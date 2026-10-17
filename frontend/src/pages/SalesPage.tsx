import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import CatalogPicker from '../components/CatalogPicker'
import Modal from '../components/Modal'
import { escapeHtml, openPrint } from '../print'
import { formatDateTime, inputClass, money, qty, retailPrice, useLocationsAndRegisters, type CashRegisterRef } from './shared'
import Skeleton from '../components/Skeleton'

/** Строка чека: из справочника (nomenclatureId) или свободная — название + себестоимость руками. */
type Line = {
  key: string
  nomenclatureId: number | null
  name: string
  isWork: boolean
  quantity: string
  price: string
  cost: string // себестоимость единицы: для свободной позиции — вводят, для товара без остатка — из справочника
  stock: number | null // остаток на складе (для товара из справочника)
}
type Top = { key: string; nomenclature_id: number | null; name: string; is_work: boolean; price: string; purchase_price: string; count: number; stock: string | null }
type PayOption = { id: string; registerId: number; isBank: boolean; label: string }
type Payment = { cash_register_id: string; amount: string; is_bank: boolean }
type SaleRow = { id: number; number: string; date: string; total_price: string; paid: string; counteragent: string | null; seller: string | null }
type SaleDetail = SaleRow & {
  positions: { id: number; name: string; is_work: boolean; quantity: string; sold_price: string; returned_quantity: string }[]
}

const DISCOUNTS = [0, 5, 10, 15]

function payOptions(registers: CashRegisterRef[]): PayOption[] {
  // Сначала кассы своей точки (наличные — первыми), потом общие: терминал, перевод
  const sorted = [...registers].sort((a, b) => Number(a.location_id === null) - Number(b.location_id === null))
  return sorted.flatMap((r) => [
    ...(r.accepts_cash ? [{ id: `${r.id}:cash`, registerId: r.id, isBank: false, label: r.location_id === null ? r.name : 'Наличные' }] : []),
    ...(r.accepts_bank ? [{ id: `${r.id}:bank`, registerId: r.id, isBank: true, label: r.location_id === null ? r.name : `${r.name} · безнал` }] : []),
  ])
}

const remember = (key: string, value?: string): string | null => {
  try {
    if (value === undefined) return localStorage.getItem(key)
    localStorage.setItem(key, value)
  } catch { /* приватный режим — не страшно */ }
  return null
}

