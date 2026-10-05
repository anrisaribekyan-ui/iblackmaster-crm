import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'

type Location = { id: number; name: string }
type CashRegister = { id: number; location_id: number | null; name: string }
type CashItem = { id: number; name: string }
type Transaction = {
  id: number
  date: string
  cash_register_id: number
  cash_register_name: string | null
  cash_item_id: number
  cash_item_name: string | null
  is_income: boolean
  is_bank: boolean
  amount: string
  balance_after: string
  location_id: number | null
  counteragent_id: number | null
  order_id: number | null
  sale_id: number | null
  stock_document_id: number | null
  note: string | null
  is_deleted: boolean
}
type TransactionPage = { items: Transaction[]; total: number; page: number }
type Filters = { locationId: string; registerId: string; itemId: string; dateFrom: string; dateTo: string; deleted: boolean }

const inputClass = 'rounded-md border border-line bg-surface px-2.5 py-2'
const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  dateStyle: 'short',
  timeStyle: 'short',
})
const money = (value: string) => `${Number(value).toLocaleString('ru-RU')} ₽`

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}

export default function FinanceTransactionsPage() {
  const { can } = useAuth()
  const [locations, setLocations] = useState<Location[]>([])
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [cashItems, setCashItems] = useState<CashItem[]>([])
  const [data, setData] = useState<TransactionPage | null>(null)
  const [filters, setFilters] = useState<Filters>({ locationId: '', registerId: '', itemId: '', dateFrom: '', dateTo: '', deleted: false })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState<number | null>(null)
  const canViewDeleted = can('viewDeleteTransactionAccess')
  const canChange = can('changeTransactionAccess')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (filters.locationId) params.set('location_id', filters.locationId)
      if (filters.registerId) params.set('cash_register_id', filters.registerId)
      if (filters.itemId) params.set('cash_item_id', filters.itemId)
      if (filters.dateFrom) params.set('date_from', filters.dateFrom)
      if (filters.dateTo) params.set('date_to', filters.dateTo)
      if (filters.deleted && canViewDeleted) params.set('deleted', 'true')
      const [result, activeLocations, activeRegisters, activeItems] = await Promise.all([
        api.get<TransactionPage>(`/transactions?${params.toString()}`),
        api.get<Location[]>('/locations'),
        api.get<CashRegister[]>('/cash-registers'),
        api.get<CashItem[]>('/cash-items'),
      ])
      setData(result)
      setLocations(activeLocations)
      setRegisters(activeRegisters)
      setCashItems(activeItems)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить журнал операций')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [canViewDeleted, filters, page])

  useEffect(() => {
    void load()
  }, [load])

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPage(1)
    setFilters({
      locationId: String(form.get('location_id') ?? ''),
      registerId: String(form.get('cash_register_id') ?? ''),
      itemId: String(form.get('cash_item_id') ?? ''),
      dateFrom: String(form.get('date_from') ?? ''),
      dateTo: String(form.get('date_to') ?? ''),
      deleted: canViewDeleted && form.get('deleted') === 'on',
    })
  }

  const updateTransaction = async (transaction: Transaction, restore: boolean) => {
    setActionId(transaction.id)
    setError('')
    try {
      if (restore) await api.post(`/transactions/${transaction.id}/restore`)
      else await api.del(`/transactions/${transaction.id}`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось изменить транзакцию')
    } finally {
      setActionId(null)
    }
  }

  const locationLabel = (id: number | null) =>
    id === null ? 'Общие' : locations.find((location) => location.id === id)?.name ?? '—'
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / 50))

  return (
    <section>
      {!can('transactionAccess') ? (
        <p role="alert" className="rounded-md border border-danger p-3 text-danger">Нет права просматривать журнал транзакций.</p>
      ) : (
        <>
          <form onSubmit={submitFilters} className="mb-4 grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 xl:grid-cols-6">
            <select className={inputClass} name="location_id" defaultValue={filters.locationId} aria-label="Локация">
              <option value="">Все локации</option>
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
            <select className={inputClass} name="cash_register_id" defaultValue={filters.registerId} aria-label="Касса">
              <option value="">Все кассы</option>
              {registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
            </select>
            <select className={inputClass} name="cash_item_id" defaultValue={filters.itemId} aria-label="Статья">
              <option value="">Все статьи</option>
              {cashItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <input className={inputClass} name="date_from" type="date" aria-label="Дата с" defaultValue={filters.dateFrom} />
            <input className={inputClass} name="date_to" type="date" aria-label="Дата по" defaultValue={filters.dateTo} />
            {canViewDeleted && (
              <label className="flex items-center gap-2 text-sm">
                <input name="deleted" type="checkbox" defaultChecked={filters.deleted} />
                Удалённые
              </label>
            )}
            <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink sm:col-span-2 xl:col-span-6">Применить фильтры</button>
          </form>
          {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
          {loading ? (
            <p className="text-muted">Загрузка транзакций…</p>
          ) : data === null ? (
            <p className="text-muted">Не удалось загрузить журнал.</p>
          ) : data.items.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-muted">По выбранным фильтрам транзакций нет.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="border-b border-line text-muted">
                    <tr>
                      <th className="px-3 py-2">Дата</th>
                      <th className="px-3 py-2">Локация / касса</th>
                      <th className="px-3 py-2">Статья</th>
                      <th className="px-3 py-2">Тип</th>
                      <th className="px-3 py-2 text-right">Сумма</th>
                      <th className="px-3 py-2">Комментарий</th>
                      {canChange && <th className="px-3 py-2">Действие</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((transaction) => {
                      const linked = transaction.order_id !== null || transaction.sale_id !== null || transaction.stock_document_id !== null
                      return (
                        <tr key={transaction.id} className={transaction.is_deleted ? 'text-muted' : ''}>
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(transaction.date)}</td>
                          <td className="px-3 py-2">{locationLabel(transaction.location_id)} · {transaction.cash_register_name ?? 'Касса'}</td>
                          <td className="px-3 py-2">{transaction.cash_item_name ?? '—'}</td>
                          <td className="px-3 py-2">{transaction.is_bank ? 'Безнал' : 'Наличные'}</td>
                          <td className={`num whitespace-nowrap px-3 py-2 text-right font-medium ${transaction.is_income ? 'text-success' : 'text-danger'}`}>
                            {transaction.is_income ? '+' : '−'}{money(transaction.amount)}
                          </td>
                          <td className="max-w-64 truncate px-3 py-2">{transaction.note || '—'}</td>
                          {canChange && (
                            <td className="whitespace-nowrap px-3 py-2">
                              {filters.deleted ? (
                                <button disabled={actionId === transaction.id} className="text-accent disabled:opacity-60" onClick={() => void updateTransaction(transaction, true)}>
                                  Восстановить
                                </button>
                              ) : !linked ? (
                                <button disabled={actionId === transaction.id} className="text-danger disabled:opacity-60" onClick={() => {
                                  if (confirm('Удалить транзакцию?')) void updateTransaction(transaction, false)
                                }}>Удалить</button>
                              ) : <span className="text-muted">В документе</span>}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <footer className="mt-3 flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Всего: {data.total}</span>
                <div className="flex items-center gap-2">
                  <button disabled={page <= 1} className="rounded-md border border-line bg-surface px-3 py-1.5 disabled:opacity-50" onClick={() => setPage((current) => current - 1)}>Назад</button>
                  <span className="text-sm text-muted">{page} / {pageCount}</span>
                  <button disabled={page >= pageCount} className="rounded-md border border-line bg-surface px-3 py-1.5 disabled:opacity-50" onClick={() => setPage((current) => current + 1)}>Далее</button>
                </div>
              </footer>
            </>
          )}
        </>
      )}
    </section>
  )
}
