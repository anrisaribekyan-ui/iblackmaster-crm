import { useEffect, useState } from 'react'
import { api } from '../api/client'

export type IntakeHints = {
  client: {
    id: number
    name: string
    visits: number
    is_regular: boolean
    open_orders: number
    debt: number
    spent: number
    allow_sms: boolean
    note: string | null
    last: { id: number; number: string; device: string; works: string[]; date: string; days_ago: number } | null
  } | null
  warranty: {
    kind: 'warranty' | 'repeat'
    match: 'serial' | 'model'
    order_id: number
    number: string
    device: string
    brand: string | null
    model: string | null
    closed_at: string
    days_ago: number
    covered: { name: string; until: string }[]
    works: string[]
  }[]
  warranty_order_type_id: number | null
}

const rub = (v: number | string) => `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`
const date = (v: string) => v.slice(0, 10).split('-').reverse().join('.')

function ago(days: number) {
  if (days <= 0) return 'сегодня'
  if (days < 31) return `${days} дн. назад`
  const months = Math.round(days / 30)
  if (months < 12) return `${months} мес. назад`
  const years = Math.floor(days / 365)
  return years === 1 ? 'год назад' : `${years} г. назад`
}

/** Подгружает подсказки приёмки: кто клиент (C1) и нет ли гарантии на этот аппарат (C2). */
export function useIntakeHints(counteragentId: number | null, serial: string, brand: string, model: string) {
  const [hints, setHints] = useState<IntakeHints | null>(null)
  useEffect(() => {
    const serialKey = serial.replace(/[^0-9a-zA-Z]/g, '')
    if (!counteragentId && serialKey.length < 5) {
      setHints(null)
      return
    }
    let active = true
    const timer = window.setTimeout(() => {
      const q = new URLSearchParams()
      if (counteragentId) q.set('counteragent_id', String(counteragentId))
      if (serialKey.length >= 5) q.set('serial', serial)
      if (brand) q.set('brand', brand)
      if (model) q.set('model', model)
      api.get<IntakeHints>(`/intake/hints?${q}`).then((r) => active && setHints(r)).catch(() => undefined)
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [counteragentId, serial, brand, model])
  return hints
}

export function ClientCard({ client }: { client: NonNullable<IntakeHints['client']> }) {
  // Новый клиент (первый визит) — карточка не нужна, хватает «Найден клиент»
  if (client.visits === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{client.name.split(' ')[0]}, {client.visits + 1}-й визит</span>
        {client.is_regular && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">Постоянный</span>}
        {client.debt > 0 && <span className="rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">Долг {rub(client.debt)}</span>}
        {client.open_orders > 0 && <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">В работе: {client.open_orders}</span>}
        {!client.allow_sms && <span className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">Без SMS</span>}
      </div>
      {client.last && (
        <p className="mt-1 text-muted">
          Последний — <a className="text-ink underline decoration-line underline-offset-2" href={`/orders/${client.last.id}`} target="_blank" rel="noreferrer">{client.last.number}</a>,{' '}
          {client.last.device}{client.last.works.length > 0 && `, ${client.last.works.join(', ')}`} · {ago(client.last.days_ago)}
        </p>
      )}
      {Number(client.spent) > 0 && <p className="text-muted">Всего оставил: {rub(client.spent)}</p>}
      {client.note && <p className="mt-1 whitespace-pre-wrap">{client.note}</p>}
    </div>
  )
}

export function WarrantyAlert({ hints, isWarrantyType, onApply }: { hints: IntakeHints; isWarrantyType: boolean; onApply: (item: IntakeHints['warranty'][number]) => void }) {
  if (hints.warranty.length === 0) return null
  return (
    <div className="space-y-2">
      {hints.warranty.map((w) => {
        const strong = w.kind === 'warranty'
        return (
          <div key={w.order_id} role="status"
            className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm ${strong ? 'border-success bg-success/10' : 'border-line bg-surface'}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {strong ? 'Гарантийный случай' : 'Повторное обращение'}
                <span className="font-normal text-muted"> · {w.match === 'serial' ? 'тот же IMEI / серийник' : 'тот же клиент и модель'}</span>
              </p>
              <p>
                {strong
                  ? w.covered.map((c) => `${c.name} — до ${date(c.until)}`).join('; ')
                  : `Выдан ${ago(w.days_ago)}${w.works.length ? `: ${w.works.join(', ')}` : ''}. Сроки гарантии в заказе не указаны — проверьте по квитанции.`}
              </p>
              <p className="text-muted">
                Заказ <a className="text-ink underline decoration-line underline-offset-2" href={`/orders/${w.order_id}`} target="_blank" rel="noreferrer">{w.number}</a>, {w.device}, выдан {date(w.closed_at)}
              </p>
            </div>
            {hints.warranty_order_type_id && !isWarrantyType && (
              <button type="button" onClick={() => onApply(w)}
                className={`rounded-md px-3 py-2 font-medium ${strong ? 'bg-success text-white' : 'border border-line bg-surface'}`}>
                Оформить как гарантийный
              </button>
            )}
            {isWarrantyType && <span className="text-success">✓ Оформляется как гарантийный</span>}
          </div>
        )
      })}
    </div>
  )
}
