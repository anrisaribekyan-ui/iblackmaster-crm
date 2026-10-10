import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'locations', label: 'Локации' },
  { to: 'statuses', label: 'Статусы' },
  { to: 'order-types', label: 'Типы заказов' },
  { to: 'staff', label: 'Сотрудники и роли' },
  { to: 'notifications', label: 'Уведомления' },
  { to: 'quick-orders', label: 'Быстрые заказы' },
  { to: 'checklist', label: 'Чек-лист' },
]

export default function SettingsLayout() {
  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold">Настройки</h1>
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Настройки" className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-md px-3 py-2 ${isActive ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-surface'}`
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
