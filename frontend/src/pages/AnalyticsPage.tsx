import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { downloadCsv } from '../csv'
import { money, qty } from './shared'
import BarList from '../components/charts/BarList'
import ChartCard from '../components/charts/ChartCard'
import TimeChart from '../components/charts/TimeChart'
import { compact, count, dayLong, fillDays, rub } from '../components/charts/format'

type TabKey = 'orders' | 'works' | 'sales' | 'cashflow' | 'stock'
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom'
type Location = { id: number; name: string }
type Row = Record<string, unknown>
type Column = { field: string; label: string; kind: 'text' | 'money' | 'number' }

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000

function moscowMidnightUtc(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d) - MOSCOW_OFFSET_MS).toISOString()
}

function moscowNow(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day') }
}

function addDays(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const date = new Date(Date.UTC(y, m - 1, d + delta))
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function periodRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } | null {
  const today = moscowNow()
  if (period === 'today') return null
  if (period === 'yesterday') {
    const day = addDays(today.y, today.m, today.d, -1)
    return { from: moscowMidnightUtc(day.y, day.m, day.d), to: moscowMidnightUtc(today.y, today.m, today.d) }
  }
  if (period === 'week') {
    const day = addDays(today.y, today.m, today.d, -6)
    return { from: moscowMidnightUtc(day.y, day.m, day.d), to: moscowMidnightUtc(today.y, today.m, today.d + 1) }
  }
  if (period === 'month') {
    return { from: moscowMidnightUtc(today.y, today.m, 1), to: moscowMidnightUtc(today.y, today.m, today.d + 1) }
  }
  if (!customFrom || !customTo) return null
  const [fy, fm, fd] = customFrom.split('-').map(Number)
  const [ty, tm, td] = customTo.split('-').map(Number)
  return { from: moscowMidnightUtc(fy, fm, fd), to: moscowMidnightUtc(ty, tm, td + 1) }
}

const PERIODS: [Period, string][] = [
  ['today', 'Сегодня'],
  ['yesterday', 'Вчера'],
  ['week', '7 дней'],
  ['month', 'Месяц'],
  ['custom', 'Период'],
]

const TABS: { key: TabKey; label: string }[] = [
  { key: 'orders', label: 'Заказы' },
  { key: 'works', label: 'Работы и запчасти' },
  { key: 'sales', label: 'Продажи' },
  { key: 'cashflow', label: 'Деньги' },
  { key: 'stock', label: 'Склад' },
]

const GROUP_OPTIONS: Record<TabKey, { value: string; label: string }[]> = {
  orders: [
    { value: 'master', label: 'Мастер' },
    { value: 'manager', label: 'Менеджер' },
    { value: 'order_type', label: 'Тип заказа' },
    { value: 'status', label: 'Статус' },
    { value: 'how_know', label: 'Источник рекламы' },
    { value: 'day', label: 'День' },
  ],
  works: [
    { value: 'performer', label: 'Исполнитель' },
    { value: 'nomenclature', label: 'Номенклатура' },
  ],
  sales: [
    { value: 'seller', label: 'Продавец' },
    { value: 'day', label: 'День' },
    { value: 'nomenclature', label: 'Номенклатура' },
  ],
  cashflow: [
    { value: 'cash_item', label: 'Статья' },
    { value: 'cash_register', label: 'Касса' },
    { value: 'day', label: 'День' },
  ],
  stock: [],
}

const BASE_COLUMNS: Record<TabKey, Column[]> = {
  orders: [
    { field: 'name', label: 'Группа', kind: 'text' },
    { field: 'count', label: 'Кол-во', kind: 'number' },
    { field: 'revenue', label: 'Выручка', kind: 'money' },
  ],
  works: [
    { field: 'name', label: 'Группа', kind: 'text' },
    { field: 'quantity', label: 'Кол-во', kind: 'number' },
    { field: 'revenue', label: 'Выручка', kind: 'money' },
  ],
  sales: [
    { field: 'name', label: 'Группа', kind: 'text' },
    { field: 'count', label: 'Кол-во', kind: 'number' },
    { field: 'revenue', label: 'Выручка', kind: 'money' },
  ],
  cashflow: [
    { field: 'name', label: 'Группа', kind: 'text' },
    { field: 'income', label: 'Приход', kind: 'money' },
    { field: 'expense', label: 'Расход', kind: 'money' },
  ],
  stock: [
    { field: 'store_name', label: 'Склад', kind: 'text' },
    { field: 'positions', label: 'Позиций', kind: 'number' },
    { field: 'quantity', label: 'Кол-во', kind: 'number' },
  ],
}

const MARGIN_COLUMNS: Column[] = [
  { field: 'cost', label: 'Себестоимость', kind: 'money' },
  { field: 'profit', label: 'Прибыль', kind: 'money' },
]

