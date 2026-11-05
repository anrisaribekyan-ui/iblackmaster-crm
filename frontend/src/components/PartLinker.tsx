import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { DOSKA_BOARDS, doska, noteOrderOnCard } from './PartOrder'

/**
 * «Закупки → Связать»: карточки «Что купить», у которых ещё не записано, зачем они.
 * Мелкая кнопка «зачем это?» показывает заказы, похожие на запчасть, но привязку не делает сама — выбирает сотрудник.
 */
type Card = { id: string; loc: string; col: number; text: string; supplier: string | null; price?: number | null; deleted?: boolean }
type Linked = { order_id: number | null; order_number: string | null; purpose: string; purpose_label: string }
type Suggestion = { order_id: number; number: string; device: string; client: string; problems: string; score: number }

const boardName = (loc: string) => DOSKA_BOARDS.find((b) => b.id === loc)?.name ?? loc

function CardRow({ card, linked, onLinked }: { card: Card; linked: Linked | undefined; onLinked: () => void }) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')

  const ask = async () => {
    setOpen(true)
    if (items) return
    setLoading(true)
    try {
      setItems((await api.post<{ items: Suggestion[] }>('/part-requests/suggest', { text: card.text })).items)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  const link = async (body: { order_id?: number; order_number?: string; purpose: string; suggested?: boolean }, orderNumber?: string) => {
    setError('')
    try {
      const saved = await api.post<{ order_number: string | null }>('/part-requests', {
        doska_id: card.id, text: card.text, price: card.price ?? null, ...body,
      })
      const number = orderNumber ?? saved.order_number
      if (number) await noteOrderOnCard(card.id, number, me?.short_name ?? 'CRM').catch(() => undefined)
      setOpen(false)
      onLinked()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось записать')
    }
  }

  return (
    <li className="py-2.5 text-sm">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="break-words">{card.text}</span>
          <span className="block text-xs text-muted">{boardName(card.loc)}{card.price ? ` · ${card.price.toLocaleString('ru-RU')} ₽` : ''}</span>
        </span>
        {linked ? (
          <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs">
            {linked.order_number ? `для заказа ${linked.order_number}` : linked.purpose_label}
          </span>
        ) : (
          <button type="button" onClick={() => void (open ? setOpen(false) : ask())} className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-accent">
            это для заказа?
          </button>
        )}
      </div>
      {open && !linked && (
        <div className="mt-2 grid gap-2 rounded-lg bg-canvas p-3">
          {loading ? <p className="text-xs text-muted">Ищу подходящие заказы…</p> : items && items.length > 0 ? (
            <>
              <p className="text-xs text-muted">Похоже на эти заказы. Выберите, если подходит:</p>
              {items.map((o) => (
                <button key={o.order_id} type="button" onClick={() => void link({ order_id: o.order_id, purpose: 'order', suggested: true }, o.number)}
                  className="rounded-md border border-line bg-surface px-3 py-2 text-left hover:border-accent">
                  <span className="font-medium">{o.number}</span> · {o.device}
                  <span className="block break-words text-xs text-muted">{[o.client, o.problems].filter(Boolean).join(' · ')}</span>
                </button>
              ))}
            </>
          ) : <p className="text-xs text-muted">Подходящих открытых заказов не нашла. Укажите вручную.</p>}
          <div className="flex flex-wrap gap-2">
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Номер заказа, например А16002" aria-label="Номер заказа"
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm" />
            <button type="button" disabled={!manual.trim()} onClick={() => void link({ order_number: manual.trim(), purpose: 'order' })}
              className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50 hover:border-accent">Для заказа</button>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <button type="button" onClick={() => void link({ purpose: 'stock_order' })} className="rounded-full border border-line px-3 py-1 hover:border-accent">На склад: потратили в заказе</button>
            <button type="button" onClick={() => void link({ purpose: 'stock_sale' })} className="rounded-full border border-line px-3 py-1 hover:border-accent">На склад: продали</button>
          </div>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      )}
    </li>
  )
}

export default function PartLinker() {
  const [cards, setCards] = useState<Card[] | null>(null)
  const [linked, setLinked] = useState<Record<string, Linked>>({})
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const state = await doska<{ items?: Card[] }>('/api/state')
      const list = (state.items ?? []).filter((i) => !i.deleted && i.col === 0)
      setCards(list)
      if (list.length) {
        const r = await api.get<{ items: Record<string, Linked> }>(`/part-requests/linked?doska_ids=${list.map((c) => c.id).join(',')}`)
        setLinked(r.items)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Доска закупок недоступна')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  if (error) return <p role="alert" className="rounded-xl border border-line bg-surface p-5 text-danger">{error}</p>
  if (!cards) return <div className="h-28 animate-pulse rounded-xl bg-surface" />
  const open = cards.filter((c) => !linked[c.id])
  const done = cards.filter((c) => linked[c.id])
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">Зачем эти запчасти</h2>
      <p className="mb-2 text-sm text-muted">{open.length ? `${open.length} без отметки. Нажмите «это для заказа?» — подскажу похожие заказы, выберете сами.` : 'Все карточки привязаны.'}</p>
      <ul className="divide-y divide-line">
        {[...open, ...done].map((c) => <CardRow key={c.id} card={c} linked={linked[c.id]} onLinked={() => void load()} />)}
      </ul>
      {!cards.length && <p className="text-sm text-muted">В «Что купить» пусто.</p>}
    </div>
  )
}
