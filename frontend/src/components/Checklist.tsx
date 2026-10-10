import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

export type Mark = 'ok' | 'fail' | 'na'
export type ChecklistValues = Record<string, Mark>

export const MARK_TITLES: Record<Mark, string> = { ok: 'работает', fail: 'не работает', na: 'не проверить' }

/** Пункты чек-листа из настроек (Настройки → Чек-лист). */
export function useChecklistItems() {
  const [items, setItems] = useState<string[]>([])
  useEffect(() => {
    api.get<{ items: string[] }>('/settings/checklist').then((r) => setItems(r.items)).catch(() => setItems([]))
  }, [])
  return items
}

const markStyle: Record<Mark, string> = {
  ok: 'border-success bg-success text-white',
  fail: 'border-danger bg-danger text-white',
  na: 'border-ink bg-ink text-white',
}

/** Отметки по пунктам: ✓ работает · ✗ не работает · — не проверить. Крупные кнопки под палец. */
export function ChecklistInput({ items, value, onChange }: { items: string[]; value: ChecklistValues; onChange: (v: ChecklistValues) => void }) {
  const set = (item: string, mark: Mark) => {
    const next = { ...value }
    if (next[item] === mark) delete next[item]
    else next[item] = mark
    onChange(next)
  }
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => onChange(Object.fromEntries(items.map((i) => [i, 'ok' as Mark])))}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-success">Всё работает</button>
        <button type="button" onClick={() => onChange(Object.fromEntries(items.map((i) => [i, 'na' as Mark])))}
          className="rounded-md border border-line px-3 py-1.5 text-sm">Не включается — не проверить</button>
        {Object.keys(value).length > 0 && <button type="button" onClick={() => onChange({})} className="text-sm text-muted">Сбросить</button>}
      </div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2 px-3 py-1.5">
            <span className={`min-w-0 flex-1 text-sm ${value[item] === 'fail' ? 'font-medium text-danger' : 'text-ink'}`}>{item}</span>
            {(['ok', 'fail', 'na'] as Mark[]).map((mark) => (
              <button
                key={mark}
                type="button"
                aria-label={`${item}: ${MARK_TITLES[mark]}`}
                aria-pressed={value[item] === mark}
                onClick={() => set(item, mark)}
                className={`grid h-9 w-9 place-items-center rounded-md border text-base ${value[item] === mark ? markStyle[mark] : 'border-line text-muted'}`}
              >
                {mark === 'ok' ? '✓' : mark === 'fail' ? '✕' : '—'}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Подпись клиента пальцем или мышью. onChange отдаёт PNG (data URL) или null, если пусто. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasInk = useRef(false) // в ref, а не в state: обработчики касаний не должны видеть устаревшее значение
  const [empty, setEmpty] = useState(true)

  useEffect(() => {
    const c = canvas.current!
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    const ctx = c.getContext('2d')!
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#16181d'
  }, [])

  const pos = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const finish = () => {
    if (!drawing.current) return
    drawing.current = false
    if (hasInk.current) onChange(canvas.current!.toDataURL('image/png'))
  }

  const clear = () => {
    const c = canvas.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    hasInk.current = false
    setEmpty(true)
    onChange(null)
  }

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-36 w-full touch-none rounded-lg border border-dashed border-line bg-surface"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drawing.current = true
            const ctx = canvas.current!.getContext('2d')!
            const p = pos(e)
            ctx.beginPath()
            ctx.moveTo(p.x, p.y)
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return
            const ctx = canvas.current!.getContext('2d')!
            const p = pos(e)
            ctx.lineTo(p.x, p.y)
            ctx.stroke()
            if (!hasInk.current) {
              hasInk.current = true
              setEmpty(false)
            }
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
        />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted">Подпись клиента — пальцем здесь</span>}
      </div>
      {!empty && <button type="button" onClick={clear} className="mt-1 text-sm text-muted">Стереть подпись</button>}
    </div>
  )
}

/** Компактная сводка: «всё работает» или список замечаний. */
export function ChecklistSummary({ values }: { values: ChecklistValues }) {
  const entries = Object.entries(values)
  if (entries.length === 0) return <span className="text-muted">не заполнен</span>
  const fails = entries.filter(([, v]) => v === 'fail').map(([k]) => k)
  const na = entries.filter(([, v]) => v === 'na').map(([k]) => k)
  return (
    <span>
      {fails.length === 0 && na.length === 0 && <span className="text-success">всё работает ({entries.length})</span>}
      {fails.length > 0 && <span className="text-danger">не работает: {fails.join(', ')}</span>}
      {na.length > 0 && <span className="text-muted">{fails.length ? '; ' : ''}не проверить: {na.join(', ')}</span>}
    </span>
  )
}