export default function AnalyticsPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<TabKey>('orders')
  const [groupBy, setGroupBy] = useState('master')
  const [isWork, setIsWork] = useState(true)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [period, setPeriod] = useState<Period>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Location[]>('/locations').then(setLocations).catch(() => setLocations([]))
  }, [])

  const changeTab = (next: TabKey) => {
    setTab(next)
    setGroupBy(GROUP_OPTIONS[next][0]?.value ?? '')
    setRows(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (locationId) params.set('location_id', locationId)
      const range = periodRange(period, customFrom, customTo)
      if (range) {
        params.set('date_from', range.from)
        params.set('date_to', range.to)
      }
      let path = ''
      if (tab === 'orders') path = `/reports/orders?${params}&group_by=${groupBy}`
      else if (tab === 'works') path = `/reports/works?${params}&group_by=${groupBy}&is_work=${isWork}`
      else if (tab === 'sales') path = `/reports/sales?${params}&group_by=${groupBy}`
      else if (tab === 'cashflow') path = `/reports/cashflow?${params}&group_by=${groupBy}`
      else path = `/reports/stock-value?${params}`
      setRows(await api.get<Row[]>(path))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить отчёт')
      setRows(null)
    } finally {
      setLoading(false)
    }
  }, [tab, groupBy, isWork, locationId, period, customFrom, customTo])

  useEffect(() => {
    void load()
  }, [load])

  const columns = useMemo(() => {
    const base = BASE_COLUMNS[tab]
    if (tab === 'stock') {
      const hasValue = rows?.some((r) => r.value !== null && r.value !== undefined)
      return hasValue ? [...base, { field: 'value', label: 'Сумма', kind: 'money' as const }] : base
    }
    const hasMargin = rows?.some((r) => r.cost !== null && r.cost !== undefined)
    return hasMargin ? [...base, ...MARGIN_COLUMNS] : base
  }, [tab, rows])

  const totals = useMemo(() => {
    const result: Record<string, number> = {}
    if (!rows) return result
    for (const col of columns) {
      if (col.kind === 'money' || col.kind === 'number') {
        result[col.field] = rows.reduce((sum, row) => sum + Number(row[col.field] ?? 0), 0)
      }
    }
    return result
  }, [rows, columns])

  const filename = useMemo(() => {
    if (tab === 'stock') return 'отчёт-склад.csv'
    const today = moscowNow()
    let from: { y: number; m: number; d: number } = today
    let to: { y: number; m: number; d: number } = today
    if (period === 'yesterday') {
      from = addDays(today.y, today.m, today.d, -1)
      to = from
    } else if (period === 'week') {
      from = addDays(today.y, today.m, today.d, -6)
    } else if (period === 'month') {
      from = { y: today.y, m: today.m, d: 1 }
    } else if (period === 'custom' && customFrom && customTo) {
      const [fy, fm, fd] = customFrom.split('-').map(Number)
      const [ty, tm, td] = customTo.split('-').map(Number)
      from = { y: fy, m: fm, d: fd }
      to = { y: ty, m: tm, d: td }
    }
    const names: Record<TabKey, string> = { orders: 'заказы', works: 'работы', sales: 'продажи', cashflow: 'деньги', stock: 'склад' }
    return `отчёт-${names[tab]}-${fmt(from.y, from.m, from.d)}-${fmt(to.y, to.m, to.d)}.csv`
  }, [tab, period, customFrom, customTo])

  const download = () => {
    if (!rows) return
    const headers = columns.map((c) => c.label)
    const data = rows.map((row) => columns.map((c) => (row[c.field] ?? '') as string | number | null | undefined))
    downloadCsv(filename, headers, data)
  }

  if (!can('reportAccess')) {
    return <section><h1 className="text-xl font-semibold">Аналитика</h1><p className="mt-4 text-muted">Нет доступа к отчётам.</p></section>
  }

  return (
    <section>
      <h1 className="mb-5 text-xl font-semibold">Аналитика</h1>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="an-location">Локация</label>
        <select id="an-location" className="rounded-md border border-line bg-surface px-3 py-2" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Все локации</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <div className="flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Период">
          {PERIODS.map(([value, title]) => (
            <button
              key={value}
              type="button"
              className={`rounded px-2.5 py-1.5 text-sm ${period === value ? 'bg-ink text-white' : 'text-muted hover:bg-canvas'}`}
              onClick={() => setPeriod(value)}
            >
              {title}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <>
            <input type="date" aria-label="С" className="rounded-md border border-line bg-surface px-3 py-2" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <input type="date" aria-label="По" className="rounded-md border border-line bg-surface px-3 py-2" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </>
        )}
      </div>

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 ${tab === t.key ? 'border-accent font-medium' : 'border-transparent text-muted'}`} onClick={() => changeTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {GROUP_OPTIONS[tab].length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">Группировать по
            <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {GROUP_OPTIONS[tab].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
        {tab === 'works' && (
          <label className="flex items-center gap-2 text-sm text-muted">Тип
            <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={isWork ? 'true' : 'false'} onChange={(e) => setIsWork(e.target.value === 'true')}>
              <option value="true">Работы</option>
              <option value="false">Запчасти</option>
            </select>
          </label>
        )}
      </div>

      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : rows === null ? (
        <p className="text-muted">Отчёт недоступен.</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">За выбранный период данных нет.</p>
      ) : (
        <>
        <ReportChart tab={tab} groupBy={groupBy} rows={rows} />
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>{columns.map((c) => <th key={c.field} className={`px-3 py-2 font-medium ${c.kind !== 'text' ? 'text-right' : ''}`}>{c.label}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-t border-line">
                  {columns.map((c) => (
                    <td key={c.field} className={`px-3 py-2 ${c.kind !== 'text' ? 'text-right num' : ''}`}>
                      {groupBy === 'day' && c.field === 'name' ? dayLong(String(row.key)) : formatCell(row[c.field], c.kind)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-canvas font-medium">
                {columns.map((c) => (
                  <td key={c.field} className={`px-3 py-2 ${c.kind !== 'text' ? 'text-right num' : ''}`}>
                    {c.kind === 'text' ? 'Итого' : formatCell(totals[c.field], c.kind)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}

      {rows && rows.length > 0 && (
        <div className="mt-4 flex justify-end">
          <button className="rounded-md border border-line bg-surface px-3 py-2" onClick={download}>Скачать CSV</button>
        </div>
      )}
    </section>
  )
}

function formatCell(value: unknown, kind: Column['kind']): string {
  if (value === null || value === undefined) return '—'
  if (kind === 'money') return money(value as string | number)
  if (kind === 'number') return qty(value as string | number)
  return String(value)
}


const num = (v: unknown) => Number(v ?? 0)

/** График над таблицей отчёта: по дням — динамика, по группам — рейтинг полосами. */
function ReportChart({ tab, groupBy, rows }: { tab: TabKey; groupBy: string; rows: Row[] }) {
  const hasProfit = rows.some((r) => r.profit !== null && r.profit !== undefined)

  if (tab === 'stock') {
    const hasValue = rows.some((r) => r.value !== null && r.value !== undefined)
    return (
      <ChartCard className="mb-4" title={hasValue ? 'Товар на складах, в закупочных ценах' : 'Товар на складах, штук'}>
        <BarList
          share
          format={hasValue ? rub : count}
          items={rows.map((r) => ({ key: String(r.store_id), name: String(r.store_name), value: num(hasValue ? r.value : r.quantity) }))}
        />
      </ChartCard>
    )
  }

  if (groupBy === 'day') {
    type DayRow = Row & { key: string }
    const filled = fillDays<DayRow>(
      rows.map((r) => ({ ...r, key: String(r.key) })),
      (key) => ({ key, name: key, revenue: 0, profit: 0, income: 0, expense: 0 }) as DayRow,
    )
    const days = filled.map((r) => r.key)
    if (days.length < 2) return null
    if (tab === 'cashflow') {
      return (
        <ChartCard className="mb-4" title="Приход и расход по дням">
          <TimeChart
            kind="columns"
            days={days}
            label="Приход и расход по дням"
            format={rub}
            axisFormat={compact}
            series={[
              { name: 'Приход', color: 'var(--viz-1)', values: filled.map((r) => num(r.income)) },
              { name: 'Расход', color: 'var(--viz-2)', values: filled.map((r) => num(r.expense)) },
            ]}
          />
        </ChartCard>
      )
    }
    return (
      <ChartCard className="mb-4" title={hasProfit ? 'Выручка и прибыль по дням' : 'Выручка по дням'}>
        <TimeChart
          days={days}
          label="Выручка по дням"
          format={rub}
          axisFormat={compact}
          series={[
            { name: 'Выручка', color: 'var(--viz-1)', values: filled.map((r) => num(r.revenue)) },
            ...(hasProfit ? [{ name: 'Прибыль', color: 'var(--viz-2)', values: filled.map((r) => num(r.profit)) }] : []),
          ]}
        />
      </ChartCard>
    )
  }

  if (tab === 'cashflow') {
    const income = rows.filter((r) => num(r.income) > 0)
    const expense = rows.filter((r) => num(r.expense) > 0)
    return (
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Приход">
          {income.length ? <BarList share format={rub} items={income.map((r) => ({ key: String(r.key), name: String(r.name), value: num(r.income) }))} /> : <p className="text-sm text-muted">Прихода нет.</p>}
        </ChartCard>
        <ChartCard title="Расход">
          {expense.length ? <BarList share format={rub} items={expense.map((r) => ({ key: String(r.key), name: String(r.name), value: num(r.expense) }))} /> : <p className="text-sm text-muted">Расхода нет.</p>}
        </ChartCard>
      </div>
    )
  }

  return (
    <div className={`mb-4 grid gap-4 ${hasProfit ? 'lg:grid-cols-2' : ''}`}>
      <ChartCard title="Выручка">
        <BarList share format={rub} items={rows.map((r) => ({ key: String(r.key), name: String(r.name), value: num(r.revenue) }))} />
      </ChartCard>
      {hasProfit && (
        <ChartCard title="Прибыль" subtitle="Выручка минус себестоимость">
          <BarList format={rub} items={rows.map((r) => ({ key: String(r.key), name: String(r.name), value: Math.max(0, num(r.profit)) }))} />
        </ChartCard>
      )}
    </div>
  )
}
