import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'

export type QuickOrder = {
  id: number
  name: string
  device_type: string | null
  brand: string | null
  model: string | null
  problems: string[]
  approximate_price: string | null
  works: { name: string; price: number; guarantee_days: number }[]
  parts_note: string | null
  total: number
  sort: number
  uses: number
  is_active: boolean
}

const rub = (v: number) => `${v.toLocaleString('ru-RU')} ₽`

/** Ряд «быстрых заказов» на приёмке (ТЗ этап 3, E3). Подходящие к введённой модели — первыми. */
export default function QuickOrderPicker({
  model,
  selected,
  onSelect,
}: {
  model: string
  selected: QuickOrder | null
  onSelect: (q: QuickOrder | null) => void
}) {
  const { can } = useAuth()
  const [items, setItems] = useState<QuickOrder[]>([])
  useEffect(() => {
    api.get<QuickOrder[]>('/quick-orders').then(setItems).catch(() => setItems([]))
  }, [])

  const sorted = useMemo(() => {
    const m = model.trim().toLowerCase()
    if (!m) return items
    const match = (q: QuickOrder) => (q.model ?? '').toLowerCase() === m
    return [...items.filter(match), ...items.filter((q) => !match(q))]
  }, [items, model])

  if (items.length === 0) {
    return can('settingAccess') ? (
      <p className="text-sm text-muted">
        Частые ремонты можно принимать одной кнопкой — <Link className="text-accent" to="/settings/quick-orders">настроить быстрые заказы</Link>.
      </p>
    ) : null
  }

  if (selected) {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent-soft p-3 text-sm">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{selected.name}</p>
            <p className="mt-0.5 text-muted">
              Добавятся работы: {selected.works.map((w) => `${w.name} ${rub(w.price)}${w.guarantee_days ? ` (гарантия ${w.guarantee_days} дн.)` : ''}`).join(', ') || '—'}
            </p>
            {selected.parts_note && <p className="text-muted">Мастеру: запчасть {selected.parts_note}</p>}
          </div>
          <button type="button" onClick={() => onSelect(null)} className="shrink-0 rounded-md px-2 py-1 text-muted hover:bg-surface">Убрать</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium">Быстрый заказ</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {sorted.map((q) => (
          <button
            key={q.id}
            type="button"
            onClick={() => onSelect(q)}
            className="shrink-0 rounded-xl border border-line bg-surface px-3 py-2 text-left hover:border-accent"
          >
            <span className="block whitespace-nowrap text-sm font-medium">{q.name}</span>
            <span className="block text-xs text-muted tabular-nums">{q.total ? rub(q.total) : q.approximate_price || '—'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
