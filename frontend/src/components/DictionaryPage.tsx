import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from './Modal'

export type DictionaryField = {
  name: string
  label: string
  type: 'number' | 'checkbox'
  defaultValue: number | boolean
  step?: string
  min?: string
}

export type DictionaryConfig = {
  title: string
  path: string
  permission: string
  fields?: DictionaryField[]
}

type Item = { id: number; name: string; [key: string]: unknown }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export default function DictionaryPage({ config }: { config: DictionaryConfig }) {
  const { can } = useAuth()
  const [items, setItems] = useState<Item[] | null>(null)
  const [editor, setEditor] = useState<Item | null | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const canEdit = can(config.permission)

  const load = useCallback(async (query = '') => {
    setLoading(true)
    setError('')
    try {
      const searchParams = new URLSearchParams()
      if (query.trim()) searchParams.set('q', query.trim())
      const suffix = searchParams.size ? `?${searchParams.toString()}` : ''
      setItems(await api.get<Item[]>(`${config.path}${suffix}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : `Не удалось загрузить: ${config.title.toLowerCase()}`)
    } finally {
      setLoading(false)
    }
  }, [config.path, config.title])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload: Record<string, unknown> = { name: String(form.get('name') ?? '').trim() }
    for (const field of config.fields ?? []) {
      payload[field.name] = field.type === 'checkbox'
        ? form.get(field.name) === 'on'
        : Number(form.get(field.name) ?? field.defaultValue)
    }
    setSaving(true)
    setError('')
    try {
      if (editor?.id) await api.put(`${config.path}/${editor.id}`, payload)
      else await api.post(config.path, payload)
      setEditor(undefined)
      await load(search)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить запись')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Item) => {
    if (!confirm(`Удалить «${item.name}»?`)) return
    setError('')
    try {
      await api.del(`${config.path}/${item.id}`)
      await load(search)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить запись')
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{config.title}</h2>
        {canEdit && <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => setEditor(null)}>Добавить</button>}
      </div>
      <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void load(search) }}>
        <input className={`${inputClass} max-w-sm`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск" />
        <button className="rounded-md border border-line bg-surface px-3 py-2">Найти</button>
      </form>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : items === null ? (
        <p className="text-muted">Не удалось загрузить справочник.</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-muted">Записей пока нет. Добавьте первую запись.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <span>
                {item.name}
                {config.fields?.map((field) => (
                  <small key={field.name} className="ml-2 text-muted">
                    {field.type === 'checkbox'
                      ? item[field.name] ? 'Дробное количество' : ''
                      : `${field.label}: ${String(item[field.name] ?? field.defaultValue)}`}
                  </small>
                ))}
              </span>
              {canEdit && (
                <span className="flex shrink-0 gap-3 text-sm">
                  <button className="text-muted hover:text-ink" onClick={() => setEditor(item)}>Изменить</button>
                  <button className="text-danger" onClick={() => void remove(item)}>Удалить</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editor !== undefined && (
        <Modal title={editor ? `Изменить · ${editor.name}` : `Новая запись · ${config.title.toLowerCase()}`} onClose={() => setEditor(undefined)}>
          <form onSubmit={(event) => void save(event)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Название
              <input className={inputClass} name="name" required maxLength={200} defaultValue={editor?.name ?? ''} />
            </label>
            {(config.fields ?? []).map((field) => (
              <label key={field.name} className={field.type === 'checkbox' ? 'flex items-center gap-2' : 'grid gap-1 text-sm text-muted'}>
                {field.type === 'checkbox' ? (
                  <>
                    <input name={field.name} type="checkbox" defaultChecked={Boolean(editor?.[field.name] ?? field.defaultValue)} />
                    {field.label}
                  </>
                ) : (
                  <>
                    {field.label}
                    <input className={inputClass} name={field.name} type="number" step={field.step ?? '1'} min={field.min} defaultValue={Number(editor?.[field.name] ?? field.defaultValue)} />
                  </>
                )}
              </label>
            ))}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditor(undefined)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
