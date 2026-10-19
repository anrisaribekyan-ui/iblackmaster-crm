import type React from 'react'
import { useState } from 'react'

type Props = {
  id: string
  value: string
  onChange: (value: string) => void
  length?: number
  /** Ошибка кода — ячейки краснеют и вздрагивают */
  error?: boolean
  /** Код принят — ячейки съезжаются в центр, на их месте появляется галочка */
  done?: boolean
  doneLabel?: string
}

/**
 * Код из письма: шесть ячеек. Под ними одно настоящее поле на всю ширину — так работают вставка,
 * автоподстановка кода из почты на телефоне и стирание, а ячейки только показывают цифры.
 */
export default function OtpInput({ id, value, onChange, length = 6, error = false, done = false, doneLabel = 'Готово' }: Props) {
  const [focused, setFocused] = useState(false)
  const active = Math.min(value.length, length - 1)
  const cells = Array.from({ length }, (_, i) => value[i] ?? '')
  // На сколько ячеек сдвинуть каждую к центру: ширина ячейки + промежуток ≈ 100% + 8px
  const offset = (i: number) => `calc(${(length - 1) / 2 - i} * (100% + 8px))`

  return (
    <div className={`relative ${error ? 'otp-error' : ''} ${done ? 'otp-done' : ''}`}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }} aria-hidden>
        {cells.map((digit, i) => (
          <div
            key={`${i}-${digit}`}
            className="otp-cell num grid h-14 place-items-center rounded-xl border border-line-strong bg-canvas text-2xl font-semibold"
            data-active={focused && !done && i === active && value.length < length + 1}
            data-filled={digit !== ''}
            style={{ '--to-center': offset(i) } as React.CSSProperties}
          >
            {digit || (focused && i === active ? <span className="h-6 w-px animate-pulse bg-accent" /> : <span className="text-placeholder">·</span>)}
          </div>
        ))}
      </div>
      {done && (
        <div className="absolute inset-0 grid place-items-center" role="status">
          <span className="otp-check flex items-center gap-2 rounded-full bg-[#12b76a] px-4 py-2 font-medium text-white shadow-lg">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {doneLabel}
          </span>
        </div>
      )}
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern={`\\d{${length}}`}
        maxLength={length}
        value={value}
        disabled={done}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, length))}
        onFocus={(e) => {
          setFocused(true)
          const end = e.target.value.length
          e.target.setSelectionRange(end, end)
        }}
        onBlur={() => setFocused(false)}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        style={{ caretColor: 'transparent' }}
        autoFocus
        required
      />
    </div>
  )
}
