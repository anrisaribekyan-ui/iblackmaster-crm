import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import ProductCard from '../../components/ProductCard'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import { inputClass, money, qty, useLocationsAndRegisters } from '../shared'
import { downloadCsv } from '../../csv'
import Skeleton from '../../components/Skeleton'

type Remain = {
  store_id: number
  store_name: string
  nomenclature_id: number
  code: number
  article: string | null
  name: string
  quantity: string
  avg_purchase_price: string | null
  total: string | null
  min_count: string
  group: string | null
}

type Sort = 'name' | 'quantity' | 'total'

export default function RemainsPage() {
  const { can } = useAuth()
  const { locations } = useLocationsAndRegisters()
  const [locationId, setLocationId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [search, setSearch] = useState('')
  const [onlyPositive, setOnlyPositive] = useState(true)
  const [rows, setRows] = useState<Remain[] | null>(null)
  const [error, setError] = useState('')
  const [params, setParams] = useSearchParams()
  const openId = Number(params.get('item')) || null // карточка в адресе: можно обновить страницу или скинуть ссылку
  const [sort, setSort] = useState<Sort>('name')
  const [onlyLow, setOnlyLow] = useState(false)
  const showPrice = can('purchasePriceAccess')
  const open = (id: number | null) => setParams(id ? { item: String(id) } : {}, { replace: !id })

  const load = async (event?: FormEvent) => {
    event?.preventDefault()
    setError('')
    const params = new URLSearchParams()
    if (locationId) params.set('location_id', locationId)
    if (storeId) params.set('store_id', storeId)
    if (search.trim()) params.set('q', search.trim())
    if (onlyPositive) params.set('only_positive', 'true')
    try {
      setRows(await api.get<Remain[]>(`/stock/remains?${params}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить остатки')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, storeId, onlyPositive])
  // Поиск на лету
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const isLow = (r: Remain) => Number(r.min_count) > 0 && Number(r.quantity) <= Number(r.min_count)
  const shown = useMemo(() => {
    const list = (rows ?? []).filter((r) => !onlyLow || isLow(r))
    if (sort === 'quantity') return [...list].sort((a, b) => Number(a.quantity) - Number(b.quantity))
    if (sort === 'total') return [...list].sort((a, b) => Number(b.total ?? 0) - Number(a.total ?? 0))
    return list
  }, [rows, sort, onlyLow])
  const lowCount = (rows ?? []).filter(isLow).length
  const units = shown.reduce((sum, r) => sum + Number(r.quantity), 0)

  const stores = locations.find((l) => String(l.id) === locationId)?.stores ?? []
  const total = shown.reduce((sum, r) => sum + Number(r.total ?? 0), 0)

  const exportCsv = () => {
    if (!rows) return
    const headers = ['Код', 'Артикул', 'Товар', 'Склад', 'Кол-во']
    if (showPrice) headers.push('Ср. закуп', 'Сумма')
    const data = shown.map((r) => {
      const line: (string | number)[] = [r.code, r.article ?? '', r.name, r.store_name, Number(r.quantity)]
      if (showPrice) line.push(Number(r.avg_purchase_price ?? 0), Number(r.total ?? 0))
      return line
    })
    downloadCsv('остатки.csv', headers, data)
  }

  return (
    <div>
      <form onSubmit={(e) => void load(e)} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted md:flex-none">Локация
          <select className={inputClass} value={locationId} onChange={(e) => { setLocationId(e.target.value); setStoreId('') }}>
            <option value="">Все локации</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-muted md:flex-none">Склад
          <select className={inputClass} value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={!locationId}>
            <option value="">Все склады</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <input type="search" className={`${inputClass} order-first basis-full md:order-none md:basis-auto md:min-w-48 md:flex-1`} placeholder="Товар, артикул или код" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button type="button" className="hidden rounded-md border border-line bg-surface px-3 py-2 md:block" onClick={exportCsv}>Скачать CSV</button>
      </form>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <button type="button" onClick={() => setOnlyPositive((v) => !v)} className={`rounded-full border px-3 py-1 ${onlyPositive ? 'border-ink bg-ink text-white' : 'border-line bg-surface'}`}>В наличии</button>
        <button type="button" onClick={() => setOnlyLow((v) => !v)} className={`rounded-full border px-3 py-1 ${onlyLow ? 'border-warning bg-warning text-white' : 'border-line bg-surface'}`}>
          Заканчивается{lowCount > 0 && <span className="ml-1.5 num opacity-80">{lowCount}</span>}
        </button>
        <label className="ml-auto flex items-center gap-2 text-muted"><span className="hidden sm:inline">Сортировка</span>
          <select className="rounded-md border border-line bg-surface px-2 py-1" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">по названию</option>
            <option value="quantity">меньше всего</option>
            {showPrice && <option value="total">дороже всего на складе</option>}
          </select>
        </label>
      </div>

      {error && <p className="mb-3 text-danger">{error}</p>}
      {rows === null ? (
        <Skeleton />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-muted">
          {search ? `По «${search}» ничего нет.` : onlyLow ? 'Ничего не заканчивается — у всех товаров остаток выше минимального.' : 'Товаров нет. Остатки появятся после поступления.'}
        </p>
      ) : (
        <>
        <p className="mb-2 text-sm text-muted">{shown.length} позиций · {qty(units)} шт{showPrice && <> · <span className="text-ink num">{money(total)}</span> по закупке</>}</p>
        {/* Телефон: карточки */}
        <ul className="grid grid-cols-1 gap-2 md:hidden">
          {shown.map((r) => (
            <li key={`${r.store_id}-${r.nomenclature_id}`} className="min-w-0">
              <button type="button" onClick={() => open(r.nomenclature_id)} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left active:bg-canvas">
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 [overflow-wrap:anywhere]">{r.name}</span>
                  <small className="text-muted">{r.group ?? `код ${r.code}`}{!storeId && ` · ${r.store_name}`}</small>
                </span>
                <span className="text-right">
                  <b className={`block num text-lg leading-none ${Number(r.quantity) <= 0 ? 'text-danger' : isLow(r) ? 'text-warning' : ''}`}>{qty(r.quantity)}</b>
                  {showPrice && <small className="text-muted num">{money(r.avg_purchase_price)}</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Товар</th>
                <th className="px-3 py-2 font-medium">Склад</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Кол-во</th>
                {showPrice && <th className="whitespace-nowrap px-3 py-2 text-right font-medium">Ср. закуп</th>}
                {showPrice && <th className="px-3 py-2 text-right font-medium">Сумма</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.store_id}-${r.nomenclature_id}`} className="cursor-pointer border-t border-line hover:bg-canvas" onClick={() => open(r.nomenclature_id)}>
                  <td className="px-3 py-2 num text-muted">{r.code}</td>
                  <td className="px-3 py-2">
                    {r.name}{r.article && <small className="ml-2 text-muted">{r.article}</small>}
                    {r.group && <small className="block text-xs text-muted">{r.group}</small>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{r.store_name}</td>
                  <td className={`px-3 py-2 text-right num ${Number(r.quantity) <= 0 ? 'text-danger' : isLow(r) ? 'font-semibold text-warning' : ''}`} title={isLow(r) ? `Минимум ${qty(r.min_count)}` : undefined}>
                    {isLow(r) && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-warning align-middle" aria-label="заканчивается" />}{qty(r.quantity)}
                  </td>
                  {showPrice && <td className="whitespace-nowrap px-3 py-2 text-right num">{money(r.avg_purchase_price)}</td>}
                  {showPrice && <td className="whitespace-nowrap px-3 py-2 text-right num">{money(r.total)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {showPrice && (
            <div className="border-t border-line px-3 py-2 text-right text-sm">
              Итого по закупке: <strong className="num">{money(total)}</strong>
            </div>
          )}
        </div>
        </>
      )}
      {openId && <ProductCard id={openId} onClose={() => open(null)} onChanged={() => void load()} />}
    </div>
  )
}
