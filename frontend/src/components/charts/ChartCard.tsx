import { useState, type ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  children: ReactNode
  /** Табличный двойник графика: те же числа без наведения (доступность, точные значения) */
  table?: { headers: string[]; rows: (string | number)[][] }
  action?: ReactNode
  className?: string
}

export default function ChartCard({ title, subtitle, children, table, action, className = '' }: Props) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-surface p-4 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {table && (
            <button type="button" className="rounded-md px-2 py-1 text-xs text-muted hover:bg-canvas" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
              {asTable ? 'График' : 'Таблица'}
            </button>
          )}
        </div>
      </header>
      {asTable && table ? (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-xs text-muted">
              <tr>{table.headers.map((h, i) => <th key={h} className={`py-1.5 font-medium ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-line">
                  {row.map((cell, ci) => <td key={ci} className={`py-1.5 ${ci ? 'num text-right' : ''}`}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </section>
  )
}
