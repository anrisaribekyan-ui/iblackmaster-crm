import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { downloadCsv } from '../csv'
import ChartCard from './charts/ChartCard'
import TimeChart from './charts/TimeChart'
import BarList from './charts/BarList'
import { compact, dayLong, dayShort, rub } from './charts/format'
import Skeleton from './Skeleton'

type GroupBy = 'day' | 'week' | 'month'

type ProfitRow = {
  key: string
  orders: number
  sales: number
  revenue: number
  cost: number
  gross: number
  salary: number
  bank_fee: number
  expenses: number
  net: number
  margin: number | null
}

type ProfitData = {
  rows: ProfitRow[]
  total: ProfitRow
  expense_items: { name: string; amount: number }[]
  not_counted: { name: string; amount: number }[]
}

const GROUPS: [GroupBy, string][] = [
  ['day', 'По дням'],
  ['week', 'По неделям'],
  ['month', 'По месяцам'],
]

const MONTH = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const MONTH_SHORT = new Intl.DateTimeFormat('ru-RU', { month: 'short', timeZone: 'UTC' })

function periodLabel(key: string, groupBy: GroupBy): string {
  const date = new Date(`${key}T00:00:00Z`)
  if (groupBy === 'month') {
    const text = MONTH.format(date).replace(' г.', '')
    return text.charAt(0).toUpperCase() + text.slice(1)
  }
  if (groupBy === 'week') {
    const end = new Date(date)
    end.setUTCDate(end.getUTCDate() + 6)
    return `${dayShort(key)} – ${dayShort(end.toISOString().slice(0, 10))}`
  }
  return dayLong(key)
}

function tickLabel(key: string, groupBy: GroupBy): string {
  if (groupBy === 'month') return MONTH_SHORT.format(new Date(`${key}T00:00:00Z`)).replace('.', '')
  return dayShort(key)
}

/** Ключи всех периодов между первым и последним — чтобы пустые дни/недели/месяцы были на оси нулями. */
function fillKeys(rows: ProfitRow[], groupBy: GroupBy): ProfitRow[] {
  if (rows.length === 0) return rows
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const result: ProfitRow[] = []
  const end = new Date(`${rows[rows.length - 1].key}T00:00:00Z`)
  for (let d = new Date(`${rows[0].key}T00:00:00Z`); d <= end; ) {
    const key = d.toISOString().slice(0, 10)
    result.push(byKey.get(key) ?? { key, orders: 0, sales: 0, revenue: 0, cost: 0, gross: 0, salary: 0, bank_fee: 0, expenses: 0, net: 0, margin: null })
    if (groupBy === 'month') d.setUTCMonth(d.getUTCMonth() + 1)
    else d.setUTCDate(d.getUTCDate() + (groupBy === 'week' ? 7 : 1))
  }
  return result
}

const signed = (v: number) => (v < 0 ? `−${rub(-v)}` : rub(v))
const percent = (v: number | null) => (v === null ? '—' : `${v.toLocaleString('ru-RU')} %`)

