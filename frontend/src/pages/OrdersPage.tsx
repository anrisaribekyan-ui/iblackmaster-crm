import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { formatPhone } from '../format'
import { useAuth } from '../auth'
import { downloadCsv } from '../csv'

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

export default function OrdersPage() {
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

  const queryString = useMemo(() => {
    const params = new URLSearchParams(searchParams)
    if (!params.has('tab')) params.set('tab', 'all')
    return params.toString()
  }, [searchParams])
  const currentTab = (searchParams.get('tab') ?? 'all') as Tab
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
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams(queryString)
      setData(await api.get<OrderList>(`/orders?${params.toString()}`))
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
          {can('createOrderAccess') && <Link className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" to="/orders/new">Создать</Link>}
          <button className="hidden whitespace-nowrap rounded-md border border-line bg-surface px-3 py-2 sm:block" onClick={() => void exportCsv()}>Скачать CSV</button>
        </div>
      </header>
      <form onSubmit={submitSearch} className="mb-3 flex gap-2">
        <input className={`${filterInput} min-w-0 flex-1`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Номер, телефон, имя, серийный номер или модель" />
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
      <nav aria-label="Группы заказов" className="mb-3 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => {
          const count = tab.key === 'all'
            ? Object.values(data?.counts ?? {}).reduce((sum, value) => sum + value, 0)
            : data?.counts[tab.key] ?? 0
          return (
            <button
              key={tab.key}
              className={`whitespace-nowrap border-b-2 px-3 py-2 ${currentTab === tab.key ? 'border-accent font-medium text-ink' : 'border-transparent text-muted'}`}
              onClick={() => setParam('tab', tab.key)}
            >
              {tab.label} <span className="text-xs text-muted">{count}</span>
            </button>
          )
        })}
      </nav>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="py-6 text-muted">Загрузка заказов…</p>
      ) : data === null ? (
        <p className="py-6 text-muted">Список заказов недоступен.</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Заказов по выбранным условиям нет. Измените фильтры или создайте новый заказ.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="bg-canvas text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Заказ</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Крайний срок</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Менеджер</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Создан</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Тип заказа</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Устройство</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Неисправность</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Контрагент</th>
                  <th className="px-3 py-2 text-right font-medium">Сумма</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((order) => {
                  const overdue = order.deadline && new Date(order.deadline).getTime() < Date.now() && order.status.group !== 'closed'
                  return (
                    <tr key={order.id} className="border-t border-line hover:bg-canvas">
                      <td className="px-3 py-2"><Link to={`/orders/${order.id}`} className="font-medium text-accent hover:underline">{order.is_urgent && <span aria-label="Срочный заказ" title="Срочный" className="mr-1 text-danger">●</span>}{order.number}</Link></td>
                      <td className="px-3 py-2"><span className="whitespace-nowrap rounded-full px-2 py-1 text-xs" style={{ color: order.status.color, backgroundColor: `${order.status.color}22` }}>{order.status.name}</span></td>
                      <td className={`hidden px-3 py-2 whitespace-nowrap md:table-cell ${overdue ? 'font-medium text-danger' : ''}`}>{formatDate(order.deadline)}</td>
                      <td className="hidden px-3 py-2 md:table-cell">{order.manager ?? '—'}</td>
                      <td className="hidden px-3 py-2 whitespace-nowrap md:table-cell">{formatDate(order.created_at)}</td>
                      <td className="hidden px-3 py-2 md:table-cell">{orderTypes.find((type) => type.id === order.order_type_id)?.name ?? '—'}</td>
                      <td className="hidden px-3 py-2 md:table-cell">{[order.brand, order.model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="hidden px-3 py-2 md:table-cell">{order.problems?.join(', ') || '—'}</td>
                      <td className="hidden px-3 py-2 md:table-cell">{order.counteragent.name}<small className="block text-muted">{formatPhone(order.counteragent.phones)}</small></td>
                      <td className="px-3 py-2 whitespace-nowrap text-right num">{Number(order.total_price) > 0
                        ? <>{formatMoney(order.total_price)}<small className="block text-muted">Оплачено {formatMoney(order.paid)}</small></>
                        : <span className="text-muted">{order.approximate_price ? `≈ ${order.approximate_price}` : '—'}</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <footer className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>Всего: {data.total}</span>
            <span className="flex items-center gap-3">
              <button disabled={currentPage <= 1} className="text-ink disabled:opacity-40" onClick={() => setParam('page', String(currentPage - 1))}>Назад</button>
              Страница {currentPage} из {pageCount}
              <button disabled={currentPage >= pageCount} className="text-ink disabled:opacity-40" onClick={() => setParam('page', String(currentPage + 1))}>Далее</button>
            </span>
          </footer>
        </>
      )}
    </section>
  )
}
