import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { formatPhone, isoToLocalInput, localInputToIso } from '../format'
import { useAuth } from '../auth'
import Modal from '../components/Modal'
import TaskForm, { type TaskEmployee, type TaskFormValues } from '../components/TaskForm'

type Status = { id: number; group: string; name: string; color: string; pay_required: boolean; comment_mode: string }
type StatusGroup = { group: string; title: string; statuses: Status[] }
type Employee = { id: number; short_name: string }
type CashRegister = {
  id: number
  location_id: number | null
  name: string
  accepts_cash: boolean
  accepts_bank: boolean
  bank_percent: string
}
type Store = { id: number; location_id: number; name: string; is_default: boolean }
type FormField = {
  id: number
  key: string
  label: string
  group: string
  data_type: string
  is_required: boolean
  is_visible: boolean
  items: string[] | null
}
type Position = {
  id: number
  nomenclature_id: number | null
  is_work: boolean
  name: string
  quantity: string
  price: string
  sold_price: string
  purchase_price: string | null
  total: string
  margin: string | null
  guarantee_days: number
  store_id: number | null
}
type HistoryItem = {
  id: number
  type: string
  title: string
  text: string | null
  data: Record<string, unknown>
  created_at: string
  employee_name: string | null
  status: { name: string; color: string } | null
}
type Transaction = {
  id: number
  date: string
  amount: string
  is_bank: boolean
  cash_register_id: number
  note: string | null
  is_income: boolean
  cash_item_name: string
  cash_item_type: string | null
  cash_register_name: string
}
type OrderDetail = {
  order: Record<string, unknown> & {
    id: number
    number: string
    location_id: number
    order_type_id: number
    counteragent_id: number
    total_price: string
    total_purchase: string
    paid: string
    discount_percent: string
    discount_sum: string
  }
  status: Status
  order_type: { id: number; name: string }
  counteragent: { id: number; name: string; phones: string | null; balance: string }
  master: Employee | null
  manager: Employee | null
  positions: Position[]
  history: HistoryItem[]
  transactions: Transaction[]
  debt: string
}
type OrderFieldValues = Record<string, unknown>
type CatalogItem = { id: number; name: string; article?: string | null; prices?: { price: string }[]; is_work: boolean }
type PaymentMode = 'payment' | 'refund'
type TaskRow = { id: number; title: string; text: string | null; assignee_name: string | null; deadline: string | null; is_done: boolean }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'
const aliasMap: Record<string, string> = {
  deviceType: 'device_type',
  sn: 'serial',
  problem: 'problems',
  completeSet: 'complete_set',
  password: 'device_password',
  orderNode: 'note',
  approximatePrice: 'approximate_price',
  prepayment: 'has_prepayment',
  isUrgent: 'is_urgent',
  master: 'master_id',
  manager: 'manager_id',
  howKnow: 'how_know_id',
}

