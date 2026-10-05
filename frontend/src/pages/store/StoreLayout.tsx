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
      <h1 className="mb-5 text-xl font-semibold">Склад</h1>
      <nav aria-label="Склад" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2 ${isActive ? 'border-accent font-medium' : 'border-transparent text-muted'}`
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
