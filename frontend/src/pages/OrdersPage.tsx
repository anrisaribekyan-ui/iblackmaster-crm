import { useCurrentLocation } from '../currentLocation'
import LocationSwitcher from '../components/LocationSwitcher'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRowLink } from '../components/rowLink'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { formatPhone } from '../format'
import { useAuth } from '../auth'
import { downloadCsv } from '../csv'
import Modal from '../components/Modal'
import type { SmsMark } from '../components/StatusBadge'
import QuickStatus from '../components/QuickStatus'
import Icon from '../components/icons'
import { btn, Empty, field, ListSkeleton, PageHeader, Stat, Tabs, Tag, useMedia, type TabItem } from '../components/ui'

type Tab = 'new' | 'inWork' | 'wait' | 'finish' | 'closed' | 'all' | 'open'
type CustomTab = { id: string; name: string; statusIds: number[] }
type OrderRow = {
  id: number
  number: string
  status: { id: number; group: Exclude<Tab, 'all' | 'open'>; name: string; color: string; sms?: SmsMark }
  deadline: string | null
  manager: string | null
  created_at: string
  order_type_id: number
  device_type: string | null
  brand: string | null
  model: string | null
  serial: string | null
  problems: string[]
  counteragent: { id: number; name: string; phones: string | null }
  total_price: string
  paid: string
  approximate_price: string | null
  device_password?: string | null
  is_urgent: boolean
  is_deleted?: boolean
}
type OrderList = { items: OrderRow[]; total: number; counts: Record<Exclude<Tab, 'all'>, number> }
type StatusGroup = { group: string; title: string; statuses: { id: number; name: string; color: string; comment_mode?: string; role_access?: Record<string, { view?: boolean; set?: boolean; change?: boolean }> }[] }
type OrderType = { id: number; name: string }
type Employee = { id: number; short_name: string }

const tabs: { key: Tab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'inWork', label: 'В работе' },
  { key: 'wait', label: 'Отложенные' },
  { key: 'finish', label: 'Готовые' },
  { key: 'closed', label: 'Выданные' },
  { key: 'open', label: 'Не выданные' },
  { key: 'all', label: 'Все' },
]
const filterInput = field

// Форматтеры создаём один раз: new Intl.* на каждую строку списка — самое дорогое место отрисовки 50 заказов
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })
const DAY_KEY = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow' })
const DAY_NAME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', weekday: 'short' })
const DAY_NAME_YEAR = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', weekday: 'short', year: 'numeric' })
const TIME = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
const MONEY = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

function formatDate(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return DATE_TIME.format(parsed)
}

function formatMoney(value: string) {
  return `${MONEY.format(Number(value))} ₽`
}

// Последние показанные списки (по фильтрам): вернулись из заказа — список на экране сразу, свежий подгружается следом
const listCache = new Map<string, OrderList>()

