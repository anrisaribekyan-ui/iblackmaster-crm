import { useState, type ReactNode } from 'react'

/** Значение, которое копируется по нажатию (IMEI, номер, телефон). Короткое «Скопировано ✓» вместо всплывашки. */
export default function Copyable({ value, children, className = '' }: { value: string; children?: ReactNode; className?: string }) {
  const [done, setDone] = useState(false)
  if (!value) return <>{children ?? '—'}</>
  return (
    <button
      type="button"
      title="Нажмите, чтобы скопировать"
      className={`group inline-flex items-center gap-1.5 rounded text-left hover:text-accent ${className}`}
      onClick={(event) => {
        event.stopPropagation()
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        })
      }}
    >
      <span className="break-all">{children ?? value}</span>
      <span className={`text-xs ${done ? 'text-success' : 'text-muted opacity-0 group-hover:opacity-100'}`} aria-live="polite">
        {done ? 'скопировано ✓' : '⧉'}
      </span>
    </button>
  )
}
