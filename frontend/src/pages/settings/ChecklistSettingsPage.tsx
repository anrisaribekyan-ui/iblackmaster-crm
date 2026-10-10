import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'

/** Настройки → Чек-лист: какие пункты проверяем при приёме и выдаче. */
export default function ChecklistSettingsPage() {
  const [items, setItems] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.get<{ items: string[] }>('/settings/checklist').then((r) => setItems(r.items)).catch(() => undefined)
  }, [])

  const save = async (next: string[]) => {
    setMessage('')
    try {
      const r = await api.put<{ items: string[] }>('/settings/checklist', { items: next })
      setItems(r.items)
      setMessage('Сохранено')
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    }
  }
  const move = (i: number, d: number) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    void save(next)
  }

  return (
    <section className="max-w-xl">
      <h2 className="text-lg font-semibold">Чек-лист проверки</h2>
      <p className="mb-4 text-sm text-muted">Что проверяем у аппарата при приёме и при выдаче. Отметки и подпись клиента попадают в квитанцию и акт — это защита в спорах «после вас перестало работать».</p>
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {items.map((item, i) => (
          <li key={item} className="flex items-center gap-2 px-3 py-2">
            <span className="flex-1">{item}</span>
            <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше" className="h-8 w-8 rounded text-muted disabled:opacity-30">↑</button>
            <button type="button" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Ниже" className="h-8 w-8 rounded text-muted disabled:opacity-30">↓</button>
            <button type="button" onClick={() => void save(items.filter((x) => x !== item))} className="text-sm text-danger">Удалить</button>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { void save([...items, newItem.trim()]); setNewItem('') } }}>
        <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Например, NFC" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2" />
        <button className="rounded-md bg-accent px-4 py-2 text-accent-ink">Добавить</button>
      </form>
      {message && <p className="mt-2 text-sm text-muted">{message}</p>}
    </section>
  )
}
