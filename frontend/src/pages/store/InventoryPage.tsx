import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import { formatDateTime, inputClass, qty, useLocationsAndRegisters } from '../shared'

type Row = { id: number; number: string; date: string; store: string | null; is_posted: boolean; note: string | null }
type Detail = {
  id: number
  number: string
  date: string
  store: string | null
  is_posted: boolean
  positions: { id: number; nomenclature_id: number; name: string; code: number; quantity: string; quantity_accounted: string | null }[]
}

export default function InventoryPage() {
  const { can } = useAuth()
  const { locations } = useLocationsAndRegisters()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [doc, setDoc] = useState<Detail | null>(null)
  const [facts, setFacts] = useState<Record<number, string>>({})
  const [locationId, setLocationId] = useState('')
  const [storeId, setStoreId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setRows((await api.get<{ items: Row[] }>('/stock-documents?type=inventory')).items)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить инвентаризации')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const open = async (id: number) => {
    setError('')
    const detail = await api.get<Detail>(`/stock-documents/${id}`)
    setDoc(detail)
    setFacts(Object.fromEntries(detail.positions.map((p) => [p.nomenclature_id, String(Number(p.quantity))])))
  }

  const create = async () => {
    if (!locationId || !storeId) {
      setError('Выберите локацию и склад')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await api.post<{ id: number }>('/stock-documents/inventory', { location_id: Number(locationId), store_id: Number(storeId) })
      await load()
      await open(created.id)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать инвентаризацию')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!doc) return
    await api.put(`/stock-documents/${doc.id}/positions`, {
      positions: Object.entries(facts).map(([id, quantity]) => ({ nomenclature_id: Number(id), quantity: quantity || '0' })),
    })
  }

  const run = async (action: () => Promise<void>, fail: string) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fail)
    } finally {
      setBusy(false)
    }
  }

  const finish = () => run(async () => {
    if (!doc || !confirm('Закончить инвентаризацию? Излишки будут оприходованы, недостача списана.')) return
    await save()
    await api.post(`/stock-documents/${doc.id}/finish`)
    await open(doc.id)
    await load()
  }, 'Не удалось завершить инвентаризацию')

  if (doc) {
    const editable = !doc.is_posted && can('changeInventoryDocumentAccess')
    return (
      <div>
        <button className="mb-3 text-sm text-muted" onClick={() => setDoc(null)}>← Все инвентаризации</button>
        <h2 className="mb-1 text-lg font-semibold">Инвентаризация {doc.number}</h2>
        <p className="mb-4 text-sm text-muted">{formatDateTime(doc.date)} · {doc.store} · {doc.is_posted ? 'проведена' : 'в работе'}</p>
        {error && <p className="mb-3 text-danger">{error}</p>}
        {doc.positions.length === 0 ? (
          <p className="rounded-xl border border-line bg-surface p-4 text-muted">На складе нет товаров для пересчёта.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Товар</th>
                  <th className="px-3 py-2 text-right font-medium">Учёт</th>
                  <th className="px-3 py-2 text-right font-medium">Факт</th>
                  <th className="px-3 py-2 text-right font-medium">Отклонение</th>
                </tr>
              </thead>
              <tbody>
                {doc.positions.map((p) => {
                  const fact = Number(facts[p.nomenclature_id] ?? p.quantity)
                  const diff = fact - Number(p.quantity_accounted ?? 0)
                  return (
                    <tr key={p.id} className="border-t border-line">
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 text-right num">{qty(p.quantity_accounted)}</td>
                      <td className="px-3 py-2 text-right">
                        {editable ? (
                          <input className={`${inputClass} ml-auto w-24 text-right num`} type="number" min="0" step="0.001"
                            value={facts[p.nomenclature_id] ?? ''} onChange={(e) => setFacts((cur) => ({ ...cur, [p.nomenclature_id]: e.target.value }))} />
                        ) : <span className="num">{qty(p.quantity)}</span>}
                      </td>
                      <td className={`px-3 py-2 text-right num ${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : 'text-muted'}`}>
                        {diff > 0 ? '+' : ''}{qty(diff)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {editable && doc.positions.length > 0 && (
          <div className="mt-4 flex justify-end gap-2">
            <button disabled={busy} className="rounded-md border border-line bg-surface px-4 py-2" onClick={() => void run(async () => { await save(); await open(doc.id) }, 'Не удалось сохранить')}>Сохранить</button>
            <button disabled={busy} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60" onClick={() => void finish()}>Закончить инвентаризацию</button>
          </div>
        )}
      </div>
    )
  }

  const stores = locations.find((l) => String(l.id) === locationId)?.stores ?? []
  return (
    <div>
      <h2 className="mb-4 text-lg font-semibold">Инвентаризация</h2>
      {can('createInventoryDocumentAccess') && (
        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-4">
          <label className="grid gap-1 text-xs text-muted">Локация
            <select className={inputClass} value={locationId} onChange={(e) => { setLocationId(e.target.value); setStoreId('') }}>
              <option value="">Выберите</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted">Склад
            <select className={inputClass} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Выберите</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button disabled={busy} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60" onClick={() => void create()}>Начать инвентаризацию</button>
        </div>
      )}
      {error && <p className="mb-3 text-danger">{error}</p>}
      {rows === null ? <p className="text-muted">Загрузка…</p> : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-muted">Инвентаризаций ещё не было.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {rows.map((r) => (
            <li key={r.id}>
              <button className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-canvas" onClick={() => void open(r.id)}>
                <span><span className="font-medium text-accent">{r.number}</span> <span className="text-muted">· {r.store} · {formatDateTime(r.date)}</span></span>
                <span className={`text-sm ${r.is_posted ? 'text-success' : 'text-muted'}`}>{r.is_posted ? 'Проведена' : 'В работе'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
