import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import PhoneInput from '../components/PhoneInput'
import { formatDateTime, inputClass, money, useLocationsAndRegisters } from './shared'

type Config = { prices: Record<string, number>; commission_percent: number; can_free: boolean; configured: boolean }
type VpnClient = { id: number; name: string | null; phone: string; subscription_url: string | null; expires_at: string | null; owner: string | null }
type Result = { client: VpnClient; kind: 'issue' | 'renew'; price: string }

const TERMS: Record<string, string> = { '1': '1 месяц', '3': '3 месяца', '6': '6 месяцев', '12': '12 месяцев' }

function daysLeft(iso: string | null) {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

function PanelSettings({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [tokenSet, setTokenSet] = useState(false)
  const [ptype, setPtype] = useState('marzban')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [passwordSet, setPasswordSet] = useState(false)
  const [percent, setPercent] = useState('30')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!open) return
    api.get<{ panel_url: string; panel_type: string; panel_username: string; token_set: boolean; password_set: boolean; commission_percent: number }>('/vpn/settings').then((c) => { setUrl(c.panel_url); setPtype(c.panel_type); setLogin(c.panel_username); setTokenSet(c.token_set); setPasswordSet(c.password_set); setPercent(String(c.commission_percent)) }).catch(() => undefined)
  }, [open])
  const save = async () => {
    try {
      await api.put('/vpn/settings', { panel_type: ptype, panel_url: url.trim(), panel_username: login.trim(), panel_password: password || undefined, panel_token: token.trim() || undefined, commission_percent: Number(percent) })
      setMsg('Сохранено'); setToken(''); setPassword(''); onSaved()
    } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Не удалось сохранить') }
  }
  return (
    <div className="mt-4 rounded-xl border border-line bg-surface p-4">
      <button className="text-sm text-accent" onClick={() => setOpen(!open)}>{open ? 'Скрыть настройки панели' : 'Настройки панели (владелец)'}</button>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm text-muted">Панель
            <select className={inputClass} value={ptype} onChange={(e) => setPtype(e.target.value)}>
              <option value="marzban">Marzban</option>
              <option value="remnawave">Remnawave</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted sm:col-span-2">Адрес панели
            <input className={inputClass} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8000 или https://panel.example.com" />
          </label>
          {ptype === 'marzban' ? (<>
            <label className="grid gap-1 text-sm text-muted">Логин админа
              <input className={inputClass} autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Пароль {passwordSet && <span className="text-success">(сохранён)</span>}
              <input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          </>) : (
            <label className="grid gap-1 text-sm text-muted sm:col-span-2">API-токен {tokenSet && <span className="text-success">(сохранён)</span>}
              <input className={inputClass} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
          )}
          <label className="grid gap-1 text-sm text-muted">Сотруднику, % от цены
            <input className={`${inputClass} num`} inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, ''))} />
          </label>
          <div className="flex items-center gap-3 sm:col-span-3">
            <button className="rounded-md bg-accent px-3 py-2 text-accent-ink" onClick={() => void save()}>Сохранить</button>
            {msg && <span className="text-sm text-muted">{msg}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

export default function VpnPage() {
  const { can } = useAuth()
  const { registers } = useLocationsAndRegisters()
  const [config, setConfig] = useState<Config | null>(null)
  const [clients, setClients] = useState<VpnClient[]>([])
  const [q, setQ] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [step, setStep] = useState(0)
  const [target, setTarget] = useState('')
  const [free, setFree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [copied, setCopied] = useState(false)

  const terms = useMemo(() => Object.keys(config?.prices ?? {}).map(Number).sort((a, b) => a - b), [config])
  const months = terms[step] ?? 1
  const price = config?.prices[String(months)] ?? 0
  const perMonth = Math.round(price / months)
  const saving = terms.length ? Math.round((1 - price / months / (config?.prices[String(terms[0])] ?? price)) * 100) : 0

  const loadClients = useCallback(async () => {
    try { setClients(await api.get<VpnClient[]>(`/vpn/clients${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)) } catch { /* список необязателен */ }
  }, [q])
  useEffect(() => { api.get<Config>('/vpn/config').then(setConfig).catch((e) => setError(e instanceof ApiError ? e.message : 'Нет доступа')) }, [])
  useEffect(() => { const t = setTimeout(() => void loadClients(), 250); return () => clearTimeout(t) }, [loadClients])

  const options = registers.flatMap((r) => [
    ...(r.accepts_cash ? [{ v: `${r.id}:cash`, l: `${r.name} — нал` }] : []),
    ...(r.accepts_bank ? [{ v: `${r.id}:bank`, l: `${r.name} — безнал` }] : []),
  ])
  useEffect(() => { if (!target && options.length) setTarget(options[0].v) }, [options, target])

  const submit = async () => {
    setError('')
    setResult(null)
    setBusy(true)
    try {
      const [id, kind] = target.split(':')
      const res = await api.post<Result>('/vpn/issue', {
        phone, name: name.trim() || null, months, free,
        ...(free ? {} : { cash_register_id: Number(id), is_bank: kind === 'bank' }),
      })
      setResult(res)
      void loadClients()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось выдать доступ')
    } finally {
      setBusy(false)
    }
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* буфер недоступен */ }
  }
  const phoneOk = phone.replace(/\D/g, '').length === 11

  return (
    <section className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-[22px] font-bold leading-tight md:text-[26px]">VPN iBM</h1>
      <p className="mb-4 text-sm text-muted">Клиент закрепляется за тем, кто выдал первый доступ: он получает {config?.commission_percent ?? 30}% с выдачи и каждого продления.</p>
      {config && !config.configured && <p className="mb-3 rounded-md border border-warning p-3 text-sm">Панель VPN не подключена. Владелец: внизу страницы «Настройки панели».</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="grid content-start gap-4 rounded-xl border border-line bg-surface p-4">
          <label className="grid gap-1 text-sm text-muted">Телефон клиента
            <PhoneInput className="bg-surface" value={phone} onChange={setPhone} autoFocus />
          </label>
          <label className="grid gap-1 text-sm text-muted">Имя (необязательно)
            <input className={inputClass} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm text-muted">Срок</span>
              <span className="text-sm font-medium">{TERMS[String(months)] ?? `${months} мес.`}</span>
            </div>
            <input aria-label="Тариф" className="w-full accent-[var(--color-accent)]" type="range" min={0} max={Math.max(0, terms.length - 1)} step={1} value={step}
              onChange={(e) => setStep(Number(e.target.value))} />
            <div className="mt-1 flex justify-between text-xs text-muted">
              {terms.map((t, i) => <button key={t} type="button" className={i === step ? 'font-semibold text-ink' : ''} onClick={() => setStep(i)}>{t} мес</button>)}
            </div>
            <p className="mt-3 flex items-baseline justify-between">
              <strong className="num text-3xl">{free ? '0 ₽' : money(price)}</strong>
              <span className="text-sm text-muted num">{months > 1 ? `${money(perMonth)} в месяц${saving > 0 ? ` · выгода ${saving}%` : ''}` : 'без скидки'}</span>
            </p>
          </div>
          {config?.can_free && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />Выдать без оплаты</label>
          )}
          {!free && (
            <label className="grid gap-1 text-sm text-muted">Принял оплату в кассу
              <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
                {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </label>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button disabled={busy || !phoneOk || !config?.configured || (!free && !target)} onClick={() => void submit()}
            className="rounded-md bg-accent px-3 py-3 font-medium text-accent-ink disabled:opacity-50">
            {busy ? 'Выдаю…' : free ? 'Выдать доступ' : `Принял ${money(price)} — выдать доступ`}
          </button>
          {result && (
            <div className="grid gap-2 rounded-lg border border-success p-3 text-sm">
              <p className="font-medium text-success">{result.kind === 'issue' ? 'Доступ выдан' : 'Подписка продлена'} · до {formatDateTime(result.client.expires_at)}</p>
              {result.client.subscription_url && <>
                <input readOnly className={`${inputClass} num`} value={result.client.subscription_url} onFocus={(e) => e.currentTarget.select()} />
                <button className="rounded-md border border-line px-3 py-2" onClick={() => void copy(result.client.subscription_url ?? '')}>{copied ? 'Скопировано ✓' : 'Скопировать ссылку'}</button>
              </>}
              <p className="text-muted">Закреплён за: {result.client.owner ?? '—'}</p>
            </div>
          )}
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <input className={`${inputClass} mb-3`} placeholder="Найти клиента: телефон или имя" value={q} onChange={(e) => setQ(e.target.value)} />
          {clients.length === 0 ? <p className="text-sm text-muted">Клиентов пока нет.</p> : (
            <ul className="divide-y divide-line">
              {clients.map((c) => {
                const d = daysLeft(c.expires_at)
                return (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <button className="min-w-0 text-left" onClick={() => { setPhone(c.phone); setName(c.name ?? ''); setResult(null) }} title="Подставить в форму для продления">
                      <span className="block truncate font-medium">{c.name || c.phone}</span>
                      <span className="text-xs text-muted num">+{c.phone} · {c.owner ?? 'без закрепления'}</span>
                    </button>
                    <span className={`whitespace-nowrap text-xs ${d === null ? 'text-muted' : d < 0 ? 'text-danger' : d <= 7 ? 'text-warning' : 'text-success'}`}>
                      {d === null ? '—' : d < 0 ? `истёк ${-d} дн. назад` : `ещё ${d} дн.`}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          {can('vpnAccess') && <p className="mt-3 text-xs text-muted">Нажмите на клиента, чтобы продлить его подписку.</p>}
        </div>
      </div>
      {can('settingAccess') && <PanelSettings onSaved={() => api.get<Config>('/vpn/config').then(setConfig).catch(() => undefined)} />}
    </section>
  )
}
