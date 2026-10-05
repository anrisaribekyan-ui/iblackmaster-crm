import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type PriceType = { id: number; name: string; is_minimal: boolean; sort: number }
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
  stock_quantity: string | null
}
type Page = { items: Item[]; total: number; page: number }
type Group = { id: number; name: string; children: Group[] }
type Measure = { id: number; name: string; is_float: boolean }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

function flattenGroups(groups: Group[], prefix = ''): { id: number; label: string }[] {
  return groups.flatMap((group) => {
    const label = prefix ? `${prefix} / ${group.name}` : group.name
    return [{ id: group.id, label }, ...flattenGroups(group.children ?? [], label)]
  })
}

export default function NomenclaturePage({ isWork }: { isWork: boolean }) {
  const { can } = useAuth()
  const permission = isWork ? 'workAccess' : 'nomenclatureAccess'
  const [pageData, setPageData] = useState<Page | null>(null)
  const [priceTypes, setPriceTypes] = useState<PriceType[]>([])
  const [groups, setGroups] = useState<{ id: number; label: string }[]>([])
  const [measures, setMeasures] = useState<Measure[]>([])
  const [editing, setEditing] = useState<Item | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = can(permission)
  const title = isWork ? 'Работы' : 'Товары'

  const loadReferences = useCallback(async () => {
    try {
      const [priceData, groupData, measureData] = await Promise.all([
        api.get<PriceType[]>('/price-types'),
        api.get<Group[]>('/nomenclature-groups'),
        api.get<Measure[]>('/measures'),
      ])
      setPriceTypes(priceData)
      setGroups(flattenGroups(groupData))
      setMeasures(measureData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить группы, единицы измерения и типы цен')
    }
  }, [])

  const loadItems = useCallback(async (searchTerm = search, pageNumber = page) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ is_work: String(isWork), page: String(pageNumber) })
      if (searchTerm.trim()) params.set('q', searchTerm.trim())
      setPageData(await api.get<Page>(`/nomenclature?${params.toString()}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Не удалось загрузить справочник «${title.toLowerCase()}»`)
      setPageData(null)
    } finally {
      setLoading(false)
    }
  }, [isWork, page, search, title])

  useEffect(() => {
    void loadReferences()
  }, [loadReferences])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const value = (name: string) => String(values.get(name) ?? '').trim()
    const payload = {
      article: value('article') || null,
      name: value('name'),
      is_work: isWork,
      group_id: value('group_id') ? Number(value('group_id')) : null,
      measure_id: value('measure_id') ? Number(value('measure_id')) : null,
      purchase_price: value('purchase_price') || '0',
      guarantee_days: Number(value('guarantee_days') || 0),
      min_count: value('min_count') || '0',
      has_serials: values.get('has_serials') === 'on',
      note: value('note') || null,
      salary_percent: value('salary_percent') || null,
      salary_fixed: value('salary_fixed') || null,
      prices: priceTypes.map((priceType) => ({
        price_type_id: priceType.id,
        price: value(`price_${priceType.id}`) || '0',
      })),
    }
    setSaving(true)
    setError('')
    try {
      if (editing?.id) await api.put(`/nomenclature/${editing.id}`, payload)
      else await api.post('/nomenclature', payload)
      setEditing(undefined)
      await loadItems()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Не удалось сохранить ${title.toLowerCase()}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Item) => {
    if (!confirm(`Удалить «${item.name}»?`)) return
    setError('')
    try {
      await api.del(`/nomenclature/${item.id}`)
      await loadItems()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить запись')
    }
  }

  const priceLabel = (priceType: PriceType, item: Item) => {
    const value = item.prices.find((price) => price.price_type_id === priceType.id)?.price
    return value === undefined ? '—' : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {canEdit && <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => setEditing(null)}>Добавить {isWork ? 'работу' : 'товар'}</button>}
      </div>
      <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); void loadItems(search, 1) }}>
        <input className={`${inputClass} max-w-sm`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по названию, артикулу или коду" />
        <button className="rounded-md border border-line bg-surface px-3 py-2">Найти</button>
      </form>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : pageData === null ? (
        <p className="text-muted">Не удалось загрузить список.</p>
      ) : pageData.items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-muted">{title} не найдены. Добавьте первую запись.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-canvas text-muted">
                <tr>
                  <th className="px-3 py-2">Код</th>
                  <th className="px-3 py-2">Артикул</th>
                  <th className="px-3 py-2">Название</th>
                  <th className="px-3 py-2">Группа</th>
                  <th className="px-3 py-2">Ед.</th>
                  {priceTypes.map((priceType) => <th key={priceType.id} className="px-3 py-2">{priceType.name}</th>)}
                  {canEdit && <th className="px-3 py-2">Действия</th>}
                </tr>
              </thead>
              <tbody>
                {pageData.items.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-3 py-2 num">{item.code}</td>
                    <td className="px-3 py-2">{item.article || '—'}</td>
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2">{groups.find((group) => group.id === item.group_id)?.label ?? '—'}</td>
                    <td className="px-3 py-2">{measures.find((measure) => measure.id === item.measure_id)?.name ?? '—'}</td>
                    {priceTypes.map((priceType) => <td key={priceType.id} className="px-3 py-2 num">{priceLabel(priceType, item)}</td>)}
                    {canEdit && <td className="px-3 py-2"><span className="flex gap-2 whitespace-nowrap"><button className="text-muted" onClick={() => setEditing(item)}>Изменить</button><button className="text-danger" onClick={() => void remove(item)}>Удалить</button></span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>Всего: {pageData.total}</span>
            <span className="flex items-center gap-3">
              <button disabled={page <= 1} className="text-ink disabled:opacity-40" onClick={() => setPage((current) => Math.max(1, current - 1))}>Назад</button>
              Страница {pageData.page}
              <button disabled={page * 50 >= pageData.total} className="text-ink disabled:opacity-40" onClick={() => setPage((current) => current + 1)}>Далее</button>
            </span>
          </footer>
        </>
      )}
      {editing !== undefined && (
        <Modal title={editing ? `Карточка · ${editing.name}` : `Новая запись · ${title.toLowerCase()}`} onClose={() => setEditing(undefined)}>
          <form onSubmit={(event) => void save(event)} className="grid max-h-[75vh] gap-3 overflow-y-auto px-1 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Название<input className={inputClass} name="name" required maxLength={300} defaultValue={editing?.name ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">Артикул<input className={inputClass} name="article" defaultValue={editing?.article ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">Группа
              <select className={inputClass} name="group_id" defaultValue={editing?.group_id ?? ''}><option value="">Без группы</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.label}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Единица измерения
              <select className={inputClass} name="measure_id" defaultValue={editing?.measure_id ?? ''}><option value="">Не выбрана</option>{measures.map((measure) => <option key={measure.id} value={measure.id}>{measure.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Закупочная цена
              <input className={inputClass} name="purchase_price" type="number" min="0" step="1" defaultValue={editing?.purchase_price ?? '0'} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Минимальный остаток<input className={inputClass} name="min_count" type="number" min="0" step="0.001" defaultValue={editing?.min_count ?? '0'} /></label>
            {isWork && <label className="grid gap-1 text-sm text-muted">Гарантия, дней<input className={inputClass} name="guarantee_days" type="number" min="0" defaultValue={editing?.guarantee_days ?? 0} /></label>}
            {!isWork && <label className="flex items-center gap-2"><input type="checkbox" name="has_serials" defaultChecked={editing?.has_serials ?? false} />Учитывать серийные номера</label>}
            {priceTypes.map((priceType) => (
              <label key={priceType.id} className="grid gap-1 text-sm text-muted">Цена · {priceType.name}
                <input className={inputClass} name={`price_${priceType.id}`} type="number" min="0" step="1" defaultValue={editing?.prices.find((price) => price.price_type_id === priceType.id)?.price ?? '0'} />
              </label>
            ))}
            <label className="grid gap-1 text-sm text-muted sm:col-span-2">Примечание<textarea className={inputClass} name="note" rows={3} defaultValue={editing?.note ?? ''} /></label>
            {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditing(undefined)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
