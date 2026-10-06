import { compact } from './format'

type Props = {
  label: string
  value: number
  format?: (v: number) => string
  previous?: number | null // значение за прошлый такой же период → дельта
  upIsGood?: boolean
  trend?: number[] // последние дни для спарклайна
  hero?: boolean
}

/** Плитка KPI: подпись · значение · дельта к прошлому периоду · спарклайн (тихий серый, последний день — акцентом). */
export default function StatTile({ label, value, format = (v) => compact(v), previous, upIsGood = true, trend, hero = false }: Props) {
  let delta: { text: string; good: boolean; up: boolean } | null = null
  if (previous !== undefined && previous !== null) {
    if (previous === 0) {
      delta = value > 0 ? { text: 'новое', good: upIsGood, up: true } : null
    } else {
      const change = ((value - previous) / previous) * 100
      const up = change >= 0
      if (Math.abs(change) >= 0.5) delta = { text: `${up ? '+' : '−'}${Math.abs(change) < 10 ? Math.abs(change).toFixed(1).replace('.', ',') : Math.round(Math.abs(change))}%`, good: up === upIsGood, up }
    }
  }
  return (
    <div className="flex h-full min-h-28 flex-col rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted">{label}</p>
        {trend && trend.length > 1 && <span className={hero ? '' : 'hidden sm:block'}><Sparkline values={trend} /></span>}
      </div>
      <p className={`mt-auto whitespace-nowrap pt-2 font-semibold leading-none tracking-tight text-ink ${hero ? 'text-[34px] xl:text-[40px]' : 'text-[28px]'}`}>{format(value)}</p>
      <p className="mt-2 flex h-4 min-w-0 items-center gap-1 whitespace-nowrap text-xs">
        {delta ? (
          <>
            <span aria-hidden style={{ color: delta.good ? 'var(--viz-good)' : 'var(--viz-bad)' }}>{delta.up ? '▲' : '▼'}</span>
            <span className="num font-medium" style={{ color: delta.good ? 'var(--viz-good)' : 'var(--viz-bad)' }}>{delta.text}</span>
            <span className="truncate text-muted">к прошлому периоду</span>
          </>
        ) : (
          previous !== undefined && <span className="text-muted">как в прошлом периоде</span>
        )}
      </p>
    </div>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const w = 72
  const h = 26
  const max = Math.max(1, ...values)
  const step = w / (values.length - 1)
  const pt = (v: number, i: number) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 6)).toFixed(1)}`
  const lastY = h - 3 - (values[values.length - 1] / max) * (h - 6)
  return (
    <svg width={w + 6} height={h} aria-hidden className="shrink-0 overflow-visible">
      <polyline points={values.map(pt).join(' ')} fill="none" stroke="var(--viz-quiet)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={w} cy={lastY} r={3.5} fill="var(--viz-1)" stroke="#fff" strokeWidth={2} />
    </svg>
  )
}
