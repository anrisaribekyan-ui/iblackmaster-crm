import { useEffect, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'

const GHOST = '+7 (___) ___-__-__'

/** Одна цифровая «маска»: +7 (916) 123-45-67. Пустая строка, пока цифр нет. */
function maskOne(raw: string): string {
  const withPlus7 = /^\s*\+7/.test(raw)
  let digits = raw.replace(/\D/g, '')
  if (withPlus7) digits = digits.slice(1)
  else if (digits.length > 10 && /^[78]/.test(digits)) digits = digits.slice(1)
  else if (digits.length === 1 && /[78]/.test(digits)) digits = ''
  digits = digits.slice(0, 10)
  if (!digits) return ''
  let out = '+7 (' + digits.slice(0, 3)
  if (digits.length > 3) out += ') ' + digits.slice(3, 6)
  if (digits.length > 6) out += '-' + digits.slice(6, 8)
  if (digits.length > 8) out += '-' + digits.slice(8, 10)
  return out
}

/** Несколько номеров через запятую поддерживаются: каждый приводится к маске. */
export function maskPhones(raw: string): string {
  const parts = raw.split(/[,;]/)
  const done = parts.map(maskOne)
  const last = parts.length - 1
  return done.filter((p, i) => p || i === last && parts.length === 1).join(', ') + (parts.length > 1 && !done[last] && done.slice(0, -1).some(Boolean) ? ', ' : '')
}

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'type'> & {
  value?: string
  defaultValue?: string | null
  onChange?: (value: string) => void
}

export default function PhoneInput({ value, defaultValue, onChange, className = '', onFocus, onBlur, ...rest }: Props) {
  const [inner, setInner] = useState(() => maskPhones(value ?? defaultValue ?? ''))
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)

  useEffect(() => {
    if (value !== undefined && maskPhones(value) !== inner) setInner(maskPhones(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useLayoutEffect(() => {
    if (caret.current !== null && ref.current && document.activeElement === ref.current) {
      ref.current.setSelectionRange(caret.current, caret.current)
    }
    caret.current = null
  }, [inner])

  const digitsCount = (s: string) => s.replace(/\D/g, '').length
  const handle = (el: HTMLInputElement) => {
    const raw = el.value
    const pos = el.selectionStart ?? raw.length
    const next = maskPhones(raw)
    // каретка остаётся после того же количества цифр, что и до форматирования
    const before = digitsCount(raw.slice(0, pos))
    let np = 0
    let seen = 0
    while (np < next.length && seen < before) {
      if (/\d/.test(next[np])) seen += 1
      np += 1
    }
    caret.current = pos >= raw.length ? next.length : Math.max(np, next.startsWith('+7') && before > 0 ? 5 : 0)
    setInner(next)
    onChange?.(next)
  }

  const phones = inner.split(', ')
  const lastDigits = digitsCount(phones[phones.length - 1])
  const complete = lastDigits === 11 || (lastDigits === 10 && inner.startsWith('+7'))
  const typed = phones[phones.length - 1]
  const ghostTail = inner.endsWith(', ') ? GHOST : phones.length === 1 || typed ? GHOST.slice(typed.length) : ''
  const prefix = inner.endsWith(', ') ? inner : phones.length > 1 ? phones.slice(0, -1).join(', ') + ', ' + typed : typed

  return (
    <span className={`relative block ${className}`}>
      <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-3 py-2 num text-muted/60">
        <span className="invisible">{prefix}</span>
        <span>{focused || prefix ? ghostTail : ''}</span>
      </span>
      <input
        ref={ref}
        {...rest}
        type="tel"
        inputMode="tel"
        autoComplete={rest.autoComplete ?? 'tel'}
        value={inner}
        placeholder=""
        onChange={(e) => handle(e.currentTarget)}
        onFocus={(e) => { setFocused(true); onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); onBlur?.(e) }}
        className={`num relative w-full rounded-md border bg-transparent px-3 py-2 pr-9 tracking-wide outline-none transition-colors ${
          complete ? 'border-success' : 'border-line focus:border-accent'
        }`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-success transition-all duration-200 ${complete ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`}
      >✓</span>
    </span>
  )
}
