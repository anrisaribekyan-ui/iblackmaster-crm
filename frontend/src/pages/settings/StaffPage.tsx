import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../auth'
import Modal from '../../components/Modal'

type Location = { id: number; name: string }
type Role = {
  id: number
  name: string
  home_page: 'orders' | 'sales'
  permissions: string[]
  scopes: Record<string, string>
  is_system: boolean
}
type Employee = {
  id: number
  name: string
  surname: string | null
  patronymic: string | null
  short_name: string
  email: string
  phones: string | null
  inn: string | null
  position: string | null
  birthday: string | null
  role_id: number
  is_owner: boolean
  is_active: boolean
  location_ids: number[]
}
type Permission = { code: string; title: string; parent: string | null }
type PermissionSection = { section: string; permissions: Permission[] }
type Scope = { title: string; options: Record<string, string> }
type PermissionCatalog = { sections: PermissionSection[]; scopes: Record<string, Scope> }
type EmployeeEditor = { kind: 'employee'; employee?: Employee } | { kind: 'password'; employee: Employee }

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export default function StaffPage() {
  const { can } = useAuth()
  const [tab, setTab] = useState<'employees' | 'roles'>('employees')
  const [employees, setEmployees] = useState<Employee[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [editor, setEditor] = useState<EmployeeEditor | null>(null)
  const [editingRole, setEditingRole] = useState<Role | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [employeeData, roleData, locationData, permissionData] = await Promise.all([
        api.get<Employee[]>('/employees'),
        api.get<Role[]>('/roles'),
        api.get<Location[]>('/locations'),
        api.get<PermissionCatalog>('/permissions'),
      ])
      setEmployees(employeeData)
      setRoles(roleData)
      setLocations(locationData)
      setCatalog(permissionData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить сотрудников и роли')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const mutate = async (action: () => Promise<unknown>, fallback: string) => {
    setSaving(true)
    setError('')
    try {
      await action()
      setEditor(null)
      setEditingRole(undefined)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : fallback)
    } finally {
      setSaving(false)
    }
  }

  const saveEmployee = (event: FormEvent<HTMLFormElement>, selectedLocations: number[]) => {
    event.preventDefault()
    if (!editor || editor.kind !== 'employee') return
    const values = new FormData(event.currentTarget)
    const value = (key: string) => String(values.get(key) ?? '').trim()
    const payload = {
      name: value('name'),
      surname: value('surname') || null,
      patronymic: value('patronymic') || null,
      short_name: value('short_name'),
      email: value('email'),
      phones: value('phones') || null,
      inn: value('inn') || null,
      position: value('position') || null,
      birthday: value('birthday') || null,
      role_id: Number(value('role_id')),
      location_ids: selectedLocations,
    }
    void mutate(
      () => editor.employee
        ? api.put(`/employees/${editor.employee.id}`, payload)
        : api.post('/employees', { ...payload, password: value('password') }),
      'Не удалось сохранить сотрудника',
    )
  }

  const changePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor || editor.kind !== 'password') return
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    void mutate(
      () => api.post(`/employees/${editor.employee.id}/password`, { password }),
      'Не удалось сменить пароль',
    )
  }

  const saveRole = (event: FormEvent<HTMLFormElement>, permissions: string[], scopes: Record<string, string>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const payload = {
      name: String(form.get('name') ?? '').trim(),
      home_page: String(form.get('home_page') ?? 'orders'),
      permissions,
      scopes,
    }
    void mutate(
      () => editingRole
        ? api.put(`/roles/${editingRole.id}`, payload)
        : api.post('/roles', payload),
      'Не удалось сохранить роль',
    )
  }

  const deactivate = async (employee: Employee) => {
    if (!confirm(`Отключить сотрудника «${employee.short_name}»?`)) return
    await mutate(() => api.del(`/employees/${employee.id}`), 'Не удалось отключить сотрудника')
  }

  const removeRole = async (role: Role) => {
    if (!confirm(`Удалить роль «${role.name}»?`)) return
    await mutate(() => api.del(`/roles/${role.id}`), 'Не удалось удалить роль')
  }

  const roleNames = new Map(roles.map((role) => [role.id, role.name]))
  const locationNames = new Map(locations.map((location) => [location.id, location.name]))

  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">Сотрудники и роли</h2>
      <div className="mb-4 flex gap-1 border-b border-line">
        {(['employees', 'roles'] as const).map((item) => (
          <button
            key={item}
            className={`border-b-2 px-3 py-2 ${tab === item ? 'border-accent font-medium text-ink' : 'border-transparent text-muted'}`}
            onClick={() => setTab(item)}
          >
            {item === 'employees' ? 'Сотрудники' : 'Роли'}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : tab === 'employees' ? (
        <section>
          {can('settingAccess') && (
            <div className="mb-3 flex justify-end">
              <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => setEditor({ kind: 'employee' })}>
                Добавить сотрудника
              </button>
            </div>
          )}
          {employees === null || employees.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-muted">Сотрудников пока нет.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[760px] text-left">
                <thead className="bg-canvas text-sm text-muted">
                  <tr>{['Имя', 'Email', 'Роль', 'Локации', 'Активен', 'Действия'].map((heading) => <th key={heading} className="px-3 py-2 font-medium">{heading}</th>)}</tr>
                </thead>
                <tbody>
                  {employees.map((employee) => (
                    <tr key={employee.id} className="border-t border-line">
                      <td className="px-3 py-2">{employee.short_name}{employee.is_owner && <small className="ml-1 text-muted">владелец</small>}</td>
                      <td className="px-3 py-2">{employee.email}</td>
                      <td className="px-3 py-2">{roleNames.get(employee.role_id) ?? '—'}</td>
                      <td className="px-3 py-2">{employee.location_ids.map((id) => locationNames.get(id)).filter(Boolean).join(', ') || '—'}</td>
                      <td className="px-3 py-2">{employee.is_active ? 'Да' : 'Нет'}</td>
                      <td className="px-3 py-2">
                        {can('settingAccess') && (
                          <span className="flex gap-2 whitespace-nowrap text-sm">
                            <button className="text-muted" onClick={() => setEditor({ kind: 'employee', employee })}>Изменить</button>
                            <button className="text-muted" onClick={() => setEditor({ kind: 'password', employee })}>Пароль</button>
                            {employee.is_active && !employee.is_owner && <button className="text-danger" onClick={() => void deactivate(employee)}>Отключить</button>}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section>
          {can('settingAccess') && (
            <div className="mb-3 flex justify-end">
              <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => setEditingRole(null)}>Добавить роль</button>
            </div>
          )}
          {roles.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface p-4 text-muted">Ролей пока нет.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
              {roles.map((role) => (
                <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <span className="font-medium">{role.name}</span>
                    {role.is_system && <small className="ml-2 text-muted">системная</small>}
                    <p className="text-sm text-muted">{role.permissions.length} прав · главная: {role.home_page === 'sales' ? 'Продажи' : 'Заказы'}</p>
                  </div>
                  {can('settingAccess') && (
                    <span className="flex gap-3 text-sm">
                      <button className="text-muted" onClick={() => setEditingRole(role)}>Изменить</button>
                      {!role.is_system && <button className="text-danger" onClick={() => void removeRole(role)}>Удалить</button>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editor?.kind === 'employee' && (
        <EmployeeForm
          employee={editor.employee}
          roles={roles}
          locations={locations}
          saving={saving}
          error={error}
          onClose={() => setEditor(null)}
          onSubmit={saveEmployee}
        />
      )}
      {editor?.kind === 'password' && (
        <Modal title={`Сменить пароль · ${editor.employee.short_name}`} onClose={() => setEditor(null)}>
          <form onSubmit={changePassword} className="grid gap-3">
            <label className="grid gap-1 text-sm text-muted">Новый пароль (не менее 8 символов)
              <input className={inputClass} name="password" type="password" minLength={8} required autoComplete="new-password" />
            </label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditor(null)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
      {editingRole !== undefined && catalog && (
        <RoleForm
          role={editingRole ?? undefined}
          catalog={catalog}
          saving={saving}
          error={error}
          onClose={() => setEditingRole(undefined)}
          onSubmit={saveRole}
        />
      )}
    </section>
  )
}

function EmployeeForm({
  employee,
  roles,
  locations,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  employee?: Employee
  roles: Role[]
  locations: Location[]
  saving: boolean
  error: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>, selectedLocations: number[]) => void
}) {
  const [selectedLocations, setSelectedLocations] = useState<number[]>(employee?.location_ids ?? [])
  const toggleLocation = (id: number) => setSelectedLocations((current) =>
    current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
  )

  return (
    <Modal title={employee ? 'Изменить сотрудника' : 'Новый сотрудник'} onClose={onClose}>
      <form onSubmit={(event) => onSubmit(event, selectedLocations)} className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-muted">Имя<input className={inputClass} name="name" required defaultValue={employee?.name ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Фамилия<input className={inputClass} name="surname" defaultValue={employee?.surname ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Отчество<input className={inputClass} name="patronymic" defaultValue={employee?.patronymic ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Короткое имя<input className={inputClass} name="short_name" required defaultValue={employee?.short_name ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Email<input className={inputClass} name="email" type="email" required defaultValue={employee?.email ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Телефоны<input className={inputClass} name="phones" defaultValue={employee?.phones ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">ИНН<input className={inputClass} name="inn" defaultValue={employee?.inn ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Должность<input className={inputClass} name="position" defaultValue={employee?.position ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">День рождения<input className={inputClass} name="birthday" type="date" defaultValue={employee?.birthday ?? ''} /></label>
        <label className="grid gap-1 text-sm text-muted">Роль
          <select className={inputClass} name="role_id" required defaultValue={employee?.role_id ?? ''} disabled={employee?.is_owner}>
            <option value="" disabled>Выберите роль</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
          {employee?.is_owner && <input type="hidden" name="role_id" value={employee.role_id} />}
        </label>
        {!employee && <label className="grid gap-1 text-sm text-muted">Пароль (не менее 8 символов)<input className={inputClass} name="password" type="password" minLength={8} required autoComplete="new-password" /></label>}
        <fieldset className="grid gap-1 rounded-md border border-line p-3 sm:col-span-2">
          <legend className="px-1 text-sm text-muted">Доступные локации</legend>
          {locations.length === 0 ? <span className="text-sm text-muted">Нет доступных локаций.</span> : locations.map((location) => (
            <label key={location.id} className="flex items-center gap-2">
              <input type="checkbox" checked={selectedLocations.includes(location.id)} onChange={() => toggleLocation(location.id)} />
              {location.name}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  )
}

function RoleForm({
  role,
  catalog,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  role?: Role
  catalog: PermissionCatalog
  saving: boolean
  error: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>, permissions: string[], scopes: Record<string, string>) => void
}) {
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? [])
  const [scopes, setScopes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(catalog.scopes).map(([key, scope]) => [
        key,
        role?.scopes[key] ?? Object.keys(scope.options)[0],
      ]),
    ),
  )
  const allPermissions = catalog.sections.flatMap((section) => section.permissions)
  const togglePermission = (item: Permission, checked: boolean) => {
    setPermissions((current) => {
      if (checked) return [...new Set([...current, item.code])]
      const removed = new Set([item.code])
      let changed = true
      while (changed) {
        changed = false
        for (const permission of allPermissions) {
          if (permission.parent && removed.has(permission.parent) && !removed.has(permission.code)) {
            removed.add(permission.code)
            changed = true
          }
        }
      }
      return current.filter((code) => !removed.has(code))
    })
  }

  return (
    <Modal title={role ? `Роль «${role.name}»` : 'Новая роль'} onClose={onClose}>
      <form onSubmit={(event) => onSubmit(event, permissions, scopes)} className="grid gap-4">
        <label className="grid gap-1 text-sm text-muted">Название
          <input className={inputClass} name="name" required maxLength={100} defaultValue={role?.name ?? ''} />
        </label>
        <label className="grid gap-1 text-sm text-muted">Стартовая страница
          <select className={inputClass} name="home_page" defaultValue={role?.home_page ?? 'orders'}>
            <option value="orders">Заказы</option>
            <option value="sales">Продажи</option>
          </select>
        </label>
        <fieldset className="max-h-[45vh] space-y-4 overflow-auto rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">Права</legend>
          {catalog.sections.map((section) => (
            <section key={section.section}>
              <h3 className="mb-1 font-medium">{section.section}</h3>
              <div className="space-y-1">
                {section.permissions.map((permission) => {
                  const parent = permission.parent ? allPermissions.find((candidate) => candidate.code === permission.parent) : undefined
                  const parentEnabled = !permission.parent || permissions.includes(permission.parent)
                  return (
                    <label key={permission.code} className={`flex items-start gap-2 ${permission.parent ? 'ml-5' : ''} ${!parentEnabled ? 'text-muted' : ''}`}>
                      <input
                        className="mt-0.5"
                        type="checkbox"
                        checked={permissions.includes(permission.code)}
                        disabled={!parentEnabled}
                        onChange={(event) => togglePermission(permission, event.target.checked)}
                      />
                      <span>{permission.title}{permission.parent && !parent && <small className="ml-1">({permission.parent})</small>}</span>
                    </label>
                  )
                })}
              </div>
            </section>
          ))}
        </fieldset>
        <fieldset className="grid gap-3 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-medium">Права-выборы</legend>
          {Object.entries(catalog.scopes).map(([key, scope]) => {
            const choices = Object.entries(scope.options)
            return (
              <label key={key} className="grid gap-1 text-sm text-muted">{scope.title}
                <select
                  className={inputClass}
                  value={scopes[key] ?? choices[0]?.[0] ?? ''}
                  onChange={(event) => setScopes((current) => ({ ...current, [key]: event.target.value }))}
                >
                  {choices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            )
          })}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">{saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  )
}
