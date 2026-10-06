import { useState } from 'react'

type Item = { key: string | number; name: string; value: number; hint?: string }

/**
 * Рейтинг горизонтальными полосами («Источники рекламы», «Выручка по мастерам»).
 * Одна шкала синего (величина, а не разные серии), значение — у конца полосы, полоса ≤ 12px,
 * скругление только на конце. Показываем топ-N, остальное сворачиваем в «Остальные».
 */
export default function BarList({ items, format, limit = 8, share = false }: { items: Item[]; format: (v: number) => string; limit?: number; share?: boolean }) {
  const [hover, setHover] = useState<string | number | null>(null)
  const sorted = [...items].sort((a, b) => b.value - a.value)
  const head = sorted.slice(0, limit)
  const tail = sorted.slice(limit)
  const rows = tail.length
    ? [...head, { key: '__other', name: `Остальные (${tail.length})`, value: tail.reduce((s, i) => s + i.value, 0) }]
    : head
  const max = Math.max(1, ...rows.map((r) => r.value))
  const total = items.reduce((s, i) => s + i.value, 0)

  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const isOther = row.key === '__other'
        const pct = total ? Math.round((row.value / total) * 100) : 0
        return (
          <li
            key={row.key}
            className="text-sm"
            onPointerEnter={() => setHover(row.key)}
            onPointerLeave={() => setHover(null)}
            title={'hint' in row && row.hint ? row.hint : undefined}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-ink">{row.name}</span>
              <span className="shrink-0 whitespace-nowrap">
                <strong className="num font-semibold text-ink">{format(row.value)}</strong>
                {share && <span className="num ml-1.5 text-xs text-[var(--viz-label)]">{pct}%</span>}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--viz-seq-track)]">
              <div
                className="h-full rounded-full transition-[width,opacity] duration-300"
                style={{
                  width: `${Math.max(1.5, (row.value / max) * 100)}%`,
                  background: isOther ? 'var(--viz-quiet)' : 'var(--viz-seq)',
                  opacity: hover === null || hover === row.key ? 1 : 0.55,
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