function formatMoney(value: string | number) {
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function fieldValue(field: FormField, detail: OrderDetail) {
  const key = field.key
  if (key === 'name') return detail.counteragent.name
  if (key === 'phones') return detail.counteragent.phones ?? ''
  if (key === 'howKnow') return detail.order.how_know_id ?? ''
  if (key === 'master') return detail.master?.id ?? ''
  if (key === 'manager') return detail.manager?.id ?? ''
  if (key.startsWith('custom_') || !(key in aliasMap) && !['brand', 'model', 'color', 'appearance'].includes(key)) {
    return (detail.order.custom_fields as Record<string, unknown> | undefined)?.[key] ?? ''
  }
  const orderKey = aliasMap[key] ?? key
  const value = detail.order[orderKey]
  return value ?? ''
}

function displayValue(field: FormField, detail: OrderDetail, masters: Employee[], managers: Employee[]) {
  const value = fieldValue(field, detail)
  if (field.key === 'howKnow') return String(value || '—')
  if (field.key === 'master') return masters.find((item) => item.id === Number(value))?.short_name ?? '—'
  if (field.key === 'manager') return managers.find((item) => item.id === Number(value))?.short_name ?? '—'
  if (field.key === 'prepayment' || field.key === 'isUrgent') return value ? 'Да' : 'Нет'
  if (Array.isArray(value)) return value.join(', ') || '—'
  if (value === null || value === undefined || value === '') return '—'
  if (field.key === 'deadline') return formatDate(String(value))
  return String(value)
}

export default function OrderDetailPage() {
  const { orderId } = useParams()
  const { can } = useAuth()
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [fields, setFields] = useState<FormField[]>([])
  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([])
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [masters, setMasters] = useState<Employee[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [tab, setTab] = useState<'info' | 'positions'>('info')
  const [editingInfo, setEditingInfo] = useState(false)
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null)
  const [closeAfterPay, setCloseAfterPay] = useState(false)
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentRegisterId, setPaymentRegisterId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('cash')
  const [closeComment, setCloseComment] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [comment, setComment] = useState('')
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([])
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null)
  const [quantity, setQuantity] = useState('1')
  const [positionPrice, setPositionPrice] = useState('0')
  const [positionCost, setPositionCost] = useState('')
  const [storeId, setStoreId] = useState('')
  const [discountKind, setDiscountKind] = useState<'percent' | 'sum'>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [taskEmployees, setTaskEmployees] = useState<TaskEmployee[]>([])
  const [taskCreating, setTaskCreating] = useState(false)

  const loadDetail = useCallback(async (initial = false) => {
    if (!orderId) return
    if (initial) setLoading(true)
    setError('')
    try {
      const result = await api.get<OrderDetail>(`/orders/${orderId}`)
      setDetail(result)
      setDiscountKind(Number(result.order.discount_sum) > 0 ? 'sum' : 'percent')
      setDiscountValue(
        Number(result.order.discount_sum) > 0
          ? String(result.order.discount_sum)
          : Number(result.order.discount_percent) > 0 ? String(result.order.discount_percent) : '',
      )
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить заказ')
    } finally {
      if (initial) setLoading(false)
    }
  }, [orderId])

  const loadReferences = useCallback(async (current: OrderDetail) => {
    try {
      const [fieldsData, statuses, registers, storeData, masterData, managerData] = await Promise.all([
        api.get<FormField[]>(`/order-types/${current.order.order_type_id}/fields`),
        api.get<StatusGroup[]>('/order-statuses'),
        api.get<CashRegister[]>('/cash-registers'),
        api.get<Store[]>(`/stores?location_id=${current.order.location_id}`),
        api.get<Employee[]>('/employees/short?master=1'),
        api.get<Employee[]>('/employees/short?manager=1'),
      ])
      setFields(fieldsData)
      setStatusGroups(statuses)
      setCashRegisters(registers.filter((register) => register.location_id === null || register.location_id === current.order.location_id))
      setStores(storeData)
      setMasters(masterData)
      setManagers(managerData)
      if (storeData.length) setStoreId(String(storeData.find((store) => store.is_default)?.id ?? storeData[0].id))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить справочники заказа')
    }
  }, [])

  useEffect(() => {
    void loadDetail(true)
  }, [loadDetail])

  useEffect(() => {
    if (detail) void loadReferences(detail)
  }, [detail?.order.id, detail?.order.order_type_id, detail?.order.location_id, loadReferences])

  const loadTasks = useCallback(async () => {
    if (!orderId) return
    try {
      const result = await api.get<{ items: TaskRow[] }>(`/tasks?order_id=${orderId}&status=all`)
      setTasks(result.items)
    } catch {
      setTasks([])
    }
  }, [orderId])

  useEffect(() => {
    void loadTasks()
    api.get<TaskEmployee[]>('/employees/short').then(setTaskEmployees).catch(() => setTaskEmployees([]))
  }, [loadTasks])

  const toggleTask = async (task: TaskRow) => {
    setError('')
    try {
      await api.post(`/tasks/${task.id}/${task.is_done ? 'reopen' : 'done'}`)
      await loadTasks()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось изменить задачу')
    }
  }

  const createTask = async (values: TaskFormValues) => {
    await api.post('/tasks', values)
    await loadTasks()
  }

  const run = async (action: () => Promise<unknown>, fallback: string): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      await action()
      await loadDetail()
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback)
      return false
    } finally {
      setSaving(false)
    }
  }

  const changeStatus = async (status: Status, commentText?: string) => {
    if (!detail) return
    await run(
      () => api.post(`/orders/${detail.order.id}/status`, { status_id: status.id, comment: commentText || null }),
      'Не удалось изменить статус',
    )
  }

  const selectStatus = (statusId: string) => {
    const status = statusGroups.flatMap((group) => group.statuses).find((item) => item.id === Number(statusId))
    if (!status) return
    const commentText = askStatusComment(status)
    if (commentText === null) return
    void changeStatus(status, commentText)
  }

  const isClosed = detail?.status.group === 'closed'
  // Себестоимость видна с правом просмотра закупочных цен, редактируется с правом orderPurchasePriceAccess
  const canSeeCost = can('purchasePriceAccess') || can('orderPurchasePriceAccess')

  const getFirstClosedStatus = () =>
    statusGroups.find((group) => group.group === 'closed')?.statuses[0]

  const askStatusComment = (status: Status): string | null => {
    if (status.comment_mode === 'none') return ''
    const commentText = prompt(status.comment_mode === 'required' ? 'Укажите обязательный комментарий' : 'Комментарий к смене статуса (необязательно)')
    if (commentText === null || status.comment_mode === 'required' && !commentText.trim()) return null
    return commentText
  }

  const openPayment = (mode: PaymentMode, forClosure = false) => {
    const available = cashRegisters.filter((register) => register.accepts_cash || register.accepts_bank)
    const defaultRegister = available.find((register) => register.accepts_cash) ?? available[0]
    setPaymentMode(mode)
    setCloseAfterPay(forClosure)
    setPaymentAmount(mode === 'payment' ? String(Math.max(0, Number(detail?.debt ?? 0))) : '')
    setPaymentRegisterId(defaultRegister ? String(defaultRegister.id) : '')
    setPaymentMethod(defaultRegister?.accepts_cash ? 'cash' : 'bank')
    setPaymentError('')
  }

  const giveOrder = () => {
    if (!detail) return
    const status = getFirstClosedStatus()
    if (!status) {
      setError('Не настроен статус выдачи заказа')
      return
    }
    const commentText = askStatusComment(status)
    if (commentText === null) return
    if (Number(detail.debt) > 0) {
      setPaymentAmount(String(detail.debt))
      setPaymentMode('payment')
      setCloseAfterPay(true)
      setCloseComment(commentText)
      const available = cashRegisters.filter((register) => register.accepts_cash || register.accepts_bank)
      const defaultRegister = available.find((register) => register.accepts_cash) ?? available[0]
      setPaymentRegisterId(defaultRegister ? String(defaultRegister.id) : '')
      setPaymentMethod(defaultRegister?.accepts_cash ? 'cash' : 'bank')
      setPaymentError('Для выдачи необходимо полностью оплатить заказ.')
      return
    }
    void changeStatus(status, commentText)
  }

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || !paymentMode) return
    const form = new FormData(event.currentTarget)
    const cashRegisterId = Number(form.get('cash_register_id'))
    const isBank = String(form.get('method')) === 'bank'
    const payload = {
      cash_register_id: cashRegisterId,
      amount: String(form.get('amount') ?? ''),
      is_bank: isBank,
      note: String(form.get('note') ?? '').trim() || null,
    }
    const mode = paymentMode
    const shouldClose = closeAfterPay
    setSaving(true)
    setPaymentError('')
    try {
      const result = await api.post<{ debt: string }>(`/orders/${detail.order.id}/${mode === 'payment' ? 'payments' : 'refunds'}`, payload)
      await loadDetail()
      if (shouldClose && mode === 'payment' && Number(result.debt) <= 0) {
        const status = getFirstClosedStatus()
        if (!status) throw new ApiError(400, 'business_error', 'Не настроен статус выдачи заказа')
        await api.post(`/orders/${detail.order.id}/status`, { status_id: status.id, comment: closeComment || null })
        await loadDetail()
        setPaymentMode(null)
        setCloseAfterPay(false)
      } else if (shouldClose && mode === 'payment') {
        setPaymentAmount(String(result.debt))
        setPaymentError('Оплатите оставшуюся сумму, чтобы выдать заказ.')
      } else {
        setPaymentMode(null)
      }
    } catch (e) {
      setPaymentError(e instanceof ApiError ? e.message : 'Не удалось выполнить операцию с оплатой')
    } finally {
      setSaving(false)
    }
  }

  const searchCatalog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail) return
    setError('')
    try {
      const result = await api.get<CatalogItem[]>(`/nomenclature/search?q=${encodeURIComponent(search)}&location_id=${detail.order.location_id}`)
      setSearchResults(result)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось найти номенклатуру')
    }
  }

  const addPosition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || !selectedItem) return
    // id = 0 — работа, вписанная вручную (без справочника)
    const manual = selectedItem.id === 0
    if (manual && !selectedItem.name.trim()) {
      setError('Укажите название работы')
      return
    }
    const base = manual
      ? { name: selectedItem.name.trim(), is_work: true, quantity, price: positionPrice }
      : {
          nomenclature_id: selectedItem.id,
          quantity,
          price: positionPrice,
          is_work: selectedItem.is_work,
          store_id: selectedItem.is_work ? null : Number(storeId),
        }
    // Пустая себестоимость — берётся из справочника / средней цены склада
    const payload = can('orderPurchasePriceAccess') && positionCost !== '' ? { ...base, purchase_price: positionCost } : base
    const success = await run(
      () => api.post(`/orders/${detail.order.id}/positions`, payload),
      'Не удалось добавить позицию',
    )
    if (!success) return
    setSelectedItem(null)
    setSearchResults([])
    setSearch('')
    setPositionCost('')
  }

  const saveDiscount = async () => {
    if (!detail || !discountValue) return
    const payload = discountKind === 'percent'
      ? { discount_percent: discountValue }
      : { discount_sum: discountValue }
    await run(
      () => api.put(`/orders/${detail.order.id}/discount`, payload),
      'Не удалось сохранить скидку',
    )
  }

  const sendComment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || !comment.trim()) return
    if (await run(() => api.post(`/orders/${detail.order.id}/comments`, { text: comment.trim() }), 'Не удалось добавить комментарий')) {
      setComment('')
    }
  }

  const editPositionPrice = async (position: Position, price: string) => {
    if (!detail) return
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, { price }),
      'Не удалось обновить цену позиции',
    )
  }

  const editPositionCost = async (position: Position, purchasePrice: string) => {
    if (!detail) return
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, { purchase_price: purchasePrice || '0' }),
      'Не удалось обновить себестоимость',
    )
  }

  const printReceipt = async () => {
    if (!detail) return
    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      setError('Разрешите всплывающие окна для печати квитанции')
      return
    }
    try {
      const html = await api.getHtml(`/orders/${detail.order.id}/print/receipt`)
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      printWindow.focus()
      printWindow.setTimeout(() => printWindow.print(), 100)
    } catch (err) {
      printWindow.close()
      setError(err instanceof ApiError ? err.message : 'Не удалось открыть квитанцию')
    }
  }

  const removePosition = async (position: Position) => {
    if (!detail || !confirm(`Удалить «${position.name}» из заказа?`)) return
    await run(() => api.del(`/orders/${detail.order.id}/positions/${position.id}`), 'Не удалось удалить позицию')
  }

  if (loading) return <p className="text-muted">Загрузка заказа…</p>
  if (!detail) {
    return <section>{error && <p role="alert" className="text-danger">{error}</p>}<Link className="text-accent" to="/orders">← К списку заказов</Link></section>
  }

  const activeRegisters = cashRegisters.filter((register) => register.accepts_cash || register.accepts_bank)
  const selectedRegister = activeRegisters.find((register) => String(register.id) === paymentRegisterId)

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link className="text-muted hover:text-ink" to="/orders">← Заказы</Link>
          <h1 className="text-xl font-semibold">{detail.order.number}</h1>
          <select
            aria-label="Статус заказа"
            className="rounded-full border border-line bg-surface px-3 py-1.5"
            style={{ color: detail.status.color }}
            value={detail.status.id}
            onChange={(event) => selectStatus(event.target.value)}
          >
            {statusGroups.map((group) => (
              <optgroup key={group.group} label={group.title}>
                {group.statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <span className="flex gap-2">
          <button className="rounded-md border border-line bg-surface px-3 py-2" onClick={printReceipt}>Печать</button>
          {detail.status.group !== 'closed' && <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={giveOrder}>Выдать</button>}
        </span>
      </header>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <nav className="mb-3 flex gap-1 border-b border-line">
            <button className={`border-b-2 px-3 py-2 ${tab === 'info' ? 'border-accent font-medium' : 'border-transparent text-muted'}`} onClick={() => setTab('info')}>Информация</button>
            <button className={`border-b-2 px-3 py-2 ${tab === 'positions' ? 'border-accent font-medium' : 'border-transparent text-muted'}`} onClick={() => setTab('positions')}>Работы и материалы</button>
          </nav>
          {tab === 'info' ? (
            <section className="rounded-xl border border-line bg-surface p-4">
              <header className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold">Информация о заказе</h2>
                {can('changeOrderInfoAccess') && <button className="text-sm text-accent" onClick={() => setEditingInfo(true)}>Изменить</button>}
              </header>
              <div className="grid gap-4 sm:grid-cols-2">
                <Info label="Клиент" value={detail.counteragent.name} />
                <Info label="Телефоны" value={formatPhone(detail.counteragent.phones) || '—'} />
                <Info label="Тип заказа" value={detail.order_type.name} />
                <Info label="Статус" value={detail.status.name} />
                {fields.filter((field) => field.is_visible && field.key !== 'name' && field.key !== 'phones').map((field) => (
                  <Info key={field.id} label={field.label} value={displayValue(field, detail, masters, managers)} />
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-line bg-surface p-4">
              <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">Работы и материалы</h2>
                <strong className="num">{formatMoney(detail.order.total_price)}</strong>
              </header>
              {detail.positions.length === 0 ? (
                <p className="mb-4 text-sm text-muted">Позиций пока нет. Добавьте работу или материал через поиск ниже.</p>
              ) : (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full min-w-[740px] text-left text-sm">
                    <thead className="bg-canvas text-muted"><tr>{['Позиция', 'Тип', 'Количество', 'Цена', ...(canSeeCost ? ['Себестоимость'] : []), 'Итого', ...(can('marginPriceAccess') ? ['Прибыль'] : []), ''].map((item) => <th key={item} className="px-2 py-2 font-medium">{item}</th>)}</tr></thead>
                    <tbody>
                      {detail.positions.map((position) => (
                        <PositionRow
                          key={position.id}
                          position={position}
                          canEdit={can('changeOrderPositionAccess') && !isClosed}
                          canViewMargin={can('marginPriceAccess')}
                          canViewCost={canSeeCost}
                          canEditCost={can('changeOrderPositionAccess') && can('orderPurchasePriceAccess') && !isClosed}
                          onSavePrice={(price) => void editPositionPrice(position, price)}
                          onSaveCost={(cost) => void editPositionCost(position, cost)}
                          onDelete={() => void removePosition(position)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {can('changeOrderPositionAccess') && !isClosed && (
                <div className="mb-5 rounded-lg border border-line p-3">
                  <form onSubmit={(event) => void searchCatalog(event)} className="flex gap-2">
                    <input className={`${inputClass} min-w-0 flex-1`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти товар или работу" />
                    <button className="rounded-md border border-line px-3 py-2">Найти</button>
                    <button
                      type="button"
                      className="rounded-md border border-line px-3 py-2 whitespace-nowrap"
                      onClick={() => {
                        setSelectedItem({ id: 0, name: search.trim(), is_work: true })
                        setPositionPrice('')
                        setPositionCost('')
                        setQuantity('1')
                        setSearchResults([])
                      }}
                    >
                      Работа вручную
                    </button>
                  </form>
                  {searchResults.length > 0 && (
                    <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                      {searchResults.map((item) => (
                        <li key={item.id}>
                          <button className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-canvas" onClick={() => {
                            setSelectedItem(item)
                            setPositionPrice(item.prices?.[0]?.price ?? '0')
                            setPositionCost('')
                            setSearchResults([])
                          }}>
                            <span>{item.name}<small className="ml-2 text-muted">{item.article}</small></span>
                            <span className="text-xs text-muted">{item.is_work ? 'Работа' : 'Материал'}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selectedItem && (
                    <form onSubmit={(event) => void addPosition(event)} className="mt-3 grid gap-2 sm:grid-cols-4">
                      {selectedItem.id === 0 ? (
                        <label className="grid gap-1 text-xs text-muted sm:col-span-4">Название работы
                          <input className={inputClass} required autoFocus value={selectedItem.name} onChange={(event) => setSelectedItem({ ...selectedItem, name: event.target.value })} placeholder="Например, замена дисплея" />
                        </label>
                      ) : (
                        <div className="font-medium sm:col-span-4">{selectedItem.name}</div>
                      )}
                      <label className="grid gap-1 text-xs text-muted">Количество<input className={inputClass} type="number" min="0.001" step="0.001" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
                      <label className="grid gap-1 text-xs text-muted">Цена<input className={inputClass} type="number" min="0" step="1" required value={positionPrice} onChange={(event) => setPositionPrice(event.target.value)} /></label>
                      {can('orderPurchasePriceAccess') && (
                        <label className="grid gap-1 text-xs text-muted">Себестоимость
                          <input className={inputClass} type="number" min="0" step="1" value={positionCost} onChange={(event) => setPositionCost(event.target.value)} placeholder={selectedItem.id === 0 ? '0' : 'Из справочника'} />
                        </label>
                      )}
                      {!selectedItem.is_work && (
                        <label className="grid gap-1 text-xs text-muted">Склад
                          <select className={inputClass} required value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                            <option value="">Выберите склад</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                          </select>
                        </label>
                      )}
                      <div className="flex items-end gap-2 sm:col-span-4">
                        <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">Добавить</button>
                        <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setSelectedItem(null)}>Отмена</button>
                      </div>
                    </form>
                  )}
                </div>
              )}
              <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                <div className="text-sm text-muted">Оплачено <strong className="ml-2 text-ink num">{formatMoney(detail.order.paid)}</strong></div>
                <div className="text-sm text-muted">Долг <strong className="ml-2 text-ink num">{formatMoney(detail.debt)}</strong></div>
                {can('discountSaleAccess') && !isClosed && (
                  <div className="flex items-end gap-2 sm:col-span-2">
                    <label className="grid gap-1 text-xs text-muted">Скидка
                      <select className={inputClass} value={discountKind} onChange={(event) => setDiscountKind(event.target.value as 'percent' | 'sum')}>
                        <option value="percent">Процент</option><option value="sum">Сумма</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-xs text-muted">{discountKind === 'percent' ? 'Скидка, %' : 'Скидка, ₽'}
                      <input className={inputClass} type="number" min="0" step="1" value={discountValue} onChange={(event) => setDiscountValue(event.target.value)} />
                    </label>
                    <button disabled={saving} className="rounded-md border border-line px-3 py-2" onClick={() => void saveDiscount()}>Применить</button>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-4">
            <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Оплаты</h2><strong className="num">{formatMoney(detail.order.paid)}</strong></header>
            <p className="mb-3 text-sm text-muted">Долг: <strong className="text-ink num">{formatMoney(detail.debt)}</strong></p>
            <div className="flex flex-wrap gap-2">
              {can('operationCashRegisterAccess') && <button className="rounded-md bg-accent px-3 py-2 text-sm text-accent-ink" onClick={() => openPayment('payment')}>Принять оплату</button>}
              {can('returnOrderProductAccess') && <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => openPayment('refund')}>Возврат</button>}
            </div>
            {detail.transactions.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {detail.transactions.map((transaction) => (
                  <li key={transaction.id} className={`py-2 text-sm ${transaction.cash_item_type === 'bankPercent' ? 'text-muted' : ''}`}>
                    <div className="flex justify-between gap-2">
                      <span>{transaction.cash_item_type === 'bankPercent' ? 'Комиссия банка' : `${transaction.is_income ? 'Оплата' : 'Возврат'}, ${transaction.is_bank ? 'безнал' : 'наличные'}`}</span>
                      <strong className={`num ${transaction.is_income ? '' : 'text-danger'}`}>{transaction.is_income ? '' : '−'}{formatMoney(transaction.amount)}</strong>
                    </div>
                    <small className="text-muted">{formatDate(transaction.date)} · {transaction.cash_register_name}{transaction.note ? ` · ${transaction.note}` : ''}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-4">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Задачи</h2>
              {can('createTaskAccess') && <button className="text-sm text-accent" onClick={() => setTaskCreating(true)}>+ Задача</button>}
            </header>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted">Задач по заказу нет.</p>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-2 py-2 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={task.is_done} onChange={() => void toggleTask(task)} aria-label="Выполнено" />
                    <span className={task.is_done ? 'text-muted line-through' : ''}>
                      {task.title}
                      {task.assignee_name && <small className="block text-muted">{task.assignee_name}</small>}
                      {task.deadline && <small className="block text-muted">{formatDate(task.deadline)}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-3 font-semibold">История</h2>
            <form onSubmit={(event) => void sendComment(event)} className="mb-3 grid gap-2">
              <textarea className={inputClass} rows={2} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий к заказу" />
              <button disabled={saving || !comment.trim()} className="justify-self-end rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">Добавить</button>
            </form>
            {detail.history.length === 0 ? (
              <p className="text-sm text-muted">История пока пуста.</p>
            ) : (
              <ol className="space-y-3">
                {detail.history.map((item) => (
                  <li key={item.id} className="border-l-2 border-line pl-3">
                    <p className="font-medium">{item.title}</p>
                    {item.status && <p className="text-sm" style={{ color: item.status.color }}>{item.status.name}</p>}
                    {item.text && <p className="whitespace-pre-wrap text-sm">{item.text}</p>}
                    <small className="text-muted">{item.employee_name ?? 'Система'} · {formatDate(item.created_at)}</small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </div>

      {taskCreating && (
        <TaskForm employees={taskEmployees} orderId={Number(orderId)} onSave={createTask} onClose={() => setTaskCreating(false)} />
      )}
      {editingInfo && (
        <OrderInfoEditor
          detail={detail}
          fields={fields}
          masters={masters}
          managers={managers}
          saving={saving}
          onClose={() => setEditingInfo(false)}
          onSave={async (payload) => {
            if (await run(() => api.put(`/orders/${detail.order.id}`, payload), 'Не удалось сохранить информацию')) {
              setEditingInfo(false)
            }
          }}
        />
      )}
      {paymentMode && (
        <Modal title={paymentMode === 'payment' ? closeAfterPay ? 'Оплата для выдачи' : 'Принять оплату' : 'Возврат'} onClose={() => { setPaymentMode(null); setCloseAfterPay(false) }}>
          <form onSubmit={(event) => void submitPayment(event)} className="grid gap-3">
            {activeRegisters.length === 0 ? (
              <p className="text-muted">Нет доступных касс для операции.</p>
            ) : (
              <>
                <label className="grid gap-1 text-sm text-muted">Касса
                  <select
                    className={inputClass}
                    name="cash_register_id"
                    value={paymentRegisterId}
                    onChange={(event) => {
                      const register = activeRegisters.find((item) => String(item.id) === event.target.value)
                      setPaymentRegisterId(event.target.value)
                      if (register && !register.accepts_cash && paymentMethod === 'cash') setPaymentMethod('bank')
                      if (register && !register.accepts_bank && paymentMethod === 'bank') setPaymentMethod('cash')
                    }}
                    required
                  >
                    {activeRegisters.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-muted">Сумма, ₽
                  <input className={inputClass} name="amount" type="number" min="0.01" step="1" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm text-muted">Способ
                  <select className={inputClass} name="method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'cash' | 'bank')}>
                    {selectedRegister?.accepts_cash && <option value="cash">Наличные</option>}
                    {selectedRegister?.accepts_bank && <option value="bank">Безналичные</option>}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-muted">Примечание<input className={inputClass} name="note" /></label>
              </>
            )}
            {paymentError && <p role="alert" className="text-sm text-danger">{paymentError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => { setPaymentMode(null); setCloseAfterPay(false) }}>Отмена</button>
              {activeRegisters.length > 0 && <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Обработка…' : paymentMode === 'payment' ? 'Оплатить' : 'Вернуть'}</button>}
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-sm text-muted">{label}</dt><dd className="mt-1 whitespace-pre-wrap">{value}</dd></div>
}

function PositionRow({
  position,
  canEdit,
  canViewMargin,
  canViewCost,
  canEditCost,
  onSavePrice,
  onSaveCost,
  onDelete,
}: {
  position: Position
  canEdit: boolean
  canViewMargin: boolean
  canViewCost: boolean
  canEditCost: boolean
  onSavePrice: (price: string) => void
  onSaveCost: (cost: string) => void
  onDelete: () => void
}) {
  const [price, setPrice] = useState(position.price)
  useEffect(() => setPrice(position.price), [position.price])
  const [cost, setCost] = useState(position.purchase_price ?? '')
  useEffect(() => setCost(position.purchase_price ?? ''), [position.purchase_price])
  return (
    <tr className="border-t border-line">
      <td className="px-2 py-2">{position.name}</td>
      <td className="px-2 py-2">{position.is_work ? 'Работа' : 'Материал'}</td>
      <td className="px-2 py-2 num">{Number(position.quantity).toLocaleString('ru-RU')}</td>
      <td className="px-2 py-2">{canEdit ? <input className={`${inputClass} w-28 text-right num`} type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} onBlur={() => { if (price !== position.price) onSavePrice(price) }} /> : <span className="num">{formatMoney(position.sold_price)}</span>}</td>
      {canViewCost && (
        <td className="px-2 py-2">{canEditCost
          ? <input className={`${inputClass} w-28 text-right num`} type="number" min="0" step="1" value={cost} title="Себестоимость за единицу" onChange={(event) => setCost(event.target.value)} onBlur={() => { if (cost !== (position.purchase_price ?? '')) onSaveCost(cost) }} />
          : <span className="num">{position.purchase_price === null ? '—' : formatMoney(position.purchase_price)}</span>}</td>
      )}
      <td className="px-2 py-2 num">{formatMoney(position.total)}</td>
      {canViewMargin && <td className="px-2 py-2 num">{position.margin === null ? '—' : formatMoney(position.margin)}</td>}
      <td className="px-2 py-2">{canEdit && <button className="text-danger" onClick={onDelete}>Удалить</button>}</td>
    </tr>
  )
}

function OrderInfoEditor({
  detail,
  fields,
  masters,
  managers,
  saving,
  onClose,
  onSave,
}: {
  detail: OrderDetail
  fields: FormField[]
  masters: Employee[]
  managers: Employee[]
  saving: boolean
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const [values, setValues] = useState<OrderFieldValues>(() =>
    Object.fromEntries(fields.map((field) => {
      const raw = fieldValue(field, detail)
      return [field.key, field.data_type === 'dateTime' ? isoToLocalInput(raw as string | null) : raw]
    })),
  )
  const [error, setError] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const payload: Record<string, unknown> = {}
    const customFields = { ...(detail.order.custom_fields as Record<string, unknown> | undefined) }
    for (const field of fields) {
      if (field.key === 'name' || field.key === 'phones') continue
      const key = aliasMap[field.key] ?? field.key
      let value = values[field.key]
      if (field.data_type === 'multiple' && typeof value === 'string') value = value.split(',').map((item) => item.trim()).filter(Boolean)
      if (['master_id', 'manager_id', 'how_know_id'].includes(key)) value = value ? Number(value) : null
      if (field.data_type === 'dateTime') value = localInputToIso(value as string | null)
      if (key.startsWith('custom_') || !(key in aliasMap) && !['brand', 'model', 'color', 'appearance'].includes(field.key)) {
        customFields[field.key] = value
      } else {
        payload[key] = value
      }
    }
    payload.custom_fields = customFields
    setError('')
    try {
      await onSave(payload)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить изменения')
    }
  }
  return (
    <Modal title="Изменить информацию о заказе" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid max-h-[75vh] gap-3 overflow-y-auto sm:grid-cols-2">
        {fields.filter((field) => field.is_visible).map((field) => {
          const value = values[field.key]
          const staticField = field.key === 'name' || field.key === 'phones'
          const selectOptions = field.key === 'master' ? masters : field.key === 'manager' ? managers : []
          return (
            <label key={field.id} className="grid gap-1 text-sm text-muted">
              {field.label}
              {field.key === 'master' || field.key === 'manager' ? (
                <select className={inputClass} disabled={staticField} value={String(value ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>
                  <option value="">Не назначен</option>{selectOptions.map((person) => <option key={person.id} value={person.id}>{person.short_name}</option>)}
                </select>
              ) : field.data_type === 'boolean' ? (
                <input type="checkbox" checked={Boolean(value)} disabled={staticField} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.checked }))} />
              ) : field.data_type === 'multiple' ? (
                <input className={inputClass} value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} disabled={staticField} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
              ) : field.data_type === 'text' ? (
                <textarea className={inputClass} rows={2} value={String(value ?? '')} disabled={staticField} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
              ) : (
                <input
                  className={inputClass}
                  type={field.key === 'phones' ? 'tel' : field.data_type === 'date' ? 'date' : field.data_type === 'dateTime' ? 'datetime-local' : field.data_type === 'number' || field.data_type === 'money' ? 'number' : 'text'}
                  value={String(value ?? '')}
                  disabled={staticField}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              )}
              {staticField && <small>Данные клиента редактируются в карточке контрагента.</small>}
            </label>
          )
        })}
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  )
}
