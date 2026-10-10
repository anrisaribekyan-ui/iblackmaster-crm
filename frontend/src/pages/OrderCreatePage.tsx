import { ClientCard, useIntakeHints, WarrantyAlert } from '../components/IntakeHints'
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { localInputToIso } from '../format'
import { useAuth } from '../auth'

type Location = { id: number; name: string }
type OrderType = { id: number; name: string }
type FormField = {
  id: number
  key: string
  label: string
  group: string
  data_type: string
  place: string
  is_required: boolean
  is_only_dictionary: boolean
  default_value: unknown
  items: string[] | null
  is_visible: boolean
}
type Counteragent = { id: number; name: string; phones: string | null }
type DeviceSuggestion = { id: number; brand_id: number; brand: string; model: string; name: string }
type Employee = { id: number; short_name: string }
type FormValues = Record<string, unknown>
type Choice = { id: number; name: string }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'
const groupTitles: Record<string, string> = {
  counteragent: 'Клиент',
  device: 'Устройство',
  other: 'Дополнительно',
  custom: 'Дополнительные поля',
}
const knownKeys = new Set([
  'name', 'phones', 'howKnow', 'deviceType', 'brand', 'model', 'sn', 'problem', 'completeSet',
  'appearance', 'color', 'password', 'orderNode', 'approximatePrice', 'prepayment', 'deadline',
  'isUrgent', 'master', 'manager',
])

function numberPart(place: string, index: number) {
  const result = Number(place.split('.')[index] ?? 0)
  return Number.isFinite(result) ? result : 0
}

function getRows(fields: FormField[]) {
  const grouped = new Map<string, Map<number, Map<number, FormField[]>>>()
  for (const field of fields.filter((item) => item.is_visible)) {
    if (!grouped.has(field.group)) grouped.set(field.group, new Map())
    const rows = grouped.get(field.group)!
    const rowIndex = numberPart(field.place, 0)
    const columnIndex = numberPart(field.place, 1)
    if (!rows.has(rowIndex)) rows.set(rowIndex, new Map())
    const columns = rows.get(rowIndex)!
    if (!columns.has(columnIndex)) columns.set(columnIndex, [])
    columns.get(columnIndex)!.push(field)
  }
  return [...grouped.entries()].map(([group, rows]) => ({
    group,
    rows: [...rows.entries()].sort(([a], [b]) => a - b).map(([row, columns]) => ({
      row,
      columns: [...columns.entries()].sort(([a], [b]) => a - b).map(([column, items]) => ({
        column,
        fields: items.sort((a, b) => numberPart(a.place, 2) - numberPart(b.place, 2)),
      })),
    })),
  }))
}

function initialValue(field: FormField, employeeId: number | undefined) {
  if (field.default_value !== null && field.default_value !== undefined) {
    if (
      typeof field.default_value === 'object'
      && !Array.isArray(field.default_value)
      && 'current_user' in field.default_value
      && employeeId
    ) return String(employeeId)
    return field.default_value
  }
  if (field.data_type === 'multiple') return []
  if (field.data_type === 'boolean') return false
  return ''
}

function toOptionalNumber(value: unknown) {
  const stringValue = String(value ?? '').trim()
  return stringValue ? Number(stringValue) : null
}

