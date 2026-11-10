import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'locations', label: 'Локации' },
  { to: 'statuses', label: 'Статусы' },
  { to: 'order-types', label: 'Типы заказов' },
  { to: 'staff', label: 'Сотрудники и роли' },
  { to: 'notifications', label: 'Уведомления' },
  { to: 'quick-orders', label: 'Быстрые заказы' },
  { to: 'checklist', label: 'Чек-лист' },
  { to: 'livesklad-import', label: 'Перенос из LiveSklad' },
]

export default function SettingsLayout() {
  return (
    <div>
      <h1 className="mb-4 text-[22px] font-bold leading-tight md:text-[26px]">Настройки</h1>
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Настройки" className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `whitespace-nowrap flex min-h-9 items-center rounded-md px-3 text-sm ${isActive ? 'bg-surface font-semibold text-ink shadow-[var(--shadow-card)] ring-1 ring-line' : 'font-medium text-ink-2 hover:bg-line-soft hover:text-ink'}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1"><Outlet /></div>
      </div>
    </div>
  )
}
