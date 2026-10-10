import { useRef, useState, type PointerEvent } from 'react'
import Modal from './Modal'

/** Графический ключ Android хранится в поле «Пароль» строкой «узор 1-4-7-8-9» (точки 1–9 слева направо, сверху вниз). */
const PREFIX = 'узор '
const PATTERN_RE = /^узор ([1-9](?:-[1-9])+)$/

export function parsePattern(value: string | null | undefined): number[] | null {
  const match = PATTERN_RE.exec((value ?? '').trim())
  return match ? match[1].split('-').map(Number) : null
}

export const formatPattern = (dots: number[]) => `${PREFIX}${dots.join('-')}`

const center = (dot: number, size: number) => {
  const step = size / 3
  return { x: step * (((dot - 1) % 3) + 0.5), y: step * (Math.floor((dot - 1) / 3) + 0.5) }
}

/** Картинка узора: точки, линия, начало отмечено кружком потолще. */
export function PatternView({ dots, size = 72 }: { dots: number[]; size?: number }) {
  const points = dots.map((d) => center(d, size))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Графический ключ: ${dots.join('-')}`} className="shrink-0 rounded-md bg-canvas">
      {Array.from({ length: 9 }, (_, i) => {
        const c = center(i + 1, size)
        return <circle key={i} cx={c.x} cy={c.y} r={size * 0.035} fill="#98a2b3" />
      })}
      <polyline points={points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--color-accent)" strokeWidth={size * 0.045} strokeLinejoin="round" strokeLinecap="round" />
      {points[0] && <circle cx={points[0].x} cy={points[0].y} r={size * 0.08} fill="none" stroke="var(--color-accent)" strokeWidth={size * 0.035} />}
    </svg>
  )
}

/** Точка между двумя (через центр): на Android ведёшь 1→3 — 2 включается сама. */
function between(a: number, b: number): number | null {
  const [ar, ac] = [Math.floor((a - 1) / 3), (a - 1) % 3]
  const [br, bc] = [Math.floor((b - 1) / 3), (b - 1) % 3]
  if ((ar + br) % 2 !== 0 || (ac + bc) % 2 !== 0) return null
  return ((ar + br) / 2) * 3 + (ac + bc) / 2 + 1
}

/** Окно ввода узора пальцем (как на экране блокировки Android). */
export function PatternLockDialog({ initial, onSave, onClose }: { initial: number[] | null; onSave: (dots: number[]) => void; onClose: () => void }) {
  const SIZE = 264
  const [dots, setDots] = useState<number[]>(initial ?? [])
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const drawing = useRef(false)
  const svg = useRef<SVGSVGElement>(null)

  const dotAt = (event: PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * SIZE
    const y = ((event.clientY - rect.top) / rect.height) * SIZE
    setCursor({ x, y })
    for (let d = 1; d <= 9; d++) {
      const c = center(d, SIZE)
      if (Math.hypot(c.x - x, c.y - y) < SIZE * 0.13) return d
    }
    return null
  }

  const add = (dot: number | null) => {
    if (!dot) return
    setDots((current) => {
      if (current.includes(dot)) return current
      const mid = current.length ? between(current[current.length - 1], dot) : null
      return mid && !current.includes(mid) ? [...current, mid, dot] : [...current, dot]
    })
  }

  const points = dots.map((d) => center(d, SIZE))
  return (
    <Modal title="Графический ключ" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Попросите клиента нарисовать ключ пальцем, как на своём телефоне.</p>
      <svg
        ref={svg}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto block w-full max-w-[264px] touch-none select-none rounded-xl bg-canvas"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          setDots([])
          const d = dotAt(e)
          if (d) setDots([d])
        }}
        onPointerMove={(e) => drawing.current && add(dotAt(e))}
        onPointerUp={() => {
          drawing.current = false
          setCursor(null)
        }}
      >
        <polyline points={[...points, ...(cursor && drawing.current && points.length ? [cursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none" stroke="var(--color-accent)" strokeWidth={8} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
        {Array.from({ length: 9 }, (_, i) => {
          const c = center(i + 1, SIZE)
          const on = dots.includes(i + 1)
          return (
            <g key={i}>
              <circle cx={c.x} cy={c.y} r={on ? 16 : 10} fill={on ? 'var(--color-accent)' : '#c5cad3'} />
              {on && <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize="12" fill="#fff" fontWeight="600">{dots.indexOf(i + 1) + 1}</text>}
            </g>
          )
        })}
      </svg>
      <p className="mt-3 text-center text-sm text-muted">{dots.length ? `Точек: ${dots.length}` : 'Ведите пальцем от первой точки'}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => setDots([])} className="rounded-md border border-line px-4 py-2.5">Заново</button>
        <button type="button" disabled={dots.length < 2} onClick={() => onSave(dots)}
          className="flex-1 rounded-md bg-accent px-4 py-2.5 font-medium text-accent-ink disabled:opacity-50">Сохранить ключ</button>
      </div>
    </Modal>
  )
}

/** Поле «Пароль» с кнопкой «Ключ»: текстом — пароль/PIN, рисунком — графический ключ. */
export function DevicePasswordInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className: string }) {
  const [open, setOpen] = useState(false)
  const dots = parsePattern(value)
  return (
    <div className="flex items-center gap-2">
      {dots ? (
        <div className="flex flex-1 items-center gap-3">
          <PatternView dots={dots} size={56} />
          <span className="text-sm text-muted">Графический ключ</span>
          <button type="button" className="ml-auto text-sm text-danger" onClick={() => onChange('')}>Очистить</button>
        </div>
      ) : (
        <input className={`${className} min-w-0 flex-1`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="PIN или пароль" autoComplete="off" />
      )}
      <button type="button" onClick={() => setOpen(true)} className="shrink-0 rounded-md border border-line px-3 py-2 text-sm" title="Нарисовать графический ключ">
        Ключ
      </button>
      {open && (
        <PatternLockDialog
          initial={dots}
          onClose={() => setOpen(false)}
          onSave={(d) => {
            onChange(formatPattern(d))
            setOpen(false)
          }}
        />
      )}
    </div>
  )
}
