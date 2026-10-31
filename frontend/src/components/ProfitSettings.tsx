import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { inputClass, shortLocation, useLocationsAndRegisters } from '../pages/shared'

type Fixed = { name: string; amount: number; location_id: number | null }
type Share = { name: string; percent: number; location_id: number | null }
type Cfg = { tax_percent: number; tax_register_ids: number[]; fixed: Fixed[]; shares: Share[] }

/** Налог и постоянные расходы за месяц: из них складывается «чистая» прибыль. */
export default function ProfitSettings({ onSaved }: { onSaved: () => void }) {
  const { can } = useAuth()
  const { locations, registers } = useLocationsAndRegisters()
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const editable = can('settingAccess')

  useEffect(() => {
    api.get<Cfg>('/reports/profit/settings').then((c) => setCfg({ ...c, shares: c.shares ?? [] })).catch(() => setCfg(null))
  }, [])
  if (!cfg) return null

  const setFixed = (index: number, patch: Partial<Fixed>) =>
    setCfg({ ...cfg, fixed: cfg.fixed.map((f, i) => (i === index ? { ...f, ...patch } : f)) })

  const save = async () => {
    setBusy(true)
    setMsg('')
    try {
      const saved = await api.put<Cfg>('/reports/profit/settings', { ...cfg, fixed: cfg.fixed.filter((f) => f.name.trim()), shares: cfg.shares.filter((x) => x.name.trim()) })
      setCfg({ ...saved, shares: saved.shares ?? [] })
      setMsg('Сохранено')
      onSaved()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  const total = cfg.fixed.reduce((sum, f) => sum + (Number(f.amount) || 0), 0)
  return (
    <details className="mb-4 rounded-xl border border-line bg-surface p-4">
      <summary className="cursor-pointer font-semibold">Налог и постоянные расходы</summary>
      <p className="mt-2 text-sm text-muted">
        Налог берётся процентом от поступлений по выбранным кассам (за вычетом возвратов). Постоянные расходы вводятся за месяц и делятся по дням периода.
        Оклад сотрудников сюда не вносится: он идёт через зарплату.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          Налог, %
          <input type="number" min={0} max={100} step="0.1" disabled={!editable} className={`${inputClass} mt-1 w-24`} value={cfg.tax_percent}
            onChange={(e) => setCfg({ ...cfg, tax_percent: Number(e.target.value) })} />
        </label>
        <fieldset className="text-sm">
          <legend className="mb-1">С каких касс считать налог</legend>
          <div className="flex flex-wrap gap-3">
            {registers.map((r) => (
              <label key={r.id} className="flex items-center gap-1.5">
                <input type="checkbox" disabled={!editable} checked={cfg.tax_register_ids.includes(r.id)}
                  onChange={(e) => setCfg({ ...cfg, tax_register_ids: e.target.checked ? [...cfg.tax_register_ids, r.id] : cfg.tax_register_ids.filter((i) => i !== r.id) })} />
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <h3 className="mb-2 mt-4 text-sm font-semibold">Постоянные расходы в месяц, всего {total.toLocaleString('ru-RU')} ₽</h3>
      <div className="grid gap-2">
        {cfg.fixed.map((f, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_12rem_auto]">
            <input aria-label="Статья" disabled={!editable} className={inputClass} value={f.name} onChange={(e) => setFixed(i, { name: e.target.value })} />
            <input aria-label="Сумма в месяц" type="number" min={0} disabled={!editable} className={`${inputClass} text-right`} value={f.amount}
              onChange={(e) => setFixed(i, { amount: Number(e.target.value) })} />
            <select aria-label="Точка" disabled={!editable} className={`${inputClass} max-sm:col-span-2`} value={f.location_id ?? ''}
              onChange={(e) => setFixed(i, { location_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Общий (все точки)</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{shortLocation(l.name)}</option>)}
            </select>
            {editable && (
              <button type="button" aria-label={`Убрать «${f.name}»`} className="rounded-md border border-line px-3 text-muted hover:bg-canvas max-sm:col-span-2 max-sm:py-2"
                onClick={() => setCfg({ ...cfg, fixed: cfg.fixed.filter((_, j) => j !== i) })}>Убрать</button>
            )}
          </div>
        ))}
      </div>
      <h3 className="mb-2 mt-4 text-sm font-semibold">Доли от чистой прибыли</h3>
      <div className="grid gap-2">
        {cfg.shares.map((x, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_12rem_auto]">
            <input aria-label="Кому" disabled={!editable} className={inputClass} value={x.name}
              onChange={(e) => setCfg({ ...cfg, shares: cfg.shares.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
            <input aria-label="Процент" type="number" min={0} max={100} step="0.1" disabled={!editable} className={`${inputClass} text-right`} value={x.percent}
              onChange={(e) => setCfg({ ...cfg, shares: cfg.shares.map((y, j) => (j === i ? { ...y, percent: Number(e.target.value) } : y)) })} />
            <select aria-label="Точка доли" disabled={!editable} className={`${inputClass} max-sm:col-span-2`} value={x.location_id ?? ''}
              onChange={(e) => setCfg({ ...cfg, shares: cfg.shares.map((y, j) => (j === i ? { ...y, location_id: e.target.value ? Number(e.target.value) : null } : y)) })}>
              <option value="">Все точки</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{shortLocation(l.name)}</option>)}
            </select>
            {editable && (
              <button type="button" aria-label={`Убрать «${x.name}»`} className="rounded-md border border-line px-3 text-muted hover:bg-canvas max-sm:col-span-2 max-sm:py-2"
                onClick={() => setCfg({ ...cfg, shares: cfg.shares.filter((_, j) => j !== i) })}>Убрать</button>
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setCfg({ ...cfg, shares: [...cfg.shares, { name: '', percent: 0, location_id: null }] })}>
            + Доля
          </button>
        </div>
      )}
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setCfg({ ...cfg, fixed: [...cfg.fixed, { name: '', amount: 0, location_id: null }] })}>
            + Статья
          </button>
          <button type="button" disabled={busy} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60" onClick={() => void save()}>Сохранить</button>
          {msg && <span role="status" className="text-sm text-muted">{msg}</span>}
        </div>
      )}
    </details>
  )
}
