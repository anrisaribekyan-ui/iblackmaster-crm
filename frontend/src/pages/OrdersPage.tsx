import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useRowLink } from '../components/rowLink'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { formatPhone } from '../format'
import { useAuth } from '../auth'
import { downloadCsv } from '../csv'
import StatusBadge from '../components/StatusBadge'

type Tab = 'new' | 'inWork' | 'wait' | 'finish' | 'closed' | 'all'
type OrderRow = {
  id: number
  number: string
  status: { id: number; group: Exclude<Tab, 'all'>; name: string; color: string }
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
  is_urgent: boolean
  is_deleted?: boolean
}
type OrderList = { items: OrderRow[]; total: number; counts: Record<Exclude<Tab, 'all'>, number> }
type Location = { id: number; name: string }
type StatusGroup = { group: string; title: string; statuses: { id: number; name: string; color: string }[] }
type OrderType = { id: number; name: string }
type Employee = { id: number; short_name: string }

const tabs: { key: Tab; label: string }[] = [
  { key: 'new', label: 'Новые' },
  { key: 'inWork', label: 'В работе' },
  { key: 'wait', label: 'Отложенные' },
  { key: 'finish', label: 'Готовые' },
  { key: 'closed', label: 'Выданные' },
  { key: 'all', label: 'Все' },
]
const filterInput = 'rounded-md border border-line bg-surface px-2 py-1.5'

function formatDate(value: string | null) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed)
}

