import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type OrderType = { id: number; name: string; sort: number; is_active: boolean }
type DataType = 'string' | 'text' | 'date' | 'dateTime' | 'boolean' | 'number' | 'money' | 'enum' | 'multiple'
type FormField = {
  id?: number
  order_type_id?: number | null
  key: string
  label: string
  group: string
  data_type: DataType
  place: string
  is_required: boolean
  is_only_dictionary: boolean
  default_value: unknown
  items: string[] | null
  is_visible: boolean
}
type TypeEditor = OrderType | null

const dataTypes: { value: DataType; label: string }[] = [
  { value: 'string', label: 'Строка' },
  { value: 'text', label: 'Текст' },
  { value: 'date', label: 'Дата' },
  { value: 'dateTime', label: 'Дата и время' },
  { value: 'boolean', label: 'Да / нет' },
  { value: 'number', label: 'Число' },
  { value: 'money', label: 'Деньги' },
  { value: 'enum', label: 'Список' },
  { value: 'multiple', label: 'Множественный выбор' },
]
const groups: Record<string, string> = {
  counteragent: 'Контрагент',
  device: 'Устройство',
  other: 'Дополнительно',
  custom: 'Пользовательские поля',
}
const inputClass = 'rounded-md border border-line bg-surface px-2 py-1.5'

function comparePlace(a: FormField, b: FormField) {
  const left = a.place.split('.').map(Number)
  const right = b.place.split('.').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference) return difference
  }
  return (a.id ?? 0) - (b.id ?? 0)
}

