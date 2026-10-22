import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'
import Icon from './icons'
import InstallApp from './InstallApp'
import ThemeSwitch from './ThemeSwitch'
import Skeleton from './Skeleton'

/** Меню как в LiveSklad. permission — право, без которого пункт скрыт (пусто — виден всем). */
export const MENU: { to: string; label: string; icon: string; permission?: string }[] = [
  { to: '/', icon: 'home', label: 'Главная' },
  { to: '/orders', icon: 'orders', label: 'Заказы' },
  { to: '/sales', icon: 'sales', label: 'Продажи' },
  { to: '/store/remains', icon: 'store', label: 'Склад', permission: 'remainAccess' },
  { to: '/tasks', icon: 'tasks', label: 'Задачи' },
  { to: '/boards', icon: 'boards', label: 'Доски' },
  { to: '/zakupki', icon: 'cart', label: 'Закупки' },
  { to: '/apps', icon: 'phone', label: 'Приложения', permission: 'appInstallAccess' },
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
  const searchRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const navigationType = useNavigationType()
  // Новая страница открывается сверху; «Назад» оставляет прокрутку как была
  useEffect(() => {
    if (navigationType === 'POP') return
    window.scrollTo(0, 0)
    mainRef.current?.scrollTo(0, 0)
  }, [location.pathname, navigationType])

  // В полях сумм и количеств при касании выделяем всё — новое число сразу заменяет старое
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const el = event.target as HTMLInputElement
      if (el?.tagName === 'INPUT' && (el.type === 'number' || el.inputMode === 'numeric' || el.inputMode === 'decimal')) {
        requestAnimationFrame(() => { try { el.select() } catch { /* type=number в Safari */ } })
      }
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  // В списке заказов свой поиск по списку — общий на телефоне не дублируем
  const onOrders = location.pathname === '/orders'

  // Название вкладки браузера = раздел: удобно, когда открыто несколько вкладок CRM
  useEffect(() => {
    const section = [...MENU].reverse().find((m) => (m.to === '/' ? location.pathname === '/' : location.pathname.startsWith(m.to.split('/').slice(0, 2).join('/'))))
    document.title = section && section.to !== '/' ? `${section.label} · iBlackMaster` : 'iBlackMaster'
  }, [location.pathname])

  // Горячие клавиши (когда курсор не в поле ввода): / — поиск, N — новый заказ, P — продажа.
  // Смотрим на физическую клавишу, поэтому работает и на русской раскладке.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.metaKey || event.ctrlKey || event.altKey || target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (event.code === 'Slash' || event.key === '/') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.code === 'KeyN' && can('createOrderAccess')) {
        navigate('/orders/new')
      } else if (event.code === 'KeyP') {
        navigate('/sales')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, can])

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // «А15911» на русской раскладке и просто «15911» — тоже номер заказа
    let term = query.trim().replace(/^[АаAa]/, 'A')
    if (!term) return
    if (/^\d{4,6}$/.test(term)) term = `A${term}`
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
      {menuOpen && <div className="modal-backdrop fixed inset-0 z-[45] bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}
      <aside
        className={`fixed inset-y-0 left-0 z-[46] flex w-64 shrink-0 flex-col bg-rail pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-rail-ink transition-transform md:static md:w-56 md:translate-x-0 ${menuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
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
        <ThemeSwitch />
        <div className="m-3 flex items-center gap-3 rounded-lg bg-rail-hover px-3 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#3a3f47] text-sm font-medium text-white" aria-hidden>
            {(me?.short_name ?? '?').slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1 text-sm leading-tight">
            <div className="truncate font-medium text-white">{me?.short_name}</div>
            <div className="truncate text-xs text-rail-muted">{me?.role_name}</div>
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-rail-muted hover:bg-rail hover:text-white" title="Выйти из CRM на этом устройстве">
            <Icon name="logout" className="h-[18px] w-[18px]" />
            <span className="md:sr-only">Выйти</span>
          </button>
        </div>
      </aside>
      {/* На телефоне прокручивается вся страница (прячется адресная строка, работает «потянуть — обновить»),
          на компьютере — только рабочая область справа от меню */}
      <main ref={mainRef} className="min-w-0 flex-1 px-3 pb-24 sm:px-8 md:overflow-auto md:py-6 md:pb-6">
        <header className={`top-0 z-20 ${onOrders ? 'max-md:static md:hidden' : 'sticky'} -mx-3 mb-3 flex items-center gap-2 bg-canvas/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur sm:-mx-8 sm:px-8 md:static md:mx-0 md:mb-4 md:justify-end md:bg-transparent md:p-0 md:backdrop-blur-none`}>
          <form onSubmit={(event) => void submitSearch(event)} className={`${onOrders ? 'max-md:hidden' : ''} relative min-w-0 flex-1 md:max-w-md md:flex-none md:basis-[28rem]`}>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              type="search"
              enterKeyHint="search"
              className="peer w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 md:pr-9"
              placeholder="Поиск: номер, телефон, имя, IMEI"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && (setQuery(''), event.currentTarget.blur())}
            />
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-xs text-muted md:block peer-focus:md:hidden" title="Нажмите / чтобы искать">/</kbd>
          </form>
        </header>
        <Suspense fallback={<Skeleton className="py-6" />}>
          <Outlet />
        </Suspense>
      </main>
      <MobileTabBar onMore={() => setMenuOpen(true)} canCreate={can('createOrderAccess')} />
    </div>
  )
}

/** Нижняя панель на телефоне — как в обычных приложениях: главное под большим пальцем. */
function MobileTabBar({ onMore, canCreate }: { onMore: () => void; canCreate: boolean }) {
  const [plus, setPlus] = useState(false)
  const navigate = useNavigate()
  const item = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
  const go = (to: string) => {
    setPlus(false)
    navigate(to)
  }
  return (
    <>
      {plus && (
        // «+» — два главных действия дня: принять заказ и пробить продажу
        <div className="modal-backdrop fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setPlus(false)}>
          <div className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] rise grid gap-2" onClick={(e) => e.stopPropagation()}>
            {canCreate && (
              <button className="flex items-center gap-3 rounded-2xl bg-surface p-4 text-left shadow-xl" onClick={() => go('/orders/new')}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-white"><Icon name="orders" className="h-6 w-6" /></span>
                <span><b className="block">Новый заказ</b><small className="text-muted">принять устройство в ремонт</small></span>
              </button>
            )}
            <button className="flex items-center gap-3 rounded-2xl bg-surface p-4 text-left shadow-xl" onClick={() => go('/sales')}>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink text-white"><Icon name="sales" className="h-6 w-6" /></span>
              <span><b className="block">Продажа</b><small className="text-muted">плитки ходовых товаров</small></span>
            </button>
            <button className="flex items-center gap-3 rounded-2xl bg-surface p-4 text-left shadow-xl" onClick={() => go('/sales?quick=1')}>
              <span className="grid h-11 w-11 place-items-center rounded-xl border border-line text-2xl">+</span>
              <span><b className="block">Своя позиция</b><small className="text-muted">продать то, чего нет в справочнике</small></span>
            </button>
          </div>
        </div>
      )}
      <nav
        aria-label="Быстрые разделы"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-surface/95 pb-[calc(env(safe-area-inset-bottom)+0.35rem)] backdrop-blur md:hidden"
      >
        <NavLink to="/" end className={item}><Icon name="home" className="h-6 w-6" />Главная</NavLink>
        <NavLink to="/orders" end className={item}><Icon name="orders" className="h-6 w-6" />Заказы</NavLink>
        <button type="button" onClick={() => setPlus((v) => !v)} className="flex flex-1 flex-col items-center pt-1.5" aria-label="Создать" aria-expanded={plus}>
          <span className={`grid h-11 w-11 place-items-center rounded-full bg-accent text-white shadow-md shadow-accent/30 transition-transform ${plus ? 'rotate-45' : ''}`}>
            <Icon name="plus" className="h-6 w-6" />
          </span>
        </button>
        <NavLink to="/sales" className={item}><Icon name="sales" className="h-6 w-6" />Продажи</NavLink>
        <button type="button" onClick={onMore} className="flex flex-1 flex-col items-center gap-0.5 pt-2 text-[11px] text-muted">
          <Icon name="menu" className="h-6 w-6" />Ещё
        </button>
      </nav>
    </>
  )
}
