import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth'

export default function FinanceLayout() {
  const { can, me } = useAuth()
  const hasSalary = me?.is_owner || (me?.scopes?.salary && me.scopes.salary !== 'none')
  const links = [
    { to: 'cashes', label: 'Кассы' },
    ...(can('transactionAccess') ? [{ to: 'transactions', label: 'Журнал операций' }] : []),
    ...(hasSalary ? [{ to: 'salary', label: 'Зарплата' }] : []),
  ]

  return (
    <section>
      <h1 className="mb-5 text-[22px] font-bold leading-tight md:text-[26px]">Финансы</h1>
      <nav aria-label="Финансы" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `shrink-0 whitespace-nowrap -mb-px flex h-10 items-center border-b-2 px-3 ${isActive ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-ink-2 hover:text-ink'}`
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
