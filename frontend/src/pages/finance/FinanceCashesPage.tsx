import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type Location = { id: number; name: string }
type CashRegister = {
  id: number
  location_id: number | null
  name: string
  accepts_cash: boolean
  accepts_bank: boolean
  cash_balance: string | null
  bank_balance: string | null
}
type CashItem = { id: number; name: string; is_income: boolean; type: string | null }
type Operation = { kind: 'income' | 'expense' | 'move'; register: CashRegister }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'
const buttonClass = 'rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas'
const money = (value: string | null) => value === null ? '—' : `${Number(value).toLocaleString('ru-RU')} ₽`

export default function FinanceCashesPage() {
  const { can } = useAuth()
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [items, setItems] = useState<CashItem[]>([])
  const [operation, setOperation] = useState<Operation | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canOperate = can('operationCashRegisterAccess')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [cashRegisters, activeLocations, cashItems] = await Promise.all([
        api.get<CashRegister[]>('/cash-registers'),
        api.get<Location[]>('/locations'),
        api.get<CashItem[]>('/cash-items'),
      ])
      setRegisters(cashRegisters)
      setLocations(activeLocations)
      setItems(cashItems)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить кассы')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const submitOperation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!operation) return
    const form = new FormData(event.currentTarget)
    const amount = String(form.get('amount') ?? '')
    const isBank = form.get('is_bank') === 'true'
    const note = String(form.get('note') ?? '').trim() || null
    setSaving(true)
    setError('')
    try {
      if (operation.kind === 'move') {
        await api.post('/transactions/move', {
          from_register_id: operation.register.id,
          to_register_id: Number(form.get('to_register_id')),
          amount,
          is_bank: isBank,
          note,
        })
      } else {
        await api.post('/transactions', {
          cash_register_id: operation.register.id,
          cash_item_id: Number(form.get('cash_item_id')),
          amount,
          is_bank: isBank,
          note,
        })
      }
      setOperation(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось выполнить операцию')
    } finally {
      setSaving(false)
    }
  }

  const locationName = (locationId: number | null) =>
    locationId === null ? 'Общие кассы' : locations.find((location) => location.id === locationId)?.name ?? 'Локация'
  const groups = new Map<number | null, CashRegister[]>()
  for (const register of registers) {
    groups.set(register.location_id, [...(groups.get(register.location_id) ?? []), register])
  }

  return (
    <section>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка касс…</p>
      ) : registers.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-muted">Активных касс нет. Добавьте кассу в настройках локаций.</p>
      ) : (
        <div className="grid gap-6">
          {[...groups.entries()].map(([locationId, groupRegisters]) => (
            <section key={locationId ?? 'global'}>
              <h2 className="mb-3 text-lg font-semibold">{locationName(locationId)}</h2>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {groupRegisters.map((register) => (
                  <article key={register.id} className="rounded-xl border border-line bg-surface p-4">
                    <h3 className="mb-3 font-semibold">{register.name}</h3>
                    <dl className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-sm text-muted">Наличные</dt>
                        <dd className="num font-medium">{register.accepts_cash ? money(register.cash_balance) : '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-sm text-muted">Безналичные</dt>
                        <dd className="num font-medium">{register.accepts_bank ? money(register.bank_balance) : '—'}</dd>
                      </div>
                    </dl>
                    {canOperate && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button className={buttonClass} onClick={() => { setError(''); setOperation({ kind: 'income', register }) }}>Приход</button>
                        <button className={buttonClass} onClick={() => { setError(''); setOperation({ kind: 'expense', register }) }}>Расход</button>
                        <button className={buttonClass} onClick={() => { setError(''); setOperation({ kind: 'move', register }) }}>Перемещение</button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      {operation && (
        <CashOperationModal
          operation={operation}
          registers={registers}
          items={items}
          error={error}
          saving={saving}
          onClose={() => setOperation(null)}
          onSubmit={(event) => void submitOperation(event)}
        />
      )}
    </section>
  )
}

function CashOperationModal({
  operation,
  registers,
  items,
  error,
  saving,
  onClose,
  onSubmit,
}: {
  operation: Operation
  registers: CashRegister[]
  items: CashItem[]
  error: string
  saving: boolean
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const [selectedBankMethod, setSelectedBankMethod] = useState<boolean | null>(null)
  const isMove = operation.kind === 'move'
  const availableItems = items.filter((item) => item.type === null && item.is_income === (operation.kind === 'income'))
  const methods = [
    ...(operation.register.accepts_cash ? [{ value: false, label: 'Наличные' }] : []),
    ...(operation.register.accepts_bank ? [{ value: true, label: 'Безналичные' }] : []),
  ]
  const isBank = selectedBankMethod !== null && methods.some((method) => method.value === selectedBankMethod)
    ? selectedBankMethod
    : methods[0]?.value ?? false
  const compatibleRegisters = registers.filter((register) => (
    register.id !== operation.register.id
    && (isBank ? operation.register.accepts_bank && register.accepts_bank : operation.register.accepts_cash && register.accepts_cash)
  ))
  const showItemWarning = !isMove && availableItems.length === 0
  const showDestinationWarning = isMove && compatibleRegisters.length === 0
  const title = operation.kind === 'income' ? 'Приход денег' : operation.kind === 'expense' ? 'Расход денег' : 'Перемещение между кассами'

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={onSubmit} className="grid gap-3">
        <p className="text-sm text-muted">Касса: <span className="text-ink">{operation.register.name}</span></p>
        {!isMove && (
          <label className="grid gap-1 text-sm text-muted">Статья
            <select className={inputClass} name="cash_item_id" required disabled={showItemWarning} defaultValue="">
              <option value="" disabled>Выберите статью</option>
              {availableItems.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
        {isMove && (
          <label className="grid gap-1 text-sm text-muted">Куда
            <select className={inputClass} name="to_register_id" required disabled={showDestinationWarning} defaultValue="">
              <option value="" disabled>Выберите кассу</option>
              {compatibleRegisters.map((register) => <option key={register.id} value={register.id}>{register.name}</option>)}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm text-muted">Сумма
          <input className={inputClass} name="amount" type="number" min="0.01" step="0.01" required />
        </label>
        <label className="grid gap-1 text-sm text-muted">Тип средств
          <select
            className={inputClass}
            name="is_bank"
            required
            value={methods.some((method) => method.value === isBank) ? String(isBank) : String(methods[0]?.value ?? '')}
            onChange={(event) => setSelectedBankMethod(event.target.value === 'true')}
          >
            {methods.map((method) => <option key={String(method.value)} value={String(method.value)}>{method.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">Комментарий
          <input className={inputClass} name="note" maxLength={1000} />
        </label>
        {showItemWarning && <p className="text-sm text-danger">Нет пользовательских статей этого направления. <Link className="text-accent underline" to="/compendiums/cash-items">Добавить статью</Link></p>}
        {showDestinationWarning && <p className="text-sm text-danger">Нет другой кассы с подходящим типом средств.</p>}
        {methods.length === 0 && <p className="text-sm text-danger">Касса не принимает наличные или безналичные средства.</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass} onClick={onClose}>Отмена</button>
          <button disabled={saving || methods.length === 0 || showItemWarning || showDestinationWarning} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">
            {saving ? 'Выполнение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
