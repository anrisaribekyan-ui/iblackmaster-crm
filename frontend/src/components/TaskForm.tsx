import { useState, type FormEvent } from 'react'
import { isoToLocalInput, localInputToIso } from '../format'
import { inputClass } from '../pages/shared'
import Modal from './Modal'

export type TaskEmployee = { id: number; short_name: string }

export type TaskFormValues = {
  title: string
  text: string | null
  assignee_id: number | null
  deadline: string | null
  order_id: number | null
}

export default function TaskForm({
  employees,
  initial,
  orderId,
  submitLabel = 'Сохранить',
  onSave,
  onClose,
}: {
  employees: TaskEmployee[]
  initial?: Partial<TaskFormValues>
  orderId?: number | null
  submitLabel?: string
  onSave: (values: TaskFormValues) => Promise<void>
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [assigneeId, setAssigneeId] = useState(initial?.assignee_id ? String(initial.assignee_id) : '')
  const [deadline, setDeadline] = useState(isoToLocalInput(initial?.deadline ?? null))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    setError('')
    setSaving(true)
    try {
      await onSave({
        title: title.trim(),
        text: text.trim() ? text.trim() : null,
        assignee_id: assigneeId ? Number(assigneeId) : null,
        deadline: localInputToIso(deadline),
        order_id: orderId ?? null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить задачу')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={initial ? 'Редактировать задачу' : 'Новая задача'} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3">
        <label className="grid gap-1 text-sm text-muted">
          Заголовок
          <input autoFocus className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Описание
          <textarea className={inputClass} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Исполнитель
          <select className={inputClass} value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">Не назначен</option>
            {employees.map((person) => <option key={person.id} value={person.id}>{person.short_name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Срок
          <input type="datetime-local" className={inputClass} value={deadline} onChange={(event) => setDeadline(event.target.value)} />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  )
}
