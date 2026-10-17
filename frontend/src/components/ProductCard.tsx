import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from './Modal'
import { formatDateTime, inputClass, money, qty } from '../pages/shared'

type Price = { price_type_id: number; name: string; price: string; location_id: number | null }
type Item = {
  id: number
  code: number
  article: string | null
  name: string
  is_work: boolean
  group_id: number | null
  measure_id: number | null
  purchase_price: string | null
  guarantee_days: number
  min_count: string
  has_serials: boolean
  note: string | null
  salary_percent: string | null
  salary_fixed: string | null
  prices: Price[]
}
type Card = {
  item: Item
  group: string | null
  balances: { store_id: number; store: string; location: string; color: string; quantity: string; avg_purchase_price: string | null }[]
  on_hand: string
  used_30: string
  days_left: number | null
  history: { date: string; kind: string; title: string; number: string; link: string; note: string | null; quantity: string; price: string | null }[]
}
type PriceType = { id: number; name: string; is_minimal: boolean; sort: number }

const KIND_STYLE: Record<string, string> = {
  purchase: 'bg-success/10 text-success',
  saleReturn: 'bg-success/10 text-success',
  sale: 'bg-ink text-white',
  order: 'bg-accent-soft text-accent',
  move: 'bg-canvas text-muted',
  inventory: 'bg-canvas text-muted',
  cancellation: 'bg-danger/10 text-danger',
  purchaseReturn: 'bg-danger/10 text-danger',
}

