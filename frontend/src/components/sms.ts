/** Общие типы и подписи для SMS: нужны и журналу уведомлений, и блоку SMS в карточке заказа. */

export type Sms = {
  id: number
  created_at: string
  sent_at: string | null
  order_id: number | null
  order_number: string | null
  kind: 'status' | 'manual' | 'test'
  phone: string
  text: string
  state: 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'cancelled'
  state_title: string
  error: string | null
}

export const smsStateClass: Record<Sms['state'], string> = {
  queued: 'bg-canvas text-muted',
  sending: 'bg-canvas text-muted',
  sent: 'bg-accent-soft text-ink',
  delivered: 'bg-success/15 text-success',
  failed: 'bg-danger/10 text-danger',
  cancelled: 'bg-canvas text-muted line-through',
}

export function formatDateTime(value: string | null) {
  if (!value) return ''
  return new Date(value.endsWith('Z') || value.includes('+') ? value : `${value}Z`).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Подсчёт длины SMS: кириллица — 70 знаков в одном SMS, 67 в каждой части длинного. */
export function smsParts(text: string) {
  const len = [...text].length
  if (len === 0) return 0
  return len <= 70 ? 1 : Math.ceil(len / 67)
}
