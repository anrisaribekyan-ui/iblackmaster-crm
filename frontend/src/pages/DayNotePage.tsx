import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { inputClass, money, useLocationsAndRegisters, type CashRegisterRef } from './shared'

type Candidate = { order_id: number; location_id: number; number: string; label: string; client: string; debt: number; status: string; ready: boolean }
type Product = { nomenclature_id: number; name: string; is_work: boolean }
type Item = {
  kind: 'sale' | 'give_order' | 'payment' | 'other'
  text: string
  title: string
  amount: number | null
  method: 'cash' | 'bank' | null
  person: string | null
  is_work?: boolean
  no_cost?: boolean
  guarantee_days?: number | null
  candidates: Candidate[]
  products: Product[]
  status: 'new' | 'applied' | 'skipped'
  ref: string | null
}
type Note = { id: number; text: string; items: Item[]; analyzed_at: string | null; analyzed_by: 'ai' | 'rules' | null; ai_enabled: boolean }
type StatusGroup = { group: string; statuses: { id: number; comment_mode: string }[] }

const KIND_TITLE: Record<Item['kind'], string> = {
  sale: 'Продажа',  // для работы название берём ниже
  give_order: 'Выдача ремонта',
  payment: 'Оплата по ремонту',
  other: 'Не распознано',
}

/** Касса для способа оплаты: сначала кассы нужной точки, потом общие. */
function pickRegister(registers: CashRegisterRef[], locationId: number | null, bank: boolean): CashRegisterRef | undefined {
  return registers
    .filter((r) => (bank ? r.accepts_bank : r.accepts_cash) && (r.location_id === null || r.location_id === locationId))
    .sort((a, b) => Number(a.location_id === null) - Number(b.location_id === null))[0]
}

