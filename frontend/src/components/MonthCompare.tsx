import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { rub } from './charts/format'

type Row = { key: string; orders: number; sales: number; revenue: number; gross: number; net: number; margin: number | null }

const MSK = 3 * 60 * 60 * 1000
const utc = (y: number, m: number) => new Date(Date.UTC(y, m - 1, 1) - MSK).toISOString()
const NAME = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })

function mskNow() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0)
  return { y: g('year'), m: g('month') }
}

const METRICS: { key: keyof Row; label: string; money: boolean }[] = [
  { key: 'orders', label: 'Заказов', money: false },
  { key: 'sales', label: 'Продаж', money: false },
  { key: 'revenue', label: 'Выручка', money: true },
  { key: 'gross', label: 'Валовая прибыль', money: true },
  { key: 'net', label: 'Чистая прибыль', money: true },
]

/** Последний полный месяц против предыдущего: одним запросом отчёта прибыли по месяцам. */
export default function MonthCompare({ locationId }: { locationId?: string }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const { y, m } = mskNow()
  const lastStart = new Date(Date.UTC(y, m - 2, 1))
  const prevStart = new Date(Date.UTC(y, m - 3, 1))
  const lastKey = lastStart.toISOString().slice(0, 7)
  const prevKey = prevStart.toISOString().slice(0, 7)

  useEffect(() => {
    // Два месяца: предыдущий и последний полный
    const start = new Date(Date.UTC(y, m - 3, 1))
    const params = new URLSearchParams({ date_from: utc(start.getUTCFullYear(), start.getUTCMonth() + 1), date_to: utc(y, m), group_by: 'month' })
    if (locationId) params.set('location_id', locationId)
    let cancelled = false
    api.get<{ rows: Row[] }>(`/reports/profit?${params}`)
      .then((r) => !cancelled && setRows(r.rows))
      .catch(() => !cancelled && setFailed(true))
    return () => { cancelled = true }
  }, [locationId, y, m])

  if (failed) return null
  const find = (key: string) => rows?.find((r) => r.key.slice(0, 7) === key)
  const last = find(lastKey)
  const prev = find(prevKey)
  const title = (d: Date) => { const t = NAME.format(d).replace(' г.', ''); return t.charAt(0).toUpperCase() + t.slice(1) }

  return (
    <div className="mb-4 rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-medium">Сравнение: {title(lastStart)} и {title(prevStart)}</h2>
      {rows === null ? <div role="status" aria-label="Загрузка сравнения" className="grid gap-2 pt-1">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="ui-skel h-[25px]" />)}</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 font-medium"></th><th className="py-1 pl-3 text-right font-medium">{title(lastStart)}</th><th className="py-1 pl-3 text-right font-medium">{title(prevStart)}</th><th className="py-1 pl-3 text-right font-medium">Изменение</th></tr>
            </thead>
            <tbody>
              {METRICS.map((mt) => {
                const a = Number(last?.[mt.key] ?? 0)
                const b = Number(prev?.[mt.key] ?? 0)
                const diff = a - b
                const pct = b !== 0 ? Math.round((diff / Math.abs(b)) * 100) : null
                const fmt = (v: number) => (mt.money ? (v < 0 ? `−${rub(-v)}` : rub(v)) : String(v))
                return (
                  <tr key={mt.key} className="border-t border-line-soft">
                    <td className="py-1.5">{mt.label}</td>
                    <td className="py-1.5 text-right num">{fmt(a)}</td>
                    <td className="py-1.5 text-right num text-muted">{fmt(b)}</td>
                    <td className={`py-1.5 text-right num ${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted'}`}>
                      {diff > 0 ? '+' : diff < 0 ? '−' : ''}{fmt(Math.abs(diff))}{pct !== null ? ` (${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(pct)} %)` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
