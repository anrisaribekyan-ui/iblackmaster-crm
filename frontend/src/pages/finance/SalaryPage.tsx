import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../api/client'
import { money } from '../shared'

type Location = { id: number; name: string }
type SummaryRow = {
  employee_id: number
  name: string
  salary: string
  accrued: string
  bonuses: string
  penalties: string
  total: string
  paid: string
  to_pay: string
}
type Summary = { items: SummaryRow[]; total: string; to_pay: string }

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const buttonClass = 'rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-canvas'

export default function SalaryPage() {
  const navigate = useNavigate()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [locationId, setLocationId] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      if (locationId) params.set('location_id', locationId)
      const [result, locs] = await Promise.all([
        api.get<Summary>(`/salary/summary?${params.toString()}`),
        api.get<Location[]>('/locations'),
      ])
      setSummary(result)
      setLocations(locs)
    } catch (e) {
      setSummary(null)
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить зарплату')
    } finally {
      setLoading(false)
    }
  }, [year, month, locationId])

  useEffect(() => {
    void load()
  }, [load])

  const shiftMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setYear(y)
    setMonth(m)
  }

  const totalPaid = summary?.items.reduce((sum, row) => sum + Number(row.paid), 0) ?? 0

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <button className={buttonClass} onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">‹</button>
          <span className="min-w-36 text-center font-medium">{MONTHS[month - 1]} {year}</span>
          <button className={buttonClass} onClick={() => shiftMonth(1)} aria-label="Следующий месяц">›</button>
        </div>
        <select className="rounded-md border border-line bg-surface px-3 py-2 text-sm" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Все локации</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </div>

      {error && <p className="mb-3 text-danger">{error}</p>}

      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : summary === null ? null : summary.items.length === 0 ? (
        <p className="text-muted">За этот месяц начислений нет.</p>
      ) : (
        <div className="overflow-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Сотрудник</th>
                <th className="px-3 py-2 text-right font-medium">Начислено</th>
                <th className="px-3 py-2 text-right font-medium">Выплачено</th>
                <th className="px-3 py-2 text-right font-medium">К выплате</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {summary.items.map((row) => (
                <tr key={row.employee_id} className="cursor-pointer hover:bg-canvas" onClick={() => navigate(`/finance/salary/${row.employee_id}`)}>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="num px-3 py-2 text-right">{money(row.total)}</td>
                  <td className="num px-3 py-2 text-right">{money(row.paid)}</td>
                  <td className={`num px-3 py-2 text-right font-medium ${Number(row.to_pay) < 0 ? 'text-danger' : ''}`}>{money(row.to_pay)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-line font-medium">
              <tr>
                <td className="px-3 py-2">Итого</td>
                <td className="num px-3 py-2 text-right">{money(summary.total)}</td>
                <td className="num px-3 py-2 text-right">{money(totalPaid)}</td>
                <td className={`num px-3 py-2 text-right ${Number(summary.to_pay) < 0 ? 'text-danger' : ''}`}>{money(summary.to_pay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