function formatMoney(value: string) {
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`
}

// Последние показанные списки (по фильтрам): вернулись из заказа — список на экране сразу, свежий подгружается следом
const listCache = new Map<string, OrderList>()

export default function OrdersPage() {
  const rowLink = useRowLink()
  const { can } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<OrderList | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([])
  const [orderTypes, setOrderTypes] = useState<OrderType[]>([])
  const [masters, setMasters] = useState<Employee[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [search, setSearch] = useState(searchParams.get('q') ?? '')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Последняя открытая вкладка запоминается: «Заказы» в меню открывают то, где вы были
  const lastTab = (() => {
    try { return localStorage.getItem('orders:tab') ?? 'all' } catch { return 'all' }
  })()
  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.has('tab')) params.set('tab', lastTab)
    return params.toString()
  }, [searchParams, lastTab])
  const currentTab = (searchParams.get('tab') ?? lastTab) as Tab
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
      const [locationData, statuses, typeData, masterData, managerData] = await Promise.all([
        api.get<Location[]>('/locations'),
        api.get<StatusGroup[]>('/order-statuses'),
        api.get<OrderType[]>('/order-types'),
        api.get<Employee[]>('/employees/short?master=1'),
        api.get<Employee[]>('/employees/short?manager=1'),
      ])
      setLocations(locationData)
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

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setParam('q', search.trim())
  }

  const selectFilter = (key: string, value: string) => setParam(key, value)

  const statusOptions = statusGroups.flatMap((group) =>
    group.statuses.map((status) => ({ ...status, groupTitle: group.title })),
  )
  const pageCount = data ? Math.max(1, Math.ceil(data.total / 50)) : 1

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Заказы</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Локация"
            className={filterInput}
            value={searchParams.get('location_id') ?? ''}
            onChange={(event) => selectFilter('location_id', event.target.value)}
          >
            <option value="">Все локации</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          {can('createOrderAccess') && <Link className="hidden rounded-md bg-accent px-3 py-2 font-medium text-accent-ink md:inline-block" to="/orders/new">Создать</Link>}
          <Link className="whitespace-nowrap rounded-md border border-line bg-surface px-3 py-2" to="/orders/forgotten">Забытые</Link>
          <button className="hidden whitespace-nowrap rounded-md border border-line bg-surface px-3 py-2 sm:block" onClick={() => void exportCsv()}>Скачать CSV</button>
        </div>
      </header>
      <form onSubmit={submitSearch} className="mb-3 flex gap-2">
        <input className={`${filterInput} min-w-0 flex-1`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, телефон, имя, IMEI" />
        <button className="rounded-md border border-line bg-surface px-3 py-2">Найти</button>
        <button type="button" className="rounded-md border border-line bg-surface px-3 py-2" onClick={() => setFiltersOpen((current) => !current)}>
          {filtersOpen ? 'Скрыть фильтры' : 'Фильтры'}
        </button>
      </form>
      {filtersOpen && (
        <div className="mb-4 grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-sm text-muted">Статус
            <select className={filterInput} value={searchParams.get('status_id') ?? ''} onChange={(event) => selectFilter('status_id', event.target.value)}>
              <option value="">Любой</option>
              {statusOptions.map((status) => <option key={status.id} value={status.id}>{status.groupTitle} · {status.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Тип заказа
            <select className={filterInput} value={searchParams.get('order_type_id') ?? ''} onChange={(event) => selectFilter('order_type_id', event.target.value)}>
              <option value="">Любой</option>{orderTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Мастер
            <select className={filterInput} value={searchParams.get('master_id') ?? ''} onChange={(event) => selectFilter('master_id', event.target.value)}>
              <option value="">Любой</option>{masters.map((employee) => <option key={employee.id} value={employee.id}>{employee.short_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Менеджер
            <select className={filterInput} value={searchParams.get('manager_id') ?? ''} onChange={(event) => selectFilter('manager_id', event.target.value)}>
              <option value="">Любой</option>{managers.map((employee) => <option key={employee.id} value={employee.id}>{employee.short_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Созданы с
            <input className={filterInput} type="date" value={searchParams.get('date_from') ?? ''} onChange={(event) => selectFilter('date_from', event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm text-muted">Созданы по
            <input className={filterInput} type="date" value={searchParams.get('date_to') ?? ''} onChange={(event) => selectFilter('date_to', event.target.value)} />
          </label>
          <label className="grid gap-1 text-sm text-muted">Срочные
            <select className={filterInput} value={searchParams.get('urgent') ?? ''} onChange={(event) => selectFilter('urgent', event.target.value)}>
              <option value="">Любые</option><option value="true">Только срочные</option><option value="false">Без срочных</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted">Просроченные
            <select className={filterInput} value={searchParams.get('overdue') ?? ''} onChange={(event) => selectFilter('overdue', event.target.value)}>
              <option value="">Любые</option><option value="true">Только просроченные</option><option value="false">Не просроченные</option>
            </select>
          </label>
          {searchParams.size > 0 && <button className="text-left text-sm text-danger sm:col-span-2 xl:col-span-4" onClick={() => setSearchParams({ tab: currentTab })}>Сбросить фильтры</button>}
        </div>
      )}
      <nav aria-label="Группы заказов" className="mb-3 flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1">
        {tabs.map((tab) => {
          const count = tab.key === 'all'
            ? Object.values(data?.counts ?? {}).reduce((sum, value) => sum + value, 0)
            : data?.counts[tab.key] ?? 0
          return (
            <button
              key={tab.key}
              className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 transition-colors ${currentTab === tab.key ? 'bg-ink font-medium text-white shadow-sm' : 'text-muted hover:bg-canvas hover:text-ink'}`}
              onClick={() => setParam('tab', tab.key)}
            >
              {tab.label} <span className={`num text-xs ${currentTab === tab.key ? 'text-white/60' : 'text-muted'}`}>{count.toLocaleString('ru-RU')}</span>
            </button>
          )
        })}
      </nav>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading && data === null ? (
        <p className="py-6 text-muted">Загрузка заказов…</p>
      ) : data === null ? (
        <p className="py-6 text-muted">Список заказов недоступен.</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Заказов по выбранным условиям нет. Измените фильтры или создайте новый заказ.</p>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {/* Телефон: карточки вместо таблицы — всё главное видно без прокрутки вбок */}
          <ul className="space-y-2 md:hidden">
            {data.items.map((order) => {
              const overdue = order.deadline && new Date(order.deadline).getTime() < Date.now() && order.status.group !== 'closed'
              const device = [order.brand, order.model].filter(Boolean).join(' ')
              return (
                <li key={order.id}>
                  <Link
                    to={`/orders/${order.id}`}
                    className={`block rounded-xl border border-line bg-surface p-3 active:bg-canvas ${order.is_deleted ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-semibold ${order.is_deleted ? 'text-muted line-through' : 'text-accent'}`}>
                        {order.is_urgent && !order.is_deleted && <span aria-label="Срочный заказ" className="mr-1 text-danger">●</span>}
                        {order.number}
                      </span>
                      {order.is_deleted && <span className="rounded bg-[#fef3f2] px-1.5 py-0.5 text-xs font-medium text-danger">удалён</span>}
                      <StatusBadge className="ml-auto" name={order.status.name} color={order.status.color} />
                    </div>
                    <p className="mt-1.5 truncate font-medium">{device || 'Устройство не указано'}</p>
                    {order.problems?.length > 0 && <p className="truncate text-sm text-muted">{order.problems.join(', ')}</p>}
                    <div className="mt-2 flex items-end justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate">{order.counteragent.name}</p>
                        <p className={`text-xs ${overdue ? 'font-medium text-danger' : 'text-muted'}`}>
                          {formatDate(order.created_at)}{order.deadline ? ` · срок ${formatDate(order.deadline)}` : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        {Number(order.total_price) > 0 ? (
                          <>
                            <p className="font-semibold tabular-nums">{formatMoney(order.total_price)}</p>
                            {Number(order.paid) < Number(order.total_price) && <p className="text-xs text-danger">долг {formatMoney(String(Number(order.total_price) - Number(order.paid)))}</p>}
                          </>
                        ) : (
                          <p className="text-muted">{order.approximate_price ? `≈ ${order.approximate_price}` : '—'}</p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
            {/* Строка — одна мысль: заказ, статус, что за аппарат и с чем пришёл, чей, сколько. Второстепенное — мелко под главным */}
            <table className="w-full table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[7.5rem]" />
                <col className="w-[11.5rem]" />
                <col />
                <col className="w-[13rem]" />
                <col className="hidden w-[8rem] xl:table-column" />
                <col className="hidden w-[8.5rem] 2xl:table-column" />
                <col className="w-[8rem]" />
              </colgroup>
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Заказ</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="px-3 py-2 font-medium">Устройство</th>
                  <th className="px-3 py-2 font-medium">Клиент</th>
                  <th className="hidden px-3 py-2 font-medium xl:table-cell">Срок</th>
                  <th className="hidden px-3 py-2 font-medium 2xl:table-cell">Менеджер</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => {
                  const overdue = order.deadline && new Date(order.deadline).getTime() < Date.now() && order.status.group !== 'closed'
                  const device = [order.brand, order.model].filter(Boolean).join(' ')
                  const type = orderTypes.find((t) => t.id === order.order_type_id)?.name
                  return (
                    <tr key={order.id} {...rowLink(`/orders/${order.id}`)} className={`cursor-pointer border-t border-line align-top hover:bg-canvas ${order.is_deleted ? 'text-muted line-through decoration-[#98a2b3] [&_td]:opacity-70' : ''}`}>
                      <td className="px-3 py-2.5">
                        <Link to={`/orders/${order.id}`} className={`num font-semibold hover:underline ${order.is_deleted ? 'text-muted' : 'text-accent'}`}>{order.is_urgent && !order.is_deleted && <span aria-label="Срочный заказ" title="Срочный" className="mr-1 text-danger">●</span>}{order.number}</Link>
                        <small className="block whitespace-nowrap text-xs text-muted" title={formatDate(order.created_at)}>{ago(order.created_at) ?? formatDate(order.created_at).split(',')[0]}</small>
                        {order.is_deleted && <span className="mt-1 inline-block rounded bg-[#fef3f2] px-1.5 py-0.5 text-xs font-medium text-danger [text-decoration:none]">удалён</span>}
                      </td>
                      <td className="px-3 py-2.5"><StatusBadge name={order.status.name} color={order.status.color} /></td>
                      <td className="min-w-0 px-3 py-2.5">
                        <p className="truncate font-medium" title={device}>{device || <span className="text-muted">Не указано</span>}</p>
                        <p className="truncate text-xs text-muted" title={order.problems?.join(', ')}>
                          {order.problems?.join(', ') || '—'}{type && type !== 'Негарантийный' && <span className="ml-1.5 rounded bg-accent-soft px-1 text-accent">{type}</span>}
                        </p>
                      </td>
                      <td className="min-w-0 px-3 py-2.5">
                        <p className="truncate" title={order.counteragent.name}>{order.counteragent.name}</p>
                        <p className="truncate text-xs text-muted num">{formatPhone(order.counteragent.phones?.split(',')[0]) || '—'}</p>
                      </td>
                      <td className={`hidden whitespace-nowrap px-3 py-2.5 xl:table-cell ${overdue ? 'font-medium text-danger' : 'text-muted'}`}>{order.deadline ? formatDate(order.deadline).split(',')[0] : '—'}</td>
                      <td className="hidden truncate px-3 py-2.5 text-muted 2xl:table-cell">{order.manager ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right num">{Number(order.total_price) > 0
                        ? <>
                            <span className="font-medium">{formatMoney(order.total_price)}</span>
                            {Number(order.paid) < Number(order.total_price)
                              ? <small className="block text-xs text-danger">долг {formatMoney(String(Number(order.total_price) - Number(order.paid)))}</small>
                              : <small className="block text-xs text-muted">оплачен</small>}
                          </>
                        : <span className="text-muted">{order.approximate_price ? `≈ ${order.approximate_price}` : '—'}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
            <span>Всего: {data.total}</span>
            <span className="flex items-center gap-3">
              <button disabled={currentPage <= 1} className="text-ink disabled:opacity-40" onClick={() => setParam('page', String(currentPage - 1))}>Назад</button>
              Страница {currentPage} из {pageCount}
              <button disabled={currentPage >= pageCount} className="text-ink disabled:opacity-40" onClick={() => setParam('page', String(currentPage + 1))}>Далее</button>
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
  const time = date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
  const day = (d: Date) => d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
  if (day(date) === day(new Date())) return `сегодня, ${time}`
  if (day(date) === day(new Date(Date.now() - 86400000))) return `вчера, ${time}`
  return null
}
