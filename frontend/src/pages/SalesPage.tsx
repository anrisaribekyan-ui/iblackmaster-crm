import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import CatalogPicker from '../components/CatalogPicker'
import Modal from '../components/Modal'
import { formatDateTime, inputClass, money, qty, retailPrice, useLocationsAndRegisters, type CatalogItem } from './shared'

type Line = { item: CatalogItem; quantity: string; price: string }
type Payment = { cash_register_id: string; amount: string; is_bank: boolean }
type SaleRow = { id: number; number: string; date: string; total_price: string; paid: string; counteragent: string | null; seller: string | null }
type SaleDetail = SaleRow & {
  positions: { id: number; name: string; is_work: boolean; quantity: string; sold_price: string; returned_quantity: string }[]
}

export default function SalesPage() {
  const { can } = useAuth()
  const { locations, registers } = useLocationsAndRegisters()
  const [locationId, setLocationId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [discount, setDiscount] = useState('')
  const [phone, setPhone] = useState('')
  const [buyer, setBuyer] = useState<{ id: number; name: string } | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<SaleRow[] | null>(null)
  const [viewing, setViewing] = useState<SaleDetail | null>(null)

  useEffect(() => {
    if (!locationId && locations.length) {
      const first = locations[0]
      setLocationId(String(first.id))
      setStoreId(String(first.stores.find((s) => s.is_default)?.id ?? first.stores[0]?.id ?? ''))
    }
  }, [locations, locationId])

  const localRegisters = registers.filter((r) => r.location_id === null || String(r.location_id) === locationId)

  const loadHistory = useCallback(async () => {
    if (!locationId) return
    try {
      setHistory((await api.get<{ items: SaleRow[] }>(`/sales?location_id=${locationId}`)).items)
    } catch {
      setHistory([])
    }
  }, [locationId])
  useEffect(() => { void loadHistory() }, [loadHistory])

  const gross = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.price || 0), 0)
  const total = Math.max(0, Math.round(gross * (1 - Number(discount || 0) / 100) * 100) / 100)
  const paidSum = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0)

  const findBuyer = async () => {
    setError('')
    try {
      const found = await api.get<{ id: number; name: string } | null>(`/counteragents/by-phone?phone=${encodeURIComponent(phone)}`)
      if (found) setBuyer(found)
      else setError('Покупатель с таким телефоном не найден')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось найти покупателя')
    }
  }

  const addPayment = () => {
    const reg = localRegisters.find((r) => r.accepts_cash) ?? localRegisters[0]
    if (!reg) return
    setPayments((cur) => [...cur, { cash_register_id: String(reg.id), amount: String(Math.max(0, total - paidSum)), is_bank: !reg.accepts_cash }])
  }

  const submit = async () => {
    setError('')
    setNotice('')
    if (lines.length === 0) {
      setError('Добавьте товар или работу в чек')
      return
    }
    setBusy(true)
    try {
      const sale = await api.post<{ number: string; debt: string }>('/sales', {
        location_id: Number(locationId),
        store_id: Number(storeId),
        counteragent_id: buyer?.id ?? null,
        discount_percent: discount || '0',
        positions: lines.map((l) => ({
          nomenclature_id: l.item.id,
          is_work: l.item.is_work,
          quantity: l.quantity,
          price: l.price || '0',
        })),
        payments: payments.filter((p) => Number(p.amount) > 0).map((p) => ({ ...p, cash_register_id: Number(p.cash_register_id) })),
      })
      setNotice(`Чек ${sale.number} пробит${Number(sale.debt) > 0 ? `, долг покупателя ${money(sale.debt)}` : ''}`)
      setLines([])
      setPayments([])
      setDiscount('')
      setBuyer(null)
      setPhone('')
      await loadHistory()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось пробить чек')
    } finally {
      setBusy(false)
    }
  }

  const stores = locations.find((l) => String(l.id) === locationId)?.stores ?? []

  return (
    <section>
      <h1 className="mb-5 text-xl font-semibold">Продажи</h1>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 font-medium">Чек</h2>
          <CatalogPicker
            locationId={locationId}
            onPick={(item) => setLines((cur) => cur.some((l) => l.item.id === item.id) ? cur : [...cur, { item, quantity: '1', price: retailPrice(item) }])}
          />
          {lines.length === 0 ? (
            <p className="mt-4 text-sm text-muted">Найдите товар или работу и добавьте в чек.</p>
          ) : (
            <table className="mt-4 w-full text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 text-left font-medium">Позиция</th>
                  <th className="py-1 text-right font-medium">Кол-во</th>
                  <th className="py-1 text-right font-medium">Цена</th>
                  <th className="py-1 text-right font-medium">Сумма</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.item.id} className="border-t border-line">
                    <td className="py-1.5">{line.item.name}{!line.item.is_work && <small className="block text-muted">в наличии {qty(line.item.stock_quantity)}</small>}</td>
                    <td className="py-1.5 text-right">
                      <input className={`${inputClass} ml-auto w-20 text-right num`} type="number" min="0.001" step="0.001" value={line.quantity}
                        onChange={(e) => setLines((cur) => cur.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))} />
                    </td>
                    <td className="py-1.5 text-right">
                      <input className={`${inputClass} ml-auto w-28 text-right num`} type="number" min="0" step="0.01" value={line.price}
                        disabled={!can('discountSaleAccess') && !can('setPriceAccess')}
                        onChange={(e) => setLines((cur) => cur.map((l, j) => j === i ? { ...l, price: e.target.value } : l))} />
                    </td>
                    <td className="py-1.5 text-right num">{money(Number(line.quantity || 0) * Number(line.price || 0))}</td>
                    <td className="py-1.5 pl-2 text-right"><button className="text-danger" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))} aria-label="Убрать">×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <aside className="grid content-start gap-3 rounded-xl border border-line bg-surface p-4">
          <label className="grid gap-1 text-xs text-muted">Локация
            <select className={inputClass} value={locationId} onChange={(e) => {
              const loc = locations.find((l) => String(l.id) === e.target.value)
              setLocationId(e.target.value)
              setStoreId(String(loc?.stores.find((s) => s.is_default)?.id ?? loc?.stores[0]?.id ?? ''))
              setLines([])
              setPayments([])
            }}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">Склад
            <select className={inputClass} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="grid gap-1 text-xs text-muted">Покупатель (необязательно)
            {buyer ? (
              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm text-ink">{buyer.name}<button className="text-muted" onClick={() => setBuyer(null)}>×</button></div>
            ) : (
              <div className="flex gap-1">
                <input className={inputClass} type="tel" placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <button className="rounded-md border border-line px-2" onClick={() => void findBuyer()}>Найти</button>
              </div>
            )}
          </div>
          {can('discountSaleAccess') && (
            <label className="grid gap-1 text-xs text-muted">Скидка, %
              <input className={inputClass} type="number" min="0" max="100" step="0.1" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </label>
          )}
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-muted">Итого</span><strong className="num text-xl">{money(total)}</strong>
          </div>

          <div className="grid gap-2">
            {payments.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_auto] gap-1">
                <select className={inputClass} value={`${p.cash_register_id}:${p.is_bank ? 'bank' : 'cash'}`}
                  onChange={(e) => {
                    const [id, kind] = e.target.value.split(':')
                    setPayments((cur) => cur.map((x, j) => j === i ? { ...x, cash_register_id: id, is_bank: kind === 'bank' } : x))
                  }}>
                  {localRegisters.flatMap((r) => [
                    ...(r.accepts_cash ? [<option key={`${r.id}c`} value={`${r.id}:cash`}>{r.name} — нал</option>] : []),
                    ...(r.accepts_bank ? [<option key={`${r.id}b`} value={`${r.id}:bank`}>{r.name} — безнал</option>] : []),
                  ])}
                </select>
                <input className={`${inputClass} text-right num`} type="number" min="0" step="0.01" value={p.amount}
                  onChange={(e) => setPayments((cur) => cur.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                <button className="px-1 text-danger" onClick={() => setPayments((cur) => cur.filter((_, j) => j !== i))} aria-label="Убрать оплату">×</button>
              </div>
            ))}
            <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={addPayment}>+ Оплата</button>
            {payments.length > 0 && Math.abs(paidSum - total) > 0.001 && (
              <p className="text-sm text-muted">{paidSum < total ? `Не хватает ${money(total - paidSum)}` : `Больше суммы на ${money(paidSum - total)}`}</p>
            )}
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          {notice && <p className="text-sm text-success">{notice}</p>}
          <button disabled={busy} className="rounded-md bg-accent px-4 py-2.5 font-medium text-accent-ink disabled:opacity-60" onClick={() => void submit()}>
            {busy ? 'Пробиваем…' : 'Пробить чек'}
          </button>
        </aside>
      </div>

      <h2 className="mb-3 mt-8 font-medium">История чеков</h2>
      {history === null ? <p className="text-muted">Загрузка…</p> : history.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-muted">Чеков в этой локации ещё нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr><th className="px-3 py-2 font-medium">Чек</th><th className="px-3 py-2 font-medium">Дата</th><th className="px-3 py-2 font-medium">Покупатель</th><th className="px-3 py-2 font-medium">Продавец</th><th className="px-3 py-2 text-right font-medium">Сумма</th><th className="px-3 py-2 text-right font-medium">Оплачено</th></tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => void api.get<SaleDetail>(`/sales/${s.id}`).then(setViewing)}>
                  <td className="px-3 py-2 font-medium text-accent">{s.number}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.date)}</td>
                  <td className="px-3 py-2">{s.counteragent ?? '—'}</td>
                  <td className="px-3 py-2">{s.seller ?? '—'}</td>
                  <td className="px-3 py-2 text-right num">{money(s.total_price)}</td>
                  <td className={`px-3 py-2 text-right num ${Number(s.paid) < Number(s.total_price) ? 'text-danger' : ''}`}>{money(s.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && (
        <SaleModal sale={viewing} registers={localRegisters} canReturn={can('saleReturnAccess')}
          onClose={() => setViewing(null)} onReturned={() => { setViewing(null); void loadHistory() }} />
      )}
    </section>
  )
}

