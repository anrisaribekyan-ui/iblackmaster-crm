import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { formatPhone, isoToLocalInput, localInputToIso } from '../format'
import { useAuth } from '../auth'
import Modal from '../components/Modal'
import { btn, ListSkeleton } from '../components/ui'
import TaskForm, { type TaskEmployee, type TaskFormValues } from '../components/TaskForm'
import { openPrint } from '../print'
import { actHtml, checklistHtml as checkSheetHtml, FORMS_STYLE, labelHtml, LABEL_STYLE, receiptHtml, refusalHtml, saleCheckHtml, warrantyHtml, type FormData } from '../printForms'
import OrderSms from '../components/OrderSms'
import OrderPhotos from '../components/OrderPhotos'
import OrderChecklistCard, { type Signatures } from '../components/OrderChecklistCard'
import type { ChecklistValues } from '../components/Checklist'
import { DevicePasswordInput, parsePattern, PatternView } from '../components/PatternLock'
import StatusBadge, { SmsTicks, statusColors, type SmsMark } from '../components/StatusBadge'
import OrderParts from '../components/OrderParts'
import PartOrderModal, { partQuery } from '../components/PartOrder'
import Copyable from '../components/Copyable'
import HeaderMenu from '../components/HeaderMenu'

type Status = { id: number; group: string; name: string; color: string; pay_required: boolean; comment_mode: string; sms?: SmsMark }
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
  salary_percent?: string | null
  performer_id?: number | null
  performer_name?: string | null
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
    is_deleted?: boolean
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
type CatalogItem = { id: number; name: string; article?: string | null; prices?: { price: string }[]; is_work: boolean; guarantee_days?: number }
type PaymentMode = 'payment' | 'refund' | 'tip'
type TaskRow = { id: number; title: string; text: string | null; assignee_name: string | null; deadline: string | null; is_done: boolean }
type LocationInfo = { id: number; name: string; address: string | null; phones: string | null }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'
// Поле в строке позиции: компактное, рамка проявляется при наведении — таблица читается как таблица, а не как форма
const cellInput = 'cell-input h-8 rounded-md border px-2 text-right text-sm num'
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

