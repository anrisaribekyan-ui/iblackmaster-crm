import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type DeviceType = { id: number; name: string; salary_percent: string | null; salary_fixed: string | null }
type Brand = { id: number; name: string; device_type_id: number | null }
type DeviceModel = { id: number; name: string; brand_id: number }
type Editor =
  | { kind: 'type'; item?: DeviceType }
  | { kind: 'brand'; item?: Brand }
  | { kind: 'model'; item?: DeviceModel }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export default function DevicesPage() {
  const { can } = useAuth()
  const [types, setTypes] = useState<DeviceType[] | null>(null)
  const [brands, setBrands] = useState<Brand[]>([])
  const [models, setModels] = useState<DeviceModel[]>([])
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<number | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = can('brandModelDeviceAccess')

  const loadTypes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.get<DeviceType[]>('/device-types')
      setTypes(result)
      setSelectedTypeId((current) =>
        current === null || !result.some((item) => item.id === current) ? result[0]?.id ?? null : current,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить типы устройств')
      setTypes(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTypes()
  }, [loadTypes])

  const loadBrands = useCallback(async () => {
    if (selectedTypeId === null) {
      setBrands([])
      setSelectedBrandId(null)
      return
    }
    try {
      const result = await api.get<Brand[]>(`/brands?device_type_id=${selectedTypeId}`)
      setBrands(result)
      setSelectedBrandId((current) =>
        current === null || !result.some((item) => item.id === current) ? result[0]?.id ?? null : current,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить марки')
    }
  }, [selectedTypeId])

  useEffect(() => {
    void loadBrands()
  }, [loadBrands])

  const loadModels = useCallback(async () => {
    if (selectedBrandId === null) {
      setModels([])
      return
    }
    try {
      setModels(await api.get<DeviceModel[]>(`/device-models?brand_id=${selectedBrandId}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить модели')
    }
  }, [selectedBrandId])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  const reloadHierarchy = async () => {
    await loadTypes()
    await loadBrands()
    await loadModels()
  }

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    setSaving(true)
    setError('')
    try {
      if (editor.kind === 'type') {
        const payload = {
          name,
          salary_percent: String(form.get('salary_percent') ?? '').trim() || null,
          salary_fixed: String(form.get('salary_fixed') ?? '').trim() || null,
        }
        if (editor.item) await api.put(`/device-types/${editor.item.id}`, payload)
        else await api.post('/device-types', payload)
      } else if (editor.kind === 'brand') {
        const typeId = String(form.get('device_type_id') ?? '')
        const payload = { name, device_type_id: typeId ? Number(typeId) : null }
        if (editor.item) await api.put(`/brands/${editor.item.id}`, payload)
        else await api.post('/brands', payload)
      } else {
        const payload = { name, brand_id: Number(form.get('brand_id')) }
        if (editor.item) await api.put(`/device-models/${editor.item.id}`, payload)
        else await api.post('/device-models', payload)
      }
      setEditor(null)
      await reloadHierarchy()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить запись')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (kind: Editor['kind'], item: DeviceType | Brand | DeviceModel) => {
    if (!confirm(`Удалить «${item.name}»?`)) return
    const path = kind === 'type' ? 'device-types' : kind === 'brand' ? 'brands' : 'device-models'
    setError('')
    try {
      await api.del(`/${path}/${item.id}`)
      await reloadHierarchy()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить запись')
    }
  }

  const selectedType = types?.find((type) => type.id === selectedTypeId)
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId)

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Устройства</h2>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : types === null ? (
        <p className="text-muted">Не удалось загрузить типы устройств.</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-3">
          <ListColumn
            title="Тип устройства"
            empty="Типов устройств пока нет."
            canEdit={canEdit}
            onAdd={() => setEditor({ kind: 'type' })}
          >
            {types.map((type) => (
              <Entry key={type.id} name={type.name} selected={selectedTypeId === type.id} onSelect={() => { setSelectedTypeId(type.id); setSelectedBrandId(null) }} canEdit={canEdit} onEdit={() => setEditor({ kind: 'type', item: type })} onDelete={() => void remove('type', type)} />
            ))}
          </ListColumn>
          <ListColumn
            title={selectedType ? `Марки · ${selectedType.name}` : 'Марки'}
            empty={selectedType ? 'Для этого типа устройств марок пока нет.' : 'Сначала выберите тип устройства.'}
            canEdit={canEdit && selectedTypeId !== null}
            onAdd={() => setEditor({ kind: 'brand' })}
          >
            {brands.map((brand) => (
              <Entry key={brand.id} name={brand.name} selected={selectedBrandId === brand.id} onSelect={() => setSelectedBrandId(brand.id)} canEdit={canEdit} onEdit={() => setEditor({ kind: 'brand', item: brand })} onDelete={() => void remove('brand', brand)} />
            ))}
          </ListColumn>
          <ListColumn
            title={selectedBrand ? `Модели · ${selectedBrand.name}` : 'Модели'}
            empty={selectedBrand ? 'Для этой марки моделей пока нет.' : 'Сначала выберите марку.'}
            canEdit={canEdit && selectedBrandId !== null}
            onAdd={() => setEditor({ kind: 'model' })}
          >
            {models.map((model) => (
              <Entry key={model.id} name={model.name} selected={false} onSelect={() => undefined} canEdit={canEdit} onEdit={() => setEditor({ kind: 'model', item: model })} onDelete={() => void remove('model', model)} />
            ))}
          </ListColumn>
        </div>
      )}
      {editor && (
        <Modal
          title={
            editor.kind === 'type'
              ? editor.item ? 'Изменить тип устройства' : 'Новый тип устройства'
              : editor.kind === 'brand'
                ? editor.item ? 'Изменить марку' : 'Новая марка'
                : editor.item ? 'Изменить модель' : 'Новая модель'
          }
          onClose={() => setEditor(null)}
        >
          <form onSubmit={(event) => void save(event)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Название
              <input className={inputClass} name="name" required defaultValue={editor.item?.name ?? ''} />
            </label>
            {editor.kind === 'type' && (
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm text-muted">Зарплата, %<input className={inputClass} name="salary_percent" type="number" min="0" step="0.01" defaultValue={editor.item?.salary_percent ?? ''} /></label>
                <label className="grid gap-1 text-sm text-muted">Зарплата, сумма<input className={inputClass} name="salary_fixed" type="number" min="0" step="0.01" defaultValue={editor.item?.salary_fixed ?? ''} /></label>
              </div>
            )}
            {editor.kind === 'brand' && (
              <label className="grid gap-1 text-sm text-muted">Тип устройства
                <select className={inputClass} name="device_type_id" defaultValue={editor.item?.device_type_id ?? selectedTypeId ?? ''}>
                  <option value="">Без типа</option>
                  {(types ?? []).map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
            )}
            {editor.kind === 'model' && (
              <label className="grid gap-1 text-sm text-muted">Марка
                <select className={inputClass} name="brand_id" required defaultValue={editor.item?.brand_id ?? selectedBrandId ?? ''}>
                  {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
                </select>
              </label>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditor(null)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

function ListColumn({
  title,
  empty,
  canEdit,
  onAdd,
  children,
}: {
  title: string
  empty: string
  canEdit: boolean
  onAdd: () => void
  children: React.ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <section className="min-h-64 rounded-xl border border-line bg-surface p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {canEdit && <button className="text-sm text-accent" onClick={onAdd}>+ Добавить</button>}
      </header>
      {!hasChildren ? <p className="py-2 text-sm text-muted">{empty}</p> : <ul className="divide-y divide-line">{children}</ul>}
    </section>
  )
}

function Entry({
  name,
  selected,
  onSelect,
  canEdit,
  onEdit,
  onDelete,
}: {
  name: string
  selected: boolean
  onSelect: () => void
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className={`flex items-center gap-2 py-1 ${selected ? 'font-medium text-accent' : ''}`}>
      <button className="min-w-0 flex-1 truncate py-1 text-left" onClick={onSelect}>{name}</button>
      {canEdit && <button aria-label={`Изменить ${name}`} className="text-sm text-muted" onClick={onEdit}>Изменить</button>}
      {canEdit && <button aria-label={`Удалить ${name}`} className="text-sm text-danger" onClick={onDelete}>×</button>}
    </li>
  )
}
