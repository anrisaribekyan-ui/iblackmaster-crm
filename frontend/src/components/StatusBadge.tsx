import type React from 'react'
/**
 * Бейдж статуса заказа. Цвета статусов заданы в настройках и бывают светлыми (салатовый «В пайке»,
 * серый «Отказ») — как текст они бледнеют. Поэтому текст затемняем, пока он не станет читаемым
 * (контраст ≥ 4.5 к фону), фон — тот же цвет, слегка, а точка — исходный цвет без изменений.
 */

function parse(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
const toHex = (rgb: number[]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

const cache = new Map<string, { text: string; bg: string; dot: string }>()

export function statusColors(color: string | null | undefined): { text: string; bg: string; dot: string } {
  const key = color ?? ''
  const hit = cache.get(key)
  if (hit) return hit
  const rgb = parse(key) ?? [102, 112, 133]
  // Фон — 14 % цвета на белом
  const bg = rgb.map((c) => 255 - (255 - c) * 0.14) as [number, number, number]
  const bgL = luminance(bg)
  let text = [...rgb] as [number, number, number]
  for (let i = 0; i < 20 && contrast(luminance(text), bgL) < 4.5; i++) text = text.map((c) => c * 0.85) as [number, number, number]
  const result = { text: toHex(text), bg: toHex(bg), dot: toHex(rgb) }
  cache.set(key, result)
  return result
}

export type SmsMark = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | null | undefined

const SMS_TITLE: Record<string, string> = {
  queued: 'SMS ждёт отправки',
  sending: 'SMS отправляется',
  sent: 'SMS отправлено',
  delivered: 'SMS доставлено',
  failed: 'SMS не ушло',
}

/**
 * Галочки SMS по текущему статусу, как в мессенджерах: часы — в очереди, ✓ — ушло с телефона-шлюза,
 * ✓✓ — оператор подтвердил доставку, «!» — не отправилось. Нет SMS — ничего не рисуем.
 */
export function SmsTicks({ state, onDark = false, className = '' }: { state: SmsMark; onDark?: boolean; className?: string }) {
  if (!state) return null
  const title = SMS_TITLE[state]
  const tone = onDark
    ? state === 'delivered' ? 'text-[#8cc8ff]' : state === 'failed' ? 'text-[#ff8a72]' : 'text-white/60'
    : state === 'delivered' ? 'text-success' : state === 'failed' ? 'text-danger' : 'opacity-60'
  return (
    <span className={`inline-flex shrink-0 items-center ${tone} ${className}`} title={title}>
      <span className="sr-only">{title}</span>
      {state === 'failed' ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6 3.4v3.2M6 8.4v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      ) : state === 'queued' || state === 'sending' ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6 3.6V6l1.6 1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
      ) : (
        <svg width={state === 'delivered' ? 17 : 12} height="12" viewBox={state === 'delivered' ? '0 0 17 12' : '0 0 12 12'} aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 6.4 4.4 9.2 10.5 2.8" />
          {state === 'delivered' && <path d="M8.2 8.4l.8.8 6.1-6.4" />}
        </svg>
      )}
    </span>
  )
}

export default function StatusBadge({ name, color, sms, className = '' }: { name: string; color: string | null | undefined; sms?: SmsMark; className?: string }) {
  const c = statusColors(color)
  // Цвета через переменные: в тёмных темах CSS берёт светлый текст и полупрозрачный фон того же оттенка
  return (
    <span
      title={name}
      className={`status-badge inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
      style={{ '--sb-text': c.text, '--sb-bg': c.bg, '--sb-dot': c.dot } as React.CSSProperties}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.dot }} aria-hidden />
      <span className="truncate">{name}</span>
      <SmsTicks state={sms} />
    </span>
  )
}
