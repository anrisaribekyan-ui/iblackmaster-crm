import { useEffect, useState } from 'react'
import { api } from '../api/client'

type Hint = { work: string; count: number; from: number; to: number; typical: number; last: number; last_date: string }

const rub = (v: number) => v.toLocaleString('ru-RU')
const timesWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'раз' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'раза' : 'раз')

/** «Цена за 3 секунды» (ТЗ этап 3, E2): частые ремонты этой модели и сколько они обычно стоили у нас. */
export default function PriceHints({ brand, model, onPick }: { brand: string; model: string; onPick: (price: string) => void }) {
  const [hints, setHints] = useState<Hint[]>([])
  useEffect(() => {
    if (model.trim().length < 2) {
      setHints([])
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      const q = new URLSearchParams({ model: model.trim() })
      if (brand.trim()) q.set('brand', brand.trim())
      api.get<Hint[]>(`/intake/prices?${q}`).then((r) => active && setHints(r)).catch(() => undefined)
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [brand, model])

  if (hints.length === 0) return null
  return (
    <div className="rounded-xl border border-line bg-canvas p-3">
      <p className="mb-2 text-sm font-semibold">Обычно на {[brand, model].filter(Boolean).join(' ')}</p>
      <ul className="divide-y divide-line">
        {hints.map((h) => {
          const range = h.from === h.to ? `${rub(h.typical)} ₽` : `${rub(h.from)}–${rub(h.to)} ₽`
          return (
            <li key={h.work}>
              <button
                type="button"
                onClick={() => onPick(h.from === h.to ? String(h.typical) : `${h.from}-${h.to}`)}
                className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:text-accent"
                title="Подставить в «Ориентировочную цену»"
              >
                <span className="min-w-0 flex-1 truncate">{h.work}</span>
                <span className="shrink-0 font-semibold tabular-nums">{range}</span>
                <span className="hidden w-36 shrink-0 text-right text-xs text-muted sm:inline">
                  последний {rub(h.last)} · {h.count} {timesWord(h.count)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <p className="mt-1 text-xs text-muted">Итог заказа с этой работой по выданным заказам. Нажмите — цена встанет в «Ориентировочную цену».</p>
    </div>
  )
}
