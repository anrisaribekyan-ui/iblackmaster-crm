import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: 'how-knows', label: 'Источники рекламы' },
  { to: 'problems', label: 'Неисправности' },
  { to: 'complete-sets', label: 'Комплектация' },
  { to: 'measures', label: 'Единицы измерения' },
  { to: 'counteragent-types', label: 'Типы контрагентов' },
  { to: 'devices', label: 'Устройства' },
  { to: 'products', label: 'Товары' },
  { to: 'works', label: 'Работы' },
  { to: 'counteragents', label: 'Контрагенты' },
  { to: 'cash-items', label: 'Статьи денег' },
]

export default function CompendiumsLayout() {
  return (
    <div>
      <h1 className="mb-5 text-xl font-semibold">Справочники</h1>
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Справочники" className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col">
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
