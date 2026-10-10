import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import BarList from '../components/charts/BarList'
import ChartCard from '../components/charts/ChartCard'
import StatTile from '../components/charts/StatTile'
import MyEarnings from '../components/MyEarnings'
import ForgottenBanner from '../components/ForgottenBanner'
import TimeChart from '../components/charts/TimeChart'
import { compact, count, dayShort, rub } from '../components/charts/format'

type Dashboard = {
  orders: { created: number; in_work: number; ready: number; closed: number | null }
  overdue: { id: number; number: string; deadline: string; status_name: string; status_color: string; master_name: string | null }[] | null
  finance: { income: string; expense: string; revenue: string; cash_registers: { id: number; name: string; cash_balance: string; bank_balance: string }[] } | null
  how_know: { name: string; count: number }[] | null
  masters: { employee_id: number; name: string; orders_in_work: number }[] | null
  trend: { day: string; created: number; closed: number | null; income: string | null; expense: string | null; revenue: string | null; profit: string | null }[]
  previous: { created: number; closed: number | null; income: string | null; revenue: string | null }
}
type Location = { id: number; name: string }
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

const PERIOD_LABELS: Record<Period, string> = { today: 'Сегодня', yesterday: 'Вчера', week: '7 дней', month: 'Месяц', custom: 'Период' }
const PERIOD_NAMES: Record<Period, string> = { today: 'сегодня', yesterday: 'вчера', week: '7 дней', month: 'месяц', custom: 'период' }

const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000

function moscowMidnightUtc(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d) - MOSCOW_OFFSET_MS).toISOString()
}

function moscowNow(): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day') }
}

function periodRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } | null {
  const { y, m, d } = moscowNow()
  if (period === 'today') return null
  if (period === 'yesterday') return { from: moscowMidnightUtc(y, m, d - 1), to: moscowMidnightUtc(y, m, d) }
  if (period === 'week') return { from: moscowMidnightUtc(y, m, d - 6), to: moscowMidnightUtc(y, m, d + 1) }
  if (period === 'month') return { from: moscowMidnightUtc(y, m, 1), to: moscowMidnightUtc(y, m, d + 1) }
  if (!customFrom || !customTo) return null
  const [fy, fm, fd] = customFrom.split('-').map(Number)
  const [ty, tm, td] = customTo.split('-').map(Number)
  return { from: moscowMidnightUtc(fy, fm, fd), to: moscowMidnightUtc(ty, tm, td + 1) }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export default function DashboardPage() {
  const { can } = useAuth()
  const canPeriod = can('dashboardOrderPeriodAccess')
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [period, setPeriod] = useState<Period>('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<Location[]>('/locations').then(setLocations).catch(() => setLocations([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (locationId) params.set('location_id', locationId)
      const range = periodRange(period, customFrom, customTo)
      if (range && canPeriod) {
        params.set('date_from', range.from)
        params.set('date_to', range.to)
      }
      setData(await api.get<Dashboard>(`/dashboard?${params.toString()}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить главную')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [locationId, period, customFrom, customTo, canPeriod])

  useEffect(() => {
    void load()
  }, [load])

  const cashTotal = useMemo(() => {
    const registers = data?.finance?.cash_registers ?? []
    return registers.reduce((sum, r) => sum + Number(r.cash_balance) + Number(r.bank_balance), 0)
  }, [data])

  if (loading && !data) return <p className="text-muted">Загрузка…</p>
  if (!data) return <section>{error && <p role="alert" className="text-danger">{error}</p>}</section>

  const { orders, trend, previous } = data
  const days = trend.map((t) => t.day)
  const last14 = trend.slice(-14)
  const hasMoney = data.finance !== null
  const hasClosed = orders.closed !== null
  const hasProfit = trend.some((t) => t.profit !== null)
  const periodName = canPeriod ? PERIOD_NAMES[period] : 'сегодня'

  return (
    <section className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-xl font-semibold">Главная</h1>
        <label className="sr-only" htmlFor="dash-location">Локация</label>
          <select id="dash-location" className="rounded-md border border-line bg-surface px-3 py-2" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Все локации</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        {canPeriod && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Период">
              {(Object.keys(PERIOD_NAMES) as Period[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`rounded px-2.5 py-1.5 text-sm ${period === p ? 'bg-ink text-white' : 'text-muted hover:bg-canvas'}`}
                  onClick={() => setPeriod(p)}
                >
                  {PERIOD_LABELS[p]}
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
        )}
      </header>

      {error && <p role="alert" className="mb-4 text-danger">{error}</p>}

      <ForgottenBanner locationId={locationId} />
      <MyEarnings />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {hasMoney && (
          <div className="col-span-2 xl:col-span-1">
            <StatTile
              hero
              label={`Выручка, ${periodName}`}
              value={Number(data.finance!.revenue)}
              format={rub}
              previous={previous.revenue === null ? null : Number(previous.revenue)}
              trend={last14.map((t) => Number(t.revenue ?? 0))}
            />
          </div>
        )}
        <StatTile label={`Принято заказов, ${periodName}`} value={orders.created} format={count} previous={previous.created} trend={last14.map((t) => t.created)} />
        {hasClosed && (
          <StatTile label={`Выдано, ${periodName}`} value={orders.closed!} format={count} previous={previous.closed} trend={last14.map((t) => t.closed ?? 0)} />
        )}
        <div className="flex min-h-28 flex-col justify-between rounded-xl border border-line bg-surface p-4">
          <p className="text-sm text-muted">Сейчас в работе</p>
          <div>
            <p className="text-[28px] font-semibold leading-none">{count(orders.in_work)}</p>
            <p className="mt-2 text-xs text-muted">из них готово к выдаче: <strong className="num text-ink">{orders.ready}</strong></p>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        {hasMoney && (
          <ChartCard
            title={hasProfit ? 'Выручка и прибыль по дням' : 'Выручка по дням'}
            subtitle="Последние 30 дней: выданные заказы и продажи"
            table={{
              headers: hasProfit ? ['День', 'Выручка', 'Прибыль'] : ['День', 'Выручка'],
              rows: [...trend].reverse().map((t) => (hasProfit ? [dayShort(t.day), rub(Number(t.revenue)), rub(Number(t.profit))] : [dayShort(t.day), rub(Number(t.revenue))])),
            }}
          >
            <TimeChart
              kind="columns"
              days={days}
              label="Выручка и прибыль по дням за 30 дней"
              format={rub}
              axisFormat={compact}
              series={[
                { name: 'Выручка', color: 'var(--viz-1)', values: trend.map((t) => Number(t.revenue ?? 0)) },
                ...(hasProfit ? [{ name: 'Прибыль', color: 'var(--viz-2)', values: trend.map((t) => Number(t.profit ?? 0)) }] : []),
              ]}
            />
          </ChartCard>
        )}
        <ChartCard
          title="Заказы по дням"
          subtitle={hasClosed ? 'Последние 30 дней: сколько приняли и сколько выдали' : 'Последние 30 дней: сколько приняли'}
          table={{
            headers: hasClosed ? ['День', 'Принято', 'Выдано'] : ['День', 'Принято'],
            rows: [...trend].reverse().map((t) => (hasClosed ? [dayShort(t.day), t.created, t.closed ?? 0] : [dayShort(t.day), t.created])),
          }}
        >
          <TimeChart
            days={days}
            label="Принятые и выданные заказы по дням за 30 дней"
            format={count}
            series={[
              { name: 'Принято', color: 'var(--viz-1)', values: trend.map((t) => t.created) },
              ...(hasClosed ? [{ name: 'Выдано', color: 'var(--viz-2)', values: trend.map((t) => t.closed ?? 0) }] : []),
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.how_know !== null && (
          <ChartCard title="Откуда клиенты" subtitle={`Источники рекламы, ${periodName}`}>
            {data.how_know.length === 0 ? (
              <p className="text-sm text-muted">За период заказов с источником нет. Источник указывают при приёме заказа.</p>
            ) : (
              <BarList share format={count} items={data.how_know.map((h) => ({ key: h.name, name: h.name, value: h.count }))} />
            )}
          </ChartCard>
        )}

        {data.masters !== null && (
          <ChartCard title="Загрузка мастеров" subtitle="Незакрытые заказы сейчас">
            {data.masters.length === 0 ? (
              <p className="text-sm text-muted">Незакрытых заказов у мастеров нет.</p>
            ) : (
              <BarList format={(v) => `${count(v)} в работе`} items={data.masters.map((m) => ({ key: m.employee_id, name: m.name, value: m.orders_in_work }))} />
            )}
          </ChartCard>
        )}

        {data.finance !== null && (
          <ChartCard title="Деньги в кассах" subtitle="Остаток сейчас">
            <p className="mb-3 text-3xl font-semibold">{rub(cashTotal)}</p>
            <ul className="divide-y divide-line text-sm">
              {data.finance.cash_registers.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="truncate">{r.name}</span>
                  <span className="num shrink-0 font-medium">{rub(Number(r.cash_balance) + Number(r.bank_balance))}</span>
                </li>
              ))}
            </ul>
          </ChartCard>
        )}

        {data.overdue !== null && (
          <ChartCard title="Просроченные" subtitle={data.overdue.length ? `${data.overdue.length} заказ(ов) после срока` : undefined}>
            {data.overdue.length === 0 ? (
              <p className="text-sm text-muted">Просроченных заказов нет 👍</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.overdue.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link className="font-medium text-accent hover:underline" to={`/orders/${item.id}`}>{item.number}</Link>
                    <span className="text-muted">{formatDate(item.deadline)}</span>
                    <span className="whitespace-nowrap rounded-full px-2 py-1 text-xs" style={{ color: item.status_color, backgroundColor: `${item.status_color}22` }}>{item.status_name}</span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        )}
      </div>
    </section>
  )
}