export default function SalesPage() {
  const { can } = useAuth()
  const { locations, registers } = useLocationsAndRegisters()
  const [params, setParams] = useSearchParams()
  const [locationId, setLocationId] = useState(() => remember('sale:location') ?? '')
  const [storeId, setStoreId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [top, setTop] = useState<Top[] | null>(null)
  const [discount, setDiscount] = useState(0) // %
  const [discountSum, setDiscountSum] = useState('')
  const [payId, setPayId] = useState('')
  const [split, setSplit] = useState(false)
  const [payments, setPayments] = useState<Payment[]>([])
  const [showBuyer, setShowBuyer] = useState(false)
  const [phone, setPhone] = useState('')
  const [buyer, setBuyer] = useState<{ id: number; name: string } | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: number; number: string; total: number; debt: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<SaleRow[] | null>(null)
  const [viewing, setViewing] = useState<SaleDetail | null>(null)
  const [quick, setQuick] = useState(params.get('quick') === '1')
  // ?open=15 — сразу показать чек (ссылка из карточки товара)
  useEffect(() => {
    const id = Number(params.get('open'))
    if (id) void api.get<SaleDetail>(`/sales/${id}`).then(setViewing).catch(() => undefined)
  }, [params])

  // Точка: запомненная, иначе первая
  useEffect(() => {
    if (!locations.length) return
    const current = locations.find((l) => String(l.id) === locationId) ?? locations[0]
    if (String(current.id) !== locationId) setLocationId(String(current.id))
    setStoreId((s) => (current.stores.some((st) => String(st.id) === s) ? s : String(current.stores.find((st) => st.is_default)?.id ?? current.stores[0]?.id ?? '')))
  }, [locations, locationId])

  const localRegisters = useMemo(() => registers.filter((r) => r.location_id === null || String(r.location_id) === locationId), [registers, locationId])
  const options = useMemo(() => payOptions(localRegisters), [localRegisters])
  useEffect(() => {
    if (!options.length) return
    const saved = remember(`sale:pay:${locationId}`)
    setPayId((cur) => (options.some((o) => o.id === cur) ? cur : options.find((o) => o.id === saved)?.id ?? options[0].id))
  }, [options, locationId])

  const loadHistory = useCallback(async () => {
    if (!locationId) return
    try {
      setHistory((await api.get<{ items: SaleRow[] }>(`/sales?location_id=${locationId}`)).items)
    } catch {
      setHistory([])
    }
  }, [locationId])
  const loadTop = useCallback(async () => {
    if (!locationId || !storeId) return
    try {
      setTop(await api.get<Top[]>(`/sales/top?location_id=${locationId}&store_id=${storeId}&limit=11`))
    } catch {
      setTop([])
    }
  }, [locationId, storeId])
  useEffect(() => { void loadHistory() }, [loadHistory])
  useEffect(() => { void loadTop() }, [loadTop])

  const gross = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.price || 0), 0)
  const total = Math.max(0, Math.round(gross - Math.round((gross * discount) / 100) - Number(discountSum || 0)))
  const cost = lines.reduce((sum, l) => sum + Number(l.quantity || 0) * Number(l.cost || 0), 0)
  const paidSum = split ? payments.reduce((sum, p) => sum + Number(p.amount || 0), 0) : total
  const canSeeCost = can('marginPriceAccess')

  const addLine = (line: Omit<Line, 'key' | 'quantity'> & { quantity?: string }) => {
    setDone(null)
    setError('')
    setLines((cur) => {
      const same = cur.findIndex((l) => (line.nomenclatureId ? l.nomenclatureId === line.nomenclatureId : !l.nomenclatureId && l.name.toLowerCase() === line.name.toLowerCase() && l.price === line.price))
      if (same >= 0) return cur.map((l, i) => (i === same ? { ...l, quantity: String(Number(l.quantity || 0) + Number(line.quantity || 1)) } : l))
      return [...cur, { ...line, quantity: line.quantity ?? '1', key: `${Date.now()}-${Math.random()}` }]
    })
  }

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

  const startSplit = () => {
    const option = options.find((o) => o.id === payId) ?? options[0]
    setSplit(true)
    setPayments(option ? [{ cash_register_id: String(option.registerId), is_bank: option.isBank, amount: String(total) }] : [])
  }

  const submit = async () => {
    setError('')
    if (lines.length === 0) {
      setError('Чек пустой — нажмите на плитку или найдите товар')
      return
    }
    const option = options.find((o) => o.id === payId)
    const pays = split
      ? payments.filter((p) => Number(p.amount) > 0).map((p) => ({ ...p, cash_register_id: Number(p.cash_register_id) }))
      : option && total > 0 ? [{ cash_register_id: option.registerId, is_bank: option.isBank, amount: String(total) }] : []
    setBusy(true)
    try {
      const sale = await api.post<{ id: number; number: string; debt: string; total_price: string }>('/sales', {
        location_id: Number(locationId),
        store_id: Number(storeId),
        counteragent_id: buyer?.id ?? null,
        discount_percent: String(discount),
        discount_sum: discountSum || '0',
        positions: lines.map((l) => {
          const short = !l.isWork && l.nomenclatureId !== null && (l.stock ?? 0) < Number(l.quantity || 0)
          return {
            nomenclature_id: l.nomenclatureId,
            name: l.nomenclatureId ? undefined : l.name,
            is_work: l.isWork,
            quantity: l.quantity,
            price: l.price || '0',
            ...(l.nomenclatureId === null ? { purchase_price: l.cost || '0' } : {}),
            ...(short ? { no_stock: true, purchase_price: l.cost || '0' } : {}),
          }
        }),
        payments: pays,
      })
      if (option && !split) remember(`sale:pay:${locationId}`, option.id)
      setDone({ id: sale.id, number: sale.number, total: Number(sale.total_price), debt: Number(sale.debt) })
      try { navigator.vibrate?.(15) } catch { /* не все телефоны умеют */ }
      setLines([])
      setPayments([])
      setSplit(false)
      setDiscount(0)
      setDiscountSum('')
      setBuyer(null)
      setPhone('')
      setShowBuyer(false)
      void loadHistory()
      void loadTop()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось пробить чек')
    } finally {
      setBusy(false)
    }
  }

  const stores = locations.find((l) => String(l.id) === locationId)?.stores ?? []
  const today = new Date().toDateString()
  const todaySales = (history ?? []).filter((s) => new Date(s.date).toDateString() === today)
  const closeQuick = () => {
    setQuick(false)
    if (params.get('quick')) setParams({}, { replace: true })
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Продажи</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Точка" className="rounded-md border border-line bg-surface px-3 py-2 text-sm" value={locationId} onChange={(e) => {
            setLocationId(e.target.value)
            remember('sale:location', e.target.value)
            setLines([])
            setSplit(false)
            setTop(null)
          }}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          {stores.length > 1 && (
            <select aria-label="Склад" className="rounded-md border border-line bg-surface px-3 py-2 text-sm" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <button
              type="button"
              onClick={() => setQuick(true)}
              className="flex min-h-24 flex-col justify-between rounded-xl bg-ink p-3 text-left text-white shadow-sm transition active:scale-[0.98] hover:opacity-90"
            >
              <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xl leading-none">+</span>
              <span className="font-medium leading-tight">Своя позиция<small className="block font-normal text-white/60">название, себестоимость, цена</small></span>
            </button>
            {top === null
              ? Array.from({ length: 5 }, (_, i) => <div key={i} className="min-h-24 animate-pulse rounded-xl border border-line bg-surface" />)
              : top.map((t) => {
                const stock = t.stock === null ? null : Number(t.stock)
                const inCart = lines.find((l) => (t.nomenclature_id ? l.nomenclatureId === t.nomenclature_id : !l.nomenclatureId && l.name === t.name))
                return (
                  <button
                    key={t.key}
                    type="button"
                    title={`Пробивали ${t.count} раз за 90 дней`}
                    onClick={() => addLine({ nomenclatureId: t.nomenclature_id, name: t.name, isWork: t.is_work, price: String(Number(t.price)), cost: String(Number(t.purchase_price)), stock })}
                    className={`relative flex min-h-24 flex-col justify-between rounded-xl border bg-surface p-3 text-left shadow-sm transition active:scale-[0.98] hover:border-ink/40 ${inCart ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
                  >
                    {inCart && <span className="absolute right-2 top-2 grid h-6 min-w-6 place-items-center rounded-full bg-accent px-1.5 text-xs font-semibold text-white num">{qty(inCart.quantity)}</span>}
                    <span className="line-clamp-2 pr-6 text-sm leading-snug">{t.name}</span>
                    <span className="mt-2 flex items-end justify-between gap-2">
                      <strong className="num text-lg leading-none">{money(t.price)}</strong>
                      {stock !== null && <small className={`text-xs ${stock > 0 ? 'text-muted' : 'text-danger'}`}>{stock > 0 ? `${qty(stock)} шт` : 'нет'}</small>}
                    </span>
                  </button>
                )
              })}
          </div>
          {top !== null && top.length === 0 && (
            <p className="-mt-2 text-sm text-muted">Здесь появятся плитки того, что пробивают чаще всего, — после первых продаж.</p>
          )}

          <div className="rounded-xl border border-line bg-surface p-4">
            <CatalogPicker
              locationId={locationId}
              onPick={(item) => addLine({
                nomenclatureId: item.id,
                name: item.name,
                isWork: item.is_work,
                price: String(Number(retailPrice(item))),
                cost: String(Number(item.purchase_price ?? 0)),
                stock: item.is_work ? null : Number(item.stock_quantity ?? 0),
              })}
            />
            {lines.length === 0 ? (
              <p className="mt-4 text-sm text-muted">Чек пустой. Нажмите на плитку, найдите товар или добавьте свою позицию.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {lines.map((line, i) => {
                  const short = !line.isWork && line.nomenclatureId !== null && (line.stock ?? 0) < Number(line.quantity || 0)
                  const set = (patch: Partial<Line>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)))
                  return (
                    <li key={line.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate">{line.name}</p>
                        <p className="text-xs text-muted">
                          {line.nomenclatureId === null ? 'своя позиция' : line.isWork ? 'работа' : short ? <span className="text-warning">на складе {qty(line.stock)} — продам без списания</span> : `на складе ${qty(line.stock)}`}
                          {canSeeCost && !line.isWork && Number(line.cost) > 0 && ` · себест. ${money(line.cost)}`}
                        </p>
                      </div>
                      <button type="button" className="row-span-2 grid h-9 w-9 place-items-center rounded-md text-xl text-muted hover:bg-canvas hover:text-danger" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))} aria-label="Убрать">×</button>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center rounded-md border border-line">
                          <button type="button" className="h-9 w-9 text-lg text-muted hover:text-ink" aria-label="Меньше" onClick={() => set({ quantity: String(Math.max(1, Number(line.quantity || 1) - 1)) })}>−</button>
                          <input aria-label="Количество" className="h-9 w-12 bg-transparent text-center num outline-none" inputMode="decimal" value={line.quantity} onChange={(e) => set({ quantity: e.target.value.replace(',', '.') })} />
                          <button type="button" className="h-9 w-9 text-lg text-muted hover:text-ink" aria-label="Больше" onClick={() => set({ quantity: String(Number(line.quantity || 0) + 1) })}>+</button>
                        </div>
                        <span className="text-muted">×</span>
                        <input aria-label="Цена" className="h-9 w-24 rounded-md border border-line bg-surface px-2 text-right num disabled:opacity-60" inputMode="numeric" value={line.price}
                          disabled={line.nomenclatureId !== null && !can('discountSaleAccess') && !can('setPriceAccess')}
                          onChange={(e) => set({ price: e.target.value.replace(/[^\d]/g, '') })} />
                        <span className="ml-auto whitespace-nowrap num font-medium">{money(Number(line.quantity || 0) * Number(line.price || 0))}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <aside className="grid content-start gap-4 self-start rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-4">
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">Оплата</p>
            {split ? (
              <div className="grid gap-2">
                {payments.map((p, i) => (
                  <div key={i} className="grid grid-cols-[1fr_90px_auto] gap-1">
                    <select className={inputClass} value={`${p.cash_register_id}:${p.is_bank ? 'bank' : 'cash'}`}
                      onChange={(e) => {
                        const [id, kind] = e.target.value.split(':')
                        setPayments((cur) => cur.map((x, j) => (j === i ? { ...x, cash_register_id: id, is_bank: kind === 'bank' } : x)))
                      }}>
                      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <input className={`${inputClass} text-right num`} inputMode="numeric" value={p.amount}
                      onChange={(e) => setPayments((cur) => cur.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d]/g, '') } : x)))} />
                    <button className="px-1 text-danger" onClick={() => setPayments((cur) => cur.filter((_, j) => j !== i))} aria-label="Убрать оплату">×</button>
                  </div>
                ))}
                <div className="flex justify-between text-sm">
                  <button className="text-accent" onClick={() => {
                    const o = options.find((x) => x.id !== payId) ?? options[0]
                    if (o) setPayments((cur) => [...cur, { cash_register_id: String(o.registerId), is_bank: o.isBank, amount: String(Math.max(0, total - paidSum)) }])
                  }}>+ ещё оплата</button>
                  <button className="text-muted" onClick={() => setSplit(false)}>одним способом</button>
                </div>
                {Math.abs(paidSum - total) > 0 && (
                  <p className="text-sm text-muted">{paidSum < total ? `Не хватает ${money(total - paidSum)}${buyer ? ' — уйдёт в долг' : ''}` : `Больше суммы на ${money(paidSum - total)}`}</p>
                )}
              </div>
            ) : (
              <div className="grid gap-1.5">
                <div className="grid grid-cols-2 gap-1.5">
                  {options.map((o) => (
                    <button key={o.id} type="button" onClick={() => setPayId(o.id)}
                      className={`min-h-11 rounded-lg border px-2 py-2 text-sm leading-tight transition ${payId === o.id ? 'border-ink bg-ink text-white' : 'border-line hover:border-ink/40'}`}>
                      {o.label}
                    </button>
                  ))}
                </div>
                <button className="justify-self-start text-sm text-muted hover:text-ink" onClick={startSplit}>Разделить оплату / в долг</button>
              </div>
            )}
          </div>

          {can('discountSaleAccess') && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink">Скидка</p>
              <div className="flex flex-wrap gap-1.5">
                {DISCOUNTS.map((d) => (
                  <button key={d} type="button" onClick={() => { setDiscount(d); setDiscountSum('') }}
                    className={`h-9 rounded-lg border px-3 text-sm ${discount === d && !discountSum ? 'border-ink bg-ink text-white' : 'border-line hover:border-ink/40'}`}>
                    {d === 0 ? 'Нет' : `${d}%`}
                  </button>
                ))}
                <input aria-label="Скидка в рублях" placeholder="₽" inputMode="numeric" value={discountSum}
                  onChange={(e) => { setDiscountSum(e.target.value.replace(/[^\d]/g, '')); setDiscount(0) }}
                  className={`h-9 w-20 rounded-lg border px-2 text-right text-sm num ${discountSum ? 'border-ink' : 'border-line'} bg-surface`} />
              </div>
            </div>
          )}

          <div>
            {buyer ? (
              <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">{buyer.name}<button className="text-muted" aria-label="Убрать покупателя" onClick={() => setBuyer(null)}>×</button></div>
            ) : showBuyer ? (
              <div className="flex gap-1">
                <input autoFocus className={inputClass} type="tel" placeholder="Телефон покупателя" value={phone} onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void findBuyer()} />
                <button className="rounded-md border border-line px-2" onClick={() => void findBuyer()}>Найти</button>
              </div>
            ) : (
              <button className="text-sm text-muted hover:text-ink" onClick={() => setShowBuyer(true)}>+ Покупатель (необязательно)</button>
            )}
          </div>

          <div className="border-t border-line pt-3">
            {gross !== total && <p className="flex justify-between text-sm text-muted"><span>Без скидки</span><span className="num line-through">{money(gross)}</span></p>}
            <p className="flex items-baseline justify-between"><span className="text-muted">Итого</span><strong className="num text-2xl">{money(total)}</strong></p>
            {canSeeCost && lines.length > 0 && <p className="mt-0.5 text-right text-xs text-muted">прибыль {money(total - cost)}</p>}
          </div>

          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <button disabled={busy || lines.length === 0} className="min-h-12 rounded-lg bg-accent px-4 py-3 text-base font-semibold text-accent-ink shadow-sm transition active:scale-[0.99] disabled:opacity-50" onClick={() => void submit()}>
            {busy ? 'Пробиваем…' : lines.length ? `Пробить ${money(total)}` : 'Пробить чек'}
          </button>
          {done && (
            <div role="status" key={done.id} className="pop-in rounded-lg bg-success/10 p-3 text-sm">
              <p className="font-medium text-success">✓ Чек {done.number} на {money(done.total)} пробит</p>
              {done.debt > 0 && <p className="text-muted">Долг покупателя {money(done.debt)}</p>}
              <button className="mt-1 text-accent" onClick={() => void api.get<SaleDetail>(`/sales/${done.id}`).then(setViewing)}>Открыть / печать</button>
            </div>
          )}
        </aside>
      </div>

      <div className="mb-3 mt-8 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">История чеков</h2>
        {todaySales.length > 0 && <p className="text-sm text-muted">Сегодня {todaySales.length} чек. на <span className="num text-ink">{money(todaySales.reduce((s, x) => s + Number(x.total_price), 0))}</span></p>}
      </div>
      {history === null ? <Skeleton /> : history.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-muted">Чеков в этой точке ещё нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr><th className="px-3 py-2 font-medium">Чек</th><th className="px-3 py-2 font-medium">Дата</th><th className="hidden px-3 py-2 font-medium sm:table-cell">Покупатель</th><th className="hidden px-3 py-2 font-medium sm:table-cell">Продавец</th><th className="px-3 py-2 text-right font-medium">Сумма</th><th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Оплачено</th></tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => void api.get<SaleDetail>(`/sales/${s.id}`).then(setViewing)}>
                  <td className="px-3 py-2 font-medium text-accent">{s.number}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.date)}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{s.counteragent ?? '—'}</td>
                  <td className="hidden px-3 py-2 sm:table-cell">{s.seller ?? '—'}</td>
                  <td className="px-3 py-2 text-right num">{money(s.total_price)}</td>
                  <td className={`hidden px-3 py-2 text-right num sm:table-cell ${Number(s.paid) < Number(s.total_price) ? 'text-danger' : ''}`}>{money(s.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quick && (
        <QuickItemModal
          suggestions={(top ?? []).filter((t) => t.nomenclature_id === null).map((t) => t.name)}
          canSeeCost={canSeeCost}
          onClose={closeQuick}
          onAdd={(item) => {
            addLine({ nomenclatureId: null, name: item.name, isWork: false, price: item.price, cost: item.cost, stock: null, quantity: item.quantity })
            closeQuick()
          }}
        />
      )}
      {viewing && (
        <SaleModal sale={viewing} registers={localRegisters} canReturn={can('saleReturnAccess')}
          onClose={() => setViewing(null)} onReturned={() => { setViewing(null); void loadHistory() }} />
      )}
    </section>
  )
}

/** Своя позиция: три поля и Enter. Себестоимость нужна, чтобы прибыль в отчётах была честной. */
function QuickItemModal({ suggestions, canSeeCost, onClose, onAdd }: {
  suggestions: string[]
  canSeeCost: boolean
  onClose: () => void
  onAdd: (item: { name: string; cost: string; price: string; quantity: string }) => void
}) {
  const [name, setName] = useState('')
  const [cost, setCost] = useState('')
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState('')
  const priceRef = useRef<HTMLInputElement>(null)
  const profit = Number(price || 0) - Number(cost || 0)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return setError('Как называется?')
    if (!price) return setError('Укажите цену продажи')
    onAdd({ name: name.trim(), cost: cost || '0', price, quantity: quantity || '1' })
  }

  return (
    <Modal title="Своя позиция" onClose={onClose}>
      <form className="grid gap-3" onSubmit={submit}>
        <label className="grid gap-1 text-sm text-muted">Наименование
          <input autoFocus list="quick-names" className={`${inputClass} text-ink`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, кабель Type-C" enterKeyHint="next" />
          <datalist id="quick-names">{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm text-muted">Себестоимость, ₽
            <input className={`${inputClass} text-right text-ink num`} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); priceRef.current?.focus() } }} placeholder="0" enterKeyHint="next" />
          </label>
          <label className="grid gap-1 text-sm text-muted">Цена продажи, ₽
            <input ref={priceRef} className={`${inputClass} text-right text-lg font-semibold text-ink num`} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="0" enterKeyHint="done" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted">Кол-во
            <input className={`${inputClass} w-16 text-center text-ink num`} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d]/g, ''))} />
          </label>
          {canSeeCost && price && (
            <span className={`text-sm ${profit < 0 ? 'text-danger' : 'text-success'}`}>прибыль {money(profit * Number(quantity || 1))}{profit < 0 ? ' — ниже себестоимости!' : ''}</span>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button className="min-h-12 rounded-lg bg-accent px-4 py-3 font-semibold text-accent-ink">В чек</button>
        <p className="text-center text-xs text-muted">Склад не меняется — позиция идёт только в чек и в отчёт о прибыли.</p>
      </form>
    </Modal>
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

  const printReceipt = () => {
    const rows = sale.positions
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.name)}</td>
          <td class="num">${escapeHtml(p.quantity)}</td>
          <td class="num">${escapeHtml(money(p.sold_price))}</td>
          <td class="num">${escapeHtml(money((Number(p.sold_price) * Number(p.quantity)).toFixed(0)))}</td>
        </tr>`,
      )
      .join('')
    const body = `
      <h1>Товарный чек № ${escapeHtml(sale.number)}</h1>
      <p>Дата: ${escapeHtml(formatDateTime(sale.date))}</p>
      ${sale.counteragent ? `<p>Покупатель: ${escapeHtml(sale.counteragent)}</p>` : ''}
      <p>Продавец: ${escapeHtml(sale.seller ?? '—')}</p>
      <table>
        <thead><tr><th>Наименование</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top: 3mm"><strong>Итого: ${escapeHtml(money(sale.total_price))}</strong></p>
    `
    openPrint(`Чек ${sale.number}`, body)
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
      ) : (
        <div className="flex items-center justify-between gap-2">
          {canReturn && <button className="text-danger" onClick={() => setReturning(true)}>Возврат по чеку</button>}
          <button className="rounded-md border border-line bg-surface px-3 py-2" onClick={printReceipt}>Печать чек</button>
        </div>
      )}
    </Modal>
  )
}
