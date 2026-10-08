import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

type Earnings = {
  today: number
  today_items: { order_id: number | null; number: string | null; amount: number; kinds: string[] }[]
  week: { date: string; amount: number }[]
  month: number
  month_paid: number
  month_to_pay: number
}

const rub = (v: number | string) => `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

/** «Мой заработок» (ТЗ этап 3, C5): сегодня, месяц, к выплате и за что начислено — у каждого свои цифры. */
export default function MyEarnings() {
  const [data, setData] = useState<Earnings | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    api.get<Earnings>('/salary/me').then(setData).catch(() => setData(null))
  }, [])

  // Нет ни одного начисления за месяц (владелец без правил зарплаты) — плитка не нужна
  if (!data || (Number(data.month) === 0 && Number(data.today) === 0 && data.week.every((d) => Number(d.amount) === 0))) return null

  const max = Math.max(1, ...data.week.map((d) => Number(d.amount)))
  return (
    <section className="mb-4 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="text-sm text-muted">Мой заработок сегодня</p>
          <p className="mt-1 text-[34px] font-semibold leading-none tracking-tight tabular-nums">{rub(data.today)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">За месяц</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{rub(data.month)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">К выплате</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{rub(data.month_to_pay)}</p>
        </div>
        <div className="ml-auto flex h-14 items-end gap-1.5" aria-label="Заработок за 7 дней">
          {data.week.map((d, i) => {
            const v = Number(d.amount)
            const last = i === data.week.length - 1
            return (
              <div key={d.date} className="flex w-7 flex-col items-center gap-1" title={`${d.date.split('-').reverse().join('.')}: ${rub(v)}`}>
                <div className="w-full rounded-sm" style={{ height: `${Math.max(2, (v / max) * 40)}px`, background: last ? 'var(--viz-1)' : 'var(--viz-quiet)' }} />
                <span className={`text-[11px] ${last ? 'font-medium text-ink' : 'text-muted'}`}>{WEEKDAYS[new Date(`${d.date}T12:00:00`).getDay()]}</span>
              </div>
            )
          })}
        </div>
      </div>
      {data.today_items.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? '▾' : '▸'} За что сегодня ({data.today_items.length})
          </button>
          {open && (
            <ul className="mt-2 space-y-1 text-sm">
              {data.today_items.map((item) => (
                <li key={item.order_id ?? 'manual'} className="flex items-baseline gap-2">
                  {item.order_id ? <Link className="font-medium text-ink underline decoration-line underline-offset-2" to={`/orders/${item.order_id}`}>{item.number}</Link> : <span className="font-medium">Без заказа</span>}
                  <span className="min-w-0 flex-1 truncate text-muted">{item.kinds.join(', ')}</span>
                  <span className="tabular-nums">{rub(item.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
