import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { dayLong, dayShort, niceTicks } from './format'
import { useWidth } from './useWidth'

export type Series = { name: string; color: string; values: number[] }

type Props = {
  days: string[] // ключи «YYYY-MM-DD», по возрастанию
  series: Series[]
  kind?: 'line' | 'columns'
  format: (value: number) => string // значение в подсказке и подписи
  axisFormat?: (value: number) => string // деления оси Y (компактно)
  height?: number
  label: string // что изображено — для экранного диктора
}

const M = { top: 12, right: 16, bottom: 26, left: 52 }

/**
 * Динамика по дням: линии (1–2 серии, у одной — заливка-«дымка») или столбики (сгруппированные).
 * Наведение: перекрестие ищет ближайший день, подсказка показывает все серии сразу.
 * Клавиатура: Tab на графике, стрелки ←/→ двигают выбранный день.
 */
export default function TimeChart({ days, series, kind = 'line', format, axisFormat = format, height = 220, label }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const clipId = useId()
  const n = days.length
  const plotW = Math.max(10, width - M.left - M.right)
  const plotH = height - M.top - M.bottom

  const max = Math.max(0, ...series.flatMap((s) => s.values))
  const ticks = useMemo(() => niceTicks(max), [max])
  const top = ticks[ticks.length - 1] || 1
  const y = (v: number) => M.top + plotH - (Math.max(0, v) / top) * plotH

  const band = plotW / Math.max(1, n)
  const x = (i: number) => (kind === 'columns' ? M.left + band * i + band / 2 : M.left + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1)))

  const xTicks = useMemo(() => {
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 84))))
    const list: number[] = []
    for (let i = n - 1; i >= 0; i -= every) list.unshift(i)
    return list
  }, [n, plotW])

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - M.left
    const index = kind === 'columns' ? Math.floor(px / band) : Math.round((px / plotW) * (n - 1))
    setActive(Math.min(n - 1, Math.max(0, index)))
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? n - 1) + (a === null ? 0 : 1)))
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n - 1) - (a === null ? 0 : 1)))
    else if (e.key === 'Escape') setActive(null)
    else return
    e.preventDefault()
  }

  // Геометрия столбиков: не толще 24px, 2px «воздуха» между столбиками группы
  const m = series.length
  const barW = Math.max(2, Math.min(24, (band * 0.72 - (m - 1) * 2) / m))
  const groupW = barW * m + (m - 1) * 2

  const single = series.length === 1
  const last = n - 1

  return (
    <div ref={ref} className="relative select-none">
      {!single && (
        <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--viz-ink-2)]">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              {kind === 'line' ? (
                <span className="inline-block h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              ) : (
                <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
              )}
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        tabIndex={0}
        className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-[var(--viz-1)] rounded-md"
        onPointerMove={(e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerDown={(e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top - 6} width={plotW + 8} height={plotH + 8} />
          </clipPath>
        </defs>

        {/* Сетка и ось Y: тонко и тихо */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-label)" className="num">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor={i === last && kind === 'line' ? 'end' : 'middle'} fontSize={11} fill="var(--viz-label)">
            {dayShort(days[i])}
          </text>
        ))}

        {kind === 'columns' && active !== null && (
          <rect x={M.left + band * active} y={M.top} width={band} height={plotH} fill="var(--viz-grid)" opacity={0.6} />
        )}

        {kind === 'columns' &&
          series.map((s, si) =>
            s.values.map((v, i) => {
              if (v <= 0) return null
              const bx = x(i) - groupW / 2 + si * (barW + 2)
              const by = y(v)
              const h = M.top + plotH - by
              const r = Math.min(4, h, barW / 2)
              return (
                <path
                  key={`${si}-${i}`}
                  d={`M${bx},${by + h}V${by + r}Q${bx},${by} ${bx + r},${by}H${bx + barW - r}Q${bx + barW},${by} ${bx + barW},${by + r}V${by + h}Z`}
                  fill={s.color}
                  opacity={active === null || active === i ? 1 : 0.55}
                />
              )
            }),
          )}

        {kind === 'line' && (
          <g clipPath={`url(#${clipId})`}>
            {single && (
              <path
                d={`M${x(0)},${y(0)}${series[0].values.map((v, i) => `L${x(i)},${y(v)}`).join('')}L${x(last)},${y(0)}Z`}
                fill={series[0].color}
                opacity={0.1}
              />
            )}
            {series.map((s) => (
              <path
                key={s.name}
                d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </g>
        )}

        {/* Крестик-перекрестие и точки на выбранном дне */}
        {kind === 'line' && active !== null && (
          <g>
            <line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
            {series.map((s) => (
              <circle key={s.name} cx={x(active)} cy={y(s.values[active] ?? 0)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
        {/* Конец линии: точка + значение (подпись выборочно — только последний день) */}
        {kind === 'line' && active === null && n > 0 &&
          series.map((s) => <circle key={s.name} cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />)}
      </svg>

      {active !== null && n > 0 && (
        <Tooltip
          left={x(active)}
          width={width}
          title={dayLong(days[active])}
          rows={series.map((s) => ({ name: s.name, color: s.color, value: format(s.values[active] ?? 0), line: kind === 'line' }))}
        />
      )}
    </div>
  )
}

export function Tooltip({ left, width, title, rows }: { left: number; width: number; title: string; rows: { name: string; color: string; value: string; line?: boolean }[] }) {
  const flip = left > width - 180
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-6 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={flip ? { right: Math.max(4, width - left + 12) } : { left: left + 12 }}
    >
      <p className="mb-1 text-[var(--viz-label)]">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2">
          <span className={r.line === false ? 'inline-block h-2.5 w-2.5 rounded-[3px]' : 'inline-block h-0.5 w-3 rounded-full'} style={{ background: r.color }} />
          <strong className="num text-sm text-ink">{r.value}</strong>
          <span className="text-[var(--viz-ink-2)]">{r.name}</span>
        </p>
      ))}
    </div>
  )
}
