import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../auth'
import ChangePasswordModal from './ChangePasswordModal'
import Icon from './icons'
import InstallApp from './InstallApp'
import ThemeSwitch from './ThemeSwitch'
import Skeleton from './Skeleton'
import LocationSwitcher from './LocationSwitcher'
import ShiftPrompt from './ShiftPrompt'
import IdeaButton from './IdeaButton'
import PageTip from './PageTip'
import Tour from './Tour'
import { ALL_TIPS_OFF, TOUR_ID, tipFor } from '../tips'

/** Меню как в LiveSklad. permission — право, без которого пункт скрыт (пусто — виден всем). */
type MenuGroup = 'work' | 'money' | 'service' | 'system'
/** Группы бокового меню (дизайн v2): всё меню помещается в экран без прокрутки. Порядок массива MENU прежний. */
const GROUPS: { key: MenuGroup; title: string }[] = [
  { key: 'work', title: 'Работа' },
  { key: 'money', title: 'Деньги' },
  { key: 'service', title: 'Сервис' },
  { key: 'system', title: 'Система' },
]
export const MENU: { to: string; label: string; icon: string; permission?: string; group: MenuGroup }[] = [
  { to: '/', icon: 'home', label: 'Главная', group: 'work' },
  { to: '/orders', icon: 'orders', label: 'Заказы', group: 'work' },
  { to: '/sales', icon: 'sales', label: 'Продажи', group: 'work' },
  { to: '/day', icon: 'notes', label: 'Что сегодня было', group: 'money' },
  // Идеи сотрудников видит только владелец: такого права нет ни в одной роли, у владельца «можно всё»
  { to: '/ideas', icon: 'idea', label: 'Идеи для Анри', permission: 'ideasAccess', group: 'system' },
  { to: '/store/remains', icon: 'store', label: 'Склад', permission: 'remainAccess', group: 'work' },
  { to: '/tasks', icon: 'tasks', label: 'Задачи', group: 'work' },
  { to: '/zakupki', icon: 'cart', label: 'Закупки', group: 'work' },
  { to: '/apps', icon: 'phone', label: 'Приложения', permission: 'appInstallAccess', group: 'service' },
  { to: '/panic', icon: 'phone', label: 'Проверка паник лог', permission: 'panicAccess', group: 'service' },
  { to: '/vpn', icon: 'phone', label: 'VPN', permission: 'vpnAccess', group: 'service' },
  { to: '/transfer', icon: 'phone', label: 'Перенос данных', group: 'service' },
  { to: '/finance/cashes', icon: 'finance', label: 'Финансы', group: 'money' },
  { to: '/analytics', icon: 'analytics', label: 'Аналитика', permission: 'reportAccess', group: 'money' },
  { to: '/compendiums/how-knows', icon: 'books', label: 'Справочники', group: 'system' },
  { to: '/settings', icon: 'settings', label: 'Настройки', permission: 'settingAccess', group: 'system' },
]

