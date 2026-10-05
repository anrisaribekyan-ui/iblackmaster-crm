import { useState, type FormEvent } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'

/** Меню как в LiveSklad. permission — право, без которого пункт скрыт (пусто — виден всем). */
export const MENU: { to: string; label: string; permission?: string }[] = [
  { to: '/', label: 'Главная' },
  { to: '/orders', label: 'Заказы' },
  { to: '/sales', label: 'Продажи' },
  { to: '/store/remains', label: 'Склад', permission: 'remainAccess' },
  { to: '/tasks', label: 'Задачи' },
  { to: '/boards', label: 'Доски' },
  { to: '/finance/cashes', label: 'Финансы' },
  { to: '/analytics', label: 'Аналитика', permission: 'reportAccess' },
  { to: '/compendiums/how-knows', label: 'Справочники' },
  { to: '/settings', label: 'Настройки', permission: 'settingAccess' },
]

export default function Layout() {
  const { me, logout, can } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const term = query.trim()
    if (!term) return
    if (/^[A-Za-z]\d+$/.test(term)) {
      try {
        const result = await api.get<{ items: { id: number }[]; total: number }>(`/orders?q=${encodeURIComponent(term)}`)
        if (result.total === 1 && result.items.length === 1) {
          navigate(`/orders/${result.items[0].id}`)
          setQuery('')
          return
        }
      } catch {
        /* нет доступа — просто перейдём в список */
      }
    }
    navigate(`/orders?q=${encodeURIComponent(term)}`)
    setQuery('')
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-surface">
        <div className="px-4 py-4 text-lg font-semibold">iBlackMaster</div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {MENU.filter((m) => !m.permission || can(m.permission)).map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 ${isActive ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-canvas'}`
              }
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3 text-sm">
          <div className="font-medium">{me?.short_name}</div>
          <div className="text-muted">{me?.role_name}</div>
          <button onClick={logout} className="mt-2 text-muted hover:text-ink">
            Выйти
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto p-6">
        <header className="mb-4 flex justify-end">
          <form onSubmit={(event) => void submitSearch(event)} className="w-full max-w-md">
            <input
              className="w-full rounded-md border border-line bg-surface px-3 py-2"
              placeholder="Поиск по номеру, телефону, имени, серийному номеру…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
        </header>
        <Outlet />
      </main>
    </div>
  )
}