export default function OrderCreatePage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [locations, setLocations] = useState<Location[]>([])
  const [orderTypes, setOrderTypes] = useState<OrderType[]>([])
  const [locationId, setLocationId] = useState('')
  const [orderTypeId, setOrderTypeId] = useState('')
  const [fields, setFields] = useState<FormField[]>([])
  const [values, setValues] = useState<FormValues>({})
  const [problems, setProblems] = useState<Choice[]>([])
  const [completeSets, setCompleteSets] = useState<Choice[]>([])
  const [howKnows, setHowKnows] = useState<Choice[]>([])
  const [masters, setMasters] = useState<Employee[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [deviceSuggestions, setDeviceSuggestions] = useState<DeviceSuggestion[]>([])
  const [counteragentId, setCounteragentId] = useState<number | null>(null)
  const [counteragentFound, setCounteragentFound] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [loading, setLoading] = useState(true)
  const [fieldsLoading, setFieldsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [locationData, typeData, problemData, completeSetData, howKnowData, masterData, managerData] = await Promise.all([
          api.get<Location[]>('/locations'),
          api.get<OrderType[]>('/order-types'),
          api.get<Choice[]>('/problems'),
          api.get<Choice[]>('/complete-sets'),
          api.get<Choice[]>('/how-knows'),
          api.get<Employee[]>('/employees/short?master=1'),
          api.get<Employee[]>('/employees/short?manager=1'),
        ])
        if (!active) return
        setLocations(locationData)
        setOrderTypes(typeData)
        setProblems(problemData)
        setCompleteSets(completeSetData)
        setHowKnows(howKnowData)
        setMasters(masterData)
        setManagers(managerData)
        if (locationData.length) setLocationId(String(locationData[0].id))
        if (typeData.length) setOrderTypeId(String(typeData[0].id))
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : 'Не удалось загрузить данные для создания заказа')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!orderTypeId) {
      setFields([])
      setValues({})
      return
    }
    let active = true
    setFieldsLoading(true)
    setError('')
    api.get<FormField[]>(`/order-types/${orderTypeId}/fields`)
      .then((result) => {
        if (!active) return
        const visible = result.filter((field) => field.is_visible)
        setFields(visible)
        // Смена типа заказа не стирает то, что уже введено: общие поля переносятся
        setValues((current) => Object.fromEntries(
          visible.map((field) => [field.key, field.key in current ? current[field.key] : initialValue(field, me?.id)]),
        ))
        if (!visible.some((field) => field.key === 'phones')) {
          setCounteragentId(null)
          setCounteragentFound('')
        }
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof ApiError ? e.message : 'Не удалось загрузить поля заказа')
      })
      .finally(() => {
        if (active) setFieldsLoading(false)
      })
    return () => { active = false }
  }, [orderTypeId, me?.id])

  const updateValue = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }))
    if (key === 'phones' || key === 'name') {
      setCounteragentId(null)
      setCounteragentFound('')
    }
  }

  const phoneValue = String(values.phones ?? '')
  useEffect(() => {
    const digits = phoneValue.replace(/\D/g, '')
    if (digits.length < 10) {
      setCounteragentFound('')
      setLookupError('')
      return
    }
    let active = true
    setLookupError('')
    const timer = window.setTimeout(async () => {
      try {
        const found = await api.get<Counteragent | null>(`/counteragents/by-phone?phone=${encodeURIComponent(phoneValue)}`)
        if (!active) return
        if (found) {
          setCounteragentId(found.id)
          setCounteragentFound(found.name)
          setValues((current) => ({ ...current, name: found.name }))
        } else {
          setCounteragentId(null)
          setCounteragentFound('')
        }
      } catch (e) {
        if (active) setLookupError(e instanceof ApiError ? e.message : 'Не удалось найти клиента по телефону')
      }
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [phoneValue])

  const deviceTerm = `${String(values.brand ?? '')} ${String(values.model ?? '')}`.trim()
  useEffect(() => {
    if (!deviceTerm) {
      setDeviceSuggestions([])
      return
    }
    let active = true
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.get<DeviceSuggestion[]>(`/devices/suggest?q=${encodeURIComponent(deviceTerm)}`)
        if (active) setDeviceSuggestions(result)
      } catch (e) {
        if (active) setError(e instanceof ApiError ? e.message : 'Не удалось найти устройство')
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [deviceTerm])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!locationId || !orderTypeId) {
      setError('Выберите локацию и тип заказа')
      return
    }
    const missingRequired = fields.find((field) => {
      if (!field.is_required) return false
      const value = values[field.key]
      return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
    })
    if (missingRequired) {
      setError(`Заполните поле «${missingRequired.label}»`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const howKnowId = toOptionalNumber(values.howKnow)
      const counteragent = counteragentId
        ? { id: counteragentId }
        : {
            name: String(values.name ?? '').trim(),
            phones: String(values.phones ?? '').trim() || null,
            how_know_id: howKnowId,
            is_buyer: true,
          }
      const customFields = Object.fromEntries(
        fields
          .filter((field) => !knownKeys.has(field.key))
          .map((field) => [field.key, values[field.key] ?? null]),
      )
      const payload = {
        location_id: Number(locationId),
        order_type_id: Number(orderTypeId),
        counteragent,
        device_type: values.deviceType ? String(values.deviceType) : null,
        brand: values.brand ? String(values.brand) : null,
        model: values.model ? String(values.model) : null,
        serial: values.sn ? String(values.sn) : null,
        problems: Array.isArray(values.problem) ? values.problem : [],
        complete_set: Array.isArray(values.completeSet) ? values.completeSet : [],
        appearance: Array.isArray(values.appearance) ? values.appearance : [],
        color: values.color ? String(values.color) : null,
        device_password: values.password ? String(values.password) : null,
        note: values.orderNode ? String(values.orderNode) : null,
        approximate_price: values.approximatePrice ? String(values.approximatePrice) : null,
        has_prepayment: Boolean(values.prepayment),
        deadline: localInputToIso(values.deadline as string | null),
        is_urgent: Boolean(values.isUrgent),
        how_know_id: howKnowId,
        custom_fields: customFields,
        master_id: toOptionalNumber(values.master),
        manager_id: toOptionalNumber(values.manager),
      }
      const created = await api.post<{ id: number; number: string }>('/orders', payload)
      navigate(`/orders/${created.id}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать заказ')
    } finally {
      setSaving(false)
    }
  }

  const rows = useMemo(() => getRows(fields), [fields])
  const hints = useIntakeHints(counteragentId, String(values.sn ?? ''), String(values.brand ?? ''), String(values.model ?? ''))
  const isWarrantyType = Boolean(hints?.warranty_order_type_id) && Number(orderTypeId) === hints?.warranty_order_type_id
  const applyWarranty = (item: NonNullable<typeof hints>['warranty'][number]) => {
    if (!hints?.warranty_order_type_id) return
    // Смена типа перезагружает поля формы — введённые значения сохраняются в values
    setOrderTypeId(String(hints.warranty_order_type_id))
    setValues((current) => {
      const note = String(current.orderNode ?? '')
      const mark = `Гарантия по заказу ${item.number}`
      return {
        ...current,
        brand: current.brand || item.brand || current.brand,
        model: current.model || item.model || current.model,
        orderNode: note.includes(mark) ? note : note ? `${mark}. ${note}` : mark,
      }
    })
  }

  if (loading) return <p className="text-muted">Загрузка формы заказа…</p>
  return (
    <section className="max-w-6xl">
      <h1 className="mb-4 text-xl font-semibold">Новый заказ</h1>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {orderTypes.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-muted">Нет активных типов заказов. Добавьте тип в настройках перед созданием заказа.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Локация
              <select className={inputClass} value={locationId} onChange={(event) => setLocationId(event.target.value)} required>
                <option value="" disabled>Выберите локацию</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Тип заказа
              <select className={inputClass} value={orderTypeId} onChange={(event) => setOrderTypeId(event.target.value)} required>
                {orderTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
              </select>
            </label>
          </div>
          {fieldsLoading ? (
            <p className="text-muted">Загрузка формы…</p>
          ) : fields.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-muted">Для этого типа заказа не настроены поля формы.</p>
          ) : (
            <div className="space-y-4">
              {rows.map(({ group, rows: groupRows }) => (
                <section key={group} className="rounded-xl border border-line bg-surface p-4">
                  <h2 className="mb-3 font-semibold">{groupTitles[group] ?? group}</h2>
                  <div className="space-y-3">
                    {groupRows.map(({ row, columns }) => {
                      const columnCount = Math.max(...columns.map((column) => column.column)) + 1
                      return (
                        <div
                          key={row}
                          // На телефоне поля одно под другим, с планшета — колонки из настройки формы
                          className="grid gap-3 sm:[grid-template-columns:var(--form-cols)]"
                          style={{ '--form-cols': `repeat(${columnCount}, minmax(0, 1fr))` } as CSSProperties}
                        >
                          {columns.map(({ column, fields: columnFields }) => (
                            <div key={column} className="grid content-start gap-3">
                              {columnFields.map((field) => (
                                <DynamicField
                                  key={field.id}
                                  field={field}
                                  value={values[field.key]}
                                  choices={
                                    field.key === 'problem' ? problems
                                      : field.key === 'completeSet' ? completeSets
                                        : field.key === 'howKnow' ? howKnows
                                          : field.key === 'master' ? masters
                                            : field.key === 'manager' ? managers
                                              : []
                                  }
                                  deviceSuggestions={field.key === 'brand' || field.key === 'model' ? deviceSuggestions : []}
                                  onChange={(value) => updateValue(field.key, value)}
                                  onChooseDevice={(device) => setValues((current) => ({ ...current, brand: device.brand, model: device.model }))}
                                  lookupError={field.key === 'phones' ? lookupError : ''}
                                  counteragentFound={field.key === 'phones' ? counteragentFound : ''}
                                  onNewCounteragent={() => {
                                    setCounteragentId(null)
                                    setCounteragentFound('')
                                  }}
                                />
                              ))}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                  {group === 'counteragent' && hints?.client && <ClientCard client={hints.client} />}
                  {group === 'device' && hints && <div className="mt-3"><WarrantyAlert hints={hints} isWarrantyType={isWarrantyType} onApply={applyWarranty} /></div>}
                </section>
              ))}
            </div>
          )}
          {fields.length > 0 && (
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line bg-surface px-4 py-2.5" onClick={() => navigate('/orders')}>Отмена</button>
              <button disabled={saving || fieldsLoading} className="flex-1 rounded-md bg-accent px-4 py-2.5 font-medium text-accent-ink disabled:opacity-60 sm:flex-none">
                {saving ? 'Создание…' : 'Создать заказ'}
              </button>
            </div>
          )}
        </form>
      )}
    </section>
  )
}

function DynamicField({
  field,
  value,
  choices,
  deviceSuggestions,
  onChange,
  onChooseDevice,
  lookupError,
  counteragentFound,
  onNewCounteragent,
}: {
  field: FormField
  value: unknown
  choices: Choice[] | Employee[]
  deviceSuggestions: DeviceSuggestion[]
  onChange: (value: unknown) => void
  onChooseDevice: (device: DeviceSuggestion) => void
  lookupError: string
  counteragentFound: string
  onNewCounteragent: () => void
}) {
  const label = <span>{field.label}{field.is_required && <span className="ml-1 text-danger">*</span>}</span>
  let control: ReactNode
  if (field.data_type === 'multiple' && field.key !== 'phones') {
    const selected = Array.isArray(value) ? value.map(String) : []
    const suggestions = choices.map((choice) => 'name' in choice ? choice.name : choice.short_name)
    control = (
      <MultiValueInput
        value={selected}
        suggestions={suggestions}
        placeholder={field.is_only_dictionary ? 'Выберите из списка' : 'Введите значение и нажмите Enter'}
        onChange={onChange}
      />
    )
  } else if (field.key === 'brand' || field.key === 'model') {
    control = (
      <div className="relative">
        <input
          className={inputClass}
          value={String(value ?? '')}
          required={field.is_required}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
        />
        {deviceSuggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-line bg-surface shadow-lg">
            {deviceSuggestions.map((device) => (
              <li key={device.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-canvas" onClick={() => onChooseDevice(device)}>{device.name}</button></li>
            ))}
          </ul>
        )}
      </div>
    )
  } else if (field.key === 'howKnow' || field.key === 'master' || field.key === 'manager' || field.data_type === 'enum') {
    const options = field.key === 'master' || field.key === 'manager'
      ? (choices as Employee[]).map((choice) => ({ value: String(choice.id), label: choice.short_name }))
      : field.key === 'howKnow'
        ? (choices as Choice[]).map((choice) => ({ value: String(choice.id), label: choice.name }))
        : (field.items ?? []).map((item) => ({ value: item, label: item }))
    control = (
      <select className={inputClass} value={String(value ?? '')} required={field.is_required} onChange={(event) => onChange(event.target.value)}>
        {!field.is_required && <option value="">— Не выбрано —</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    )
  } else if (field.data_type === 'boolean') {
    control = <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
  } else if (field.data_type === 'text') {
    control = <textarea className={inputClass} value={String(value ?? '')} required={field.is_required} rows={3} onChange={(event) => onChange(event.target.value)} />
  } else {
    const inputType = field.key === 'phones'
      ? 'tel'
      : field.data_type === 'date'
        ? 'date'
        : field.data_type === 'dateTime'
          ? 'datetime-local'
          : field.data_type === 'number' || field.data_type === 'money'
            ? 'number'
            : 'text'
    control = (
      <input
        className={inputClass}
        type={inputType}
        step={field.data_type === 'money' || field.data_type === 'number' ? 'any' : undefined}
        value={String(value ?? '')}
        required={field.is_required}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={field.key === 'phones' ? 'tel' : 'off'}
      />
    )
  }

  // Поля с кнопками внутри (подсказки, «+») нельзя оборачивать в <label>: клик по кнопке
  // перехватывается label и значение не добавляется.
  const Wrapper = field.data_type === 'multiple' && field.key !== 'phones' ? 'div' : 'label'
  return (
    <Wrapper className="grid gap-1 text-sm text-muted">
      {label}
      {control}
      {field.key === 'phones' && counteragentFound && (
        <span className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted">
          Найден клиент: {counteragentFound}
          <button type="button" className="text-accent" onClick={onNewCounteragent}>Создать нового</button>
        </span>
      )}
      {lookupError && field.key === 'phones' && <span role="alert" className="text-xs text-danger">{lookupError}</span>}
    </Wrapper>
  )
}

function MultiValueInput({
  value,
  suggestions,
  placeholder,
  onChange,
}: {
  value: string[]
  suggestions: string[]
  placeholder: string
  onChange: (value: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const matching = suggestions.filter((item) => item.toLocaleLowerCase('ru-RU').includes(draft.toLocaleLowerCase('ru-RU')) && !value.includes(item)).slice(0, 8)
  const add = (raw: string) => {
    const item = raw.trim()
    if (item && !value.includes(item)) onChange([...value, item])
    setDraft('')
  }
  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-1 flex flex-wrap gap-1">
          {value.map((item) => (
            <li key={item} className="flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs text-ink">
              {item}<button type="button" aria-label={`Убрать ${item}`} className="text-danger" onClick={() => onChange(value.filter((valueItem) => valueItem !== item))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative flex gap-1">
        <input
          className={inputClass}
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              add(draft)
            }
          }}
          autoComplete="off"
        />
        <button type="button" className="rounded-md border border-line px-2" onClick={() => add(draft)}>+</button>
        {draft && matching.length > 0 && (
          <ul className="absolute left-0 top-full z-10 mt-1 max-h-40 w-full overflow-auto rounded-md border border-line bg-surface shadow-lg">
            {matching.map((item) => <li key={item}><button type="button" className="w-full px-3 py-2 text-left hover:bg-canvas" onClick={() => add(item)}>{item}</button></li>)}
          </ul>
        )}
      </div>
      {suggestions.length > 0 && !draft && (
        <div className="mt-1 flex flex-wrap gap-1">
          {suggestions.slice(0, 5).filter((item) => !value.includes(item)).map((item) => <button key={item} type="button" className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:text-ink" onClick={() => add(item)}>{item}</button>)}
        </div>
      )}
    </div>
  )
}
