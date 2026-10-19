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

export default function StatusBadge({ name, color, className = '' }: { name: string; color: string | null | undefined; className?: string }) {
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
    </span>
  )
}
