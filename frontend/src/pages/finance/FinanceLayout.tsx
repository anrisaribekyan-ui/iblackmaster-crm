import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth'

export default function FinanceLayout() {
  const { can } = useAuth()
  const links = [
    { to: 'cashes', label: 'Кассы' },
    ...(can('transactionAccess') ? [{ to: 'transactions', label: 'Журнал операций' }] : []),
  ]

  return (
    <section>
      <h1 className="mb-5 text-xl font-semibold">Финансы</h1>
      <nav aria-label="Финансы" className="mb-5 flex gap-1 border-b border-line">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `border-b-2 px-3 py-2 ${isActive ? 'border-accent font-medium' : 'border-transparent text-muted'}`
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