export default function ProfitReport({ range, locationId, filenameBase }: { range: { from: string; to: string } | null; locationId: string; filenameBase: string }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('day')
  const [data, setData] = useState<ProfitData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Длинный период по дням нечитаем — подбираем группировку сами, но её можно сменить
  const days = range ? Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) : 0
  useEffect(() => {
    setGroupBy(days > 120 ? 'month' : days > 45 ? 'week' : 'day')
  }, [days])

  useEffect(() => {
    if (!range) {
      setData(null)
      setError('Выберите даты «с» и «по»')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ date_from: range.from, date_to: range.to, group_by: groupBy })
    if (locationId) params.set('location_id', locationId)
    api
      .get<ProfitData>(`/reports/profit?${params}`)
      .then((result) => !cancelled && setData(result))
      .catch((e) => {
        if (cancelled) return
        setData(null)
        setError(e instanceof ApiError ? e.message : 'Не удалось загрузить отчёт')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [range?.from, range?.to, locationId, groupBy]) // eslint-disable-line react-hooks/exhaustive-deps

  const filled = useMemo(() => (data ? fillKeys(data.rows, groupBy) : []), [data, groupBy])

  const download = () => {
    if (!data) return
    const headers = ['Период', 'Заказов', 'Чеков', 'Выручка', 'Себестоимость', 'Валовая прибыль', 'Зарплата', 'Комиссия банка', 'Расходы', 'Чистая прибыль', 'Рентабельность, %']
    const line = (r: ProfitRow, name: string) => [name, r.orders, r.sales, r.revenue, r.cost, r.gross, r.salary, r.bank_fee, r.expenses, r.net, r.margin ?? '']
    downloadCsv(`${filenameBase}.csv`, headers, [...data.rows.map((r) => line(r, periodLabel(r.key, groupBy))), line(data.total, 'Итого')])
  }

  const t = data?.total
  return (
    <div className={loading && data ? 'opacity-60 transition-opacity' : ''}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Группировка">
          {GROUPS.map(([value, title]) => (
            <button
              key={value}
              type="button"
              className={`rounded px-2.5 py-1.5 text-sm ${groupBy === value ? 'bg-ink text-white' : 'text-muted hover:bg-canvas'}`}
              onClick={() => setGroupBy(value)}
            >
              {title}
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}
      {loading && !data ? (
        <Skeleton />
      ) : !data || !t ? null : t.revenue === 0 && t.expenses === 0 && t.salary === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">За выбранный период данных нет.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Выручка" value={rub(t.revenue)} note={`${t.orders} заказ. · ${t.sales} чек.`} />
            <Tile label="Валовая прибыль" value={signed(t.gross)} note={`минус запчасти и товар ${rub(t.cost)}`} />
            <Tile label="Чистая прибыль" value={signed(t.net)} note={`минус зарплата, комиссии, расходы`} accent={t.net < 0 ? 'bad' : 'good'} />
            <Tile label="Рентабельность" value={percent(t.margin)} note="чистая прибыль / выручка" />
          </div>

          {filled.length > 1 && (
            <ChartCard className="mb-4" title="Валовая и чистая прибыль">
              <TimeChart
                kind="columns"
                days={filled.map((r) => r.key)}
                label="Валовая и чистая прибыль по периодам"
                format={signed}
                axisFormat={compact}
                tick={(key) => tickLabel(key, groupBy)}
                title={(key) => periodLabel(key, groupBy)}
                series={[
                  { name: 'Валовая', color: 'var(--viz-1)', values: filled.map((r) => r.gross) },
                  { name: 'Чистая', color: 'var(--viz-2)', values: filled.map((r) => r.net) },
                ]}
              />
            </ChartCard>
          )}

          <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="mb-3 font-semibold">Из чего складывается</h2>
              <dl className="text-sm">
                <Line label="Выручка" value={rub(t.revenue)} hint="выданные заказы + чеки продаж" />
                <Line label="− Себестоимость" value={rub(t.cost)} hint="запчасти в заказах и проданный товар по закупке" />
                <Line label="= Валовая прибыль" value={signed(t.gross)} strong />
                <Line label="− Зарплата" value={rub(t.salary)} hint="начисленная за период, а не выплаченная" />
                <Line label="− Комиссия банка" value={rub(t.bank_fee)} />
                <Line label="− Расходы" value={rub(t.expenses)} hint="аренда, связь и прочие расходы по кассам" />
                <Line label="= Чистая прибыль" value={signed(t.net)} strong />
              </dl>
            </section>
            <ChartCard title="Расходы по статьям">
              {data.expense_items.length ? (
                <BarList share format={rub} items={data.expense_items.map((i) => ({ key: i.name, name: i.name, value: i.amount }))} />
              ) : (
                <p className="text-sm text-muted">Расходов нет.</p>
              )}
            </ChartCard>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Период</th>
                  {['Выручка', 'Себестоимость', 'Валовая', 'Зарплата', 'Комиссия', 'Расходы', 'Чистая', '%'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-right font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => <TableRow key={r.key} row={r} name={periodLabel(r.key, groupBy)} />)}
              </tbody>
              <tfoot className="bg-canvas font-medium">
                <TableRow row={t} name="Итого" />
              </tfoot>
            </table>
          </div>

          {data.not_counted.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              Не считаются расходом (движение денег, а не затраты): {data.not_counted.map((i) => `${i.name} — ${rub(i.amount)}`).join('; ')}.
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <button className="rounded-md border border-line bg-surface px-3 py-2" onClick={download}>Скачать CSV</button>
          </div>
        </>
      )}
    </div>
  )
}

function Tile({ label, value, note, accent }: { label: string; value: string; note: string; accent?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-2 whitespace-nowrap text-2xl font-semibold tracking-tight" style={accent ? { color: `var(--viz-${accent})` } : undefined}>{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  )
}

function Line({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-line font-semibold' : ''}`}>
      <dt>
        {label}
        {hint && <span className="block text-xs font-normal text-muted">{hint}</span>}
      </dt>
      <dd className="num whitespace-nowrap">{value}</dd>
    </div>
  )
}

function TableRow({ row, name }: { row: ProfitRow; name: string }) {
  const cell = 'num whitespace-nowrap px-3 py-2 text-right'
  return (
    <tr className="border-t border-line">
      <td className="whitespace-nowrap px-3 py-2">{name}</td>
      <td className={cell}>{rub(row.revenue)}</td>
      <td className={cell}>{rub(row.cost)}</td>
      <td className={cell}>{signed(row.gross)}</td>
      <td className={cell}>{rub(row.salary)}</td>
      <td className={cell}>{rub(row.bank_fee)}</td>
      <td className={cell}>{rub(row.expenses)}</td>
      <td className={`${cell} ${row.net < 0 ? 'text-danger' : ''}`}>{signed(row.net)}</td>
      <td className={cell}>{percent(row.margin)}</td>
    </tr>
  )
}
