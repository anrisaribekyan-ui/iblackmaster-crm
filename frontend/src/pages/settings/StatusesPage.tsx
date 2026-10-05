import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type StatusGroup = 'new' | 'inWork' | 'wait' | 'finish' | 'closed'
type Status = {
  id: number
  group: StatusGroup
  name: string
  client_name: string | null
  color: string
  sort: number
  pay_required: boolean
  comment_mode: 'none' | 'optional' | 'required'
  role_access: Record<string, Record<'view' | 'set' | 'change', boolean>>
  is_active: boolean
}
type Group = { group: StatusGroup; title: string; statuses: Status[] }
type Role = { id: number; name: string }
type Access = Record<string, Partial<Record<'view' | 'set' | 'change', boolean>>>

const groups: { group: StatusGroup; title: string }[] = [
  { group: 'new', title: 'Новые' },
  { group: 'inWork', title: 'В работе' },
  { group: 'wait', title: 'Отложенные' },
  { group: 'finish', title: 'Готовые' },
  { group: 'closed', title: 'Выданные' },
]
const actionLabels = { view: 'Видит', set: 'Ставит', change: 'Меняет' } as const
const fieldClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export default function StatusesPage() {
  const { can } = useAuth()
  const [data, setData] = useState<Group[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [editing, setEditing] = useState<{ group: StatusGroup; status?: Status } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [statusData, roleData] = await Promise.all([
        api.get<Group[]>('/order-statuses'),
        api.get<Role[]>('/roles'),
      ])
      setData(statusData)
      setRoles(roleData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить статусы')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: FormEvent<HTMLFormElement>, roleAccess: Access) => {
    event.preventDefault()
    if (!editing) return
    const form = new FormData(event.currentTarget)
    const value = (name: string) => String(form.get(name) ?? '').trim()
    const payload = {
      group: editing.group,
      name: value('name'),
      client_name: value('client_name') || null,
      color: value('color'),
      sort: Number(value('sort') || 0),
      pay_required: form.get('pay_required') === 'on',
      comment_mode: value('comment_mode'),
      role_access: roleAccess,
    }
    setSaving(true)
    setError('')
    try {
      if (editing.status) await api.put(`/order-statuses/${editing.status.id}`, payload)
      else await api.post('/order-statuses', payload)
      setEditing(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить статус')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Статусы заказа</h2>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : data === null ? (
        <p className="text-muted">Не удалось загрузить статусы.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
          {groups.map(({ group, title }) => {
            const statuses = data.find((item) => item.group === group)?.statuses ?? []
            return (
              <section key={group} className="min-w-0 rounded-xl border border-line bg-surface p-3">
                <header className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{title}</h3>
                  {can('settingAccess') && (
                    <button className="text-sm text-accent" onClick={() => setEditing({ group })}>+ статус</button>
                  )}
                </header>
                {statuses.length === 0 ? (
                  <p className="py-2 text-sm text-muted">В этой группе пока нет статусов.</p>
                ) : (
                  <div className="space-y-2">
                    {statuses.map((status) => (
                      <button
                        key={status.id}
                        className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-accent"
                        onClick={() => setEditing({ group, status })}
                      >
                        <span className="mb-1 block h-1.5 rounded-full" style={{ backgroundColor: status.color }} />
                        <span className="block font-medium">{status.name}</span>
                        {status.client_name && <span className="block text-xs text-muted">Для клиента: {status.client_name}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
      {editing && (
        <StatusEditor
          group={editing.group}
          status={editing.status}
          roles={roles}
          saving={saving}
          error={error}
          onClose={() => setEditing(null)}
          onSubmit={save}
        />
      )}
    </section>
  )
}

function StatusEditor({
  group,
  status,
  roles,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  group: StatusGroup
  status?: Status
  roles: Role[]
  saving: boolean
  error: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>, roleAccess: Access) => Promise<void>
}) {
  const [roleAccess, setRoleAccess] = useState<Access>(status?.role_access ?? {})
  const title = groups.find((item) => item.group === group)?.title ?? ''
  const updateAccess = (roleId: number, action: keyof typeof actionLabels, checked: boolean) => {
    setRoleAccess((current) => ({
      ...current,
      [roleId]: { view: true, set: true, change: true, ...current[String(roleId)], [action]: checked },
    }))
  }

  return (
    <Modal title={status ? `Статус «${status.name}»` : `Новый статус · ${title}`} onClose={onClose}>
      <form onSubmit={(event) => void onSubmit(event, roleAccess)} className="grid gap-3">
        <label className="grid gap-1 text-sm text-muted">Название
          <input className={fieldClass} name="name" required defaultValue={status?.name ?? ''} />
        </label>
        <label className="grid gap-1 text-sm text-muted">Текст для клиента
          <input className={fieldClass} name="client_name" defaultValue={status?.client_name ?? ''} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm text-muted">Цвет
            <input className={fieldClass} name="color" type="color" defaultValue={status?.color ?? '#3E8EF7'} />
          </label>
          <label className="grid gap-1 text-sm text-muted">Порядок
            <input className={fieldClass} name="sort" type="number" defaultValue={status?.sort ?? 0} />
          </label>
        </div>
        <label className="grid gap-1 text-sm text-muted">Комментарий при смене
          <select className={fieldClass} name="comment_mode" defaultValue={status?.comment_mode ?? 'none'}>
            <option value="none">Не требуется</option>
            <option value="optional">Необязательный</option>
            <option value="required">Обязательный</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="pay_required" defaultChecked={status?.pay_required ?? false} />
          Требует полной оплаты
        </label>
        <fieldset className="overflow-x-auto rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">Доступ по ролям</legend>
          {roles.length === 0 ? (
            <p className="text-sm text-muted">Ролей пока нет.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr><th className="py-2 text-left font-medium">Роль</th>{Object.entries(actionLabels).map(([key, label]) => <th key={key} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-t border-line">
                    <td className="py-2">{role.name}</td>
                    {(Object.keys(actionLabels) as (keyof typeof actionLabels)[]).map((action) => (
                      <td key={action} className="px-2 py-2 text-center">
                        <input
                          aria-label={`${actionLabels[action]}: ${role.name}`}
                          type="checkbox"
                          checked={roleAccess[String(role.id)]?.[action] ?? true}
                          onChange={(event) => updateAccess(role.id, action, event.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
