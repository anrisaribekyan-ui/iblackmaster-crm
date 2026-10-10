import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import TaskForm, { type TaskEmployee, type TaskFormValues } from '../components/TaskForm'
import { formatDateTime } from './shared'

type Task = {
  id: number
  title: string
  text: string | null
  location_id: number | null
  order_id: number | null
  order_number: string | null
  author_name: string | null
  assignee_id: number | null
  assignee_name: string | null
  deadline: string | null
  is_done: boolean
  done_at: string | null
  created_at: string
}
type TaskList = { total: number; items: Task[] }
type Tab = 'open' | 'overdue' | 'done' | 'all'

const tabs: { key: Tab; label: string }[] = [
  { key: 'open', label: 'Открытые' },
  { key: 'overdue', label: 'Просроченные' },
  { key: 'done', label: 'Выполненные' },
  { key: 'all', label: 'Все' },
]

export default function TasksPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<Tab>('open')
  const [assigneeId, setAssigneeId] = useState('')
  const [employees, setEmployees] = useState<TaskEmployee[]>([])
  const [data, setData] = useState<TaskList | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const canCreate = can('createTaskAccess')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ status: tab })
      if (assigneeId) params.set('assignee_id', assigneeId)
      setData(await api.get<TaskList>(`/tasks?${params.toString()}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить задачи')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tab, assigneeId])

  useEffect(() => {
    api.get<TaskEmployee[]>('/employees/short').then(setEmployees).catch(() => setEmployees([]))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (task: Task) => {
    setError('')
    try {
      await api.post(`/tasks/${task.id}/${task.is_done ? 'reopen' : 'done'}`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось изменить задачу')
    }
  }

  const remove = async (task: Task) => {
    if (!confirm(`Удалить задачу «${task.title}»?`)) return
    setError('')
    try {
      await api.del(`/tasks/${task.id}`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить задачу')
    }
  }

  const create = async (values: TaskFormValues) => {
    await api.post('/tasks', values)
    await load()
  }

  const update = (task: Task) => async (values: TaskFormValues) => {
    await api.put(`/tasks/${task.id}`, values)
    await load()
  }

  return (
    <section>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Задачи</h1>
        {canCreate && <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink" onClick={() => setCreating(true)}>Новая задача</button>}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav className="flex max-w-full gap-1 overflow-x-auto border-b border-line">
          {tabs.map((t) => (
            <button key={t.key} className={`whitespace-nowrap border-b-2 px-3 py-2 ${tab === t.key ? 'border-accent font-medium' : 'border-transparent text-muted'}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <label className="flex items-center gap-2 text-sm text-muted">
          Исполнитель
          <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Все</option>
            {employees.map((person) => <option key={person.id} value={person.id}>{person.short_name}</option>)}
          </select>
        </label>
      </div>

      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка задач…</p>
      ) : data === null ? (
        <p className="text-muted">Список задач недоступен.</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Задач нет. Создайте первую — она появится здесь.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs text-muted">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 font-medium">Задача</th>
                <th className="px-3 py-2 font-medium">Исполнитель</th>
                <th className="px-3 py-2 font-medium">Срок</th>
                <th className="px-3 py-2 font-medium">Заказ</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.items.map((task) => {
                const overdue = !task.is_done && task.deadline && new Date(task.deadline).getTime() < Date.now()
                return (
                  <tr key={task.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={task.is_done} onChange={() => void toggle(task)} aria-label="Выполнено" />
                    </td>
                    <td className="cursor-pointer px-3 py-2" onClick={() => setEditing(task)}>
                      <span className={task.is_done ? 'text-muted line-through' : ''}>{task.title}</span>
                      {task.text && <small className="block text-muted">{task.text}</small>}
                    </td>
                    <td className="px-3 py-2">{task.assignee_name ?? '—'}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${overdue ? 'font-medium text-danger' : ''}`}>{formatDateTime(task.deadline)}</td>
                    <td className="px-3 py-2">{task.order_id ? <Link className="text-accent hover:underline" to={`/orders/${task.order_id}`}>{task.order_number}</Link> : '—'}</td>
                    <td className="px-3 py-2 text-right"><button className="text-danger" onClick={() => void remove(task)}>Удалить</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && <TaskForm employees={employees} onSave={create} onClose={() => setCreating(false)} />}
      {editing && (
        <TaskForm
          employees={employees}
          initial={{ title: editing.title, text: editing.text ?? '', assignee_id: editing.assignee_id, deadline: editing.deadline, order_id: editing.order_id }}
          orderId={editing.order_id}
          onSave={update(editing)}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
