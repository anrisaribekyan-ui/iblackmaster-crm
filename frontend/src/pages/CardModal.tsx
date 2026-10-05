import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { isoToLocalInput, localInputToIso } from '../format'
import { formatDateTime, inputClass } from './shared'
import { CARD_COLORS, type CardDetail, type ChecklistItem, type EmployeeShort } from './boardsTypes'

type OrderRef = { id: number; number: string }
type CommentRef = { id: number; author_name: string | null; text: string; created_at: string }

export default function CardModal({
  cardId,
  employees,
  onClose,
  onChanged,
}: {
  cardId: number
  employees: EmployeeShort[]
  onClose: () => void
  onChanged: () => void
}) {
  const { me } = useAuth()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [color, setColor] = useState(CARD_COLORS[0])
  const [assigneeId, setAssigneeId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [checklist, setChecklist] = useState<ChecklistItem[]>([])
  const [orderId, setOrderId] = useState<number | null>(null)
  const [orderNumber, setOrderNumber] = useState<string | null>(null)
  const [orderQuery, setOrderQuery] = useState('')
  const [orderResults, setOrderResults] = useState<OrderRef[]>([])
  const [comments, setComments] = useState<CommentRef[]>([])
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const card = await api.get<CardDetail>(`/boards/cards/${cardId}`)
      setTitle(card.title)
      setText(card.text ?? '')
      setColor(card.color ?? CARD_COLORS[0])
      setAssigneeId(card.assignee_id ? String(card.assignee_id) : '')
      setDeadline(isoToLocalInput(card.deadline))
      setChecklist(card.checklist ?? [])
      setOrderId(card.order_id)
      setOrderNumber(card.order_number)
      setOrderQuery(card.order_number ?? '')
      setComments(card.comment_list ?? [])
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить карточку')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [cardId])

  const searchOrders = async (q: string) => {
    setOrderQuery(q)
    if (!q.trim()) {
      setOrderResults([])
      return
    }
    try {
      const res = await api.get<{ items: OrderRef[] }>(`/orders?q=${encodeURIComponent(q.trim())}`)
      setOrderResults(res.items.slice(0, 8))
    } catch {
      setOrderResults([])
    }
  }

  const save = async () => {
    if (!title.trim()) return
    setError('')
    setSaving(true)
    try {
      await api.put(`/boards/cards/${cardId}`, {
        title: title.trim(),
        text: text.trim() ? text.trim() : null,
        color,
        assignee_id: assigneeId ? Number(assigneeId) : null,
        deadline: localInputToIso(deadline),
        order_id: orderId,
        checklist: checklist.map((item) => ({ text: item.text, done: item.done })),
      })
      onChanged()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить карточку')
    } finally {
      setSaving(false)
    }
  }

  const addComment = async (event: FormEvent) => {
    event.preventDefault()
    const value = comment.trim()
    if (!value) return
    try {
      const created = await api.post<CommentRef>(`/boards/cards/${cardId}/comments`, { text: value })
      setComments((prev) => [...prev, { ...created, author_name: created.author_name ?? me?.short_name ?? null }])
      setComment('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось добавить комментарий')
    }
  }

  const toggleCheck = (index: number) => {
    setChecklist((prev) => prev.map((item, i) => (i === index ? { ...item, done: !item.done } : item)))
  }

  const addCheckItem = () => setChecklist((prev) => [...prev, { text: '', done: false }])

  const removeCheckItem = (index: number) => setChecklist((prev) => prev.filter((_, i) => i !== index))

  const setCheckText = (index: number, value: string) => {
    setChecklist((prev) => prev.map((item, i) => (i === index ? { ...item, text: value } : item)))
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 sm:items-center sm:justify-center sm:p-4" role="presentation">
      <section
        aria-modal="true"
        role="dialog"
        className="flex h-full w-full flex-col overflow-hidden bg-surface sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-xl sm:border sm:border-line sm:shadow-xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-lg font-semibold">Карточка</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="text-xl text-muted hover:text-ink">×</button>
        </header>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-muted">Загрузка…</p>
          ) : (
            <div className="grid gap-3">
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}

              <label className="grid gap-1 text-sm text-muted">
                Название
                <textarea autoFocus className={inputClass} rows={2} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>

              <label className="grid gap-1 text-sm text-muted">
                Описание
                <textarea className={inputClass} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
              </label>

              <div className="grid gap-1 text-sm text-muted">
                <span>Цвет</span>
                <div className="flex flex-wrap gap-2">
                  {CARD_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={c}
                      onClick={() => setColor(c)}
                      className={`h-7 w-7 rounded-full ${color === c ? 'ring-2 ring-ink ring-offset-2' : ''}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <label className="grid gap-1 text-sm text-muted">
                Исполнитель
                <select className={inputClass} value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                  <option value="">Не назначен</option>
                  {employees.map((person) => (
                    <option key={person.id} value={person.id}>{person.short_name}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1 text-sm text-muted">
                Срок
                <input type="datetime-local" className={inputClass} value={deadline} onChange={(event) => setDeadline(event.target.value)} />
              </label>

              <div className="grid gap-1 text-sm text-muted">
                <span>Заказ</span>
                {orderId ? (
                  <div className="flex items-center gap-2">
                    <Link className="text-accent hover:underline" to={`/orders/${orderId}`}>{orderNumber}</Link>
                    <button type="button" className="text-muted hover:text-ink" onClick={() => { setOrderId(null); setOrderNumber(null); setOrderQuery('') }}>×</button>
                  </div>
                ) : (
                  <div>
                    <input
                      className={inputClass}
                      placeholder="Номер заказа…"
                      value={orderQuery}
                      onChange={(event) => void searchOrders(event.target.value)}
                    />
                    {orderResults.length > 0 && (
                      <ul className="mt-1 overflow-hidden rounded-md border border-line">
                        {orderResults.map((o) => (
                          <li key={o.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left hover:bg-canvas"
                              onClick={() => { setOrderId(o.id); setOrderNumber(o.number); setOrderQuery(o.number); setOrderResults([]) }}
                            >
                              {o.number}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-1 text-sm text-muted">
                <div className="flex items-center justify-between">
                  <span>Чек-лист</span>
                  <button type="button" className="text-accent hover:underline" onClick={addCheckItem}>+ Пункт</button>
                </div>
                {checklist.length === 0 ? (
                  <p className="text-muted">Пусто.</p>
                ) : (
                  <ul className="grid gap-1">
                    {checklist.map((item, index) => (
                      <li key={index} className="flex items-center gap-2">
                        <input type="checkbox" checked={item.done} onChange={() => toggleCheck(index)} aria-label="Выполнено" />
                        <input
                          className="flex-1 rounded-md border border-line bg-surface px-2 py-1"
                          value={item.text}
                          placeholder="Пункт"
                          onChange={(event) => setCheckText(index, event.target.value)}
                        />
                        <button type="button" className="text-danger" onClick={() => removeCheckItem(index)} aria-label="Удалить пункт">×</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="border-t border-line pt-3">
                <h3 className="mb-2 text-sm font-medium">Комментарии</h3>
                {comments.length === 0 ? (
                  <p className="text-sm text-muted">Комментариев нет.</p>
                ) : (
                  <ul className="grid gap-2">
                    {comments.map((c) => (
                      <li key={c.id} className="rounded-md border border-line bg-canvas px-3 py-2">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{c.author_name ?? '—'}</span>
                          <span className="text-xs text-muted">{formatDateTime(c.created_at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <form onSubmit={(event) => void addComment(event)} className="mt-2 flex gap-2">
                  <input
                    className="flex-1 rounded-md border border-line bg-surface px-3 py-2"
                    placeholder="Написать комментарий"
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                  />
                  <button className="rounded-md bg-accent px-3 py-2 text-accent-ink">Отправить</button>
                </form>
              </div>
            </div>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Закрыть</button>
          <button
            disabled={saving || loading}
            className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60"
            onClick={() => void save()}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </footer>
      </section>
    </div>
  )
}

