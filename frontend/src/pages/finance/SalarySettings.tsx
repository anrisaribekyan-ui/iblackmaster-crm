import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import Modal from '../../components/Modal'
import { inputClass, money } from '../shared'

type Kind = { code: string; title: string }
type Location = { id: number; name: string }
type OrderType = { id: number; name: string }
type Step = { from: number; value: number }
type Rule = {
  id: number
  employee_id: number
  kind: string
  kind_title: string
  location_id: number | null
  location_name: string | null
  order_type_id: number | null
  order_type_name: string | null
  base: 'margin' | 'summ'
  value_type: 'percent' | 'fixed'
  steps: Step[]
  accrue_on: 'finish' | 'close'
  discount_by: 'worker' | 'company'
  subtract_negative_margin: boolean
  keep_on_return: boolean
  max_amount: string | null
  options: { isWork?: boolean; isProduct?: boolean }
}

const EXCLUDED_KINDS = new Set(['bonus', 'penalty', 'money', 'revenue'])
const buttonClass = 'rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas'

const COLUMNS = [
  { key: 'general', label: 'Общее', match: (r: Rule) => !r.location_id && !r.order_type_id },
  { key: 'location', label: 'Для локации', match: (r: Rule) => !!r.location_id && !r.order_type_id },
  { key: 'orderType', label: 'По типу заказа', match: (r: Rule) => !r.location_id && !!r.order_type_id },
  { key: 'both', label: 'Локация + тип', match: (r: Rule) => !!r.location_id && !!r.order_type_id },
]

function describeRule(rule: Rule): string {
  const step = rule.steps[0]
  const value = step ? (rule.value_type === 'percent' ? `${step.value}%` : money(step.value)) : ''
  const base = rule.base === 'margin' ? 'от прибыли' : 'от суммы'
  let text = `${value} ${base}`
  if (rule.kind !== 'saleShop') {
    text += `, при ${rule.accrue_on === 'finish' ? 'Готов' : 'Выдан'}`
  }
  return text
}

type Draft = {
  id?: number
  kind: string
  base: 'margin' | 'summ'
  location_id: number | ''
  order_type_id: number | ''
  accrue_on: 'finish' | 'close'
  discount_by: 'worker' | 'company'
  value_type: 'percent' | 'fixed'
  steps: { from: string; value: string }[]
  max_amount: string
  subtract_negative_margin: boolean
  keep_on_return: boolean
  options: { isWork: boolean; isProduct: boolean }
}

const emptyDraft = (kind: string): Draft => ({
  kind,
  base: 'margin',
  location_id: '',
  order_type_id: '',
  accrue_on: 'finish',
  discount_by: 'worker',
  value_type: 'percent',
  steps: [{ from: '0', value: '50' }],
  max_amount: '',
  subtract_negative_margin: false,
  keep_on_return: false,
  options: { isWork: true, isProduct: true },
})

function ruleToDraft(rule: Rule): Draft {
  return {
    id: rule.id,
    kind: rule.kind,
    base: rule.base,
    location_id: rule.location_id ?? '',
    order_type_id: rule.order_type_id ?? '',
    accrue_on: rule.accrue_on,
    discount_by: rule.discount_by,
    value_type: rule.value_type,
    steps: rule.steps.map((s) => ({ from: String(s.from), value: String(s.value) })),
    max_amount: rule.max_amount ?? '',
    subtract_negative_margin: rule.subtract_negative_margin,
    keep_on_return: rule.keep_on_return,
    options: { isWork: !!rule.options?.isWork, isProduct: !!rule.options?.isProduct },
  }
}

