/**
 * ОБРАЗЕЦ страницы справочника: список + добавление + переименование + удаление.
 * Новые справочники делай по этому шаблону (тот же вид, те же состояния загрузки и ошибок).
 */
import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'

type HowKnow = { id: number; name: string; is_active: boolean }

export default function HowKnowsPage() {
  const { can } = useAuth()
  const canEdit = can('howKnowAccess')
  const [items, setItems] = useState<HowKnow[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      setItems(await api.get<HowKnow[]>('/how-knows'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить список')
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setError('')
    try {
      await api.post('/how-knows', { name })
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить')
    }
  }

  const rename = async (item: HowKnow) => {
    const next = prompt('Новое название', item.name)
    if (!next || next === item.name) return
    await api.put(`/how-knows/${item.id}`, { name: next })
    await load()
  }

  const remove = async (item: HowKnow) => {
    if (!confirm(`Удалить «${item.name}»?`)) return
    await api.del(`/how-knows/${item.id}`)
    await load()
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-4 text-xl font-semibold">Источники рекламы</h1>

      {canEdit && (
        <form onSubmit={add} className="mb-4 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, 2ГИС"
            className="flex-1 rounded-md border border-line bg-surface px-3 py-2"
          />
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink">Добавить</button>
        </form>
      )}

      {error && <p className="mb-3 text-danger">{error}</p>}

      {items === null ? (
        <p className="text-muted">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-muted">Источников пока нет. Добавьте первый — он появится в форме заказа.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-4 py-2.5">
              <span>{item.name}</span>
              {canEdit && (
                <span className="flex gap-3 text-sm">
                  <button onClick={() => rename(item)} className="text-muted hover:text-ink">
                    Переименовать
                  </button>
                  <button onClick={() => remove(item)} className="text-danger">
                    Удалить
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
