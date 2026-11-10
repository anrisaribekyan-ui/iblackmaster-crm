import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'
import { formatDateTime, inputClass, money } from '../shared'
import SalarySettings from './SalarySettings'
import Skeleton from '../../components/Skeleton'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const buttonClass = 'rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas'

type TabKey = 'accruals' | 'payouts' | 'settings'
type ManualKind = 'bonus' | 'penalty'


type MonthRow = {
  year: number
  month: number
  salary: string
  accrued: string
  bonuses: string
  penalties: string
  total: string
  paid: string
  to_pay: string
}
type EventItem = {
  id: number
  date: string
  kind: string
  kind_title: string
  amount: string
  order_id: number | null
  order_number: string | null
  sale_id: number | null
  sale_number: string | null
  details: { base_value?: string; value?: string; value_type?: string } | null
  is_manual: boolean
  note: string | null
}
type Payout = {
  id: number
  date: string
  amount: string
  is_bank: boolean
  cash_register_id: number
  note: string | null
}
type Location = { id: number; name: string }
type CashRegister = { id: number; name: string; location_id: number | null; accepts_cash: boolean; accepts_bank: boolean }
type ShortEmployee = { id: number; short_name: string }


export default function SalaryEmployeePage() {
  const { employeeId } = useParams()
  const { can } = useAuth()
  const id = Number(employeeId)

  const [employeeName, setEmployeeName] = useState('Сотрудник')
  const [tab, setTab] = useState<TabKey>('accruals')
  const [months, setMonths] = useState<MonthRow[] | null>(null)
  const [payouts, setPayouts] = useState<Payout[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [events, setEvents] = useState<EventItem[] | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [modal, setModal] = useState<ManualKind | 'payout' | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [monthsData, payoutsData, locs, regs, employees] = await Promise.all([
        api.get<MonthRow[]>(`/salary/employees/${id}/months`),
        api.get<Payout[]>(`/salary/employees/${id}/payouts`),
        api.get<Location[]>('/locations'),
        api.get<CashRegister[]>('/cash-registers'),
        api.get<ShortEmployee[]>('/employees/short'),
      ])
      setMonths(monthsData)
      setPayouts(payoutsData)
      setLocations(locs)
      setRegisters(regs)
      const found = employees.find((e) => e.id === id)
      if (found) setEmployeeName(found.short_name)
    } catch (e) {
      setMonths(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить зарплату')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const toggleMonth = async (key: string, year: number, month: number) => {
    if (expanded === key) {
      setExpanded(null)
      setEvents(null)
      return
    }
    setExpanded(key)
    setEvents(null)
    try {
      setEvents(await api.get<EventItem[]>(`/salary/employees/${id}/events?year=${year}&month=${month}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить расшифровку')
    }
  }

  const deleteEvent = async (event: EventItem) => {
    if (!confirm('Удалить это начисление?')) return
    try {
      await api.del(`/salary/events/${event.id}`)
      await load()
      if (expanded) {
        const [y, m] = expanded.split('-').map(Number)
        setEvents(await api.get<EventItem[]>(`/salary/employees/${id}/events?year=${y}&month=${m}`))
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить начисление')
    }
  }

  const submitModal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setError('')
    try {
      if (modal === 'payout') {
        await api.post('/salary/payouts', {
          employee_id: id,
          cash_register_id: Number(form.get('cash_register_id')),
          amount: String(form.get('amount') ?? ''),
          is_bank: form.get('is_bank') === 'true',
          note: String(form.get('note') ?? '').trim() || null,
        })
      } else if (modal) {
        await api.post('/salary/events', {
          employee_id: id,
          kind: modal,
          amount: String(form.get('amount') ?? ''),
          date: form.get('date') ? new Date(String(form.get('date'))).toISOString() : null,
          location_id: form.get('location_id') ? Number(form.get('location_id')) : null,
          note: String(form.get('note') ?? '').trim() || null,
        })
      }
      setModal(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const totalRow = months?.reduce(
    (acc, row) => ({
      salary: acc.salary + Number(row.salary),
      accrued: acc.accrued + Number(row.accrued),
      bonuses: acc.bonuses + Number(row.bonuses),
      penalties: acc.penalties + Number(row.penalties),
      total: acc.total + Number(row.total),
      paid: acc.paid + Number(row.paid),
      to_pay: acc.to_pay + Number(row.to_pay),
    }),
    { salary: 0, accrued: 0, bonuses: 0, penalties: 0, total: 0, paid: 0, to_pay: 0 },
  )

  const currentToPay = months?.[0]?.to_pay ?? '0'
  const canManual = can('bonusPenaltyRevenueSalaryAccess')
  const canChange = can('changeSalaryAccess')
  const canPayout = can('cashSalaryAccess')
  const canSettings = can('salarySettingAccess')

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <Link to="/finance/salary" className="text-sm text-muted hover:text-ink">‹ К зарплате</Link>
        <h1 className="text-[22px] font-bold leading-tight md:text-[26px]">{employeeName}</h1>
        <div className="ml-auto flex gap-2">
          {canManual && <button className={buttonClass} onClick={() => setModal('bonus')}>Бонус</button>}
          {canManual && <button className={buttonClass} onClick={() => setModal('penalty')}>Штраф</button>}
          {canPayout && <button className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-ink" onClick={() => setModal('payout')}>Выплатить</button>}
        </div>
      </div>

      <BalanceOnDate employeeId={id} />

      <nav className="mb-4 flex gap-1 border-b border-line">
        <button className={`-mb-px h-10 border-b-2 px-3 ${tab === 'accruals' ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`} onClick={() => setTab('accruals')}>Начисления</button>
        <button className={`-mb-px h-10 border-b-2 px-3 ${tab === 'payouts' ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`} onClick={() => setTab('payouts')}>Выплаты</button>
        {canSettings && <button className={`-mb-px h-10 border-b-2 px-3 ${tab === 'settings' ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`} onClick={() => setTab('settings')}>Настройки</button>}
      </nav>

      {error && <p className="mb-3 text-danger">{error}</p>}

      {loading ? (
        <Skeleton />
      ) : tab === 'settings' ? (
        <SalarySettings employeeId={id} />
      ) : tab === 'accruals' ? (
        months === null ? null : months.length === 0 ? (
          <p className="text-muted">Начислений пока нет.</p>
        ) : (
          <div className="overflow-auto rounded-xl border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Период</th>
                  <th className="px-3 py-2 text-right font-medium">Оклад</th>
                  <th className="px-3 py-2 text-right font-medium">Начисления</th>
                  <th className="px-3 py-2 text-right font-medium">Бонусы</th>
                  <th className="px-3 py-2 text-right font-medium">Штрафы</th>
                  <th className="px-3 py-2 text-right font-medium">Итого</th>
                  <th className="px-3 py-2 text-right font-medium">Выплачено</th>
                  <th className="px-3 py-2 text-right font-medium">К выплате</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {months.map((row) => {
                  const key = `${row.year}-${row.month}`
                  const isOpen = expanded === key
                  return (
                    <>
                      <tr key={key} className="cursor-pointer hover:bg-canvas" onClick={() => void toggleMonth(key, row.year, row.month)}>
                        <td className="px-3 py-2">{MONTHS[row.month - 1]} {row.year}</td>
                        <td className="num px-3 py-2 text-right">{money(row.salary)}</td>
                        <td className="num px-3 py-2 text-right">{money(row.accrued)}</td>
                        <td className="num px-3 py-2 text-right">{money(row.bonuses)}</td>
                        <td className="num px-3 py-2 text-right">{money(row.penalties)}</td>
                        <td className="num px-3 py-2 text-right font-medium">{money(row.total)}</td>
                        <td className="num px-3 py-2 text-right">{money(row.paid)}</td>
                        <td className={`num px-3 py-2 text-right font-medium ${Number(row.to_pay) < 0 ? 'text-danger' : ''}`}>{money(row.to_pay)}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${key}-events`}>
                          <td colSpan={8} className="bg-canvas px-3 py-3">
                            {events === null ? (
                              <Skeleton />
                            ) : events.length === 0 ? (
                              <p className="text-muted">Начислений за месяц нет.</p>
                            ) : (
                              <table className="w-full text-sm">
                                <thead className="text-muted">
                                  <tr>
                                    <th className="px-2 py-1 text-left font-medium">Дата</th>
                                    <th className="px-2 py-1 text-left font-medium">За что</th>
                                    <th className="px-2 py-1 text-left font-medium">Документ</th>
                                    <th className="px-2 py-1 text-right font-medium">База</th>
                                    <th className="px-2 py-1 text-right font-medium">Процент</th>
                                    <th className="px-2 py-1 text-right font-medium">Сумма</th>
                                    <th className="px-2 py-1" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-line">
                                  {events.map((event) => (
                                    <tr key={event.id}>
                                      <td className="whitespace-nowrap px-2 py-1.5">{formatDateTime(event.date)}</td>
                                      <td className="px-2 py-1.5">{event.kind_title}{event.note ? ` · ${event.note}` : ''}</td>
                                      <td className="px-2 py-1.5">
                                        {event.order_id ? (
                                          <Link className="text-accent hover:underline" to={`/orders/${event.order_id}`}>Заказ {event.order_number}</Link>
                                        ) : event.sale_id ? (
                                          <span>Чек {event.sale_number}</span>
                                        ) : (
                                          <span className="text-muted">—</span>
                                        )}
                                      </td>
                                      <td className="num px-2 py-1.5 text-right">{event.details?.base_value ? money(event.details.base_value) : '—'}</td>
                                      <td className="num px-2 py-1.5 text-right">
                                        {event.details?.value ? (event.details.value_type === 'fixed' ? money(event.details.value) : `${event.details.value}%`) : '—'}
                                      </td>
                                      <td className="num px-2 py-1.5 text-right font-medium">{money(event.amount)}</td>
                                      <td className="px-2 py-1.5 text-right">
                                        {event.is_manual && canChange && (
                                          <button className="text-danger" onClick={() => void deleteEvent(event)}>Удалить</button>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
              {totalRow && (
                <tfoot className="border-t border-line font-medium">
                  <tr>
                    <td className="px-3 py-2">Итого</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.salary)}</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.accrued)}</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.bonuses)}</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.penalties)}</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.total)}</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.paid)}</td>
                    <td className="num px-3 py-2 text-right">{money(totalRow.to_pay)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )
      ) : payouts === null ? null : payouts.length === 0 ? (
        <p className="text-muted">Выплат пока нет.</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Дата</th>
                <th className="px-3 py-2 text-right font-medium">Сумма</th>
                <th className="px-3 py-2 text-left font-medium">Тип</th>
                <th className="px-3 py-2 text-left font-medium">Комментарий</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {payouts.map((payout) => (
                <tr key={payout.id}>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(payout.date)}</td>
                  <td className="num px-3 py-2 text-right font-medium">{money(payout.amount)}</td>
                  <td className="px-3 py-2">{payout.is_bank ? 'Безнал' : 'Наличные'}</td>
                  <td className="px-3 py-2">{payout.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'payout' && (
        <Modal title="Выплата зарплаты" onClose={() => setModal(null)}>
          <form onSubmit={(e) => void submitModal(e)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Касса
              <select className={inputClass} name="cash_register_id" required defaultValue="">
                <option value="" disabled>Выберите кассу</option>
                {registers.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Сумма
              <input className={inputClass} name="amount" type="number" step="1" required defaultValue={currentToPay} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Тип средств
              <select className={inputClass} name="is_bank" defaultValue="false">
                <option value="false">Наличные</option>
                <option value="true">Безнал</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Комментарий
              <input className={inputClass} name="note" maxLength={500} />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass} onClick={() => setModal(null)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Выплатить'}</button>
            </div>
          </form>
        </Modal>
      )}

      {(modal === 'bonus' || modal === 'penalty') && (
        <Modal title={modal === 'bonus' ? 'Бонус' : 'Штраф'} onClose={() => setModal(null)}>
          <form onSubmit={(e) => void submitModal(e)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Сумма
              <input className={inputClass} name="amount" type="number" step="1" required min="1" autoFocus />
            </label>
            <label className="grid gap-1 text-sm text-muted">Дата
              <input className={inputClass} name="date" type="datetime-local" />
            </label>
            <label className="grid gap-1 text-sm text-muted">Локация
              <select className={inputClass} name="location_id" defaultValue="">
                <option value="">—</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Комментарий
              <input className={inputClass} name="note" maxLength={500} />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass} onClick={() => setModal(null)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}


// Баланс на начало выбранного дня: сколько начислено/выплачено до этой даты и какой остаток.
function BalanceOnDate({ employeeId }: { employeeId: string | number }) {
  const [day, setDay] = useState('')
  const [data, setData] = useState<{ total: string; paid: string; to_pay: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const show = async (value: string) => {
    setDay(value)
    setData(null)
    if (!value) return
    setBusy(true)
    try {
      setData(await api.get(`/salary/employees/${employeeId}/balance?on=${value}`))
    } catch {
      setData(null)
    } finally {
      setBusy(false)
    }
  }
  const [y, m, d] = day ? day.split('-') : []
  return (
    <section className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface p-3 text-sm">
      <label className="flex items-center gap-2 text-muted">Баланс на начало дня
        <input type="date" className="rounded-md border border-line bg-surface px-2 py-1.5 text-ink" value={day} onChange={(event) => void show(event.target.value)} />
      </label>
      {busy && <span className="text-muted">Считаю…</span>}
      {data && (
        <span>
          На начало {d}.{m}.{y}: начислено <b className="num">{money(data.total)}</b>, выплачено <b className="num">{money(data.paid)}</b>, остаток к выплате <b className="num">{money(data.to_pay)}</b>
        </span>
      )}
    </section>
  )
}