function SaleModal({ sale, registers, canReturn, onClose, onReturned }: {
  sale: SaleDetail
  registers: { id: number; name: string; accepts_cash: boolean; accepts_bank: boolean }[]
  canReturn: boolean
  onClose: () => void
  onReturned: () => void
}) {
  const [returning, setReturning] = useState(false)
  const [amounts, setAmounts] = useState<Record<number, string>>({})
  const [target, setTarget] = useState(() => {
    const reg = registers.find((r) => r.accepts_cash) ?? registers[0]
    return reg ? `${reg.id}:${reg.accepts_cash ? 'cash' : 'bank'}` : ''
  })
  const [error, setError] = useState('')

  const submit = async () => {
    const items = Object.entries(amounts).filter(([, q]) => Number(q) > 0).map(([id, q]) => ({ sale_position_id: Number(id), quantity: q }))
    if (items.length === 0) {
      setError('Укажите, что возвращаем')
      return
    }
    const [id, kind] = target.split(':')
    try {
      await api.post(`/sales/${sale.id}/returns`, { cash_register_id: Number(id), is_bank: kind === 'bank', items })
      onReturned()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось оформить возврат')
    }
  }

  return (
    <Modal title={`Чек ${sale.number}`} onClose={onClose}>
      <p className="mb-3 text-sm text-muted">{formatDateTime(sale.date)}{sale.counteragent ? ` · ${sale.counteragent}` : ''}</p>
      <table className="mb-3 w-full text-sm">
        <thead className="text-xs text-muted"><tr><th className="py-1 text-left font-medium">Позиция</th><th className="py-1 text-right font-medium">Кол-во</th><th className="py-1 text-right font-medium">Цена</th>{returning && <th className="py-1 text-right font-medium">Вернуть</th>}</tr></thead>
        <tbody>
          {sale.positions.map((p) => {
            const left = Number(p.quantity) - Number(p.returned_quantity)
            return (
              <tr key={p.id} className="border-t border-line">
                <td className="py-1.5">{p.name}{Number(p.returned_quantity) > 0 && <small className="block text-muted">возвращено {qty(p.returned_quantity)}</small>}</td>
                <td className="py-1.5 text-right num">{qty(p.quantity)}</td>
                <td className="py-1.5 text-right num">{money(p.sold_price)}</td>
                {returning && (
                  <td className="py-1.5 text-right">
                    <input className={`${inputClass} ml-auto w-20 text-right num`} type="number" min="0" max={left} step="0.001" disabled={left <= 0}
                      value={amounts[p.id] ?? ''} onChange={(e) => setAmounts((cur) => ({ ...cur, [p.id]: e.target.value }))} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mb-4 text-right">Итого {money(sale.total_price)} · оплачено {money(sale.paid)}</p>
      {returning ? (
        <div className="grid gap-2">
          <label className="grid gap-1 text-xs text-muted">Вернуть деньги из кассы
            <select className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
              {registers.flatMap((r) => [
                ...(r.accepts_cash ? [<option key={`${r.id}c`} value={`${r.id}:cash`}>{r.name} — нал</option>] : []),
                ...(r.accepts_bank ? [<option key={`${r.id}b`} value={`${r.id}:bank`}>{r.name} — безнал</option>] : []),
              ])}
            </select>
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button className="rounded-md border border-line px-3 py-2" onClick={() => setReturning(false)}>Отмена</button>
            <button className="rounded-md bg-accent px-3 py-2 text-accent-ink" onClick={() => void submit()}>Оформить возврат</button>
          </div>
        </div>
      ) : canReturn && (
        <button className="text-danger" onClick={() => setReturning(true)}>Возврат по чеку</button>
      )}
    </Modal>
  )
}
