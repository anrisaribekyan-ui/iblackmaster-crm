import { useEffect, useState } from 'react'
import { rub } from './format'

type Props = {
  label: string
  value: number
  /** Обычная выручка за такой же период: средняя за день по последним 30 дням × дней в периоде */
  norm: number | null
  previous: number | null
  summary: string
}

/**
 * Главная плитка дня: оранжевая, с большой суммой и полосой «сколько от обычного дня».
 * Полоса заполняется один раз при появлении — это редкий момент, его можно показать.
 */
export default function HeroRevenue({ label, value, norm, previous, summary }: Props) {
  const share = norm && norm > 0 ? value / norm : null
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(share === null ? 0 : Math.min(1, share)))
    return () => cancelAnimationFrame(id)
  }, [share])

  let delta = ''
  if (previous !== null && previous > 0) {
    const change = Math.round(((value - previous) / previous) * 100)
    if (change !== 0) delta = `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}%`
  }

  return (
    <div className="hero-card relative flex h-full min-h-40 flex-col overflow-hidden rounded-2xl p-5 text-white">
      <svg className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 opacity-[0.16]" viewBox="0 0 200 200" aria-hidden>
        <circle cx="100" cy="100" r="70" fill="none" stroke="#fff" strokeWidth="26" />
      </svg>
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm text-white/80">{label}</p>
        {delta && <span className="num shrink-0 whitespace-nowrap rounded-full bg-white/20 px-2 py-0.5 text-xs font-medium" title="К прошлому такому же периоду">{delta}</span>}
      </div>
      <p className="num relative mt-auto whitespace-nowrap pt-3 text-[40px] font-semibold leading-none tracking-tight xl:text-[44px]">{rub(value)}</p>
      {share !== null && (
        <div className="relative mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-white/25" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Доля от обычной выручки">
            <div className="hero-bar h-full rounded-full bg-white" style={{ transform: `scaleX(${shown})` }} />
          </div>
          <p className="mt-2 flex justify-between gap-3 text-xs text-white/80">
            <span className="num">{Math.round(share * 100)}% от обычного</span>
            <span className="num truncate">обычно {rub(Math.round(norm!))}</span>
          </p>
        </div>
      )}
      <p className="relative mt-3 truncate text-xs text-white/90">{summary}</p>
    </div>
  )
}

/** Кольцо доли: тонкая дуга акцентом поверх дорожки. */
export function Ring({ part, total, size = 56 }: { part: number; total: number; size?: number }) {
  const r = size / 2 - 5
  const c = 2 * Math.PI * r
  const share = total > 0 ? Math.min(1, part / total) : 0
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(share))
    return () => cancelAnimationFrame(id)
  }, [share])
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--viz-seq-track)" strokeWidth={6} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - shown)}
        style={{ transition: 'stroke-dashoffset 900ms var(--ease-out)' }}
      />
    </svg>
  )
}
