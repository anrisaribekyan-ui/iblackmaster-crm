import { useEffect, useState } from 'react'
import { api } from '../api/client'

type Row = { id: number; text: string; shop: string | null; price: string | null; purpose: string; purpose_label: string; suggested: boolean }

/** Заказанные запчасти этого заказа: что, где купили и зачем (под заказ или пополнение склада). */
export default function OrderParts({ orderId, version }: { orderId: number; version: number }) {
  const [rows, setRows] = useState<Row[]>([])
  useEffect(() => {
    let alive = true
    api.get<{ items: Row[] }>(`/part-requests?order_id=${orderId}`).then((r) => { if (alive) setRows(r.items) }).catch(() => undefined)
    return () => { alive = false }
  }, [orderId, version])
  if (!rows.length) return null
  return (
    <div className="mb-4 rounded-lg border border-line bg-canvas p-3 text-sm">
      <p className="mb-1 text-xs font-medium text-muted">Заказанные запчасти</p>
      <ul className="grid gap-1.5">
        {rows.map((r) => (
          <li key={r.id} className="break-words">
            <span className="text-success" aria-hidden>✓ </span>{r.text}
            <span className="block text-xs text-muted">
              {[r.shop, r.price ? `${Number(r.price).toLocaleString('ru-RU')} ₽` : null, r.purpose_label].filter(Boolean).join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
