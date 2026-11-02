import { useEffect, useState } from 'react'
import { api } from '../api/client'

type Hint = { work: string; count: number; from: number; to: number; typical: number; last: number; last_date: string }

const rub = (v: number) => v.toLocaleString('ru-RU')
const timesWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'раз' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'раза' : 'раз')

/** «Цена за 3 секунды» (ТЗ этап 3, E2): частые ремонты этой модели и сколько они обычно стоили у нас. */
export default function PriceHints({ brand, model, onPick }: { brand: string; model: string; onPick: (price: string) => void }) {
  const [hints, setHints] = useState<Hint[]>([])
  const [open, setOpen] = useState(false)
  const [hiddenFor, setHiddenFor] = useState('')
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

  const title = [brand, model].filter(Boolean).join(' ')
  if (hints.length === 0 || hiddenFor === title) return null
  return (
    <div className="col-span-full rounded-xl border border-line bg-canvas" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}>
      <div className="flex items-center gap-1 pr-1">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm">
          <span className="min-w-0 flex-1 truncate"><span className="font-semibold">Цены на {title}</span> <span className="text-muted">· {hints.length}</span></span>
          <span aria-hidden className="text-muted">{open ? '▴' : '▾'}</span>
        </button>
        <button type="button" onClick={() => setHiddenFor(title)} aria-label="Скрыть подсказки цен" className="rounded-md px-2 py-1 text-lg leading-none text-muted hover:text-ink">×</button>
      </div>
      {open && (
      <div className="border-t border-line p-3 pt-1">
      <ul className="max-h-64 divide-y divide-line overflow-y-auto">
        {hints.map((h) => {
          const range = h.from === h.to ? `${rub(h.typical)} ₽` : `${rub(h.from)}–${rub(h.to)} ₽`
          return (
            <li key={h.work}>
              <button
                type="button"
                onClick={() => { onPick(h.from === h.to ? String(h.typical) : `${h.from}-${h.to}`); setOpen(false) }}
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
      )}
    </div>
  )
}