export default function DayNotePage() {
  const { locations, registers } = useLocationsAndRegisters()
  const [note, setNote] = useState<Note | null>(null)
  const [text, setText] = useState('')
  const [aiEnabled, setAiEnabled] = useState(false)
  const [locationId, setLocationId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const noteRef = useRef<Note | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const lastSaved = useRef('')

  useEffect(() => {
    api.get<{ ai_enabled: boolean; items: Note[] }>('/day-notes')
      .then((result) => {
        const first = result.items[0] ?? null
        setAiEnabled(result.ai_enabled)
        if (first) {
          noteRef.current = first
          setNote(first)
          setText(first.text)
          lastSaved.current = first.text
        }
      })
      .catch(() => setError('Не удалось загрузить заметку'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (locationId === null && locations.length) setLocationId(locations[0].id)
  }, [locations, locationId])

  const save = useCallback(async (value: string): Promise<Note | null> => {
    if (value === lastSaved.current && noteRef.current) return noteRef.current
    setSaved('saving')
    try {
      const current = noteRef.current
      const result = current
        ? await api.put<Note>(`/day-notes/${current.id}`, { text: value })
        : await api.post<Note>('/day-notes', { text: value, location_id: locationId })
      lastSaved.current = value
      noteRef.current = { ...result, items: current?.items ?? result.items }
      setNote((prev) => (prev ? { ...prev, text: result.text } : noteRef.current))
      setSaved('saved')
      return noteRef.current
    } catch (e) {
      setSaved('idle')
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить заметку')
      return null
    }
  }, [locationId])

  // Пишет — сохраняется само, через секунду после последней буквы: заметку нельзя потерять
  const onType = (value: string) => {
    setText(value)
    setSaved('idle')
    window.clearTimeout(timer.current)
    if (value.trim()) timer.current = window.setTimeout(() => void save(value), 1000)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const analyze = async () => {
    window.clearTimeout(timer.current)
    setError('')
    setAnalyzing(true)
    try {
      const current = await save(text)
      if (!current) return
      const result = await api.post<Note>(`/day-notes/${current.id}/analyze`, {})
      noteRef.current = result
      setNote(result)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось разобрать заметку')
    } finally {
      setAnalyzing(false)
    }
  }

  const onItemChanged = (updated: Note) => {
    noteRef.current = updated
    setNote(updated)
  }

  const pending = note?.items.filter((i) => i.status === 'new' && i.kind !== 'other').length ?? 0

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold">Что сегодня было</h1>
      <p className="mb-4 text-muted">Пишите как удобно: кто, что, сколько, нал или безнал. Потом нажмите «Разобрать» — CRM предложит, что внести в заказы и продажи.</p>

      {error && <p className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-700" role="alert">{error}</p>}

      {loading ? <p className="text-muted">Загрузка…</p> : (
        <>
          <textarea
            className={`${inputClass} min-h-40 text-base`}
            placeholder={'Аля / Стекло 700 ремакс. Нал / Айфон8 выдал оплатили безнал / А51 выдал нал'}
            value={text}
            onChange={(e) => onType(e.target.value)}
            onBlur={() => { window.clearTimeout(timer.current); if (text.trim()) void save(text) }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
              disabled={analyzing || !text.trim()}
              onClick={analyze}
            >
              {analyzing ? 'Разбираю…' : 'Разобрать'}
            </button>
            {locations.length > 1 && (
              <select className="rounded-md border border-line bg-surface px-3 py-2" value={locationId ?? ''} onChange={(e) => setLocationId(Number(e.target.value))} disabled={Boolean(note)} aria-label="Точка">
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
            <span className="text-sm text-muted" aria-live="polite">
              {saved === 'saving' ? 'Сохраняю…' : saved === 'saved' ? 'Сохранено' : ''}
            </span>
          </div>
          {!aiEnabled && <p className="mt-2 text-sm text-muted">ИИ не подключён — заметка разбирается простыми правилами. Они понимают «нал», «безнал», «выдал» и суммы; сложные фразы лучше проверять глазами.</p>}
        </>
      )}

      {note && note.analyzed_at && (
        <section className="mt-6" aria-label="Что нашлось в заметке">
          <h2 className="mb-2 text-lg font-semibold">
            {note.items.length === 0 ? 'Ничего не нашлось' : pending > 0 ? `Осталось внести: ${pending}` : note.items.some((i) => i.kind !== 'other' && i.status === 'applied') ? 'Всё внесено' : 'Внести нечего'}
          </h2>
          <div className="flex flex-col gap-3">
            {note.items.map((item, index) => (
              <ItemCard
                key={`${index}:${item.text}`}
                noteId={note.id}
                index={index}
                item={item}
                locations={locations}
                registers={registers}
                fallbackLocationId={locationId}
                onChanged={onItemChanged}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ItemCard({ noteId, index, item, locations, registers, fallbackLocationId, onChanged }: {
  noteId: number
  index: number
  item: Item
  locations: { id: number; stores: { id: number; is_default: boolean }[] }[]
  registers: CashRegisterRef[]
  fallbackLocationId: number | null
  onChanged: (note: Note) => void
}) {
  const [orderId, setOrderId] = useState<string>(String(item.candidates[0]?.order_id ?? ''))
  const [productId, setProductId] = useState<string>(String(item.products[0]?.nomenclature_id ?? ''))
  const [name, setName] = useState(item.title)
  const [amount, setAmount] = useState<string>(item.amount !== null ? String(item.amount) : item.candidates[0] ? String(item.candidates[0].debt) : '')
  const [bank, setBank] = useState(item.method === 'bank')
  const [noStock, setNoStock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const candidate = useMemo(() => item.candidates.find((c) => String(c.order_id) === orderId), [item.candidates, orderId])
  const done = item.status !== 'new'

  const mark = async (status: 'applied' | 'skipped', ref: string | null = null) => {
    onChanged(await api.patch<Note>(`/day-notes/${noteId}/items/${index}`, { status, ref }))
  }

  const pickOrder = (value: string) => {
    setOrderId(value)
    const next = item.candidates.find((c) => String(c.order_id) === value)
    if (next && item.amount === null) setAmount(String(next.debt))
  }

  const applyOrder = async () => {
    if (!candidate) return
    setBusy(true)
    setError('')
    try {
      const sum = Number(amount)
      if (candidate.debt > 0 || sum > 0) {
        const register = pickRegister(registers, candidate.location_id, bank)
        if (!register) throw new ApiError(400, 'business_error', bank ? 'Нет кассы для безналичной оплаты' : 'Нет кассы для наличных')
        if (!(sum > 0)) throw new ApiError(400, 'business_error', 'Укажите сумму оплаты')
        await api.post(`/orders/${candidate.order_id}/payments`, { cash_register_id: register.id, amount: String(sum), is_bank: bank, note: 'Из заметки «что сегодня было»' })
      }
      if (item.kind === 'give_order') {
        const groups = await api.get<StatusGroup[]>('/order-statuses')
        const closed = groups.find((g) => g.group === 'closed')?.statuses[0]
        if (!closed) throw new ApiError(400, 'business_error', 'Не настроен статус выдачи заказа')
        if (closed.comment_mode === 'required') throw new ApiError(400, 'business_error', 'Для выдачи нужен комментарий — выдайте заказ вручную из карточки')
        await api.post(`/orders/${candidate.order_id}/status`, { status_id: closed.id, comment: null })
      }
      await mark('applied', `order:${candidate.number}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось внести')
    } finally {
      setBusy(false)
    }
  }

  const applySale = async () => {
    setBusy(true)
    setError('')
    try {
      const sum = Number(amount)
      if (!(sum > 0)) throw new ApiError(400, 'business_error', 'Укажите сумму продажи')
      const locId = fallbackLocationId ?? locations[0]?.id
      const location = locations.find((l) => l.id === locId)
      const store = location?.stores.find((s) => s.is_default) ?? location?.stores[0]
      if (!location || !store) throw new ApiError(400, 'business_error', 'Не найдена точка или склад')
      const register = pickRegister(registers, location.id, bank)
      if (!register) throw new ApiError(400, 'business_error', bank ? 'Нет кассы для безналичной оплаты' : 'Нет кассы для наличных')
      const position = productId
        ? { nomenclature_id: Number(productId), quantity: '1', price: String(sum), no_stock: noStock }
        : { name: name.trim() || 'Товар', is_work: Boolean(item.is_work), quantity: '1', price: String(sum), purchase_price: '0', no_stock: true, ...(item.guarantee_days != null ? { guarantee_days: item.guarantee_days } : {}) }
      const sale = await api.post<{ number: string }>('/sales', {
        location_id: location.id,
        store_id: store.id,
        positions: [position],
        payments: [{ cash_register_id: register.id, amount: String(sum), is_bank: bank }],
        note: item.person ? `Из заметки (${item.person})` : 'Из заметки «что сегодня было»',
      })
      await mark('applied', `sale:${sale.number}`)
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Не удалось внести продажу'
      if (/недостаточно/i.test(message)) {
        setNoStock(true)
        setError(`${message}. Галочка «Не списывать со склада» поставлена — нажмите «Внести продажу» ещё раз.`)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  const skip = async () => {
    setBusy(true)
    try { await mark('skipped') } catch { setError('Не удалось пропустить') } finally { setBusy(false) }
  }

  return (
    <article className={`rounded-xl border border-line bg-surface p-4 ${done ? 'opacity-60' : ''}`}>
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <b>{item.kind === 'sale' && item.is_work ? 'Работа (розница)' : KIND_TITLE[item.kind]}</b>{item.no_cost && <span className="text-sm text-muted">без себестоимости</span>}
        {item.person && <span className="text-sm text-muted">{item.person}</span>}
        {item.status === 'applied' && <span className="rounded bg-green-100 px-2 text-sm text-green-800">внесено{item.ref ? ` · ${item.ref.replace(/^\w+:/, '')}` : ''}</span>}
        {item.status === 'skipped' && <span className="rounded bg-black/5 px-2 text-sm text-muted">пропущено</span>}
      </div>
      <p className="mb-3 text-muted">«{item.text}»</p>

      {!done && item.kind === 'other' && (
        <button type="button" className="rounded-md border border-line px-3 py-2" onClick={skip} disabled={busy}>Понятно, пропустить</button>
      )}

      {!done && (item.kind === 'give_order' || item.kind === 'payment') && (
        <div className="flex flex-col gap-3">
          {item.candidates.length === 0 ? (
            <p className="text-amber-700">Подходящий открытый заказ не найден — найдите его в «Заказах» и выдайте вручную.</p>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted">Какой заказ</span>
              <select className={inputClass} value={orderId} onChange={(e) => pickOrder(e.target.value)}>
                {item.candidates.map((c) => (
                  <option key={c.order_id} value={c.order_id}>{c.number} · {c.label} · {c.client} · долг {money(c.debt)}{c.ready ? ' · готов' : ` · ${c.status}`}</option>
                ))}
              </select>
            </label>
          )}
          {candidate && (
            <PayFields amount={amount} setAmount={setAmount} bank={bank} setBank={setBank}
              hint={candidate.debt > 0 ? `Долг по заказу: ${money(candidate.debt)}` : 'Заказ уже оплачен — сумму можно не вносить'} />
          )}
          <Actions busy={busy} canApply={Boolean(candidate)} applyLabel={item.kind === 'give_order' ? 'Внести оплату и выдать' : 'Внести оплату'} onApply={applyOrder} onSkip={skip} />
        </div>
      )}

      {!done && item.kind === 'sale' && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Что продали</span>
            <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
              {item.products.map((p) => <option key={p.nomenclature_id} value={p.nomenclature_id}>{p.name}</option>)}
              <option value="">Свободная позиция (нет в справочнике)</option>
            </select>
          </label>
          {!productId && (
            <label className="flex flex-col gap-1">
              <span className="text-sm text-muted">Название в чеке</span>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          {productId && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={noStock} onChange={(e) => setNoStock(e.target.checked)} />
              Не списывать со склада (если остатка нет)
            </label>
          )}
          <PayFields amount={amount} setAmount={setAmount} bank={bank} setBank={setBank} />
          <Actions busy={busy} canApply applyLabel="Внести продажу" onApply={applySale} onSkip={skip} />
        </div>
      )}

      {error && <p className="mt-2 text-red-700" role="alert">{error}</p>}
    </article>
  )
}

function PayFields({ amount, setAmount, bank, setBank, hint }: {
  amount: string
  setAmount: (v: string) => void
  bank: boolean
  setBank: (v: boolean) => void
  hint?: string
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Сумма, ₽</span>
        <input className={`${inputClass} w-36`} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
      </label>
      <div className="flex overflow-hidden rounded-md border border-line" role="group" aria-label="Способ оплаты">
        <button type="button" aria-pressed={!bank} className={`px-4 py-2 ${!bank ? 'bg-accent text-accent-ink' : ''}`} onClick={() => setBank(false)}>Нал</button>
        <button type="button" aria-pressed={bank} className={`px-4 py-2 ${bank ? 'bg-accent text-accent-ink' : ''}`} onClick={() => setBank(true)}>Безнал</button>
      </div>
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </div>
  )
}

function Actions({ busy, canApply, applyLabel, onApply, onSkip }: { busy: boolean; canApply: boolean; applyLabel: string; onApply: () => void; onSkip: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50" disabled={busy || !canApply} onClick={onApply}>
        {busy ? 'Вношу…' : applyLabel}
      </button>
      <button type="button" className="rounded-lg border border-line px-4 py-2.5 disabled:opacity-50" disabled={busy} onClick={onSkip}>Пропустить</button>
    </div>
  )
}
