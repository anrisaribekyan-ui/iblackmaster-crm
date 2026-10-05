/** Общие форматтеры. Используй их, а не свои копии в страницах. */

/** 79161866119 → +7 (916) 186-61-19. Несколько номеров через запятую — каждый. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .split(',')
    .map((part) => {
      const d = part.replace(/\D/g, '')
      if (d.length !== 11) return part.trim()
      return `+${d[0]} (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`
    })
    .join(', ')
}

/** Значение из <input type="datetime-local"> (время по часам браузера) → ISO с часовым поясом для API. */
export function localInputToIso(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** ISO из API → значение для <input type="datetime-local"> по часам браузера. */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