function displayValue(field: FormField, detail: OrderDetail, masters: Employee[], managers: Employee[], howKnows: { id: number; name: string }[] = []) {
  const value = fieldValue(field, detail)
  if (field.key === 'howKnow') return value ? howKnows.find((item) => item.id === Number(value))?.name ?? '—' : '—'
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
  const { can, me } = useAuth()
  const [partOpen, setPartOpen] = useState(false)
  const [partsVersion, setPartsVersion] = useState(0)
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [fields, setFields] = useState<FormField[]>([])
  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([])
  const [cashRegisters, setCashRegisters] = useState<CashRegister[]>([])
  const [stores, setStores] = useState<Store[]>([])
  const [masters, setMasters] = useState<Employee[]>([])
  const [staff, setStaff] = useState<Employee[]>([])
  const [howKnows, setHowKnows] = useState<{ id: number; name: string }[]>([])
  const [deleting, setDeleting] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  useEffect(() => {
    api.get<{ id: number; name: string }[]>('/how-knows').then(setHowKnows).catch(() => setHowKnows([]))
  }, [])
  const [managers, setManagers] = useState<Employee[]>([])
  // Как в LiveSklad: заказ открывается на работах и материалах, информация — по вкладке
  const [tab, setTab] = useState<'info' | 'positions'>('positions')
  const [infoVersion, setInfoVersion] = useState(0)
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null)
  const [switching, setSwitching] = useState<Transaction | null>(null)
  const [switchBank, setSwitchBank] = useState(false)
  const [switchRegister, setSwitchRegister] = useState('')
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
  const [positionGuarantee, setPositionGuarantee] = useState('90')
  const [openPositionId, setOpenPositionId] = useState<number | null>(null)
  const [storeId, setStoreId] = useState('')
  const [discountKind, setDiscountKind] = useState<'percent' | 'sum'>('percent')
  const [discountValue, setDiscountValue] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [taskEmployees, setTaskEmployees] = useState<TaskEmployee[]>([])
  const [taskCreating, setTaskCreating] = useState(false)
  const [locations, setLocations] = useState<LocationInfo[]>([])
  const [trackQr, setTrackQr] = useState('')
  const [signatures, setSignatures] = useState<Signatures>({})

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
      api.get<Employee[]>(`/employees/short`).then(setStaff).catch(() => setStaff(masterData))
      setManagers(managerData)
      api.get<LocationInfo[]>('/locations').then(setLocations).catch(() => setLocations([]))
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

  const deleteOrder = async () => {
    if (!detail) return
    if (await run(() => api.del(`/orders/${detail.order.id}`, { reason: deleteReason.trim() || null }), 'Не удалось удалить заказ')) {
      setDeleting(false)
      setDeleteReason('')
    }
  }

  const restoreOrder = async () => {
    if (!detail) return
    await run(() => api.post(`/orders/${detail.order.id}/restore`), 'Не удалось восстановить заказ')
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

  // Выданный или удалённый заказ не редактируется
  const isClosed = detail?.status.group === 'closed' || Boolean(detail?.order.is_deleted)
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

  const [prepayMode, setPrepayMode] = useState(false)

  const openPayment = (mode: PaymentMode, forClosure = false, prepay = false) => {
    setPrepayMode(prepay)
    const available = cashRegisters.filter((register) => register.accepts_cash || register.accepts_bank)
    const defaultRegister = available.find((register) => register.accepts_cash) ?? available[0]
    setPaymentMode(mode)
    setCloseAfterPay(forClosure)
    setPaymentAmount(mode === 'payment' && !prepay ? String(Math.max(0, Math.round(Number(detail?.debt ?? 0)))) : '')
    setPaymentRegisterId(defaultRegister ? String(defaultRegister.id) : '')
    setPaymentMethod(defaultRegister?.accepts_cash ? 'cash' : 'bank')
    setPaymentError('')
  }

  const openSwitch = (transaction: Transaction) => {
    const target = !transaction.is_bank
    const same = cashRegisters.find((register) => register.id === transaction.cash_register_id)
    const fits = (register: CashRegister) => (target ? register.accepts_bank : register.accepts_cash)
    const pick = same && fits(same) ? same : cashRegisters.find(fits)
    setSwitchBank(target)
    setSwitchRegister(pick ? String(pick.id) : '')
    setPaymentError('')
    setSwitching(transaction)
  }

  const submitSwitch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || !switching) return
    setSaving(true)
    setPaymentError('')
    try {
      await api.post(`/orders/${detail.order.id}/payments/${switching.id}/change-method`, {
        is_bank: switchBank,
        cash_register_id: Number(switchRegister),
      })
      setSwitching(null)
      await loadDetail()
    } catch (e) {
      setPaymentError(e instanceof ApiError ? e.message : 'Не удалось сменить способ оплаты')
    } finally {
      setSaving(false)
    }
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
      setPrepayMode(false)
      setPaymentAmount(String(Math.round(Number(detail.debt))))
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
      is_prepayment: prepayMode,
    }
    const mode = paymentMode
    const shouldClose = closeAfterPay
    setSaving(true)
    setPaymentError('')
    try {
      const result = await api.post<{ debt: string }>(`/orders/${detail.order.id}/${mode === 'payment' ? 'payments' : mode === 'tip' ? 'tips' : 'refunds'}`, payload)
      await loadDetail()
      if (shouldClose && mode === 'payment' && Number(result.debt) <= 0) {
        const status = getFirstClosedStatus()
        if (!status) throw new ApiError(400, 'business_error', 'Не настроен статус выдачи заказа')
        await api.post(`/orders/${detail.order.id}/status`, { status_id: status.id, comment: closeComment || null })
        await loadDetail()
        setPaymentMode(null)
        setCloseAfterPay(false)
      } else if (shouldClose && mode === 'payment') {
        setPaymentAmount(String(Math.round(Number(result.debt))))
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
    const withCost = can('orderPurchasePriceAccess') && positionCost !== '' ? { ...base, purchase_price: positionCost } : base
    const payload = { ...withCost, guarantee_days: Number(positionGuarantee === '' ? 0 : positionGuarantee) }
    const success = await run(
      () => api.post(`/orders/${detail.order.id}/positions`, payload),
      'Не удалось добавить позицию',
    )
    if (!success) return
    setSelectedItem(null)
    setSearchResults([])
    setSearch('')
    setPositionCost('')
    setPositionGuarantee('90')
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

  const savePositionDetails = async (position: Position, payload: Record<string, string | number>) => {
    if (!detail) return false
    return run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, payload),
      'Не удалось сохранить позицию',
    )
  }

  const editPositionDiscount = async (position: Position, discount: string) => {
    if (!detail) return
    const qty = Number(position.quantity) || 1
    const sold = Math.max(0, Math.round(Number(position.price) - Number(discount || 0) / qty))
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, { sold_price: String(sold) }),
      'Не удалось применить скидку',
    )
  }

  const editPositionGuarantee = async (position: Position, days: string) => {
    if (!detail) return
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, { guarantee_days: Number(days || 0) }),
      'Не удалось обновить гарантию',
    )
  }

  const editPositionPerformer = async (position: Position, performerId: string) => {
    if (!detail || !performerId) return
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}/performer`, { performer_id: Number(performerId) }),
      'Не удалось сменить исполнителя',
    )
  }
  const editPositionSalary = async (position: Position, percent: string) => {
    if (!detail) return
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, percent.trim() === '' ? { reset_salary_percent: true } : { salary_percent: percent.replace(',', '.') }),
      'Не удалось изменить процент зарплаты',
    )
  }
  const editPositionCost = async (position: Position, purchasePrice: string) => {
    if (!detail) return
    await run(
      () => api.put(`/orders/${detail.order.id}/positions/${position.id}`, { purchase_price: purchasePrice || '0' }),
      'Не удалось обновить себестоимость',
    )
  }

  // QR для квитанции готовим заранее: окно печати должно открыться сразу по клику, иначе браузер его заблокирует
  const detailOrderId = detail?.order.id
  useEffect(() => {
    if (!detailOrderId) return
    let cancelled = false
    api.get<{ code: string }>(`/orders/${detailOrderId}/tracking`)
      .then(async ({ code }) => (await import('qrcode')).default.toString(`${window.location.origin}/track/${code}`, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }))
      .then((svg) => { if (!cancelled) setTrackQr(svg) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [detailOrderId])

  const currentLocation = locations.find((location) => location.id === detail?.order.location_id)
  const orderFields = (detail?.order ?? {}) as Record<string, unknown>
  const str = (value: unknown): string => (value == null ? '' : String(value))

  const buildFormData = (): FormData | null => {
    if (!detail) return null
    const list = (value: unknown) => (Array.isArray(value) ? (value as string[]).join(', ') : '')
    const day = (value: unknown) => String(value ?? '').slice(0, 10).split('-').reverse().join('.')
    const paid = Number(detail.order.paid)
    return {
      number: detail.order.number,
      date: day(orderFields.created_at),
      shop: { name: currentLocation?.name ?? '', address: currentLocation?.address ?? '', phones: currentLocation?.phones ?? '' },
      customer: { name: detail.counteragent.name, phones: detail.counteragent.phones ?? '' },
      master: detail.master?.short_name ?? '',
      manager: detail.manager?.short_name ?? '',
      device: [orderFields.device_type, orderFields.brand, orderFields.model, orderFields.color].filter(Boolean).join(' '),
      serial: str(orderFields.serial),
      look: list(orderFields.appearance),
      completeSet: list(orderFields.complete_set),
      problems: list(orderFields.problems),
      note: str(orderFields.note),
      approximatePrice: str(orderFields.approximate_price),
      verdict: str((detail.order as unknown as { verdict?: string | null }).verdict),
      prepaid: paid > 0 ? formatMoney(paid) : 'Нет',
      ready: orderFields.deadline ? day(orderFields.deadline) : '',
      positions: detail.positions.map((position) => ({
        name: position.name,
        quantity: position.quantity,
        price: position.sold_price,
        total: position.total,
        guaranteeDays: position.guarantee_days,
      })),
      total: detail.order.total_price,
      paid: detail.order.paid,
      discount: detail.order.discount_sum,
      trackQr,
      checkIn: (orderFields.check_in ?? {}) as ChecklistValues,
      checkOut: (orderFields.check_out ?? {}) as ChecklistValues,
      signatureIn: signatures.in,
      signatureOut: signatures.out,
    }
  }

  const printForm = (kind: 'receipt' | 'checklist' | 'act' | 'refusal' | 'warranty' | 'check' | 'label') => {
    const data = buildFormData()
    if (!data) return
    const forms = {
      receipt: { title: 'Квитанция', html: (d: FormData) => receiptHtml(d) },
      checklist: { title: 'Проверка неисправностей', html: checkSheetHtml },
      act: { title: 'Акт', html: actHtml },
      refusal: { title: 'Отказной лист', html: refusalHtml },
      warranty: { title: 'Гарантийный талон', html: warrantyHtml },
      check: { title: 'Товарный чек', html: saleCheckHtml },
      label: { title: 'Бирка', html: labelHtml },
    }
    openPrint(`${forms[kind].title} ${data.number}`, forms[kind].html(data), kind === 'label' ? LABEL_STYLE : FORMS_STYLE)
  }

  const removePosition = async (position: Position) => {
    if (!detail || !confirm(`Удалить «${position.name}» из заказа?`)) return
    await run(() => api.del(`/orders/${detail.order.id}/positions/${position.id}`), 'Не удалось удалить позицию')
  }

  if (loading) return (
    <section role="status" aria-label="Загрузка заказа">
      <div className="mb-4 h-[156px] rounded-2xl bg-rail" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <ListSkeleton rows={5} rowHeight={48} />
        <div className="hidden h-64 rounded-xl border border-line bg-surface xl:block" />
      </div>
    </section>
  )
  if (!detail) {
    return <section>{error && <p role="alert" className="text-danger">{error}</p>}<Link className="text-accent" to="/orders">← К списку заказов</Link></section>
  }

  const activeRegisters = cashRegisters.filter((register) => register.accepts_cash || register.accepts_bank)
  const selectedRegister = activeRegisters.find((register) => String(register.id) === paymentRegisterId)

  const isDeleted = Boolean(detail.order.is_deleted)
  const deletedEvent = isDeleted ? [...detail.history].reverse().find((item) => item.title === 'Заказ удалён') : undefined

  return (
    <section>
      {/* Шапка заказа — как бирка, которую вешают на аппарат: номер крупно, что за устройство, чьё и сколько должны */}
      <header className="mb-4 overflow-hidden rounded-2xl bg-rail text-white">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 sm:px-5">
          <Link className="text-sm text-white/50 transition-colors hover:text-white" to="/orders">← Заказы</Link>
          <span className="flex flex-wrap justify-end gap-1.5">
            <HeaderMenu label="Печать">{(close) => (<>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('receipt') }}>Квитанция о приёме</button>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('checklist') }}>Проверка неисправностей</button>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('act') }}>Акт выдачи</button>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('refusal') }}>Отказной лист</button>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('warranty') }}>Гарантийный талон</button>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('check') }}>Товарный чек</button>
                <button role="menuitem" className="rounded-md px-3 py-2 text-left hover:bg-canvas" onClick={() => { close(); printForm('label') }}>Бирка на аппарат</button>
            </>)}</HeaderMenu>
            {!isDeleted && locations.length > 1 && (
              <select
                aria-label="Передать в локацию"
                title="Передать в другую локацию"
                className="max-w-[10.5rem] truncate rounded-lg bg-transparent px-2 py-1.5 text-sm text-white/80 hover:bg-white/10"
                value={detail.order.location_id}
                onChange={(event) => {
                  const target = locations.find((location) => location.id === Number(event.target.value))
                  if (target && confirm(`Передать заказ в «${target.name}»?`)) {
                    void run(() => api.put(`/orders/${detail.order.id}`, { location_id: target.id }), 'Не удалось передать заказ')
                  }
                }}
              >
                {locations.map((location) => <option key={location.id} value={location.id} className="text-ink">{location.name.replace(/^iBlackMaster \((.*)\)$/, '$1')}</option>)}
              </select>
            )}
            {!isDeleted && (
              <HeaderMenu label="Новый заказ" width={272}>{(close) => (<>
                  <Link onClick={close} className="rounded-md px-3 py-2 hover:bg-canvas" to={`/orders/new?repeat=${detail.order.id}`}>Повторить заказ<small className="block text-muted">Тот же клиент и устройство</small></Link>
                  <Link onClick={close} className="rounded-md px-3 py-2 hover:bg-canvas" to={`/orders/new?client=${detail.counteragent.id}`}>Принять ещё от клиента<small className="block text-muted">Устройство вводится заново</small></Link>
              </>)}</HeaderMenu>
            )}
            {!isDeleted && can('deleteOrderAccess') && (
              <button className="rounded-lg px-3 py-1.5 text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-[#ff8a72]" onClick={() => setDeleting(true)}>Удалить</button>
            )}
          </span>
        </div>
        <div className="grid gap-4 px-4 pb-4 pt-2 sm:px-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className={`num text-[32px] font-bold leading-none tracking-tight ${isDeleted ? 'text-white/40 line-through decoration-[#ff8a72] decoration-2' : ''}`}>{detail.order.number}</h1>
              <span className="relative inline-flex items-center">
                <span className="pointer-events-none absolute left-3 h-2 w-2 rounded-full" style={{ backgroundColor: statusColors(detail.status.color).dot }} aria-hidden />
                <select
                  aria-label="Статус заказа"
                  className="dark-select w-auto rounded-full border-0 bg-white/10 py-1.5 pl-7 pr-8 font-medium text-white"
                  value={detail.status.id}
                  onChange={(event) => selectStatus(event.target.value)}
                  disabled={isDeleted}
                >
                  {statusGroups.map((group) => (
                    <optgroup key={group.group} label={group.title}>
                      {group.statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </span>
              <SmsTicks state={detail.status.sms} onDark />
            </div>
            <p className="mt-2 break-words text-lg text-white/90">{[str(detail.order.brand), str(detail.order.model)].filter(Boolean).join(' ') || str(detail.order.device_type) || 'Устройство не указано'}</p>
            <p className="break-words text-sm text-white/50">
              {detail.counteragent.name}{detail.counteragent.phones ? `, ${formatPhone(detail.counteragent.phones.split(',')[0])}` : ''}
            </p>
            {Array.isArray(orderFields.problems) && orderFields.problems.length > 0 && (
              <p className="mt-1 break-words text-sm text-white/80">Неисправность: <span className="text-white">{(orderFields.problems as unknown[]).join(', ')}</span></p>
            )}
            {str(orderFields.deadline) && (
              <p className="mt-1 text-sm text-white/80">Срок: <span className="text-white">{formatDate(str(orderFields.deadline))}</span></p>
            )}
            {str(orderFields.approximate_price) && (
              <p className="mt-1 text-sm text-white/80">Ориентировочная цена: <b className="font-semibold text-white">{str(orderFields.approximate_price)}</b></p>
            )}
          </div>
          <div className="flex items-end gap-5 md:justify-end">
            <div>
              <p className="text-xs text-white/50">Итого</p>
              <p className="num text-2xl font-semibold leading-tight">{formatMoney(detail.order.total_price)}</p>
            </div>
            {Number(detail.debt) > 0 && (
              <div>
                <p className="text-xs text-white/50">Долг</p>
                <p className="num text-2xl font-semibold leading-tight text-[#ff8a72]">{formatMoney(detail.debt)}</p>
              </div>
            )}
            {!isDeleted && detail.status.group !== 'closed' && (
              <button className="ml-auto h-11 rounded-[10px] bg-accent px-6 text-[15px] font-semibold text-accent-ink md:ml-2" onClick={giveOrder}>Выдать</button>
            )}
          </div>
        </div>
      </header>
      {isDeleted && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3">
          <div className="text-sm">
            <p className="font-medium text-danger">Заказ удалён</p>
            <p className="text-ink">
              {deletedEvent ? `${deletedEvent.employee_name ?? 'Система'}, ${formatDate(deletedEvent.created_at)}` : ''}
              {deletedEvent?.text ? ` · Причина: ${deletedEvent.text}` : ''}
            </p>
            <p className="text-muted">Заказ сохранён для истории: его нельзя менять, запчасти возвращены на склад, зарплата по нему снята.</p>
          </div>
          {can('deleteOrderAccess') && (
            <button disabled={saving} className="rounded-md border border-line bg-surface px-3 py-2 font-medium" onClick={() => void restoreOrder()}>Восстановить</button>
          )}
        </div>
      )}
      {deleting && (
        <Modal title={`Удалить заказ ${detail.order.number}?`} onClose={() => setDeleting(false)}>
          <div className="grid gap-3">
            <p className="text-sm text-muted">
              Заказ не пропадёт: он останется в списке перечёркнутым, с историей и причиной удаления. Запчасти вернутся на склад.
              Если по заказу были оплаты — сначала оформите возврат денег.
            </p>
            <label className="grid gap-1 text-sm text-muted">Причина
              <textarea className={inputClass} rows={2} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Например: клиент передумал, дубль заказа" />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line bg-surface px-3 py-2" onClick={() => setDeleting(false)}>Отмена</button>
              <button type="button" disabled={saving} className="rounded-md bg-danger px-3 py-2 font-medium text-white disabled:opacity-60" onClick={() => void deleteOrder()}>Удалить заказ</button>
            </div>
          </div>
        </Modal>
      )}
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <nav className="mb-3 flex gap-0.5 border-b border-line">
            <button aria-current={tab === 'positions' ? 'page' : undefined} className={`-mb-px h-10 border-b-2 px-3 ${tab === 'positions' ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`} onClick={() => setTab('positions')}>Работы и материалы</button>
            <button aria-current={tab === 'info' ? 'page' : undefined} className={`-mb-px h-10 border-b-2 px-3 ${tab === 'info' ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`} onClick={() => setTab('info')}>Информация</button>
          </nav>
          {tab === 'info' ? (
            <section className="rounded-xl border border-line bg-surface p-4">
              <header className="mb-4 flex items-center justify-between gap-3">
                <h2 className="font-semibold">Информация о заказе</h2>
              </header>
              <div className="grid gap-4 sm:grid-cols-2">
                <Info label="Клиент" value={detail.counteragent.name} />
                <div>
                  <dt className="text-sm text-muted">Телефоны</dt>
                  <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {(detail.counteragent.phones ?? '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => (
                      <span key={p} className="inline-flex items-center gap-2">
                        <Copyable value={p.replace(/\D/g, '').length === 11 ? `+${p.replace(/\D/g, '')}` : p}>{formatPhone(p)}</Copyable>
                        <a href={`tel:+${p.replace(/\D/g, '')}`} className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:border-ink/40 hover:text-ink" aria-label={`Позвонить ${formatPhone(p)}`}>Позвонить</a>
                      </span>
                    ))}
                    {!detail.counteragent.phones && '—'}
                  </dd>
                </div>
                <Info label="Тип заказа" value={detail.order_type.name} />
                <Info label="Статус" value={detail.status.name} />
                {!(can('changeOrderInfoAccess') && !isDeleted) && fields.filter((field) => field.is_visible && field.key !== 'name' && field.key !== 'phones').map((field) => (
                  field.key === 'password' && parsePattern(String(fieldValue(field, detail) ?? ''))
                    ? (
                      <div key={field.id}>
                        <dt className="text-sm text-muted">{field.label}</dt>
                        <dd className="mt-1"><PatternView dots={parsePattern(String(fieldValue(field, detail)))!} size={84} /></dd>
                      </div>
                    )
                    : (field.key === 'sn' || field.key === 'serial') && displayValue(field, detail, masters, managers, howKnows) !== '—'
                      ? (
                        <div key={field.id}>
                          <dt className="text-sm text-muted">{field.label}</dt>
                          <dd className="mt-1 num"><Copyable value={displayValue(field, detail, masters, managers, howKnows)} /></dd>
                        </div>
                      )
                      : <Info key={field.id} label={field.label} value={displayValue(field, detail, masters, managers, howKnows)} />
                ))}
              </div>
              {can('changeOrderInfoAccess') && !isDeleted && (
                <OrderInfoEditor
                  key={`${detail.order.id}:${infoVersion}`}
                  detail={detail}
                  fields={fields}
                  masters={masters}
                  managers={managers}
                  saving={saving}
                  onSave={async (payload) => {
                    if (await run(() => api.put(`/orders/${detail.order.id}`, payload), 'Не удалось сохранить информацию')) {
                      setInfoVersion((v) => v + 1)
                    }
                  }}
                />
              )}
            </section>
          ) : (
            <section className="rounded-xl border border-line bg-surface p-4">
              <h2 className="sr-only">Работы и материалы</h2>
              {(!isClosed || (can('operationCashRegisterAccess') && !detail.order.is_deleted)) && (
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                  {!isClosed && (
                    <button type="button" onClick={() => setPartOpen(true)} className={btn('soft')}>
                      Заказать запчасть
                    </button>
                  )}
                  {can('operationCashRegisterAccess') && !detail.order.is_deleted && (
                    <button type="button" title="Чаевые мастеру: половина идёт ему в зарплату, половина остаётся в кассе" onClick={() => openPayment('tip')}
                      className={btn('secondary')}>
                      + Чаевые
                    </button>
                  )}
                </div>
              )}
              <OrderParts orderId={detail.order.id as number} version={partsVersion} />
              {partOpen && (
                <PartOrderModal
                  initialQuery={partQuery(Array.isArray(detail.order.problems) ? (detail.order.problems as string[]) : [], str(detail.order.brand), str(detail.order.model))}
                  locationName={currentLocation?.name ?? null}
                  author={me?.short_name ?? 'CRM'}
                  orderId={detail.order.id as number}
                  note={[`Заказ ${detail.order.number}`, [str(detail.order.brand), str(detail.order.model)].filter(Boolean).join(' '), detail.counteragent.name].filter(Boolean).join(' · ')}
                  onClose={() => setPartOpen(false)}
                  onAdded={() => setPartsVersion((v) => v + 1)}
                />
              )}
              {detail.positions.length === 0 ? (
                <p className="mb-4 text-sm text-muted">Позиций пока нет. Добавьте работу или материал через поиск ниже.</p>
              ) : (
                <>
                {/* Телефон: позиции карточками — таблица в 7 колонок на 390 px не читается */}
                <ul className="mb-4 divide-y divide-line md:hidden">
                  {detail.positions.map((position) => (
                    <PositionCard
                      key={position.id}
                      position={position}
                      staff={staff}
                      canPerformer={can('changeOrderPositionAccess') && !detail.order.is_deleted}
                      onSavePerformer={(id) => void editPositionPerformer(position, id)}
                      canEdit={can('changeOrderPositionAccess') && !isClosed}
                      canViewMargin={can('marginPriceAccess')}
                      canViewCost={canSeeCost}
                      onSavePrice={(price) => void editPositionPrice(position, price)}
                          onSaveDiscount={(d) => void editPositionDiscount(position, d)}
                      canSalary={can('changeSalaryAccess') && !isClosed}
                      onSaveSalary={(percent) => void editPositionSalary(position, percent)}
                      onSaveGuarantee={(days) => void editPositionGuarantee(position, days)}
                      onOpen={() => setOpenPositionId(position.id)}
                      onDelete={() => void removePosition(position)}
                    />
                  ))}
                </ul>
                <div className="-mx-4 mb-4 hidden overflow-x-auto border-y border-line-soft md:block">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-head"><tr className="h-8">{[['Исполнитель', 'pl-4 text-left'], ['Кол-во', 'text-right'], ['Цена', 'text-right'], ['Скидка, ₽', 'text-right'], ...(canSeeCost ? [['Себест.', 'text-right']] : []), ['Гарантия', 'text-right'], ...(can('changeSalaryAccess') ? [['ЗП, %', 'text-right']] : []), ['Итого', 'text-right'], ...(can('marginPriceAccess') ? [['Прибыль', 'text-right']] : []), ['', 'pr-2']].map(([item, cls]) => <th key={item} className={`px-1 font-medium ${cls}`}>{item}</th>)}</tr></thead>
                    <tbody>
                      {detail.positions.map((position) => (
                        <PositionRow
                          key={position.id}
                          position={position}
                          staff={staff}
                          canPerformer={can('changeOrderPositionAccess') && !detail.order.is_deleted}
                          onSavePerformer={(id) => void editPositionPerformer(position, id)}
                          canEdit={can('changeOrderPositionAccess') && !isClosed}
                          canViewMargin={can('marginPriceAccess')}
                          canViewCost={canSeeCost}
                          canEditCost={can('changeOrderPositionAccess') && can('orderPurchasePriceAccess') && !isClosed}
                          onSavePrice={(price) => void editPositionPrice(position, price)}
                          onSaveDiscount={(d) => void editPositionDiscount(position, d)}
                          onSaveCost={(cost) => void editPositionCost(position, cost)}
                          canSalary={can('changeSalaryAccess') && !isClosed}
                          showSalary={can('changeSalaryAccess')}
                          onSaveSalary={(percent) => void editPositionSalary(position, percent)}
                          onSaveGuarantee={(days) => void editPositionGuarantee(position, days)}
                          onOpen={() => setOpenPositionId(position.id)}
                          onDelete={() => void removePosition(position)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
              {(() => {
                const opened = detail.positions.find((item) => item.id === openPositionId)
                return opened ? (
                  <PositionModal
                    position={opened}
                    canEdit={can('changeOrderPositionAccess') && !isClosed}
                    canViewCost={canSeeCost}
                    canEditCost={can('changeOrderPositionAccess') && can('orderPurchasePriceAccess') && !isClosed}
                    canViewMargin={can('marginPriceAccess')}
                    isClosed={isClosed}
                    onSave={(payload) => savePositionDetails(opened, payload)}
                    onClose={() => setOpenPositionId(null)}
                  />
                ) : null
              })()}
              {can('changeOrderPositionAccess') && !isClosed && (
                <div className="mb-5 rounded-lg border border-line p-3">
                  <form onSubmit={(event) => void searchCatalog(event)} className="flex flex-wrap gap-2">
                    <input className={`${inputClass} min-w-[12rem] flex-1`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти товар или работу" />
                    <button className="rounded-md border border-line px-3 py-2">Найти</button>
                    <button
                      type="button"
                      className="rounded-md border border-line px-3 py-2 whitespace-nowrap"
                      onClick={() => {
                        setSelectedItem({ id: 0, name: search.trim(), is_work: true })
                        setPositionPrice('')
                        setPositionCost('')
                        setPositionGuarantee('90')
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
                            setPositionGuarantee(String(item.guarantee_days || 90))
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
                      <label className="grid gap-1 text-xs text-muted">Гарантия, дней
                        <input className={inputClass} type="number" min="0" step="1" required value={positionGuarantee} onChange={(event) => setPositionGuarantee(event.target.value)} />
                      </label>
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
          <div className="mt-4">
            <OrderChecklistCard
              orderId={detail.order.id}
              checkIn={(orderFields.check_in ?? {}) as ChecklistValues}
              checkOut={(orderFields.check_out ?? {}) as ChecklistValues}
              disabled={isDeleted}
              onChanged={() => void loadDetail()}
              onSignatures={setSignatures}
            />
          </div>
          <div className="mt-4">
            <VerdictBlock
              key={detail.order.id}
              initial={String((detail.order as unknown as { verdict?: string | null }).verdict ?? '')}
              disabled={isDeleted}
              onSave={(verdict) => run(() => api.put(`/orders/${detail.order.id}`, { verdict }), 'Не удалось сохранить вердикт')}
            />
          </div>
          <div className="mt-4">
            <OrderPhotos orderId={detail.order.id} disabled={isDeleted} onChanged={() => void loadDetail()} />
          </div>
        </div>
        <aside className="space-y-4">
          <section className="rounded-xl border border-line bg-surface p-4">
            <header className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Оплаты</h2><strong className="num">{formatMoney(detail.order.paid)}</strong></header>
            <p className="mb-3 text-sm text-muted">Долг: <strong className="text-ink num">{formatMoney(detail.debt)}</strong></p>
            <div className="flex flex-wrap gap-2">
              {can('operationCashRegisterAccess') && !detail.order.is_deleted && <>
                <button className="rounded-md bg-accent px-3 py-2 text-sm text-accent-ink" onClick={() => openPayment('payment')}>Принять оплату</button>
                <button className="rounded-md border border-line px-3 py-2 text-sm" title="Половина — мастеру в зарплату, половина остаётся в кассе" onClick={() => openPayment('tip')}>Чаевые</button>
                {detail.status.group !== 'closed' && <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => openPayment('payment', false, true)}>Внести предоплату</button>}
              </>}
              {can('returnOrderProductAccess') && !detail.order.is_deleted && <button className="rounded-md border border-line px-3 py-2 text-sm" onClick={() => openPayment('refund')}>Возврат</button>}
            </div>
            {detail.transactions.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {detail.transactions.map((transaction) => (
                  <li key={transaction.id} className={`py-2 text-sm ${transaction.cash_item_type === 'bankPercent' ? 'text-muted' : ''}`}>
                    <div className="flex justify-between gap-2">
                      <span>{transaction.cash_item_type === 'bankPercent' ? 'Комиссия банка' : `${transaction.cash_item_type === 'tip' ? 'Чаевые' : transaction.is_income ? 'Оплата' : 'Возврат'}, ${transaction.is_bank ? 'безнал' : 'наличные'}`}</span>
                      <strong className={`num ${transaction.is_income ? '' : 'text-danger'}`}>{transaction.is_income ? '' : '−'}{formatMoney(transaction.amount)}</strong>
                    </div>
                    <small className="text-muted">{formatDate(transaction.date)} · {transaction.cash_register_name}{transaction.note ? ` · ${transaction.note}` : ''}</small>
                    {can('changeTransactionAccess') && can('operationCashRegisterAccess') && !detail.order.is_deleted && (transaction.cash_item_type === 'order' || transaction.cash_item_type === 'orderReturn') && (
                      <button type="button" onClick={() => openSwitch(transaction)} className="switch-pay-btn mt-2 flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold">
                        <span aria-hidden>⇄</span> Сменить способ: на {transaction.is_bank ? 'наличные' : 'безнал'}
                      </button>
                    )}
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
          <OrderSms
            orderId={detail.order.id}
            hasPhone={/(^|,)\s*79\d{9}/.test(detail.counteragent.phones ?? '')}
            disabled={isDeleted}
            partArrived={/запчасть в наличии/i.test(detail.status?.name ?? '')}
            onSent={() => void loadDetail()}
          />
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
                    {item.status && <p className="mt-0.5"><StatusBadge name={item.status.name} color={item.status.color} /></p>}
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
      {switching && (
        <Modal title="Сменить способ оплаты" onClose={() => setSwitching(null)}>
          <form onSubmit={(event) => void submitSwitch(event)} className="grid gap-3">
            <p className="text-sm">
              Оплата <strong className="num">{formatMoney(switching.amount)}</strong> ({switching.is_bank ? 'безнал' : 'наличные'}, {switching.cash_register_name}) будет перепробита по-новому.
              Старая операция удалится вместе с комиссией банка, сумма в заказе и долг не изменятся.
            </p>
            <label className="grid gap-1 text-sm text-muted">Новый способ
              <select className={inputClass} value={switchBank ? 'bank' : 'cash'} onChange={(event) => {
                const bank = event.target.value === 'bank'
                setSwitchBank(bank)
                const current = cashRegisters.find((register) => String(register.id) === switchRegister)
                if (!current || !(bank ? current.accepts_bank : current.accepts_cash)) {
                  const next = cashRegisters.find((register) => (bank ? register.accepts_bank : register.accepts_cash))
                  setSwitchRegister(next ? String(next.id) : '')
                }
              }}>
                <option value="cash">Наличные</option>
                <option value="bank">Безналичные</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Касса
              <select className={inputClass} value={switchRegister} onChange={(event) => setSwitchRegister(event.target.value)} required>
                {cashRegisters.filter((register) => (switchBank ? register.accepts_bank : register.accepts_cash)).map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
              </select>
            </label>
            {paymentError && <p role="alert" className="text-sm text-danger">{paymentError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setSwitching(null)}>Отмена</button>
              <button disabled={saving || !switchRegister} className="switch-pay-btn rounded-md px-3 py-2 font-semibold disabled:opacity-60">{saving ? 'Меняю…' : 'Сменить способ'}</button>
            </div>
          </form>
        </Modal>
      )}
      {paymentMode && (
        <Modal title={paymentMode === 'payment' ? closeAfterPay ? 'Оплата для выдачи' : prepayMode ? 'Предоплата' : 'Принять оплату' : paymentMode === 'tip' ? 'Чаевые' : 'Возврат'} onClose={() => { setPaymentMode(null); setCloseAfterPay(false) }}>
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
                  <input className={inputClass} name="amount" type="number" min="1" step="1" required value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
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
              {activeRegisters.length > 0 && <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Обработка…' : paymentMode === 'payment' ? 'Оплатить' : paymentMode === 'tip' ? 'Принять чаевые' : 'Вернуть'}</button>}
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
  onSaveDiscount,
  onSaveCost,
  onSaveGuarantee,
  canSalary,
  showSalary,
  onSaveSalary,
  onOpen,
  onDelete,
  staff,
  canPerformer,
  onSavePerformer,
}: {
  staff: Employee[]
  canPerformer: boolean
  onSavePerformer: (id: string) => void
  position: Position
  canEdit: boolean
  canViewMargin: boolean
  canViewCost: boolean
  canEditCost: boolean
  onSavePrice: (price: string) => void
  onSaveDiscount: (discount: string) => void
  onSaveCost: (cost: string) => void
  onSaveGuarantee: (days: string) => void
  canSalary: boolean
  showSalary: boolean
  onSaveSalary: (percent: string) => void
  onOpen: () => void
  onDelete: () => void
}) {
  const [price, setPrice] = useState(position.price)
  useEffect(() => setPrice(position.price), [position.price])
  const salaryNow = position.salary_percent == null ? '' : String(Number(position.salary_percent))
  const [salary, setSalary] = useState(salaryNow)
  useEffect(() => setSalary(salaryNow), [salaryNow])
  const discountNow = String(Math.max(0, Math.round((Number(position.price) - Number(position.sold_price)) * Number(position.quantity))))
  const [discount, setDiscount] = useState(discountNow)
  useEffect(() => setDiscount(discountNow), [discountNow])
  const [cost, setCost] = useState(position.purchase_price ?? '')
  useEffect(() => setCost(position.purchase_price ?? ''), [position.purchase_price])
  const [guarantee, setGuarantee] = useState(String(position.guarantee_days))
  useEffect(() => setGuarantee(String(position.guarantee_days)), [position.guarantee_days])
  return (
    <>
    {/* Позиция — две строки: название во всю ширину, под ним поля. Так длинное название не сжимает таблицу */}
    <tr className="border-t border-line-soft">
      <td colSpan={6 + (canViewCost ? 1 : 0) + (showSalary ? 1 : 0) + (canViewMargin ? 1 : 0)} className="pb-0 pl-4 pr-2 pt-2.5">
        <button type="button" className="text-left font-medium underline-offset-2 [overflow-wrap:anywhere] hover:underline" onClick={onOpen}>{position.name}</button>
        <span className="ml-2 text-xs text-muted">{position.is_work ? 'работа' : 'материал'}</span>
      </td>
    </tr>
    <tr>
      <td className="py-1.5 pl-4 pr-1"><PerformerSelect compact position={position} staff={staff} disabled={!canPerformer} onChange={onSavePerformer} /></td>
      <td className="px-1 py-1.5 text-right num">{Number(position.quantity).toLocaleString('ru-RU')}</td>
      <td className="px-1 py-1.5 text-right">{canEdit ? <input aria-label={`Цена: ${position.name}`} className={`${cellInput} w-[6rem]`} type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} onBlur={() => { if (price !== position.price) onSavePrice(price) }} /> : <span className="num">{formatMoney(position.sold_price)}</span>}</td>
      <td className="px-1 py-1.5 text-right">{canEdit ? <input aria-label={`Скидка: ${position.name}`} className={`${cellInput} w-[4.5rem]`} type="number" min="0" step="1" value={discount} title="Скидка на всю позицию, ₽" onChange={(event) => setDiscount(event.target.value)} onBlur={() => { if (discount !== discountNow) onSaveDiscount(discount) }} /> : <span className="num">{discountNow === '0' ? '—' : formatMoney(discountNow)}</span>}</td>
      {canViewCost && (
        <td className="px-1 py-1.5 text-right">{canEditCost
          ? <input aria-label={`Себестоимость: ${position.name}`} className={`${cellInput} w-[5.5rem]`} type="number" min="0" step="1" value={cost} title="Себестоимость за единицу" onChange={(event) => setCost(event.target.value)} onBlur={() => { if (cost !== (position.purchase_price ?? '')) onSaveCost(cost) }} />
          : <span className="num">{position.purchase_price === null ? '—' : formatMoney(position.purchase_price)}</span>}</td>
      )}
      <td className="px-1 py-1.5 text-right">{canEdit ? <input aria-label={`Гарантия, дней: ${position.name}`} className={`${cellInput} w-[3.75rem]`} type="number" min="0" step="1" value={guarantee} title="Гарантия на позицию, дней" onChange={(event) => setGuarantee(event.target.value)} onBlur={() => { if (guarantee !== String(position.guarantee_days)) onSaveGuarantee(guarantee) }} /> : <span className="num">{position.guarantee_days}</span>}</td>
      {showSalary && <td className="px-1 py-1.5 text-right"><input aria-label={`Процент зарплаты: ${position.name}`} className={`${cellInput} w-[4.25rem]`} inputMode="decimal" disabled={!canSalary} placeholder="авто" title="Свой процент зарплаты исполнителю за эту позицию. Пусто — по общему правилу" value={salary} onChange={(event) => setSalary(event.target.value.replace(/[^\d.,]/g, ''))} onBlur={() => { if (salary !== salaryNow) onSaveSalary(salary) }} /></td>}
      <td className="whitespace-nowrap px-1 py-1.5 text-right font-semibold num">{formatMoney(position.total)}</td>
      {canViewMargin && <td className={`whitespace-nowrap px-1 py-1.5 text-right num ${position.margin !== null && Number(position.margin) > 0 ? 'text-success' : 'text-muted'}`}>{position.margin === null ? '—' : formatMoney(position.margin)}</td>}
      <td className="py-1.5 pl-0 pr-2 text-right">{canEdit && <button className="grid h-8 w-8 place-items-center rounded-md text-lg leading-none text-muted hover:bg-danger-soft hover:text-danger" onClick={onDelete} aria-label={`Удалить ${position.name}`} title="Удалить позицию">×</button>}</td>
    </tr>
    </>
  )
}

function PerformerSelect({ position, staff, disabled, onChange, compact = false }: { position: Position; staff: Employee[]; disabled: boolean; onChange: (id: string) => void; compact?: boolean }) {
  const current = position.performer_id ?? ''
  const known = staff.some((item) => item.id === position.performer_id)
  return (
    <select aria-label={`Исполнитель: ${position.name}`} className={compact ? 'cell-input h-8 w-[9rem] rounded-md border px-2 text-sm' : `${inputClass} h-9 min-w-36 max-w-52 text-sm`} disabled={disabled} value={current} title="Кому пойдёт зарплата за эту позицию. Менять можно и после выдачи заказа" onChange={(event) => onChange(event.target.value)}>
      {!position.performer_id && <option value="">не назначен</option>}
      {position.performer_id && !known && <option value={position.performer_id}>{position.performer_name ?? `№${position.performer_id}`}</option>}
      {staff.map((item) => <option key={item.id} value={item.id}>{item.short_name}</option>)}
    </select>
  )
}

function PositionCard({ staff, canPerformer, onSavePerformer, position, canEdit, canViewMargin, canViewCost, canSalary, onSaveSalary, onSavePrice, onSaveDiscount, onSaveGuarantee, onOpen, onDelete }: {
  position: Position
  canEdit: boolean
  canViewMargin: boolean
  canViewCost: boolean
  canSalary: boolean
  staff: Employee[]
  canPerformer: boolean
  onSavePerformer: (id: string) => void
  onSaveSalary: (percent: string) => void
  onSavePrice: (price: string) => void
  onSaveDiscount: (discount: string) => void
  onSaveGuarantee: (days: string) => void
  onOpen: () => void
  onDelete: () => void
}) {
  const salaryNow = position.salary_percent == null ? '' : String(Number(position.salary_percent))
  const [salary, setSalary] = useState(salaryNow)
  useEffect(() => setSalary(salaryNow), [salaryNow])
  const [price, setPrice] = useState(position.price)
  useEffect(() => setPrice(position.price), [position.price])
  const [guarantee, setGuarantee] = useState(String(position.guarantee_days))
  useEffect(() => setGuarantee(String(position.guarantee_days)), [position.guarantee_days])
  const discountNow = String(Math.max(0, Math.round((Number(position.price) - Number(position.sold_price)) * Number(position.quantity))))
  const [discount, setDiscount] = useState(discountNow)
  useEffect(() => setDiscount(discountNow), [discountNow])
  const qtyNum = Number(position.quantity)
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <button type="button" className="block text-left [overflow-wrap:anywhere]" onClick={onOpen}>{position.name}</button>
          <p className="text-xs text-muted">
            {position.is_work ? 'работа' : 'материал'}{qtyNum !== 1 && ` · ${qtyNum.toLocaleString('ru-RU')} шт`}
            {` · гарантия ${position.guarantee_days} дн.`}
            {canViewCost && position.purchase_price !== null && ` · себест. ${formatMoney(position.purchase_price)}`}
            {canViewMargin && position.margin !== null && <span className="text-success"> · +{formatMoney(position.margin)}</span>}
          </p>
        </div>
        <p className="num whitespace-nowrap font-semibold">{formatMoney(position.total)}</p>
        {canEdit && <button className="-mr-1 grid h-8 w-8 place-items-center rounded-md text-lg text-muted hover:text-danger" onClick={onDelete} aria-label={`Удалить ${position.name}`}>×</button>}
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">Исполнитель
        <PerformerSelect position={position} staff={staff} disabled={!canPerformer} onChange={onSavePerformer} />
      </div>
      {canEdit && (
        <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">Цена
          <input className="h-9 w-28 rounded-md border border-line bg-surface px-2 text-right text-sm text-ink num" inputMode="numeric" value={price}
            onChange={(event) => setPrice(event.target.value.replace(/[^\d]/g, ''))} onBlur={() => { if (price !== position.price) onSavePrice(price) }} />
          Скидка
          <input className="h-9 w-20 rounded-md border border-line bg-surface px-2 text-right text-sm text-ink num" inputMode="numeric" value={discount}
            onChange={(event) => setDiscount(event.target.value.replace(/[^\d]/g, ''))} onBlur={() => { if (discount !== discountNow) onSaveDiscount(discount) }} />
          Гарантия, дн.
          <input className="h-9 w-20 rounded-md border border-line bg-surface px-2 text-right text-sm text-ink num" inputMode="numeric" value={guarantee}
            onChange={(event) => setGuarantee(event.target.value.replace(/[^\d]/g, ''))} onBlur={() => { if (guarantee !== String(position.guarantee_days)) onSaveGuarantee(guarantee) }} />
          {canSalary && <>
            ЗП, %
            <input className="h-9 w-24 rounded-md border border-line bg-surface px-2 text-right text-sm text-ink num" inputMode="decimal" placeholder="по правилу" value={salary}
              onChange={(event) => setSalary(event.target.value.replace(/[^\d.,]/g, ''))} onBlur={() => { if (salary !== salaryNow) onSaveSalary(salary) }} />
          </>}
        </label>
      )}
    </li>
  )
}

// Вердикт мастера / рекомендации клиенту — печатается в акте выдачи.
function VerdictBlock({ initial, disabled, onSave }: { initial: string; disabled: boolean; onSave: (verdict: string) => Promise<boolean> }) {
  const [text, setText] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const dirty = text.trim() !== saved.trim()
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-2 font-semibold">Вердикт / рекомендации клиенту</h2>
      <textarea className={inputClass} rows={3} maxLength={2000} value={text} disabled={disabled} onChange={(event) => setText(event.target.value)} placeholder="Что сделано и что рекомендуем клиенту" />
      {dirty && !disabled && (
        <div className="mt-2 flex justify-end">
          <button
            disabled={busy}
            className="rounded-md bg-accent px-3 py-2 text-sm text-accent-ink disabled:opacity-60"
            onClick={async () => {
              setBusy(true)
              if (await onSave(text.trim())) setSaved(text.trim())
              setBusy(false)
            }}
          >{busy ? 'Сохранение…' : 'Сохранить вердикт'}</button>
        </div>
      )}
    </section>
  )
}

function OrderInfoEditor({
  detail,
  fields,
  masters,
  managers,
  saving,
  onSave,
}: {
  detail: OrderDetail
  fields: FormField[]
  masters: Employee[]
  managers: Employee[]
  saving: boolean
  onSave: (payload: Record<string, unknown>) => Promise<void>
}) {
  const initial = () => Object.fromEntries(fields.map((field) => {
    const raw = fieldValue(field, detail)
    return [field.key, field.data_type === 'dateTime' ? isoToLocalInput(raw as string | null) : raw]
  })) as OrderFieldValues
  const [saved] = useState<OrderFieldValues>(initial)
  const [values, setValues] = useState<OrderFieldValues>(saved)
  const dirty = JSON.stringify(values) !== JSON.stringify(saved)
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
      // Проверяем ключ поля формы (problem, completeSet…), а не имя колонки заказа (problems, complete_set…):
      // иначе проблема, комплектация, серийный номер и т. д. уходили в custom_fields и в заказе не менялись
      if (field.key.startsWith('custom_') || !(field.key in aliasMap) && !['brand', 'model', 'color', 'appearance'].includes(field.key)) {
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
      <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-3 sm:grid-cols-2">
        {fields.filter((field) => field.is_visible && field.key !== 'name' && field.key !== 'phones').map((field) => {
          const value = values[field.key]
          const staticField = field.key === 'name' || field.key === 'phones'
          const selectOptions = field.key === 'master' ? masters : field.key === 'manager' ? managers : []
          if (field.key === 'password') {
            // Графический ключ рисуется в отдельном окне — поэтому не <label>, чтобы тапы не уходили в поле
            return (
              <div key={field.id} className="grid gap-1 text-sm text-muted">
                {field.label}
                <DevicePasswordInput className={inputClass} value={String(value ?? '')} onChange={(v) => setValues((current) => ({ ...current, [field.key]: v }))} />
              </div>
            )
          }
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
        {dirty && (
          // Появляется, как только что-то поменяли: отдельной кнопки «Изменить» не нужно
          <div className="sticky bottom-20 z-10 flex items-center justify-end gap-2 rounded-lg border border-accent/40 bg-surface p-2 shadow-lg sm:col-span-2 md:bottom-2">
            <span className="mr-auto text-sm text-muted">Есть несохранённые изменения</span>
            <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => { setValues(saved); setError('') }}>Отменить</button>
            <button disabled={saving} className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
          </div>
        )}
      </form>
  )
}


// Карточка позиции: смотреть можно всегда, править — пока заказ не выдан. Каждая правка попадает в историю заказа.
function PositionModal({ position, canEdit, canViewCost, canEditCost, canViewMargin, isClosed, onSave, onClose }: {
  position: Position
  canEdit: boolean
  canViewCost: boolean
  canEditCost: boolean
  canViewMargin: boolean
  isClosed: boolean
  onSave: (payload: Record<string, string | number>) => Promise<boolean>
  onClose: () => void
}) {
  const [price, setPrice] = useState(position.price)
  const [cost, setCost] = useState(position.purchase_price ?? '')
  const [guarantee, setGuarantee] = useState(String(position.guarantee_days))
  const [saving, setSaving] = useState(false)
  const readOnly = (label: string, value: string) => (
    <div><dt className="text-xs text-muted">{label}</dt><dd className="num">{value}</dd></div>
  )
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const payload: Record<string, string | number> = {}
    if (price !== position.price) payload.price = price
    if (canEditCost && cost !== (position.purchase_price ?? '')) payload.purchase_price = cost || '0'
    if (guarantee !== String(position.guarantee_days)) payload.guarantee_days = Number(guarantee || 0)
    if (Object.keys(payload).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    const ok = await onSave(payload)
    setSaving(false)
    if (ok) onClose()
  }
  return (
    <Modal title={position.name} onClose={onClose}>
      <form onSubmit={(event) => void save(event)} className="grid gap-3">
        <dl className="grid grid-cols-2 gap-3">
          {readOnly('Тип', position.is_work ? 'Работа' : 'Материал')}
          {readOnly('Количество', Number(position.quantity).toLocaleString('ru-RU'))}
          {readOnly('Цена со скидкой', formatMoney(position.sold_price))}
          {readOnly('Итого', formatMoney(position.total))}
          {canViewMargin && position.margin !== null && readOnly('Прибыль', formatMoney(position.margin))}
        </dl>
        <label className="grid gap-1 text-sm text-muted">Цена за единицу
          <input className={inputClass} type="number" min="0" step="1" disabled={!canEdit} value={price} onChange={(event) => setPrice(event.target.value)} />
        </label>
        {canViewCost && (
          <label className="grid gap-1 text-sm text-muted">Себестоимость за единицу
            <input className={inputClass} type="number" min="0" step="1" disabled={!canEditCost} value={cost} onChange={(event) => setCost(event.target.value)} />
          </label>
        )}
        <label className="grid gap-1 text-sm text-muted">Гарантия, дней
          <input className={inputClass} type="number" min="0" step="1" disabled={!canEdit} value={guarantee} onChange={(event) => setGuarantee(event.target.value)} />
        </label>
        {isClosed && <p className="text-sm text-muted">Заказ выдан — позицию можно только смотреть. Чтобы изменить, верните заказ в работу.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>{canEdit ? 'Отмена' : 'Закрыть'}</button>
          {canEdit && <button className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60" disabled={saving}>Сохранить</button>}
        </div>
      </form>
    </Modal>
  )
}
