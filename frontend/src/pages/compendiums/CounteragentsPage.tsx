import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type Counteragent = {
  id: number
  type_id: number | null
  name: string
  phones: string | null
  email: string | null
  address: string | null
  telegram: string | null
  max_messenger: string | null
  inn: string | null
  note: string | null
  how_know_id: number | null
  manager_id: number | null
  is_buyer: boolean
  is_vendor: boolean
  rating: number
  allow_sms: boolean
  allow_email: boolean
  allow_telegram: boolean
  allow_max: boolean
  extra: Record<string, unknown>
  balance: string
}
type CounteragentDetail = Counteragent & { orders_count: number }
type CounteragentPage = { items: Counteragent[]; total: number; page: number }
type Named = { id: number; name: string }
type Employee = { id: number; short_name: string }
type Editor = Counteragent | null | undefined

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

function formatPhoneList(value: string | null) {
  return (value ?? '').split(',').map((phone) => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('7')) {
      return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`
    }
    return phone.trim()
  }).filter(Boolean).join(', ')
}

export default function CounteragentsPage() {
  const { can } = useAuth()
  const [data, setData] = useState<CounteragentPage | null>(null)
  const [types, setTypes] = useState<Named[]>([])
  const [howKnows, setHowKnows] = useState<Named[]>([])
  const [managers, setManagers] = useState<Employee[]>([])
  const [editor, setEditor] = useState<Editor>(undefined)
  const [details, setDetails] = useState<Counteragent | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const canEdit = can('counteragentAccess')
  const canManageVendors = can('counteragentSellerAccess')

  const loadReferences = useCallback(async () => {
    try {
      const [typeData, sourceData, managerData] = await Promise.all([
        api.get<Named[]>('/counteragent-types'),
        api.get<Named[]>('/how-knows'),
        api.get<Employee[]>('/employees/short?manager=1'),
      ])
      setTypes(typeData)
      setHowKnows(sourceData)
      setManagers(managerData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить карточки справочников')
    }
  }, [])

  const load = useCallback(async (searchValue = search, pageValue = page) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(pageValue) })
      if (searchValue.trim()) params.set('q', searchValue.trim())
      setData(await api.get<CounteragentPage>(`/counteragents?${params.toString()}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить контрагентов')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    void loadReferences()
  }, [loadReferences])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    const payload = {
      type_id: text('type_id') ? Number(text('type_id')) : null,
      name: text('name'),
      phones: text('phones') || null,
      email: text('email') || null,
      address: text('address') || null,
      telegram: text('telegram') || null,
      max_messenger: text('max_messenger') || null,
      inn: text('inn') || null,
      note: text('note') || null,
      how_know_id: text('how_know_id') ? Number(text('how_know_id')) : null,
      manager_id: text('manager_id') ? Number(text('manager_id')) : null,
      is_buyer: form.get('is_buyer') === 'on',
      is_vendor: canManageVendors && form.get('is_vendor') === 'on',
      rating: Number(text('rating') || 0),
      allow_sms: form.get('allow_sms') === 'on',
      allow_email: form.get('allow_email') === 'on',
      allow_telegram: form.get('allow_telegram') === 'on',
      allow_max: form.get('allow_max') === 'on',
      extra: editor && typeof editor === 'object' ? editor.extra : {},
    }
    setSaving(true)
    setError('')
    try {
      if (editor && typeof editor === 'object') await api.put(`/counteragents/${editor.id}`, payload)
      else await api.post('/counteragents', payload)
      setEditor(undefined)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить контрагента')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Counteragent) => {
    if (!confirm(`Удалить контрагента «${item.name}»?`)) return
    setError('')
    try {
      await api.del(`/counteragents/${item.id}`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить контрагента')
    }
  }

  const openCard = async (item: Counteragent) => {
    setError('')
    try {
      setDetails(await api.get<CounteragentDetail>(`/counteragents/${item.id}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить карточку контрагента')
    }
  }

  const typeNames = new Map(types.map((item) => [item.id, item.name]))

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Контрагенты</h2>
        {canEdit && <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => setEditor(null)}>Добавить контрагента</button>}
      </div>
      <form className="mb-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setPage(1); void load(search, 1) }}>
        <input className={`${inputClass} max-w-sm`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Имя или телефон" />
        <button className="rounded-md border border-line bg-surface px-3 py-2">Найти</button>
      </form>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : data === null ? (
        <p className="text-muted">Не удалось загрузить контрагентов.</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-4 text-muted">Контрагенты не найдены. Добавьте первого контрагента.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-canvas text-muted"><tr>{['Имя', 'Телефоны', 'Тип', 'Баланс', ''].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-t border-line">
                    <td className="px-3 py-2"><button className="font-medium text-accent hover:underline" onClick={() => void openCard(item)}>{item.name}</button>{item.is_vendor && <small className="ml-2 text-muted">поставщик</small>}</td>
                    <td className="px-3 py-2">{formatPhoneList(item.phones) || '—'}</td>
                    <td className="px-3 py-2">{typeNames.get(item.type_id ?? -1) ?? '—'}</td>
                    <td className="px-3 py-2 num">{Number(item.balance).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</td>
                    <td className="px-3 py-2">{canEdit && <span className="flex gap-2 whitespace-nowrap"><button className="text-muted" onClick={() => setEditor(item)}>Изменить</button><button className="text-danger" onClick={() => void remove(item)}>Удалить</button></span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className="mt-3 flex items-center justify-between text-sm text-muted">
            <span>Всего: {data.total}</span>
            <span className="flex items-center gap-3">
              <button disabled={page <= 1} className="text-ink disabled:opacity-40" onClick={() => setPage((current) => Math.max(1, current - 1))}>Назад</button>
              Страница {data.page}
              <button disabled={page * 50 >= data.total} className="text-ink disabled:opacity-40" onClick={() => setPage((current) => current + 1)}>Далее</button>
            </span>
          </footer>
        </>
      )}
      {editor !== undefined && (
        <Modal title={editor ? `Изменить · ${editor.name}` : 'Новый контрагент'} onClose={() => setEditor(undefined)}>
          <form onSubmit={(event) => void save(event)} className="grid max-h-[75vh] gap-3 overflow-y-auto px-1 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-muted">Имя
              <input className={inputClass} name="name" required maxLength={300} defaultValue={editor?.name ?? ''} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Тип
              <select className={inputClass} name="type_id" defaultValue={editor?.type_id ?? ''}><option value="">Не выбран</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Телефоны
              <input className={inputClass} name="phones" placeholder="+7 (___) ___-__-__" defaultValue={editor?.phones ?? ''} />
            </label>
            <label className="grid gap-1 text-sm text-muted">Email<input className={inputClass} name="email" type="email" defaultValue={editor?.email ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">Адрес<input className={inputClass} name="address" defaultValue={editor?.address ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">ИНН<input className={inputClass} name="inn" defaultValue={editor?.inn ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">Telegram<input className={inputClass} name="telegram" defaultValue={editor?.telegram ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">MAX<input className={inputClass} name="max_messenger" defaultValue={editor?.max_messenger ?? ''} /></label>
            <label className="grid gap-1 text-sm text-muted">Рекламный источник
              <select className={inputClass} name="how_know_id" defaultValue={editor?.how_know_id ?? ''}><option value="">Не выбран</option>{howKnows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Менеджер
              <select className={inputClass} name="manager_id" defaultValue={editor?.manager_id ?? ''}><option value="">Не выбран</option>{managers.map((item) => <option key={item.id} value={item.id}>{item.short_name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm text-muted">Рейтинг<input className={inputClass} name="rating" type="number" defaultValue={editor?.rating ?? 0} /></label>
            <label className="grid gap-1 text-sm text-muted sm:col-span-2">Примечание<textarea className={inputClass} name="note" rows={2} defaultValue={editor?.note ?? ''} /></label>
            <fieldset className="grid gap-2 rounded-md border border-line p-3 sm:col-span-2">
              <legend className="px-1 text-sm text-muted">Настройки контрагента</legend>
              <label className="flex items-center gap-2"><input type="checkbox" name="is_buyer" defaultChecked={editor?.is_buyer ?? true} />Покупатель</label>
              {canManageVendors && <label className="flex items-center gap-2"><input type="checkbox" name="is_vendor" defaultChecked={editor?.is_vendor ?? false} />Поставщик</label>}
              <label className="flex items-center gap-2"><input type="checkbox" name="allow_sms" defaultChecked={editor?.allow_sms ?? true} />Разрешены SMS</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="allow_email" defaultChecked={editor?.allow_email ?? true} />Разрешены письма</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="allow_telegram" defaultChecked={editor?.allow_telegram ?? true} />Разрешены сообщения Telegram</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="allow_max" defaultChecked={editor?.allow_max ?? true} />Разрешены сообщения MAX</label>
            </fieldset>
            {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditor(undefined)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </form>
        </Modal>
      )}
      {details && <CounteragentCard item={details} onClose={() => setDetails(null)} />}
    </section>
  )
}

function CounteragentCard({ item, onClose }: { item: Counteragent; onClose: () => void }) {
  const [details, setDetails] = useState<CounteragentDetail | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.get<CounteragentDetail>(`/counteragents/${item.id}`)
      .then(setDetails)
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : 'Не удалось загрузить карточку'))
  }, [item.id])
  return (
    <Modal title={`Карточка контрагента · ${item.name}`} onClose={onClose}>
      {error ? <p role="alert" className="text-danger">{error}</p> : details === null ? (
        <p className="text-muted">Загрузка…</p>
      ) : (
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-sm text-muted">Имя</dt><dd>{details.name}</dd></div>
          <div><dt className="text-sm text-muted">Телефоны</dt><dd>{formatPhoneList(details.phones) || '—'}</dd></div>
          <div><dt className="text-sm text-muted">Email</dt><dd>{details.email || '—'}</dd></div>
          <div><dt className="text-sm text-muted">Адрес</dt><dd>{details.address || '—'}</dd></div>
          <div><dt className="text-sm text-muted">Баланс</dt><dd className="num">{Number(details.balance).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽</dd></div>
          <div><dt className="text-sm text-muted">Заказов</dt><dd>{details.orders_count}</dd></div>
          {details.note && <div className="sm:col-span-2"><dt className="text-sm text-muted">Примечание</dt><dd className="whitespace-pre-wrap">{details.note}</dd></div>}
        </dl>
      )}
    </Modal>
  )
}
