import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type CashItem = {
  id: number
  name: string
  is_income: boolean
  type: string | null
  affects_balance: boolean
  is_active: boolean
}

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export default function CashItemsPage() {
  const { can } = useAuth()
  const [items, setItems] = useState<CashItem[] | null>(null)
  const [editor, setEditor] = useState<CashItem | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = can('cashItemAccess')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setItems(await api.get<CashItem[]>('/cash-items'))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить статьи движения денег')
      setItems(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get('name') ?? '').trim(),
      is_income: form.get('is_income') === 'true',
      affects_balance: form.get('affects_balance') === 'on',
    }
    setSaving(true)
    setError('')
    try {
      if (editor?.id) await api.put(`/cash-items/${editor.id}`, payload)
      else await api.post('/cash-items', payload)
      setEditor(undefined)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить статью')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: CashItem) => {
    if (!confirm(`Архивировать статью «${item.name}»?`)) return
    setError('')
    try {
      await api.del(`/cash-items/${item.id}`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось архивировать статью')
    }
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Статьи движения денег</h2>
        {canEdit && <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => { setError(''); setEditor(null) }}>Добавить статью</button>}
      </div>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка статей…</p>
      ) : items === null ? (
        <p className="text-muted">Не удалось загрузить статьи.</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-muted">Статей пока нет. Добавьте статью для ручных операций.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2">Название</th>
                <th className="px-3 py-2">Направление</th>
                <th className="hidden px-3 py-2 md:table-cell">Баланс контрагента</th>
                <th className="hidden px-3 py-2 md:table-cell">Тип</th>
                {canEdit && <th className="px-3 py-2">Действие</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-medium">{item.name}</td>
                  <td className="px-3 py-2">{item.is_income ? 'Приход' : 'Расход'}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{item.affects_balance ? 'Влияет' : 'Не влияет'}</td>
                  <td className="hidden px-3 py-2 md:table-cell">{item.type ? 'Системная' : 'Пользовательская'}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap px-3 py-2">
                      {item.type === null ? (
                        <>
                          <button className="mr-3 text-accent" onClick={() => { setError(''); setEditor(item) }}>Изменить</button>
                          <button className="text-danger" onClick={() => void remove(item)}>Архивировать</button>
                        </>
                      ) : <span className="text-muted">Только просмотр</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editor !== undefined && (
        <Modal title={editor ? `Статья · ${editor.name}` : 'Новая статья движения денег'} onClose={() => setEditor(undefined)}>
          <form onSubmit={(event) => void save(event)} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Название
              <input className={inputClass} name="name" required maxLength={200} defaultValue={editor?.name ?? ''} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Направление
              <select className={inputClass} name="is_income" defaultValue={String(editor?.is_income ?? true)}>
                <option value="true">Приход</option>
                <option value="false">Расход</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input name="affects_balance" type="checkbox" defaultChecked={editor?.affects_balance ?? false} />
              Влияет на баланс контрагента
            </label>
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
