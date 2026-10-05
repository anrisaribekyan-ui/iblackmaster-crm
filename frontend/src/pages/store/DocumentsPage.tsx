import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import CatalogPicker from '../../components/CatalogPicker'
import Modal from '../../components/Modal'
import { formatDateTime, inputClass, money, qty, useLocationsAndRegisters, type CatalogItem } from '../shared'

export type DocType = 'purchase' | 'move' | 'cancellation'

const TITLES: Record<DocType, { list: string; one: string; create: string; del: string }> = {
  purchase: { list: 'Поступления', one: 'Поступление', create: 'createPurchaseDocumentAccess', del: 'deletePurchaseDocumentAccess' },
  move: { list: 'Перемещения', one: 'Перемещение', create: 'createMoveDocumentAccess', del: 'deleteMoveDocumentAccess' },
  cancellation: { list: 'Списания', one: 'Списание', create: 'createCancellationDocumentAccess', del: 'deleteCancellationDocumentAccess' },
}

type DocRow = {
  id: number
  number: string
  date: string
  store: string | null
  to_store: string | null
  counteragent: string | null
  total: string
  paid: string
  note: string | null
}

type DocDetail = DocRow & {
  positions: { id: number; name: string; code: number; quantity: string; price: string | null }[]
}

export default function DocumentsPage({ type }: { type: DocType }) {
  const { can } = useAuth()
  const t = TITLES[type]
  const [rows, setRows] = useState<DocRow[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [viewing, setViewing] = useState<DocDetail | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.get<{ items: DocRow[] }>(`/stock-documents?type=${type}`)
      setRows(data.items)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить документы')
    }
  }, [type])

  useEffect(() => {
    setRows(null)
    setCreating(false)
    void load()
  }, [load])

  const open = async (id: number) => {
    try {
      setViewing(await api.get<DocDetail>(`/stock-documents/${id}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось открыть документ')
    }
  }

  const remove = async (doc: DocDetail) => {
    if (!confirm(`Удалить документ ${doc.number}? Остатки и оплаты будут возвращены.`)) return
    try {
      await api.del(`/stock-documents/${doc.id}`)
      setViewing(null)
      await load()
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Не удалось удалить документ')
    }
  }

  if (creating) {
    return <DocumentForm type={type} onDone={() => { setCreating(false); void load() }} onCancel={() => setCreating(false)} />
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t.list}</h2>
        {can(t.create) && (
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink" onClick={() => setCreating(true)}>
            Создать
          </button>
        )}
      </div>
      {error && <p className="mb-3 text-danger">{error}</p>}
      {rows === null ? (
        <p className="text-muted">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-muted">Документов пока нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Документ</th>
                <th className="px-3 py-2 font-medium">Дата</th>
                <th className="px-3 py-2 font-medium">{type === 'move' ? 'Откуда → куда' : 'Склад'}</th>
                {type === 'purchase' && <th className="px-3 py-2 font-medium">Поставщик</th>}
                <th className="px-3 py-2 text-right font-medium">Сумма</th>
                {type === 'purchase' && <th className="px-3 py-2 text-right font-medium">Оплачено</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => void open(r.id)}>
                  <td className="px-3 py-2 font-medium text-accent">{r.number}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(r.date)}</td>
                  <td className="px-3 py-2">{type === 'move' ? `${r.store ?? '—'} → ${r.to_store ?? '—'}` : r.store}</td>
                  {type === 'purchase' && <td className="px-3 py-2">{r.counteragent ?? '—'}</td>}
                  <td className="px-3 py-2 text-right num">{money(r.total)}</td>
                  {type === 'purchase' && <td className="px-3 py-2 text-right num">{money(r.paid)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <Modal title={`${t.one} ${viewing.number}`} onClose={() => setViewing(null)}>
          <p className="mb-3 text-sm text-muted">
            {formatDateTime(viewing.date)} · {type === 'move' ? `${viewing.store} → ${viewing.to_store}` : viewing.store}
            {viewing.counteragent ? ` · ${viewing.counteragent}` : ''}
          </p>
          <table className="mb-3 w-full text-sm">
            <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Товар</th><th className="py-1 text-right font-medium">Кол-во</th><th className="py-1 text-right font-medium">Цена</th></tr></thead>
            <tbody>
              {viewing.positions.map((p) => (
                <tr key={p.id} className="border-t border-line">
                  <td className="py-1.5">{p.name}</td>
                  <td className="py-1.5 text-right num">{qty(p.quantity)}</td>
                  <td className="py-1.5 text-right num">{money(p.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-4 text-right">Итого: <strong className="num">{money(viewing.total)}</strong></p>
          {viewing.note && <p className="mb-4 text-sm">{viewing.note}</p>}
          {can(t.del) && (
            <button className="text-danger" onClick={() => void remove(viewing)}>Удалить документ</button>
          )}
        </Modal>
      )}
    </div>
  )
}

type Line = { item: CatalogItem; quantity: string; price: string }

function DocumentForm({ type, onDone, onCancel }: { type: DocType; onDone: () => void; onCancel: () => void }) {
  const { locations, registers } = useLocationsAndRegisters()
  const [locationId, setLocationId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [toStoreId, setToStoreId] = useState('')
  const [vendorQuery, setVendorQuery] = useState('')
  const [vendors, setVendors] = useState<{ id: number; name: string }[]>([])
  const [vendor, setVendor] = useState<{ id: number; name: string } | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [note, setNote] = useState('')
  const [payRegister, setPayRegister] = useState('')
  const [payAmount, setPayAmount] = useState('')
  const [payBank, setPayBank] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!locationId && locations.length) {
      const first = locations[0]
      setLocationId(String(first.id))
      setStoreId(String(first.stores.find((s) => s.is_default)?.id ?? first.stores[0]?.id ?? ''))
    }
  }, [locations, locationId])

  const stores = locations.find((l) => String(l.id) === locationId)?.stores ?? []
  const allStores = locations.flatMap((l) => l.stores.map((s) => ({ ...s, location: l.name })))
  const total = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.price || 0), 0)

  const findVendors = async () => {
    const data = await api.get<{ items: { id: number; name: string }[] }>(`/counteragents?is_vendor=true&q=${encodeURIComponent(vendorQuery)}`)
    setVendors(data.items)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (lines.length === 0) {
      setError('Добавьте хотя бы одну позицию')
      return
    }
    setBusy(true)
    try {
      await api.post('/stock-documents', {
        type,
        location_id: Number(locationId),
        store_id: Number(storeId),
        to_store_id: type === 'move' ? Number(toStoreId) || null : null,
        counteragent_id: type === 'purchase' ? vendor?.id ?? null : null,
        note: note || null,
        cash_register_id: type === 'purchase' && payRegister && payAmount ? Number(payRegister) : null,
        amount: type === 'purchase' && payRegister && payAmount ? payAmount : null,
        is_bank: payBank,
        positions: lines.map((l) => ({ nomenclature_id: l.item.id, quantity: l.quantity, price: l.price || '0' })),
      })
      onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать документ')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-4">
      <h2 className="text-lg font-semibold">Новое: {TITLES[type].one.toLowerCase()}</h2>
      <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-xs text-muted">Локация
          <select className={inputClass} value={locationId} onChange={(e) => { setLocationId(e.target.value); setStoreId(''); setLines([]) }}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">{type === 'move' ? 'Склад откуда' : 'Склад'}
          <select className={inputClass} required value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Выберите склад</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {type === 'move' && (
          <label className="grid gap-1 text-xs text-muted">Склад куда
            <select className={inputClass} required value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
              <option value="">Выберите склад</option>
              {allStores.filter((s) => String(s.id) !== storeId).map((s) => <option key={s.id} value={s.id}>{s.location} — {s.name}</option>)}
            </select>
          </label>
        )}
        {type === 'purchase' && (
          <div className="grid gap-1 text-xs text-muted">Поставщик
            {vendor ? (
              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm text-ink">
                {vendor.name}<button type="button" className="text-muted" onClick={() => setVendor(null)}>×</button>
              </div>
            ) : (
              <div className="relative flex gap-1">
                <input className={inputClass} value={vendorQuery} onChange={(e) => setVendorQuery(e.target.value)} placeholder="Имя или телефон" />
                <button type="button" className="rounded-md border border-line px-2" onClick={() => void findVendors()}>Найти</button>
                {vendors.length > 0 && (
                  <ul className="absolute left-0 top-full z-10 mt-1 w-full rounded-md border border-line bg-surface shadow-lg">
                    {vendors.map((v) => (
                      <li key={v.id}><button type="button" className="w-full px-3 py-2 text-left text-sm text-ink hover:bg-canvas" onClick={() => { setVendor(v); setVendors([]) }}>{v.name}</button></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-3 font-medium">Товары</h3>
        <CatalogPicker
          locationId={locationId}
          onlyProducts
          onPick={(item) => setLines((cur) => cur.some((l) => l.item.id === item.id) ? cur : [...cur, { item, quantity: '1', price: type === 'purchase' ? (item.purchase_price ?? '0') : '0' }])}
        />
        {lines.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 text-left font-medium">Товар</th>
                <th className="py-1 text-right font-medium">В наличии</th>
                <th className="py-1 text-right font-medium">Кол-во</th>
                {type === 'purchase' && <th className="py-1 text-right font-medium">Закуп. цена</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={line.item.id} className="border-t border-line">
                  <td className="py-1.5">{line.item.name}</td>
                  <td className="py-1.5 text-right num text-muted">{qty(line.item.stock_quantity)}</td>
                  <td className="py-1.5 text-right">
                    <input className={`${inputClass} ml-auto w-24 text-right num`} type="number" min="0.001" step="0.001" required value={line.quantity}
                      onChange={(e) => setLines((cur) => cur.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))} />
                  </td>
                  {type === 'purchase' && (
                    <td className="py-1.5 text-right">
                      <input className={`${inputClass} ml-auto w-28 text-right num`} type="number" min="0" step="0.01" required value={line.price}
                        onChange={(e) => setLines((cur) => cur.map((l, j) => j === i ? { ...l, price: e.target.value } : l))} />
                    </td>
                  )}
                  <td className="py-1.5 pl-2 text-right"><button type="button" className="text-danger" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {type === 'purchase' && lines.length > 0 && <p className="mt-3 text-right">Итого: <strong className="num">{money(total)}</strong></p>}
      </section>

      {type === 'purchase' && (
        <section className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3">
          <h3 className="font-medium sm:col-span-3">Оплата поставщику <span className="text-sm font-normal text-muted">(необязательно — без оплаты сумма уйдёт в долг поставщику)</span></h3>
          <label className="grid gap-1 text-xs text-muted">Касса
            <select className={inputClass} value={payRegister} onChange={(e) => setPayRegister(e.target.value)}>
              <option value="">Без оплаты</option>
              {registers.filter((r) => r.location_id === null || String(r.location_id) === locationId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">Сумма, ₽
            <input className={inputClass} type="number" min="0.01" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={total ? String(total) : ''} disabled={!payRegister} />
          </label>
          <label className="grid gap-1 text-xs text-muted">Способ
            <select className={inputClass} value={payBank ? 'bank' : 'cash'} onChange={(e) => setPayBank(e.target.value === 'bank')} disabled={!payRegister}>
              <option value="cash">Наличные</option><option value="bank">Безнал</option>
            </select>
          </label>
        </section>
      )}

      <label className="grid gap-1 text-xs text-muted">Примечание
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md border border-line bg-surface px-4 py-2" onClick={onCancel}>Отмена</button>
        <button disabled={busy} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">{busy ? 'Сохраняем…' : 'Провести'}</button>
      </div>
    </form>
  )
}
