import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { money } from './shared'

type Dashboard = {
  orders: { created: number; in_work: number; ready: number; closed: number | null }
  overdue: { id: number; number: string; deadline: string; status_name: string; status_color: string; master_name: string | null }[] | null
  finance: { income: string; expense: string; cash_registers: { id: number; name: string; cash_balance: string; bank_balance: string }[] } | null
  how_know: { name: string; count: number }[] | null
  masters: { employee_id: number; name: string; orders_in_work: number }[] | null
}
type Location = { id: number; name: string }
type Period = 'today' | 'yesterday' | 'week' | 'month' | 'custom'

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

  const howKnowTotal = (data?.how_know ?? []).reduce((sum, item) => sum + item.count, 0)

  if (loading) return <p className="text-muted">Загрузка…</p>
  if (!data) return <section>{error && <p role="alert" className="text-danger">{error}</p>}</section>

  const { orders } = data

  return (
    <section>
      <header className="mb-5 flex flex-wrap items-end gap-3">
        <h1 className="text-xl font-semibold">Главная</h1>
        <label className="grid gap-1 text-sm text-muted">Локация
          <select className="rounded-md border border-line bg-surface px-3 py-2" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Все</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        {canPeriod && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm text-muted">Период
              <select className="rounded-md border border-line bg-surface px-3 py-2" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="today">Сегодня</option>
                <option value="yesterday">Вчера</option>
                <option value="week">7 дней</option>
                <option value="month">Месяц</option>
                <option value="custom">Свой</option>
              </select>
            </label>
            {period === 'custom' && (
              <>
                <label className="grid gap-1 text-sm text-muted">С
                  <input type="date" className="rounded-md border border-line bg-surface px-3 py-2" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                </label>
                <label className="grid gap-1 text-sm text-muted">По
                  <input type="date" className="rounded-md border border-line bg-surface px-3 py-2" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                </label>
              </>
            )}
          </div>
        )}
      </header>

      {error && <p role="alert" className="mb-4 text-danger">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Создано" value={orders.created} />
        <Tile label="В работе" value={orders.in_work} />
        <Tile label="Готово" value={orders.ready} />
        {orders.closed !== null && <Tile label="Выдано" value={orders.closed} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.overdue !== null && (
          <Card title="Просроченные">
            {data.overdue.length === 0 ? (
              <p className="text-sm text-muted">Просроченных заказов нет.</p>
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
          </Card>
        )}

        {data.finance !== null && (
          <Card title="Кассы">
            <ul className="mb-3 divide-y divide-line">
              {data.finance.cash_registers.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{r.name}</span>
                  <span className="text-muted">нал {money(r.cash_balance)} · безнал {money(r.bank_balance)}</span>
                </li>
              ))}
            </ul>
            <p className="text-right text-sm">Итого: <strong className="num">{money(cashTotal)}</strong></p>
          </Card>
        )}

        {data.finance !== null && (
          <Card title="Приход / расход за период">
            <div className="grid grid-cols-2 gap-3 text-center">
              <div>
                <p className="text-sm text-muted">Приход</p>
                <p className="num text-success">{money(data.finance.income)}</p>
              </div>
              <div>
                <p className="text-sm text-muted">Расход</p>
                <p className="num text-danger">{money(data.finance.expense)}</p>
              </div>
            </div>
          </Card>
        )}

        {data.how_know !== null && (
          <Card title="Источники рекламы">
            {data.how_know.length === 0 ? (
              <p className="text-sm text-muted">Заказов с источником рекламы за период нет.</p>
            ) : (
              <ul className="space-y-2">
                {data.how_know.map((item) => (
                  <li key={item.name} className="text-sm">
                    <div className="mb-1 flex justify-between"><span>{item.name}</span><span className="num text-muted">{item.count}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-canvas">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${howKnowTotal ? (item.count / howKnowTotal) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {data.masters !== null && (
          <Card title="Загрузка мастеров">
            {data.masters.length === 0 ? (
              <p className="text-sm text-muted">Незакрытых заказов у мастеров нет.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.masters.map((item) => (
                  <li key={item.employee_id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{item.name}</span>
                    <span className="num">{item.orders_in_work} в работе</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </section>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold num">{value}</p>
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

