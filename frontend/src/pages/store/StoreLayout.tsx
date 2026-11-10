import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth'

export default function StoreLayout() {
  const { can } = useAuth()
  const links = [
    { to: 'remains', label: 'Остатки', permission: 'remainAccess' },
    { to: 'purchase', label: 'Поступления', permission: 'purchaseAccess' },
    { to: 'move', label: 'Перемещения', permission: 'moveAccess' },
    { to: 'cancellation', label: 'Списания', permission: 'cancellationAccess' },
    { to: 'inventory', label: 'Инвентаризация', permission: 'inventoryAccess' },
  ].filter((link) => can(link.permission))

  return (
    <section>
      <h1 className="mb-4 text-[22px] font-bold leading-tight md:text-[26px]">Склад</h1>
      <nav aria-label="Склад" className="mb-5 flex gap-1 overflow-x-auto tab-line">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `whitespace-nowrap flex h-10 items-center border-b-2 px-3 ${isActive ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </section>
  )
}
