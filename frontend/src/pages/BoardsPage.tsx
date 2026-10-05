import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from '../components/Modal'
import { inputClass } from './shared'
import type { LocationRef } from './shared'
import type { SpaceRef } from './boardsTypes'

/** id последнего открытого пространства — помним, чтобы открыть его при входе в «Доски». */
export const LAST_SPACE_KEY = 'boards_last_space'

export default function BoardsPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [spaces, setSpaces] = useState<SpaceRef[] | null>(null)
  const [locations, setLocations] = useState<LocationRef[]>([])
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const canCreate = can('createTaskAccess')

  useEffect(() => {
    api.get<LocationRef[]>('/locations').then(setLocations).catch(() => setLocations([]))
  }, [])

  const open = (id: number) => {
    try {
      localStorage.setItem(LAST_SPACE_KEY, String(id))
    } catch {
      /* приватный режим — просто не запоминаем */
    }
    navigate(`/boards/${id}`)
  }

  useEffect(() => {
    void (async () => {
      setError('')
      try {
        const list = await api.get<SpaceRef[]>('/boards/spaces')
        setSpaces(list)
        let lastId: number | null = null
        try {
          const raw = localStorage.getItem(LAST_SPACE_KEY)
          if (raw) lastId = Number(raw)
        } catch {
          lastId = null
        }
        if (lastId && list.some((s) => s.id === lastId)) navigate(`/boards/${lastId}`, { replace: true })
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Не удалось загрузить доски')
        setSpaces(null)
      }
    })()
  }, [navigate])

  return (
    <section>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Доски</h1>
        {canCreate && (
          <button className="rounded-md bg-accent px-4 py-2 font-medium text-accent-ink" onClick={() => setCreating(true)}>
            Новое пространство
          </button>
        )}
      </header>

      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}
      {spaces === null ? (
        <p className="text-muted">Загрузка…</p>
      ) : spaces.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">
          Пространств нет. Создайте первое — оно появится здесь.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((s) => (
            <button
              key={s.id}
              onClick={() => open(s.id)}
              className="rounded-xl border border-line bg-surface p-4 text-left transition-colors hover:border-accent"
            >
              <div className="font-medium">{s.name}</div>
              <div className="text-sm text-muted">
                {s.cards} {plural(s.cards, 'карточка', 'карточки', 'карточек')}
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && (
        <NewSpaceModal
          locations={locations}
          onClose={() => setCreating(false)}
          onCreated={(id) => open(id)}
        />
      )}
    </section>
  )
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

function NewSpaceModal({
  locations,
  onClose,
  onCreated,
}: {
  locations: LocationRef[]
  onClose: () => void
  onCreated: (id: number) => void
}) {
  const [name, setName] = useState('')
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setError('')
    setSaving(true)
    try {
      const created = await api.post<{ id: number; name: string }>('/boards/spaces', {
        name: name.trim(),
        location_id: locationId ? Number(locationId) : null,
      })
      onCreated(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать пространство')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Новое пространство" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3">
        <label className="grid gap-1 text-sm text-muted">
          Название
          <input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm text-muted">
          Локация
          <select className={inputClass} value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">Все локации</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">
            {saving ? 'Создание…' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
