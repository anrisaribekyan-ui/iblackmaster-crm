import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import { inputClass, money, qty, useLocationsAndRegisters } from '../shared'

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
}

export default function RemainsPage() {
  const { can } = useAuth()
  const { locations } = useLocationsAndRegisters()
  const [locationId, setLocationId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [search, setSearch] = useState('')
  const [onlyPositive, setOnlyPositive] = useState(true)
  const [rows, setRows] = useState<Remain[] | null>(null)
  const [error, setError] = useState('')
  const showPrice = can('purchasePriceAccess')

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

  const stores = locations.find((l) => String(l.id) === locationId)?.stores ?? []
  const total = (rows ?? []).reduce((sum, r) => sum + Number(r.total ?? 0), 0)

  return (
    <div>
      <form onSubmit={(e) => void load(e)} className="mb-4 flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-muted">Локация
          <select className={inputClass} value={locationId} onChange={(e) => { setLocationId(e.target.value); setStoreId('') }}>
            <option value="">Все локации</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted">Склад
          <select className={inputClass} value={storeId} onChange={(e) => setStoreId(e.target.value)} disabled={!locationId}>
            <option value="">Все склады</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <input className={`${inputClass} min-w-48 flex-1`} placeholder="Товар, артикул или код" value={search} onChange={(e) => setSearch(e.target.value)} />
        <button className="rounded-md border border-line bg-surface px-3 py-2">Найти</button>
        <label className="flex items-center gap-2 px-2 py-2 text-sm">
          <input type="checkbox" checked={onlyPositive} onChange={(e) => setOnlyPositive(e.target.checked)} /> Только в наличии
        </label>
      </form>

      {error && <p className="mb-3 text-danger">{error}</p>}
      {rows === null ? (
        <p className="text-muted">Загрузка…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-muted">Товаров нет. Остатки появятся после поступления.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Код</th>
                <th className="px-3 py-2 font-medium">Товар</th>
                <th className="px-3 py-2 font-medium">Склад</th>
                <th className="px-3 py-2 text-right font-medium">Кол-во</th>
                {showPrice && <th className="px-3 py-2 text-right font-medium">Ср. закуп</th>}
                {showPrice && <th className="px-3 py-2 text-right font-medium">Сумма</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.store_id}-${r.nomenclature_id}`} className="border-t border-line">
                  <td className="px-3 py-2 num text-muted">{r.code}</td>
                  <td className="px-3 py-2">{r.name}{r.article && <small className="ml-2 text-muted">{r.article}</small>}</td>
                  <td className="px-3 py-2 text-muted">{r.store_name}</td>
                  <td className={`px-3 py-2 text-right num ${Number(r.quantity) <= 0 ? 'text-danger' : ''}`}>{qty(r.quantity)}</td>
                  {showPrice && <td className="px-3 py-2 text-right num">{money(r.avg_purchase_price)}</td>}
                  {showPrice && <td className="px-3 py-2 text-right num">{money(r.total)}</td>}
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
      )}
    </div>
  )
}