export default function SalarySettings({ employeeId }: { employeeId: number }) {
  const [kinds, setKinds] = useState<Kind[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [orderTypes, setOrderTypes] = useState<OrderType[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [recalcOpen, setRecalcOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [recalcResult, setRecalcResult] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [kindsData, locs, types, rulesData] = await Promise.all([
        api.get<Kind[]>('/salary/kinds'),
        api.get<Location[]>('/locations'),
        api.get<OrderType[]>('/order-types'),
        api.get<Rule[]>(`/salary/rules?employee_id=${employeeId}`),
      ])
      setKinds(kindsData.filter((k) => !EXCLUDED_KINDS.has(k.code)))
      setLocations(locs)
      setOrderTypes(types)
      setRules(rulesData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить настройки зарплаты')
    } finally {
      setLoading(false)
    }
  }, [employeeId])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = (kind: string) => setDraft(emptyDraft(kind))
  const openEdit = (rule: Rule) => setDraft(ruleToDraft(rule))

  const saveRule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!draft) return
    setSaving(true)
    setError('')
    const isSale = draft.kind === 'saleShop'
    const isNewOrder = draft.kind === 'newOrder'
    const payload = {
      employee_id: employeeId,
      kind: draft.kind,
      base: draft.base,
      location_id: draft.location_id === '' ? null : Number(draft.location_id),
      order_type_id: draft.order_type_id === '' ? null : Number(draft.order_type_id),
      accrue_on: draft.accrue_on,
      discount_by: draft.discount_by,
      value_type: draft.value_type,
      steps: draft.steps.map((s) => ({ from: Number(s.from), value: Number(s.value) })),
      max_amount: draft.max_amount === '' ? null : draft.max_amount,
      subtract_negative_margin: draft.subtract_negative_margin,
      keep_on_return: draft.keep_on_return,
      options: isSale || isNewOrder ? { isWork: draft.options.isWork, isProduct: draft.options.isProduct } : {},
    }
    try {
      if (draft.id) {
        await api.put(`/salary/rules/${draft.id}`, payload)
      } else {
        await api.post('/salary/rules', payload)
      }
      setDraft(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить правило')
    } finally {
      setSaving(false)
    }
  }

  const deleteRule = async (rule: Rule) => {
    if (!confirm('Удалить это начисление?')) return
    try {
      await api.del(`/salary/rules/${rule.id}`)
      setDraft(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить правило')
    }
  }

  const submitRecalc = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setSaving(true)
    setRecalcResult('')
    try {
      const result = await api.post<{ documents: number }>('/salary/recalc', {
        year: Number(form.get('year')),
        month: Number(form.get('month')),
      })
      setRecalcResult(`Пересчитано документов: ${result.documents}`)
      setRecalcOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось пересчитать')
    } finally {
      setSaving(false)
    }
  }

  const setStep = (index: number, patch: Partial<Draft['steps'][number]>) => {
    if (!draft) return
    setDraft({
      ...draft,
      steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    })
  }

  const addStep = () => {
    if (!draft) return
    setDraft({ ...draft, steps: [...draft.steps, { from: '0', value: '0' }] })
  }

  const removeStep = (index: number) => {
    if (!draft) return
    setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })
  }

  const isSale = draft?.kind === 'saleShop'
  const isNewOrder = draft?.kind === 'newOrder'
  const showOptions = isSale || isNewOrder
  const now = new Date()

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button className={buttonClass} onClick={() => setRecalcOpen(true)}>Пересчитать зарплату</button>
      </div>

      {error && <p className="mb-3 text-danger">{error}</p>}
      {recalcResult && <p className="mb-3 text-success">{recalcResult}</p>}

      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : kinds.length === 0 ? (
        <p className="text-muted">Видов начислений нет.</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Вид начисления</th>
                {COLUMNS.map((col) => <th key={col.key} className="px-3 py-2 text-left font-medium">{col.label}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {kinds.map((kind) => (
                <tr key={kind.code}>
                  <td className="px-3 py-2 align-top font-medium">{kind.title}</td>
                  {COLUMNS.map((col) => {
                    const cellRules = rules.filter((r) => r.kind === kind.code && col.match(r))
                    return (
                      <td key={col.key} className="px-3 py-2 align-top">
                        <div className="flex flex-col gap-1.5">
                          {cellRules.map((rule) => (
                            <button
                              key={rule.id}
                              className="rounded-md border border-line bg-canvas px-2 py-1 text-left text-xs hover:border-accent"
                              onClick={() => openEdit(rule)}
                            >
                              {describeRule(rule)}
                            </button>
                          ))}
                          <button className="text-xs text-accent hover:underline" onClick={() => openCreate(kind.code)}>
                            + Добавить начисление
                          </button>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <Modal title={draft.id ? 'Начисление' : 'Новое начисление'} onClose={() => setDraft(null)}>
          <form onSubmit={(e) => void saveRule(e)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Вид начисления
              <select className={inputClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {kinds.map((kind) => <option key={kind.code} value={kind.code}>{kind.title}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Показатель
              <select className={inputClass} value={draft.base} onChange={(e) => setDraft({ ...draft, base: e.target.value as 'margin' | 'summ' })}>
                <option value="margin">Валовая прибыль</option>
                <option value="summ">Стоимость</option>
              </select>
            </label>
            {!isSale && (
              <label className="grid gap-1 text-sm text-muted">Тип заказа
                <select className={inputClass} value={draft.order_type_id} onChange={(e) => setDraft({ ...draft, order_type_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                  <option value="">Любой</option>
                  {orderTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-sm text-muted">Локация
              <select className={inputClass} value={draft.location_id} onChange={(e) => setDraft({ ...draft, location_id: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">Все</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            {!isSale && (
              <label className="grid gap-1 text-sm text-muted">Начислять, когда заказ
                <select className={inputClass} value={draft.accrue_on} onChange={(e) => setDraft({ ...draft, accrue_on: e.target.value as 'finish' | 'close' })}>
                  <option value="finish">Готов</option>
                  <option value="close">Выдан</option>
                </select>
              </label>
            )}
            <label className="grid gap-1 text-sm text-muted">Скидка за счёт
              <select className={inputClass} value={draft.discount_by} onChange={(e) => setDraft({ ...draft, discount_by: e.target.value as 'worker' | 'company' })}>
                <option value="worker">Сотрудника</option>
                <option value="company">Компании</option>
              </select>
            </label>
            {showOptions && (
              <div className="grid gap-1 text-sm text-muted">
                <span>Что начислять</span>
                <label className="flex items-center gap-2 text-ink">
                  <input type="checkbox" checked={draft.options.isWork} onChange={(e) => setDraft({ ...draft, options: { ...draft.options, isWork: e.target.checked } })} />
                  Работы
                </label>
                <label className="flex items-center gap-2 text-ink">
                  <input type="checkbox" checked={draft.options.isProduct} onChange={(e) => setDraft({ ...draft, options: { ...draft.options, isProduct: e.target.checked } })} />
                  Запчасти
                </label>
              </div>
            )}
            <div className="grid gap-1 text-sm text-muted">
              <div className="flex items-center gap-2">
                <span>Начислять</span>
                <select className="rounded-md border border-line bg-surface px-2 py-1" value={draft.value_type} onChange={(e) => setDraft({ ...draft, value_type: e.target.value as 'percent' | 'fixed' })}>
                  <option value="percent">%</option>
                  <option value="fixed">₽</option>
                </select>
              </div>
              {draft.steps.map((step, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input className={inputClass} type="number" step="1" value={step.value} onChange={(e) => setStep(index, { value: e.target.value })} placeholder="Значение" />
                  <span>{draft.value_type === 'percent' ? '%' : '₽'}</span>
                  <span>если показатель ≥</span>
                  <input className={inputClass} type="number" step="1" value={step.from} onChange={(e) => setStep(index, { from: e.target.value })} placeholder="0" />
                  <button type="button" className="text-danger" disabled={draft.steps.length <= 1} onClick={() => removeStep(index)}>×</button>
                </div>
              ))}
              <button type="button" className="text-xs text-accent hover:underline" onClick={addStep}>+ Добавить правило</button>
            </div>
            <label className="grid gap-1 text-sm text-muted">Не более
              <input className={inputClass} type="number" step="1" value={draft.max_amount} onChange={(e) => setDraft({ ...draft, max_amount: e.target.value })} placeholder="Без ограничения" />
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={draft.subtract_negative_margin} onChange={(e) => setDraft({ ...draft, subtract_negative_margin: e.target.checked })} />
              Вычитать отрицательную прибыль
            </label>
            {isSale && (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={draft.keep_on_return} onChange={(e) => setDraft({ ...draft, keep_on_return: e.target.checked })} />
                Не удалять зарплату при возврате
              </label>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-between gap-2">
              {draft.id ? (
                <button type="button" className="text-danger" onClick={() => void deleteRule(rules.find((r) => r.id === draft.id) as Rule)}>Удалить</button>
              ) : <span />}
              <div className="flex gap-2">
                <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Отмена</button>
                <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {recalcOpen && (
        <Modal title="Пересчитать зарплату" onClose={() => setRecalcOpen(false)}>
          <form onSubmit={(e) => void submitRecalc(e)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Месяц
              <select className={inputClass} name="month" defaultValue={now.getMonth() + 1}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Год
              <input className={inputClass} name="year" type="number" defaultValue={now.getFullYear()} />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass} onClick={() => setRecalcOpen(false)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Пересчёт…' : 'Пересчитать'}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}


