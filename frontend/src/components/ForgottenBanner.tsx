import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

const rub = (v: string | number) => `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`

function devicesWord(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'аппарат'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'аппарата'
  return 'аппаратов'
}

/** Полоса на главной: «на полках N готовых аппаратов на X ₽» — видна, только если такие есть. */
export default function ForgottenBanner({ locationId }: { locationId: string }) {
  const [data, setData] = useState<{ days: number; count: number; debt: string } | null>(null)
  useEffect(() => {
    api.get<{ days: number; count: number; debt: string }>(`/forgotten/summary${locationId ? `?location_id=${locationId}` : ''}`)
      .then(setData)
      .catch(() => setData(null))
  }, [locationId])
  if (!data || data.count === 0) return null
  return (
    <Link to="/orders/forgotten" className="mb-4 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft p-4 hover:border-accent">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-lg font-semibold text-white tabular-nums">{data.count}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {data.count} {devicesWord(data.count)} не забрали дольше {data.days} дней
        </span>
        <span className="block text-sm text-muted">
          {Number(data.debt) > 0 ? `Ждут оплаты ${rub(data.debt)} — ` : ''}позвонить и напомнить
        </span>
      </span>
      <span aria-hidden className="text-xl text-accent">→</span>
    </Link>
  )
}