export default function Layout() {
  const { me, logout, can, resetTips } = useAuth()
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [forcedTip, setForcedTip] = useState<string | null>(null)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  // На телефоне меню закрывается после перехода
  useEffect(() => setMenuOpen(false), [location.pathname])
  // Подсказки: экскурсия при первом входе, карточка «Что здесь» при первом заходе на страницу, «?» открывает снова
  const seen = me?.seen_tips ?? []
  const tipsOff = seen.includes(ALL_TIPS_OFF)
  const tip = tipFor(location.pathname)
  const tipAllowed = !!tip && (!tip.permission || can(tip.permission))
  const showTour = !!me && (tourOpen || (!tipsOff && !seen.includes(TOUR_ID)))
  const showTip = !showTour && tipAllowed && tip && (forcedTip === tip.id || (!tipsOff && !seen.includes(tip.id)))
  useEffect(() => setForcedTip(null), [location.pathname])
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
        className={`fixed inset-y-0 left-0 z-[46] flex w-64 shrink-0 flex-col bg-rail pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-rail-ink transition-transform md:static md:w-[220px] md:translate-x-0 ${menuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 px-[18px] pb-3 pt-[18px]">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-accent text-[15px] font-bold text-white" aria-hidden>i</span>
          <span className="text-base font-semibold tracking-tight text-white">iBlack<span className="text-rail-muted">Master</span></span>
        </div>
        {/* Общий поиск заказа живёт в меню (на компьютере): «/» ставит сюда курсор с любой страницы */}
        <form onSubmit={(event) => void submitSearch(event)} className="relative mx-3 mb-2.5 hidden md:block">
          <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rail-muted" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Найти заказ: номер, телефон, имя, IMEI"
            className="rail-search peer h-[34px] min-h-0 w-full rounded-lg border border-rail-line bg-rail-hover/60 pl-8 pr-8 text-[13px] text-white placeholder:text-rail-muted"
            placeholder="Найти заказ"
            title="Номер, телефон, имя, IMEI"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Escape' && (setQuery(''), event.currentTarget.blur())}
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] bg-rail-line px-1.5 text-[11px] leading-[18px] text-rail-ink peer-focus:hidden" title="Нажмите / чтобы искать">/</kbd>
        </form>
        <nav className="rail-scroll flex flex-1 flex-col overflow-y-auto px-2.5">
          {GROUPS.map((group) => {
            const items = MENU.filter((m) => m.group === group.key && (!m.permission || can(m.permission)))
            if (items.length === 0) return null
            return (
              <div key={group.key} className="flex flex-col gap-px pb-2">
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-rail-muted">{group.title}</p>
                {items.map((m) => (
                  <NavLink
                    key={m.to}
                    to={m.to}
                    end={m.to === '/'}
                    className={({ isActive }) =>
                      `flex min-h-11 items-center gap-2.5 rounded-[7px] px-2.5 text-[15px] md:min-h-[30px] md:text-[13.5px] ${
                        isActive ? 'bg-rail-hover font-semibold text-white' : 'text-rail-ink hover:bg-rail-hover/70 hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon name={m.icon} className={`h-[18px] w-[18px] md:h-4 md:w-4 ${isActive ? 'text-[#ff6a45]' : 'text-rail-muted'}`} />
                        {m.label}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <InstallApp />
        <div className="mx-2.5 mb-1.5 flex items-center gap-1">
          <ThemeSwitch />
          <button type="button" onClick={() => { void resetTips().then(() => setTourOpen(true)) }} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-sm font-semibold text-rail-muted hover:bg-rail-hover hover:text-white" title="Экскурсия по CRM: показать подсказки по страницам заново" aria-label="Экскурсия по CRM">
            ?
          </button>
        </div>
        <div className="mx-2.5 mb-3 flex items-center gap-2.5 rounded-[10px] bg-rail-hover/70 px-2.5 py-2">
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-rail-line text-[13px] font-semibold text-white" aria-hidden>
            {(me?.short_name ?? '?').slice(0, 1)}
          </span>
          <button type="button" onClick={() => setPasswordOpen(true)} className="min-w-0 flex-1 rounded-md text-left leading-tight" title="Сменить пароль">
            <div className="truncate text-[13px] font-medium text-white">{me?.short_name}</div>
            <div className="truncate text-xs text-rail-muted">{me?.role_name} · сменить пароль</div>
          </button>
          <button onClick={logout} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-rail-muted hover:bg-rail hover:text-white" title="Выйти из CRM на этом устройстве" aria-label="Выйти">
            <Icon name="logout" className="h-[18px] w-[18px]" />
          </button>
        </div>
      </aside>
      {passwordOpen && <ChangePasswordModal onClose={() => setPasswordOpen(false)} />}
      {showTour && <Tour onClose={() => setTourOpen(false)} />}
      {/* На телефоне прокручивается вся страница (прячется адресная строка, работает «потянуть — обновить»),
          на компьютере — только рабочая область справа от меню */}
      <main ref={mainRef} className="relative min-w-0 flex-1 px-3 pb-24 sm:px-7 md:overflow-auto md:py-[18px] md:pb-6">
        <header className={`top-0 z-20 ${onOrders ? 'max-md:static md:hidden' : 'sticky'} -mx-3 mb-3 flex items-center gap-2 bg-canvas/95 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur sm:-mx-7 sm:px-7 md:static md:mx-0 md:mb-3 md:justify-end md:bg-transparent md:p-0 md:backdrop-blur-none`}>
          <LocationSwitcher className="shrink-0 md:order-first md:mr-auto" />
          <form onSubmit={(event) => void submitSearch(event)} className={`${onOrders ? 'hidden' : ''} relative min-w-0 flex-1 md:hidden`}>
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              enterKeyHint="search"
              className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3"
              placeholder="Поиск: номер, телефон, имя, IMEI"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && (setQuery(''), event.currentTarget.blur())}
            />
          </form>
          <button
            type="button"
            onClick={() => (tipAllowed && tip ? setForcedTip(tip.id) : setTourOpen(true))}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface font-semibold text-muted hover:text-ink"
            title="Что на этой странице"
            aria-label="Подсказка по этой странице"
          >
            ?
          </button>
        </header>
        {showTip && tip && <PageTip tip={tip} onClose={() => setForcedTip(null)} onTour={() => setTourOpen(true)} />}
        <Suspense fallback={<Skeleton className="py-6" />}>
          <div key={location.pathname.split('/').slice(0, 2).join('/')} className="ui-fade">
            <Outlet />
          </div>
        </Suspense>
        {/* Запас внизу страницы: плавающая кнопка «Идея для Анри» не должна закрывать последние кнопки формы */}
        <div className="h-24" aria-hidden />
      </main>
      <ShiftPrompt />
      <IdeaButton />
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
