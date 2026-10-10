import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../api/client'
import ForgottenSettings from '../../components/ForgottenSettings'

type Variable = { name: string; hint: string }
type Template = {
  status_id: number
  status_name: string
  status_color: string
  group: string
  text: string
  is_active: boolean
  saved: boolean
}
type GatewayStatus = { configured: boolean; sent_24h: number; daily_limit: number; queued: number; public_url: string | null }
export type Sms = {
  id: number
  created_at: string
  sent_at: string | null
  order_id: number | null
  order_number: string | null
  kind: 'status' | 'manual' | 'test'
  phone: string
  text: string
  state: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled'
  state_title: string
  error: string | null
}

export const smsStateClass: Record<Sms['state'], string> = {
  queued: 'bg-canvas text-muted',
  sending: 'bg-canvas text-muted',
  sent: 'bg-accent-soft text-ink',
  delivered: 'bg-success/15 text-success',
  failed: 'bg-danger/10 text-danger',
  cancelled: 'bg-canvas text-muted line-through',
}

const field = 'w-full rounded-md border border-line bg-surface px-3 py-2'
const groupOrder = ['new', 'inWork', 'wait', 'finish', 'closed']

export function formatDateTime(value: string | null) {
  if (!value) return ''
  return new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Подсчёт длины SMS: кириллица — 70 знаков в одном SMS, 67 в каждой части длинного. */
export function smsParts(text: string) {
  const len = [...text].length
  if (len === 0) return 0
  return len <= 70 ? 1 : Math.ceil(len / 67)
}

function TemplateRow({ item, variables, onSaved }: { item: Template; variables: Variable[]; onSaved: () => void }) {
  const [text, setText] = useState(item.text)
  const [active, setActive] = useState(item.is_active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const dirty = text !== item.text || active !== item.is_active || (!item.saved && active)

  const insert = (name: string) => {
    const el = area.current
    if (!el) return setText((t) => t + name)
    const start = el.selectionStart ?? text.length
    const end = el.selectionEnd ?? text.length
    const next = text.slice(0, start) + name + text.slice(end)
    setText(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + name.length, start + name.length)
    })
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await api.put(`/notifications/templates/${item.status_id}`, { text, is_active: active })
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`rounded-xl border p-3 ${active ? 'border-accent/40 bg-surface' : 'border-line bg-surface'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.status_color }} />
        <span className="font-medium">{item.status_name}</span>
        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Отправлять SMS
        </label>
      </div>
      <textarea
        ref={area}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Текст SMS при переходе в этот статус"
        className={`${field} text-sm ${active ? '' : 'text-muted'}`}
      />
      {(active || text) && <div className="mt-2 flex flex-wrap items-center gap-1">
        {variables.map((v) => (
          <button key={v.name} type="button" title={v.hint} onClick={() => insert(v.name)}
            className="rounded border border-line px-1.5 py-0.5 text-xs text-muted hover:border-accent hover:text-accent">
            {v.name}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">
          {[...text].length} зн. · {smsParts(text)} SMS{text.includes('{') ? ' (до подстановки)' : ''}
        </span>
        {dirty && (
          <button onClick={save} disabled={saving}
            className="rounded-md bg-accent px-3 py-1 text-sm text-accent-ink disabled:opacity-60">
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        )}
      </div>}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

export default function NotificationsPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [variables, setVariables] = useState<Variable[]>([])
  const [status, setStatus] = useState<GatewayStatus | null>(null)
  const [journal, setJournal] = useState<{ total: number; items: Sms[] }>({ total: 0, items: [] })
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState('')

  const loadJournal = useCallback(async (p: number) => {
    const [j, s] = await Promise.all([
      api.get<{ total: number; items: Sms[] }>(`/notifications?page=${p}`),
      api.get<GatewayStatus>('/notifications/status'),
    ])
    setJournal(j)
    setStatus(s)
  }, [])

  const load = useCallback(async () => {
    setError('')
    try {
      const t = await api.get<{ variables: Variable[]; items: Template[] }>('/notifications/templates')
      setTemplates(t.items)
      setVariables(t.variables)
      await loadJournal(1)
      setPage(1)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить уведомления')
    } finally {
      setLoading(false)
    }
  }, [loadJournal])

  useEffect(() => { void load() }, [load])

  // Пока в очереди что-то есть — обновляем журнал, чтобы видеть «Отправлено → Доставлено»
  useEffect(() => {
    if (!status?.queued && !journal.items.some((i) => i.state === 'sent' || i.state === 'sending')) return
    const timer = setInterval(() => void loadJournal(page).catch(() => undefined), 10000)
    return () => clearInterval(timer)
  }, [status, journal, page, loadJournal])

  const sendTest = async () => {
    setTestMsg('')
    try {
      await api.post('/notifications/test', { phone: testPhone })
      setTestMsg(status?.configured ? 'Поставлено в очередь — придёт в течение минуты' : 'Поставлено в очередь, но шлюз не подключён')
      await loadJournal(1)
      setPage(1)
    } catch (e) {
      setTestMsg(e instanceof ApiError ? e.message : 'Не удалось отправить')
    }
  }

  const sorted = [...templates].sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group))
  const pages = Math.max(1, Math.ceil(journal.total / 50))

  return (
    <section className="space-y-6">
      <h2 className="text-lg font-semibold">Уведомления клиентам</h2>
      {error && <p role="alert" className="rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? <p className="text-muted">Загрузка…</p> : (
        <>
          {status && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-3">
                <div className="text-sm text-muted">Телефон-шлюз</div>
                <div className={`mt-1 font-semibold ${status.configured ? 'text-success' : 'text-danger'}`}>
                  {status.configured ? 'Подключён' : 'Не подключён'}
                </div>
                {!status.configured && (
                  <p className="mt-1 text-xs text-muted">
                    Установите на рабочий Android приложение SMS Gateway for Android, режим Cloud server, и впишите
                    его логин и пароль в настройки сервера (SMSGATE_USER, SMSGATE_PASSWORD).
                  </p>
                )}
              </div>
              <div className="rounded-xl border border-line bg-surface p-3">
                <div className="text-sm text-muted">Отправлено за сутки</div>
                <div className="mt-1 font-semibold tabular-nums">{status.sent_24h} из {status.daily_limit}</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, (status.sent_24h / Math.max(1, status.daily_limit)) * 100)}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-line bg-surface p-3">
                <div className="text-sm text-muted">В очереди</div>
                <div className="mt-1 font-semibold tabular-nums">{status.queued}</div>
                {!status.public_url && (
                  <p className="mt-1 text-xs text-danger">Не задан PUBLIC_URL — ссылка {'{ссылка}'} в SMS будет без адреса сайта.</p>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="mb-1 font-semibold">Шаблоны по статусам</h3>
            <p className="mb-3 text-sm text-muted">
              SMS уходит автоматически при смене статуса заказа. Одному клиенту — не чаще раза в 10 минут; если статус
              сменили до отправки, уйдёт только последний. Клиенты с отметкой «не присылать SMS» сообщений не получают.
            </p>
            <div className="grid gap-3 xl:grid-cols-2">
              {sorted.map((item) => (
                <TemplateRow key={`${item.status_id}-${item.text}-${item.is_active}`} item={item} variables={variables} onSaved={load} />
              ))}
            </div>
          </div>

          <ForgottenSettings />

          <div className="rounded-xl border border-line bg-surface p-3">
            <h3 className="mb-2 font-semibold">Проверить отправку</h3>
            <div className="flex flex-wrap gap-2">
              <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+7 900 000-00-00"
                inputMode="tel" className={`${field} max-w-xs`} />
              <button onClick={sendTest} disabled={testPhone.replace(/\D/g, '').length < 10}
                className="rounded-md bg-accent px-4 py-2 text-accent-ink disabled:opacity-50">Отправить тестовое SMS</button>
            </div>
            {testMsg && <p className="mt-2 text-sm text-muted">{testMsg}</p>}
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Журнал SMS</h3>
            {journal.items.length === 0 ? <p className="text-sm text-muted">Пока ни одного сообщения.</p> : (
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-canvas text-left text-muted">
                    <tr><th className="px-3 py-2">Когда</th><th className="px-3 py-2">Заказ</th><th className="px-3 py-2">Телефон</th>
                      <th className="px-3 py-2">Текст</th><th className="px-3 py-2">Состояние</th></tr>
                  </thead>
                  <tbody>
                    {journal.items.map((i) => (
                      <tr key={i.id} className="border-t border-line align-top">
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatDateTime(i.sent_at ?? i.created_at)}</td>
                        <td className="px-3 py-2">{i.order_id ? <a className="text-accent" href={`/orders/${i.order_id}`}>{i.order_number}</a> : i.kind === 'test' ? 'тест' : '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">{i.phone}</td>
                        <td className="min-w-64 px-3 py-2">{i.text}</td>
                        <td className="px-3 py-2">
                          <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${smsStateClass[i.state]}`}>{i.state_title}</span>
                          {i.error && <div className="mt-1 text-xs text-muted">{i.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <button disabled={page <= 1} onClick={() => { setPage(page - 1); void loadJournal(page - 1) }} className="rounded border border-line px-2 py-1 disabled:opacity-40">←</button>
                <span>{page} / {pages}</span>
                <button disabled={page >= pages} onClick={() => { setPage(page + 1); void loadJournal(page + 1) }} className="rounded border border-line px-2 py-1 disabled:opacity-40">→</button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
