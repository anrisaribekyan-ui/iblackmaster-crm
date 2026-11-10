import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

type Idea = { id: number; author: string; text: string; page: string | null; status: 'new' | 'done' | 'dismissed'; note: string | null; created_at: string }
type Data = { items: Idea[]; new: number }

const FILTERS: { value: string; label: string }[] = [
  { value: 'new', label: 'Новые' },
  { value: 'done', label: 'Сделано' },
  { value: 'dismissed', label: 'Отклонено' },
  { value: '', label: 'Все' },
]

const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Идеи сотрудников (кнопка «Идея для Анри»). Видит и разбирает только владелец. */
export default function IdeasPage() {
  const [status, setStatus] = useState('new')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get<Data>(`/ideas${status ? `?status=${status}` : ''}`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить'))
  }, [status])
  useEffect(load, [load])

  const mark = async (idea: Idea, next: Idea['status']) => {
    try {
      await api.put(`/ideas/${idea.id}`, { status: next })
      load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось сохранить')
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-[22px] font-bold leading-tight md:text-[26px]">Идеи для Анри</h1>
      <p className="mb-4 text-sm text-muted">Всё, что сотрудники написали кнопкой «Идея для Анри». Новых: {data?.new ?? '…'}</p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={status === f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-full px-3 py-1.5 text-sm ${status === f.value ? 'bg-ink text-white' : 'border border-line text-ink hover:bg-surface'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 text-danger" role="alert">{error}</p>}
      {data && data.items.length === 0 && <p className="text-muted">Здесь пока пусто.</p>}
      <ul className="grid gap-3">
        {data?.items.map((idea) => (
          <li key={idea.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              <b className="text-ink">{idea.author}</b>
              <span>{when(idea.created_at)}</span>
              {idea.page && <span title="Страница, на которой писали">{idea.page}</span>}
            </div>
            <p className="whitespace-pre-wrap">{idea.text}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {idea.status !== 'done' && <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white" onClick={() => void mark(idea, 'done')}>Сделано</button>}
              {idea.status !== 'dismissed' && <button className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={() => void mark(idea, 'dismissed')}>Отклонить</button>}
              {idea.status !== 'new' && <button className="rounded-md border border-line px-3 py-1.5 text-sm" onClick={() => void mark(idea, 'new')}>Вернуть в новые</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