/** Карточка товара: остатки по точкам, на сколько хватит, цены, история движений и правка — в одном окне. */
export default function ProductCard({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged?: () => void }) {
  const { can } = useAuth()
  const [card, setCard] = useState<Card | null>(null)
  const [types, setTypes] = useState<PriceType[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', article: '', purchase_price: '', guarantee_days: '', min_count: '', note: '' })
  const [prices, setPrices] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const canEdit = can(item0IsWork(card) ? 'workAccess' : 'nomenclatureAccess')
  const canPurchase = can('purchasePriceAccess')

  const load = () =>
    api.get<Card>(`/nomenclature/${id}/card`).then((c) => {
      setCard(c)
      setForm({
        name: c.item.name,
        article: c.item.article ?? '',
        purchase_price: c.item.purchase_price ? String(Number(c.item.purchase_price)) : '',
        guarantee_days: String(c.item.guarantee_days || ''),
        min_count: Number(c.item.min_count) ? String(Number(c.item.min_count)) : '',
        note: c.item.note ?? '',
      })
      setPrices(Object.fromEntries(c.item.prices.filter((p) => p.location_id === null).map((p) => [p.price_type_id, String(Number(p.price))])))
    })

  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось открыть товар'))
    api.get<PriceType[]>('/price-types').then(setTypes).catch(() => setTypes([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!card) return
    setSaving(true)
    setError('')
    try {
      const it = card.item
      await api.put(`/nomenclature/${id}`, {
        name: form.name.trim(),
        article: form.article.trim() || null,
        is_work: it.is_work,
        group_id: it.group_id,
        measure_id: it.measure_id,
        purchase_price: form.purchase_price || '0',
        guarantee_days: Number(form.guarantee_days || 0),
        min_count: form.min_count || '0',
        has_serials: it.has_serials,
        note: form.note.trim() || null,
        salary_percent: it.salary_percent,
        salary_fixed: it.salary_fixed,
        prices: Object.entries(prices).filter(([, v]) => v !== '').map(([type, price]) => ({ price_type_id: Number(type), price })),
      })
      await load()
      setEditing(false)
      onChanged?.()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const copyCode = async () => {
    if (!card) return
    try {
      await navigator.clipboard.writeText(String(card.item.code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* нет доступа к буферу — ничего страшного */ }
  }

  const item = card?.item
  const onHand = Number(card?.on_hand ?? 0)
  const low = item && Number(item.min_count) > 0 && onHand <= Number(item.min_count)

  return (
    <Modal title={item ? item.name : 'Товар'} onClose={onClose} wide>
      {!card ? (
        error ? <p className="text-danger">{error}</p> : <div className="grid gap-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-canvas" />)}</div>
      ) : (
        <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <button type="button" onClick={() => void copyCode()} className="rounded border border-line px-1.5 py-0.5 num hover:border-ink/40" title="Скопировать код">
              {copied ? 'скопировано ✓' : `код ${item!.code}`}
            </button>
            {item!.article && <span>арт. {item!.article}</span>}
            {card.group && <span>{card.group}</span>}
            {item!.guarantee_days > 0 && <span>гарантия {item!.guarantee_days} дн.</span>}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat label="В наличии" value={`${qty(onHand)} шт`} tone={onHand <= 0 ? 'bad' : low ? 'warn' : undefined} note={low ? `мин. ${qty(item!.min_count)}` : undefined} />
            <Stat label="Расход, 30 дн." value={`${qty(card.used_30)} шт`} />
            <Stat label="Хватит" value={card.days_left === null ? (Number(card.used_30) > 0 ? "—" : "нет расхода") : card.days_left > 365 ? 'больше года' : `~${card.days_left} дн.`} tone={card.days_left !== null && card.days_left < 7 ? 'warn' : undefined} />
          </div>

          {card.balances.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-ink">По складам</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {card.balances.map((b) => (
                  <li key={b.store_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: b.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{b.location.replace(/^iBlackMaster\s*\(?|\)$/g, '')} <small className="text-muted">· {b.store}</small></span>
                    {b.avg_purchase_price !== null && <span className="text-xs text-muted num">по {money(b.avg_purchase_price)}</span>}
                    <b className={`w-14 text-right num ${Number(b.quantity) <= 0 ? 'text-danger' : ''}`}>{qty(b.quantity)}</b>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {editing ? (
            <form onSubmit={(e) => void save(e)} className="grid gap-3 rounded-lg border border-line p-3">
              <label className="grid gap-1 text-xs text-muted">Название
                <input className={`${inputClass} text-ink`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <label className="grid gap-1 text-xs text-muted">Артикул
                  <input className={`${inputClass} text-ink`} value={form.article} onChange={(e) => setForm({ ...form, article: e.target.value })} />
                </label>
                {canPurchase && (
                  <label className="grid gap-1 text-xs text-muted">Закупочная, ₽
                    <input className={`${inputClass} text-right text-ink num`} inputMode="numeric" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value.replace(/[^\d]/g, '') })} />
                  </label>
                )}
                <label className="grid gap-1 text-xs text-muted">Гарантия, дн.
                  <input className={`${inputClass} text-right text-ink num`} inputMode="numeric" value={form.guarantee_days} onChange={(e) => setForm({ ...form, guarantee_days: e.target.value.replace(/[^\d]/g, '') })} />
                </label>
                <label className="grid gap-1 text-xs text-muted">Мин. остаток
                  <input className={`${inputClass} text-right text-ink num`} inputMode="numeric" value={form.min_count} onChange={(e) => setForm({ ...form, min_count: e.target.value.replace(/[^\d]/g, '') })} />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {types.map((t) => (
                  <label key={t.id} className="grid gap-1 text-xs text-muted">{t.name}, ₽
                    <input className={`${inputClass} text-right text-ink num`} inputMode="numeric" value={prices[t.id] ?? ''} onChange={(e) => setPrices({ ...prices, [t.id]: e.target.value.replace(/[^\d]/g, '') })} />
                  </label>
                ))}
              </div>
              <label className="grid gap-1 text-xs text-muted">Заметка
                <textarea className={`${inputClass} text-ink`} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </label>
              {error && <p className="text-sm text-danger">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditing(false)}>Отмена</button>
                <button disabled={saving} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохраняю…' : 'Сохранить'}</button>
              </div>
            </form>
          ) : (
            <section className="flex flex-wrap items-end justify-between gap-3">
              <dl className="flex flex-wrap gap-x-6 gap-y-2">
                {types.map((t) => {
                  const p = item!.prices.find((x) => x.price_type_id === t.id && x.location_id === null)
                  return (
                    <div key={t.id}>
                      <dt className="text-xs text-muted">{t.name}</dt>
                      <dd className="num text-lg font-semibold">{p ? money(p.price) : '—'}</dd>
                    </div>
                  )
                })}
                {canPurchase && (
                  <div>
                    <dt className="text-xs text-muted">Закупочная</dt>
                    <dd className="num text-lg font-semibold text-muted">{money(item!.purchase_price)}</dd>
                  </div>
                )}
              </dl>
              {canEdit && <button className="rounded-md border border-line px-3 py-2 text-sm hover:border-ink/40" onClick={() => setEditing(true)}>Изменить</button>}
            </section>
          )}
          {item!.note && !editing && <p className="rounded-lg bg-canvas px-3 py-2 text-sm">{item!.note}</p>}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink">История движений</h3>
            {card.history.length === 0 ? (
              <p className="text-sm text-muted">Движений пока не было.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {card.history.map((h, i) => {
                  const q = Number(h.quantity)
                  return (
                    <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className={`w-24 shrink-0 rounded px-1.5 py-0.5 text-center text-xs ${KIND_STYLE[h.kind] ?? 'bg-canvas text-muted'}`}>{h.title}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <Link to={h.link} className="text-accent hover:underline" onClick={onClose}>{h.number}</Link>
                        <small className="ml-2 text-muted">{formatDateTime(h.date)}</small>
                        {h.note && <small className="ml-2 text-muted">· {h.note}</small>}
                      </span>
                      {h.price !== null && <span className="hidden text-xs text-muted num sm:inline">{money(h.price)}</span>}
                      <b className={`w-12 text-right num ${q > 0 ? 'text-success' : q < 0 ? '' : 'text-muted'}`}>{q > 0 ? `+${qty(q)}` : qty(q)}</b>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}

function item0IsWork(card: Card | null): boolean {
  return card?.item.is_work ?? false
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={`min-w-0 rounded-lg border p-2.5 sm:p-3 ${tone === 'bad' ? 'border-danger/30 bg-danger/5' : tone === 'warn' ? 'border-warning/30 bg-warning/5' : 'border-line'}`}>
      <p className="truncate text-xs text-muted">{label}</p>
      <p className={`num mt-1 text-lg font-semibold leading-tight ${tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : ''}`}>{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}
