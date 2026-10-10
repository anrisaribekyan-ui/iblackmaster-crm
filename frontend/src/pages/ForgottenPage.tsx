import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'

type Item = {
  id: number
  number: string
  status: string
  status_color: string
  device: string
  client: string
  phones: string | null
  days: number
  total: string
  debt: string
  last_reminder: string | null
}
type Data = { days: number; count: number; debt: string; reminders_active: boolean; items: Item[] }
type Location = { id: number; name: string }

const rub = (v: string | number) => `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`
const firstPhone = (phones: string | null) => (phones ?? '').split(',')[0]?.trim() ?? ''
const prettyPhone = (digits: string) =>
  digits.length === 11 ? `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}` : digits

/** Сколько дней лежит: 7+ — внимание, 30+ — тревога */
function DaysBadge({ days }: { days: number }) {
  const tone = days >= 30 ? 'bg-danger text-white' : days >= 7 ? 'bg-accent-soft text-accent' : 'bg-canvas text-muted'
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>{days} дн.</span>
}

/** Готовые, но не забранные аппараты (ТЗ этап 3, E1). Деньги, которые лежат на полке. */
export default function ForgottenPage() {
  const [data, setData] = useState<Data | null>(null)
  const [days, setDays] = useState<number | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<Location[]>('/locations').then(setLocations).catch(() => setLocations([]))
  }, [])

  const load = useCallback(async () => {
    setError('')
    const q = new URLSearchParams()
    if (days !== null) q.set('days', String(days))
    if (locationId) q.set('location_id', locationId)
    try {
      setData(await api.get<Data>(`/forgotten?${q}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить список')
    }
  }, [days, locationId])
  useEffect(() => { void load() }, [load])

  const current = days ?? data?.days ?? 14
  return (
    <section>
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <Link to="/orders" className="text-sm text-muted">← Заказы</Link>
          <h1 className="text-xl font-semibold">Забытые аппараты</h1>
        </div>
        <select aria-label="Локация" className="rounded-md border border-line bg-surface px-3 py-2" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Все локации</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Лежат дольше</span>
        <div className="flex rounded-md border border-line bg-surface p-0.5" role="group" aria-label="Сколько дней">
          {[3, 7, 14, 30].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              className={`rounded px-3 py-1.5 text-sm ${current === d ? 'bg-ink text-white' : 'text-muted hover:bg-canvas'}`}>
              {d} дн.
            </button>
          ))}
        </div>
      </div>

      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Аппаратов</p>
              <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums">{data.count}</p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-4">
              <p className="text-sm text-muted">Ждут оплаты</p>
              <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums">{rub(data.debt)}</p>
            </div>
          </div>
          {!data.reminders_active && data.count > 0 && (
            <p className="mb-4 rounded-lg bg-accent-soft px-3 py-2 text-sm">
              Автоматические SMS-напоминания выключены. Включить можно в <Link className="font-medium underline" to="/settings/notifications">Настройки → Уведомления</Link>.
            </p>
          )}
          {data.items.length === 0 ? (
            <p className="rounded-xl border border-line bg-surface p-5 text-muted">Все готовые аппараты забирают вовремя — забытых нет.</p>
          ) : (
            <ul className="space-y-2">
              {data.items.map((item) => {
                const phone = firstPhone(item.phones)
                return (
                  <li key={item.id} className="rounded-xl border border-line bg-surface p-3">
                    <div className="flex items-center gap-2">
                      <Link to={`/orders/${item.id}`} className="font-semibold text-accent">{item.number}</Link>
                      <span className="truncate text-sm text-muted">{item.status}</span>
                      <span className="ml-auto"><DaysBadge days={item.days} /></span>
                    </div>
                    <p className="mt-1 truncate font-medium">{item.device}</p>
                    <div className="mt-2 flex flex-wrap items-end justify-between gap-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{item.client}</p>
                        {item.last_reminder && <p className="text-xs text-muted">Напоминание: {new Date(item.last_reminder).toLocaleDateString('ru-RU')}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {Number(item.debt) > 0 && <span className="font-semibold tabular-nums">{rub(item.debt)}</span>}
                        {phone && (
                          <a href={`tel:+${phone}`} className="rounded-md border border-line px-3 py-1.5 text-sm" title={prettyPhone(phone)}>
                            Позвонить
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
