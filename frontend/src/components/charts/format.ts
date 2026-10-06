/** Подписи для графиков: компактные числа и даты по-русски. */

export function compact(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${trim(value / 1_000_000)} млн`
  if (abs >= 10_000) return `${trim(value / 1_000)} тыс`
  return Math.round(value).toLocaleString('ru-RU')
}

function trim(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 })
}

export const rub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`
export const rubCompact = (value: number) => `${compact(value)} ₽`
export const count = (value: number) => Math.round(value).toLocaleString('ru-RU')

const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const DAY_LONG = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** «2026-10-05» → «5 окт.» */
export function dayShort(key: string): string {
  const date = new Date(`${key}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? key : DAY.format(date).replace('.', '')
}

/** «2026-10-05» → «пн, 5 октября» */
export function dayLong(key: string): string {
  const date = new Date(`${key}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? key : DAY_LONG.format(date)
}

/** «Красивые» деления оси: 0, 2 000, 4 000… */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / target
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v)
  return ticks
}

/** Дописывает пропущенные дни нулями, чтобы ось времени была ровной. */
export function fillDays<T extends { key: string }>(rows: T[], make: (key: string) => T): T[] {
  if (rows.length === 0) return rows
  const sorted = [...rows].sort((a, b) => a.key.localeCompare(b.key))
  const byKey = new Map(sorted.map((r) => [r.key, r]))
  const result: T[] = []
  const end = new Date(`${sorted[sorted.length - 1].key}T00:00:00Z`)
  for (let d = new Date(`${sorted[0].key}T00:00:00Z`); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    result.push(byKey.get(key) ?? make(key))
  }
  return result
}
