import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'
import Icon from './icons'
import InstallApp from './InstallApp'

/** Меню как в LiveSklad. permission — право, без которого пункт скрыт (пусто — виден всем). */
export const MENU: { to: string; label: string; icon: string; permission?: string }[] = [
  { to: '/', icon: 'home', label: 'Главная' },
  { to: '/orders', icon: 'orders', label: 'Заказы' },
  { to: '/sales', icon: 'sales', label: 'Продажи' },
  { to: '/store/remains', icon: 'store', label: 'Склад', permission: 'remainAccess' },
  { to: '/tasks', icon: 'tasks', label: 'Задачи' },
  { to: '/boards', icon: 'boards', label: 'Доски' },
  { to: '/finance/cashes', icon: 'finance', label: 'Финансы' },
  { to: '/analytics', icon: 'analytics', label: 'Аналитика', permission: 'reportAccess' },
  { to: '/compendiums/how-knows', icon: 'books', label: 'Справочники' },
  { to: '/settings', icon: 'settings', label: 'Настройки', permission: 'settingAccess' },
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
    <div className="md:flex md:h-full">
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col bg-rail pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-rail-ink transition-transform md:static md:w-56 md:translate-x-0 ${menuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 px-5 pb-5 pt-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-[15px] font-bold text-white" aria-hidden>i</span>
          <span className="text-[17px] font-semibold tracking-tight text-white">iBlack<span className="text-rail-ink">Master</span></span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
          {MENU.filter((m) => !m.permission || can(m.permission)).map((m) => (
            <NavLink
              key={m.to}
              to={m.to}
              end={m.to === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-lg px-3 py-2.5 md:py-2 ${
                  isActive ? 'bg-rail-hover font-medium text-white before:absolute before:inset-y-2 before:-left-3 before:w-1 before:rounded-r-full before:bg-accent' : 'text-rail-ink hover:bg-rail-hover hover:text-white'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={m.icon} className={`h-[18px] w-[18px] ${isActive ? 'text-accent' : 'text-rail-muted'}`} />
                  {m.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <InstallApp />
        <div className="m-3 flex items-center gap-3 rounded-lg bg-rail-hover px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#3a3f47] text-sm font-medium text-white" aria-hidden>
            {(me?.short_name ?? '?').slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1 text-sm leading-tight">
            <div className="truncate font-medium text-white">{me?.short_name}</div>
            <div className="truncate text-xs text-rail-muted">{me?.role_name}</div>
          </div>
          <button onClick={logout} className="rounded-md p-1.5 text-rail-muted hover:bg-rail hover:text-white" aria-label="Выйти" title="Выйти">
            <Icon name="logout" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </aside>
      {/* На телефоне прокручивается вся страница (прячется адресная строка, работает «потянуть — обновить»),
          на компьютере — только рабочая область справа от меню */}
      <main className="min-w-0 flex-1 px-3 pb-24 sm:px-8 md:overflow-auto md:py-6 md:pb-6">
        <header className="sticky top-0 z-20 -mx-3 mb-3 flex items-center gap-2 bg-canvas/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur sm:-mx-8 sm:px-8 md:static md:mx-0 md:mb-4 md:justify-end md:bg-transparent md:p-0 md:backdrop-blur-none">
          <form onSubmit={(event) => void submitSearch(event)} className="relative min-w-0 flex-1 md:max-w-md md:flex-none md:basis-[28rem]">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3"
              placeholder="Поиск: номер, телефон, имя, IMEI"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </form>
        </header>
        <Outlet />
      </main>
      <MobileTabBar onMore={() => setMenuOpen(true)} canCreate={can('createOrderAccess')} />
    </div>
  )
}

/** Нижняя панель на телефоне — как в обычных приложениях: главное под большим пальцем. */
function MobileTabBar({ onMore, canCreate }: { onMore: () => void; canCreate: boolean }) {
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
  return (
    <nav
      aria-label="Быстрые разделы"
      className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] backdrop-blur md:hidden"
    >
      <NavLink to="/" end className={item}><Icon name="home" className="h-6 w-6" />Главная</NavLink>
      <NavLink to="/orders" end className={item}><Icon name="orders" className="h-6 w-6" />Заказы</NavLink>
      {canCreate && (
        <NavLink to="/orders/new" className="flex flex-1 flex-col items-center pt-1.5" aria-label="Новый заказ">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-accent text-white shadow-md shadow-accent/30">
            <Icon name="plus" className="h-6 w-6" />
          </span>
        </NavLink>
      )}
      <NavLink to="/tasks" className={item}><Icon name="tasks" className="h-6 w-6" />Задачи</NavLink>
      <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] text-muted">
        <Icon name="menu" className="h-6 w-6" />Ещё
      </button>
    </nav>
  )
}
