import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  // На телефоне меню закрывается после перехода
  useEffect(() => setMenuOpen(false), [location.pathname])

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
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-line bg-surface transition-transform md:static md:w-52 md:translate-x-0 ${menuOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'}`}
      >
        <div className="px-4 py-4 text-lg font-semibold">iBlackMaster</div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
          {MENU.filter((m) => !m.permission || can(m.permission)).map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-2.5 md:py-2 ${isActive ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-canvas'}`
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
      <main className="min-w-0 flex-1 overflow-auto px-3 py-3 sm:p-6">
        <header className="mb-4 flex items-center gap-2 md:justify-end">
          <button
            type="button"
            className="rounded-md border border-line bg-surface px-3 py-2 md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Открыть меню"
          >
            ☰
          </button>
          <form onSubmit={(event) => void submitSearch(event)} className="min-w-0 flex-1 md:max-w-md md:flex-none md:basis-[28rem]">
            <input
              className="w-full rounded-md border border-line bg-surface px-3 py-2"
              placeholder="Поиск: номер, телефон, имя, IMEI"
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