export default function OrderTypesPage() {
  const { can } = useAuth()
  const [types, setTypes] = useState<OrderType[] | null>(null)
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null)
  const [fields, setFields] = useState<FormField[] | null>(null)
  const [typeEditor, setTypeEditor] = useState<TypeEditor | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadTypes = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.get<OrderType[]>('/order-types')
      setTypes(result)
      setSelectedTypeId((current) =>
        current === null || !result.some((item) => item.id === current)
          ? result[0]?.id ?? null
          : current,
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить типы заказов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTypes()
  }, [loadTypes])

  const loadFields = useCallback(async () => {
    if (selectedTypeId === null) {
      setFields(null)
      return
    }
    setFieldsLoading(true)
    setError('')
    try {
      setFields(await api.get<FormField[]>(`/order-types/${selectedTypeId}/fields`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить поля формы')
      setFields(null)
    } finally {
      setFieldsLoading(false)
    }
  }, [selectedTypeId])

  useEffect(() => {
    void loadFields()
  }, [loadFields])

  const saveType = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const payload = {
      name: String(values.get('name') ?? '').trim(),
      sort: Number(values.get('sort') ?? 0),
    }
    setSaving(true)
    setError('')
    try {
      if (typeEditor) {
        await api.put(`/order-types/${typeEditor.id}`, payload)
      } else {
        const created = await api.post<OrderType>('/order-types', payload)
        setSelectedTypeId(created.id)
      }
      setTypeEditor(undefined)
      await loadTypes()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить тип заказа')
    } finally {
      setSaving(false)
    }
  }

  const archiveType = async (orderType: OrderType) => {
    if (!confirm(`Архивировать тип заказа «${orderType.name}»?`)) return
    setSaving(true)
    setError('')
    try {
      await api.del(`/order-types/${orderType.id}`)
      setSelectedTypeId(null)
      await loadTypes()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось архивировать тип заказа')
    } finally {
      setSaving(false)
    }
  }

  const saveFields = async () => {
    if (selectedTypeId === null || fields === null) return
    setSaving(true)
    setError('')
    try {
      const saved = await api.put<FormField[]>(`/order-types/${selectedTypeId}/fields`, fields)
      setFields(saved)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить поля формы')
    } finally {
      setSaving(false)
    }
  }

  const updateField = (field: FormField, patch: Partial<FormField>) => {
    setFields((current) => current?.map((item) =>
      item === field || (field.id !== undefined && item.id === field.id) ? { ...item, ...patch } : item,
    ) ?? null)
  }

  const moveField = (field: FormField, direction: -1 | 1) => {
    setFields((current) => {
      if (!current) return current
      const groupFields = current.filter((item) => item.group === field.group).sort(comparePlace)
      const index = groupFields.findIndex((item) =>
        item === field || (field.id !== undefined && item.id === field.id),
      )
      const neighbor = groupFields[index + direction]
      if (index < 0 || !neighbor) return current
      const firstPlace = field.place
      const secondPlace = neighbor.place
      return current.map((item) => {
        if (item === field || (field.id !== undefined && item.id === field.id)) return { ...item, place: secondPlace }
        if (item === neighbor || (neighbor.id !== undefined && item.id === neighbor.id)) return { ...item, place: firstPlace }
        return item
      })
    })
  }

  const addField = () => {
    setFields((current) => {
      if (!current) return current
      const customCount = current.filter((field) => field.group === 'custom').length
      return [
        ...current,
        {
          key: 'custom_new',
          label: 'Новое поле',
          group: 'custom',
          data_type: 'string',
          place: `9.0.${customCount + 1}`,
          is_required: false,
          is_only_dictionary: false,
          default_value: null,
          items: null,
          is_visible: true,
        },
      ]
    })
  }

  const sortedGroups = Object.keys(groups)
  const groupedFields = sortedGroups
    .map((group) => ({ group, fields: (fields ?? []).filter((field) => field.group === group).sort(comparePlace) }))
    .filter((group) => group.fields.length > 0)

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Типы заказов и форма</h2>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : types === null ? (
        <p className="text-muted">Не удалось загрузить типы заказов.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-line bg-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-semibold">Типы</h3>
              {can('settingAccess') && <button className="text-sm text-accent" onClick={() => setTypeEditor(null)}>+ Тип</button>}
            </div>
            {types.length === 0 ? (
              <p className="py-2 text-sm text-muted">Типов пока нет.</p>
            ) : (
              <ul className="space-y-1">
                {types.map((item) => (
                  <li key={item.id} className={`flex items-center gap-1 rounded-md ${selectedTypeId === item.id ? 'bg-canvas' : ''}`}>
                    <button className="min-w-0 flex-1 px-2 py-2 text-left" onClick={() => setSelectedTypeId(item.id)}>{item.name}</button>
                    {can('settingAccess') && (
                      <>
                        <button aria-label={`Изменить ${item.name}`} className="px-1 text-muted" onClick={() => setTypeEditor(item)}>⋯</button>
                        <button aria-label={`Архивировать ${item.name}`} className="px-1 text-danger" onClick={() => void archiveType(item)}>×</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
          <section className="min-w-0 rounded-xl border border-line bg-surface p-3">
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{types.find((item) => item.id === selectedTypeId)?.name ?? 'Поля формы'}</h3>
              {can('settingAccess') && selectedTypeId !== null && fields && (
                <span className="flex gap-2">
                  <button className="rounded-md border border-line px-3 py-2" onClick={addField}>+ поле</button>
                  <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60" onClick={() => void saveFields()}>
                    {saving ? 'Сохранение…' : 'Сохранить форму'}
                  </button>
                </span>
              )}
            </header>
            {fieldsLoading ? (
              <p className="text-muted">Загрузка полей…</p>
            ) : selectedTypeId === null ? (
              <p className="text-muted">Выберите тип заказа или добавьте новый.</p>
            ) : fields === null ? (
              <p className="text-muted">Не удалось загрузить поля формы.</p>
            ) : fields.length === 0 ? (
              <p className="text-muted">В этой форме пока нет полей.</p>
            ) : groupedFields.length === 0 ? (
              <p className="text-muted">Нет полей для отображения.</p>
            ) : (
              <div className="space-y-5">
                {groupedFields.map(({ group, fields: groupItems }) => (
                  <section key={group}>
                    <h4 className="mb-2 font-medium">{groups[group]}</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[850px] text-left text-sm">
                        <thead className="bg-canvas text-muted">
                          <tr>
                            <th className="px-2 py-2">Метка</th>
                            <th className="px-2 py-2">Тип данных</th>
                            <th className="px-2 py-2">Место</th>
                            <th className="px-2 py-2 text-center">Обязательное</th>
                            <th className="px-2 py-2 text-center">Только справочник</th>
                            <th className="px-2 py-2 text-center">Показывать</th>
                            <th className="px-2 py-2">Порядок</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groupItems.map((field, index) => (
                            <tr key={field.id ?? `custom-${index}`} className="border-t border-line">
                              <td className="px-2 py-2"><input className={`${inputClass} w-44`} value={field.label} onChange={(event) => updateField(field, { label: event.target.value })} /></td>
                              <td className="px-2 py-2">
                                <select className={inputClass} value={field.data_type} onChange={(event) => updateField(field, { data_type: event.target.value as DataType })}>
                                  {dataTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                                </select>
                              </td>
                              <td className="px-2 py-2 font-mono">{field.place}</td>
                              <td className="px-2 py-2 text-center"><input type="checkbox" checked={field.is_required} onChange={(event) => updateField(field, { is_required: event.target.checked })} /></td>
                              <td className="px-2 py-2 text-center"><input type="checkbox" checked={field.is_only_dictionary} onChange={(event) => updateField(field, { is_only_dictionary: event.target.checked })} /></td>
                              <td className="px-2 py-2 text-center"><input type="checkbox" checked={field.is_visible} onChange={(event) => updateField(field, { is_visible: event.target.checked })} /></td>
                              <td className="px-2 py-2">
                                <span className="flex gap-1">
                                  <button type="button" aria-label="Переместить вверх" disabled={index === 0} className="rounded border border-line px-2 disabled:opacity-40" onClick={() => moveField(field, -1)}>↑</button>
                                  <button type="button" aria-label="Переместить вниз" disabled={index === groupItems.length - 1} className="rounded border border-line px-2 disabled:opacity-40" onClick={() => moveField(field, 1)}>↓</button>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {typeEditor !== undefined && (
        <Modal title={typeEditor ? 'Изменить тип заказа' : 'Новый тип заказа'} onClose={() => setTypeEditor(undefined)}>
          <form onSubmit={(event) => void saveType(event)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Название
              <input className={inputClass} name="name" required maxLength={100} defaultValue={typeEditor?.name ?? ''} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Порядок
              <input className={inputClass} name="sort" type="number" defaultValue={typeEditor?.sort ?? (types?.length ?? 0)} />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setTypeEditor(undefined)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