/** Подсвечивает в тексте найденные слова — совпадение с поиском видно сразу. */
function Mark({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  return <>{parts.map((part, i) => (i % 2 ? <mark key={i} className="rounded-[3px] bg-accent-soft px-0.5 text-accent-strong">{part}</mark> : part))}</>
}

export default function OrdersPage() {
  const rowLink = useRowLink()
  const currentLocation = useCurrentLocation()
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<OrderList | null>(null)
  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([])
  const [orderTypes, setOrderTypes] = useState<OrderType[]>([])
  const [masters, setMasters] = useState<Employee[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const desktop = useMedia('(min-width: 768px)')
  const wide = useMedia('(min-width: 1280px)')
  const wider = useMedia('(min-width: 1536px)')
  const columns = 6 + (wide ? 1 : 0) + (wider ? 1 : 0)
  const [overdueTotal, setOverdueTotal] = useState<number | null>(null)

  // Последняя открытая вкладка запоминается: «Заказы» в меню открывают то, где вы были
  const lastTab = (() => {
    try { return localStorage.getItem('orders:tab') ?? 'all' } catch { return 'all' }
  })()
  const [customTabs, setCustomTabs] = useState<CustomTab[]>(() => {
    try { return JSON.parse(localStorage.getItem('orders:customTabs') ?? '[]') as CustomTab[] } catch { return [] }
  })
  const [tabEditor, setTabEditor] = useState<CustomTab | null>(null)
  const saveCustomTabs = (next: CustomTab[]) => {
    setCustomTabs(next)
    try { localStorage.setItem('orders:customTabs', JSON.stringify(next)) } catch { /* приватный режим */ }
  }
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.has('tab')) params.set('tab', lastTab)
    const custom = customTabs.find((t) => t.id === params.get('tab'))
    if (custom) {
      params.set('tab', 'all')
      params.set('status_ids', custom.statusIds.join(','))
    } else if (params.get('tab')?.startsWith('c_')) {
      params.set('tab', 'all')
    }
    if (!params.has('location_id') && currentLocation) params.set('location_id', currentLocation)
    return params.toString()
  }, [searchParams, lastTab, currentLocation, customTabs])
  const words = (searchParams.get('q') ?? '').split(/\s+/).filter((w) => w.length > 0 && !(/^\d+$/.test(w) && w.length > 3))
  const currentTab = (searchParams.get('tab') ?? lastTab) as string
  useEffect(() => {
    try { localStorage.setItem('orders:tab', currentTab) } catch { /* приватный режим */ }
  }, [currentTab])
  const currentPage = Math.max(1, Number(searchParams.get('page') ?? '1'))

  const setParam = (key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set(key, value)
      else next.delete(key)
      if (key !== 'page') next.delete('page')
      return next
    })
  }

  const loadReferences = useCallback(async () => {
    try {
      const [statuses, typeData, masterData, managerData] = await Promise.all([
        api.get<StatusGroup[]>('/order-statuses'),
        api.get<OrderType[]>('/order-types'),
        api.get<Employee[]>('/employees/short?master=1'),
        api.get<Employee[]>('/employees/short?manager=1'),
      ])
      setStatusGroups(statuses)
      setOrderTypes(typeData)
      setMasters(masterData)
      setManagers(managerData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить фильтры')
    }
  }, [])

  const loadOrders = useCallback(async () => {
    const cached = listCache.get(queryString)
    if (cached) setData(cached)
    setLoading(!cached) // есть сохранённый список — без «Загрузка…», обновим тихо
    setError('')
    try {
      const params = new URLSearchParams(queryString)
      const fresh = await api.get<OrderList>(`/orders?${params.toString()}`)
      listCache.set(queryString, fresh)
      setData(fresh)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить список заказов')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void loadReferences()
  }, [loadReferences])

  // Плитка «Просрочены»: тот же список заказов с готовым фильтром overdue, берём только total
  useEffect(() => {
    if (!desktop) return
    const params = new URLSearchParams({ tab: 'open', overdue: 'true' })
    if (currentLocation) params.set('location_id', currentLocation)
    let alive = true
    api.get<OrderList>(`/orders?${params.toString()}`)
      .then((result) => { if (alive) setOverdueTotal(result.total) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [currentLocation, desktop, data?.total])

  useEffect(() => {
    setSearch(searchParams.get('q') ?? '')
    void loadOrders()
  }, [loadOrders, searchParams])

  const exportCsv = async () => {
    setError('')
    try {
      const base = new URLSearchParams(queryString)
      base.delete('page')
      const all: OrderRow[] = []
      let page = 1
      while (true) {
        base.set('page', String(page))
        const result = await api.get<OrderList>(`/orders?${base.toString()}`)
        all.push(...result.items)
        if (all.length >= result.total || result.items.length === 0) break
        page += 1
      }
      const headers = ['Заказ', 'Статус', 'Крайний срок', 'Менеджер', 'Создан', 'Тип заказа', 'Устройство', 'Неисправность', 'Контрагент', 'Телефон', 'Сумма', 'Оплачено']
      const rows = all.map((order) => [
        order.number,
        order.status.name,
        order.deadline ? formatDate(order.deadline) : '',
        order.manager ?? '',
        formatDate(order.created_at),
        orderTypes.find((type) => type.id === order.order_type_id)?.name ?? '',
        [order.brand, order.model].filter(Boolean).join(' '),
        order.problems?.join(', ') ?? '',
        order.counteragent.name,
        formatPhone(order.counteragent.phones),
        Number(order.total_price) || 0,
        Number(order.paid) || 0,
      ])
      downloadCsv('заказы.csv', headers, rows)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось выгрузить заказы')
    }
  }

  // Быстрая смена статуса из списка: сначала меняем на экране, потом тот же запрос, что и в карточке заказа.
  // Не прошёл — откатываем. После успеха список тихо перечитываем: заказ мог перестать подходить под фильтр.
  const quickStatus = async (order: OrderRow, next: { id: number; name: string; color: string }, comment: string | null) => {
    const before = order.status
    const group = statusGroups.find((g) => g.statuses.some((s) => s.id === next.id))?.group ?? before.group
    const patch = (status: OrderRow['status']) => setData((cur) => (cur ? { ...cur, items: cur.items.map((o) => (o.id === order.id ? { ...o, status } : o)) } : cur))
    setError('')
    patch({ ...before, id: next.id, name: next.name, color: next.color, group, sms: undefined } as OrderRow['status'])
    try {
      await api.post(`/orders/${order.id}/status`, { status_id: next.id, comment })
      listCache.delete(queryString)
      void loadOrders()
    } catch (e) {
      patch(before)
      setError(e instanceof ApiError ? e.message : 'Не удалось изменить статус')
    }
  }

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setParam('q', search.trim())
  }

  const selectFilter = (key: string, value: string) => setParam(key, value)

  const statusOptions = statusGroups.flatMap((group) =>
    group.statuses.map((status) => ({ ...status, groupTitle: group.title })),
  )
  const pageCount = data ? Math.max(1, Math.ceil(data.total / 50)) : 1

  const counts: Record<string, number> = data?.counts ?? {}
  const countOf = (key: Tab) => key === 'all'
    ? Object.values(counts).reduce((sum, value) => sum + value, 0)
    : key === 'open'
      ? Object.entries(counts).reduce((sum, [group, value]) => sum + (group === 'closed' ? 0 : value), 0)
      : counts[key] ?? 0
  const tabItems: TabItem[] = [
    ...tabs.map((tab) => ({ key: tab.key as string, label: tab.label, count: data ? countOf(tab.key) : null })),
    ...customTabs.map((tab) => ({ key: tab.id, label: tab.name, onEdit: () => setTabEditor(tab) })),
  ]
  const activeFilters = ['status_id', 'order_type_id', 'master_id', 'manager_id', 'date_from', 'date_to', 'urgent', 'overdue'].filter((key) => searchParams.get(key)).length
  const overdueOn = searchParams.get('overdue') === 'true'
  const goTab = (tab: Tab) => setSearchParams({ tab })
  // Заказы идут от новых к старым — между днями ставим тихий заголовок: «Сегодня», «Вчера», дата
  const grouped = useMemo(() => {
    const today = DAY_KEY.format(new Date())
    const yesterday = DAY_KEY.format(new Date(Date.now() - 86400000))
    const year = new Date().getFullYear()
    let previous = ''
    return (data?.items ?? []).map((order) => {
      const date = new Date(order.created_at)
      const key = DAY_KEY.format(date)
      const head = key === previous ? null : key === today ? 'Сегодня' : key === yesterday ? 'Вчера' : (date.getFullYear() === year ? DAY_NAME : DAY_NAME_YEAR).format(date)
      previous = key
      return { order, head }
    })
  }, [data])
  const money = (order: OrderRow) => {
    const total = Number(order.total_price)
    const debt = total - Number(order.paid)
    return { total, debt, partial: debt > 0 && debt < total }
  }

  // Список пересобирается только когда пришли новые данные или изменилась раскладка —
  // набор текста в поиске и открытие фильтров не перерисовывают 50 строк
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => (
!desktop ? (
            /* Телефон: карточки вместо таблицы — всё главное видно без прокрутки вбок */
            <ul className="space-y-2">
              {grouped.map(({ order, head }) => {
                const overdue = order.deadline && new Date(order.deadline).getTime() < Date.now() && order.status.group !== 'closed'
                const device = [order.brand, order.model].filter(Boolean).join(' ')
                const { total, debt } = money(order)
                return (
                  <li key={order.id}>
                    {head && <h2 className="px-1 pb-1.5 pt-2 text-xs font-semibold text-ink-2">{head}</h2>}
                    {/* Карточка — не ссылка целиком (внутри кнопка статуса): ссылка на номере растянута на всю карточку */}
                    <div className={`relative rounded-xl border border-line bg-surface p-3.5 active:bg-row-hover ${order.is_deleted ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-2">
                        <Link to={`/orders/${order.id}`} className={`shrink-0 text-xl font-bold after:absolute after:inset-0 after:rounded-xl ${order.is_deleted ? 'text-muted line-through' : 'text-accent'}`}>
                          {order.is_urgent && !order.is_deleted && <span aria-label="Срочный заказ" className="mr-1 text-danger">●</span>}
                          {order.number}
                        </Link>
                        {order.is_deleted && <Tag tone="danger">удалён</Tag>}
                        <span className="relative z-10 flex min-w-0 flex-1 justify-end"><QuickStatus status={order.status} groups={statusGroups} onPick={(next, comment) => void quickStatus(order, next, comment)} /></span>
                      </div>
                      <p className="mt-2 break-words text-base font-semibold leading-snug">{device ? <Mark text={device} words={words} /> : 'Устройство не указано'}</p>
                      {order.problems?.length > 0 && <p className="break-words text-[15px] text-ink-2">{order.problems.join(', ')}</p>}
                      <div className="mt-2.5 flex items-end justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <p className="break-words">{order.counteragent.name}</p>
                          <p className={`text-xs ${overdue ? 'font-semibold text-danger' : 'text-muted'}`}>
                            {formatDate(order.created_at)}{order.deadline ? ` · срок ${formatDate(order.deadline)}` : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          {total > 0 ? (
                            <>
                              <p className="num text-base font-semibold">{formatMoney(order.total_price)}</p>
                              {debt > 0 && <p className="num text-xs font-medium text-danger">долг {formatMoney(String(debt))}</p>}
                            </>
                          ) : (
                            <p className="text-muted">{order.approximate_price ? `≈ ${order.approximate_price}` : '—'}</p>
                          )}
                          {order.device_password && <p className="num text-xs text-muted">пароль: {order.device_password}</p>}
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-[var(--shadow-card)]">
              {/* Строка — одна линия, 44 px: заказ, статус, аппарат и неисправность, клиент, срок, деньги. Подробности — в подсказке и в карточке */}
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[7.75rem]" />
                  <col className="w-[14.5rem]" />
                  <col />
                  <col className="w-[11rem] xl:w-[16.5rem]" />
                  <col className="hidden w-[6.5rem] xl:table-column" />
                  <col className="hidden w-[8rem] 2xl:table-column" />
                  <col className="w-[9.75rem]" />
                  <col className="w-[5rem]" />
                </colgroup>
                <thead className="bg-head">
                  <tr className="h-8">
                    <th scope="col" className="pl-5 pr-2 font-medium">Заказ</th>
                    <th scope="col" className="px-2 font-medium">Статус</th>
                    <th scope="col" className="truncate px-2 font-medium">Устройство и неисправность</th>
                    <th scope="col" className="px-2 font-medium">Клиент</th>
                    <th scope="col" className="hidden px-2 font-medium xl:table-cell">Срок</th>
                    <th scope="col" className="hidden px-2 font-medium 2xl:table-cell">Менеджер</th>
                    <th scope="col" className="px-2 text-right font-medium">Сумма</th>
                    <th scope="col" className="pl-2 pr-5 font-medium">Пароль</th>
                  </tr>
                </thead>
                <tbody>
                  {grouped.map(({ order, head }) => {
                    const overdue = order.deadline && new Date(order.deadline).getTime() < Date.now() && order.status.group !== 'closed'
                    const device = [order.brand, order.model].filter(Boolean).join(' ')
                    const type = orderTypes.find((t) => t.id === order.order_type_id)?.name
                    const problems = order.problems?.join(', ')
                    const { total, debt, partial } = money(order)
                    const phone = formatPhone(order.counteragent.phones?.split(',')[0])
                    const created = ago(order.created_at)
                    return [
                      head && (
                        <tr key={`h${order.id}`} className="ui-group-head hover:!bg-canvas">
                          <th scope="rowgroup" colSpan={columns} className="h-[30px] border-t border-line-soft pl-5 text-left !text-xs !font-semibold !text-ink-2">{head}</th>
                        </tr>
                      ),
                      <tr key={order.id} {...rowLink(`/orders/${order.id}`)} className={`ui-row h-11 cursor-pointer border-t border-line-soft ${overdue && !order.is_deleted ? 'bg-danger-soft/50' : ''} ${order.is_deleted ? 'text-muted line-through decoration-placeholder [&_td]:opacity-70' : ''}`}>
                        <td className="whitespace-nowrap pl-5 pr-2">
                          <Link to={`/orders/${order.id}`} title={formatDate(order.created_at)} className={`text-[15px] font-bold hover:underline ${order.is_deleted ? 'text-muted' : 'text-accent'}`}>{order.is_urgent && !order.is_deleted && <span aria-label="Срочный заказ" title="Срочный" className="mr-1 text-danger">●</span>}{order.number}</Link>
                          {order.is_deleted
                            ? <Tag tone="danger" className="ml-1.5 [text-decoration:none]">удалён</Tag>
                            : created && !created.includes(',') && <span className="ml-1.5 text-xs text-muted">{created.replace(' назад', '')}</span>}
                        </td>
                        <td className="px-2"><QuickStatus status={order.status} groups={statusGroups} onPick={(next, comment) => void quickStatus(order, next, comment)} /></td>
                        <td className="min-w-0 px-2">
                          <p className="truncate" title={[device, problems].filter(Boolean).join(' · ')}>
                            <span className="font-semibold">{device ? <Mark text={device} words={words} /> : <span className="font-normal text-muted">Не указано</span>}</span>
                            {problems && <span className="text-muted"> · {problems}</span>}
                            {type && type !== 'Негарантийный' && <Tag tone="accent" className="ml-1.5">{type}</Tag>}
                          </p>
                        </td>
                        <td className="min-w-0 px-2">
                          <p className="flex min-w-0 items-baseline gap-1.5" title={[order.counteragent.name, phone].filter(Boolean).join(' · ')}>
                            <span className="truncate">{order.counteragent.name}</span>
                            {phone && <span className="hidden shrink-0 text-[13px] text-muted xl:inline">{phone}</span>}
                          </p>
                        </td>
                        <td className={`hidden whitespace-nowrap px-2 text-[13px] xl:table-cell ${overdue ? 'font-semibold text-danger' : 'text-ink-2'}`}>{order.deadline ? formatDate(order.deadline).split(',')[0] : <span className="text-muted">—</span>}</td>
                        <td className="hidden truncate px-2 text-[13px] text-muted 2xl:table-cell">{order.manager ?? '—'}</td>
                        <td className="whitespace-nowrap px-2 text-right num">{total > 0
                          ? <>
                              {debt > 0
                                ? <Tag tone="danger" className="mr-2">{partial ? `долг ${formatMoney(String(debt))}` : 'долг'}</Tag>
                                : <Tag tone="success" className="mr-2">оплачен</Tag>}
                              <span className="font-semibold">{formatMoney(order.total_price)}</span>
                            </>
                          : <span className="text-muted">{order.approximate_price ? `≈ ${order.approximate_price}` : '—'}</span>}</td>
                        <td className="min-w-0 truncate pl-2 pr-5 text-[13px]" title={order.device_password ? `Пароль на устройстве: ${order.device_password}` : 'Пароль на устройстве'}>{order.device_password || <span className="text-muted">—</span>}</td>
                      </tr>,
                    ]
                  })}
                </tbody>
              </table>
            </div>
          )
  ), [grouped, statusGroups, orderTypes, desktop, columns, queryString])

  return (
    <section>
      <PageHeader title="Заказы" aside={<LocationSwitcher className="max-md:hidden" />}>
        <Link className={btn('ghost')} to="/orders/forgotten">Забытые</Link>
        <button className={btn('ghost', 'md', 'max-sm:hidden')} onClick={() => void exportCsv()}>Скачать CSV</button>
        {can('createOrderAccess') && <Link className={btn('primary', 'md', 'max-md:hidden')} to="/orders/new"><Icon name="plus" className="h-3.5 w-3.5" />Новый заказ</Link>}
      </PageHeader>
      {desktop && (
        <div className="mb-3.5 grid grid-cols-4 gap-3">
          <Stat label="Новые" value={data ? countOf('new').toLocaleString('ru-RU') : '—'} hint="ждут приёмки в работу" active={currentTab === 'new' && !overdueOn} onClick={() => goTab('new')} />
          <Stat label="В работе" value={data ? countOf('inWork').toLocaleString('ru-RU') : '—'} hint={data ? `отложено ${countOf('wait').toLocaleString('ru-RU')}` : undefined} active={currentTab === 'inWork' && !overdueOn} onClick={() => goTab('inWork')} />
          <Stat label="Готовы к выдаче" value={data ? countOf('finish').toLocaleString('ru-RU') : '—'} hint="позвонить и выдать" active={currentTab === 'finish' && !overdueOn} onClick={() => goTab('finish')} />
          <Stat label="Просрочены" tone={overdueTotal ? 'danger' : 'neutral'} value={overdueTotal == null ? '—' : overdueTotal.toLocaleString('ru-RU')} hint="срок прошёл, не выданы" active={overdueOn} onClick={() => setSearchParams(overdueOn ? { tab: 'open' } : { tab: 'open', overdue: 'true' })} />
        </div>
      )}
      <form onSubmit={submitSearch} className="mb-2 flex gap-2">
        <label className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input className={`${filterInput} w-full pl-9`} type="search" enterKeyHint="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, телефон, имя, IMEI" aria-label="Поиск по заказам" />
        </label>
        <button className={btn('secondary')}>Найти</button>
        <button type="button" aria-expanded={filtersOpen} className={btn('secondary')} onClick={() => setFiltersOpen((current) => !current)}>
          {filtersOpen ? 'Скрыть' : 'Фильтры'}
          {activeFilters > 0 && <span className="num grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">{activeFilters}</span>}
        </button>
      </form>
      {filtersOpen && (
        <div className="mb-3 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-[13px] text-muted">Статус
            <select className={filterInput} value={searchParams.get('status_id') ?? ''} onChange={(event) => selectFilter('status_id', event.target.value)}>
              <option value="">Любой</option>
              {statusOptions.map((status) => <option key={status.id} value={status.id}>{status.groupTitle} · {status.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Тип заказа
            <select className={filterInput} value={searchParams.get('order_type_id') ?? ''} onChange={(event) => selectFilter('order_type_id', event.target.value)}>
              <option value="">Любой</option>{orderTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Мастер
            <select className={filterInput} value={searchParams.get('master_id') ?? ''} onChange={(event) => selectFilter('master_id', event.target.value)}>
              <option value="">Любой</option>{masters.map((employee) => <option key={employee.id} value={employee.id}>{employee.short_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Менеджер
            <select className={filterInput} value={searchParams.get('manager_id') ?? ''} onChange={(event) => selectFilter('manager_id', event.target.value)}>
              <option value="">Любой</option>{managers.map((employee) => <option key={employee.id} value={employee.id}>{employee.short_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Созданы с
            <input className={filterInput} type="date" value={searchParams.get('date_from') ?? ''} onChange={(event) => selectFilter('date_from', event.target.value)} />
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Созданы по
            <input className={filterInput} type="date" value={searchParams.get('date_to') ?? ''} onChange={(event) => selectFilter('date_to', event.target.value)} />
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Срочные
            <select className={filterInput} value={searchParams.get('urgent') ?? ''} onChange={(event) => selectFilter('urgent', event.target.value)}>
              <option value="">Любые</option><option value="true">Только срочные</option><option value="false">Без срочных</option>
            </select>
          </label>
          <label className="grid gap-1 text-[13px] text-muted">Просроченные
            <select className={filterInput} value={searchParams.get('overdue') ?? ''} onChange={(event) => selectFilter('overdue', event.target.value)}>
              <option value="">Любые</option><option value="true">Только просроченные</option><option value="false">Не просроченные</option>
            </select>
          </label>
          {searchParams.size > 0 && <button className="text-left text-sm text-danger sm:col-span-2 xl:col-span-4" onClick={() => setSearchParams({ tab: currentTab })}>Сбросить фильтры</button>}
        </div>
      )}
      <div className="mb-3">
        <Tabs
          label="Группы заказов"
          items={tabItems}
          value={currentTab}
          onChange={(key) => setParam('tab', key)}
          after={<button aria-label="Добавить свою вкладку" title="Своя вкладка: выберите нужные статусы" className="grid h-10 w-9 shrink-0 place-items-center text-accent hover:text-accent-hover md:h-[38px]" onClick={() => setTabEditor({ id: `c_${Date.now()}`, name: '', statusIds: [] })}><Icon name="plus" className="h-4 w-4" /></button>}
        />
      </div>
      {tabEditor && (
        <Modal title={customTabs.some((t) => t.id === tabEditor.id) ? 'Своя вкладка' : 'Новая вкладка'} onClose={() => setTabEditor(null)}>
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Название
              <input className={filterInput} autoFocus maxLength={20} value={tabEditor.name} onChange={(e) => setTabEditor({ ...tabEditor, name: e.target.value })} placeholder="Например: Жду запчасть" />
            </label>
            <div className="max-h-72 overflow-auto rounded-md border border-line p-2">
              {statusGroups.map((group) => (
                <div key={group.group} className="mb-2">
                  <p className="text-xs font-medium text-muted">{group.title}</p>
                  {group.statuses.map((status) => (
                    <label key={status.id} className="flex items-center gap-2 py-1 text-sm">
                      <input type="checkbox" checked={tabEditor.statusIds.includes(status.id)}
                        onChange={(e) => setTabEditor({ ...tabEditor, statusIds: e.target.checked ? [...tabEditor.statusIds, status.id] : tabEditor.statusIds.filter((i) => i !== status.id) })} />
                      {status.name}
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex justify-between gap-2">
              {customTabs.some((t) => t.id === tabEditor.id)
                ? <button className="text-danger" onClick={() => { saveCustomTabs(customTabs.filter((t) => t.id !== tabEditor.id)); if (currentTab === tabEditor.id) setParam('tab', 'open'); setTabEditor(null) }}>Удалить вкладку</button>
                : <span />}
              <button
                disabled={!tabEditor.name.trim() || tabEditor.statusIds.length === 0}
                className={btn('primary')}
                onClick={() => {
                  const item = { ...tabEditor, name: tabEditor.name.trim() }
                  saveCustomTabs(customTabs.some((t) => t.id === item.id) ? customTabs.map((t) => (t.id === item.id ? item : t)) : [...customTabs, item])
                  setParam('tab', item.id)
                  setTabEditor(null)
                }}
              >Сохранить</button>
            </div>
          </div>
        </Modal>
      )}
      {error && <p role="alert" className="mb-3 rounded-md border border-danger bg-danger-soft p-3 text-danger">{error}</p>}
      {loading && data === null ? (
        <ListSkeleton rows={desktop ? 14 : 6} rowHeight={desktop ? 44 : 96} />
      ) : data === null ? (
        <Empty>Список заказов недоступен.</Empty>
      ) : data.items.length === 0 ? (
        <Empty>Заказов по выбранным условиям нет. Измените фильтры или создайте новый заказ.</Empty>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {list}
          <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted">
            <span className="num">Всего: {data.total.toLocaleString('ru-RU')}</span>
            <span className="flex items-center gap-2">
              <button disabled={currentPage <= 1} className={btn('secondary', 'sm')} onClick={() => setParam('page', String(currentPage - 1))}>Назад</button>
              <span className="num">Страница {currentPage} из {pageCount.toLocaleString('ru-RU')}</span>
              <button disabled={currentPage >= pageCount} className={btn('secondary', 'sm')} onClick={() => setParam('page', String(currentPage + 1))}>Далее</button>
            </span>
          </footer>
        </div>
      )}
    </section>
  )
}


/** «5 мин назад», «3 ч назад», «вчера, 14:20» — для свежих заказов; старше — обычная дата (null). */
function ago(value: string): string | null {
  const date = new Date(value)
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (Number.isNaN(minutes) || minutes < 0) return null
  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`
  if (minutes < 12 * 60) return `${Math.round(minutes / 60)} ч назад`
  const time = TIME.format(date)
  const day = (d: Date) => DAY_KEY.format(d)
  if (day(date) === day(new Date())) return `сегодня, ${time}`
  if (day(date) === day(new Date(Date.now() - 86400000))) return `вчера, ${time}`
  return null
}
