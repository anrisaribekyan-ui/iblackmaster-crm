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
      <h1 className="mb-4 text-[22px] font-bold leading-tight md:text-[26px]">Справочники</h1>
      <div className="flex flex-col gap-6 lg:flex-row">
        <nav aria-label="Справочники" className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col">
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
