import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

type Conf = { list_days: number; reminders_active: boolean; reminder_days: number[]; reminder_text: string }

const field = 'w-full rounded-md border border-line bg-surface px-3 py-2'

/** Настройки «Забытых аппаратов»: с какого дня считать забытым и SMS-напоминания по дням. */
export default function ForgottenSettings() {
  const [conf, setConf] = useState<Conf | null>(null)
  const [daysText, setDaysText] = useState('')
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<Conf>('/settings/forgotten').then((c) => {
      setConf(c)
      setDaysText(c.reminder_days.join(', '))
    }).catch(() => setConf(null))
  }, [])
  if (!conf) return null

  const save = async () => {
    setError('')
    setSaved('')
    try {
      const reminder_days = daysText.split(/[^\d]+/).map(Number).filter((d) => d > 0)
      const next = await api.put<Conf>('/settings/forgotten', { ...conf, reminder_days })
      setConf(next)
      setDaysText(next.reminder_days.join(', '))
      setSaved('Сохранено')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-semibold">Забытые аппараты</h3>
      <p className="mb-3 text-sm text-muted">
        Готовые устройства, которые клиент не забрал. Напоминания уходят днём (10:00–20:00), каждому заказу — не больше одного SMS на каждый срок.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-muted">Считать забытым через, дней
          <input type="number" min={1} max={365} className={field} value={conf.list_days}
            onChange={(e) => setConf({ ...conf, list_days: Number(e.target.value) || 1 })} />
        </label>
        <label className="grid gap-1 text-sm text-muted">Напоминать на день (через запятую)
          <input className={field} value={daysText} onChange={(e) => setDaysText(e.target.value)} placeholder="3, 7, 30" />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={conf.reminders_active} onChange={(e) => setConf({ ...conf, reminders_active: e.target.checked })} />
        Отправлять SMS-напоминания автоматически
      </label>
      <label className="mt-3 grid gap-1 text-sm text-muted">Текст напоминания
        <textarea rows={3} className={field} value={conf.reminder_text} onChange={(e) => setConf({ ...conf, reminder_text: e.target.value })} />
        <span className="text-xs">Те же переменные, что в шаблонах, плюс {'{дней}'} — сколько дней аппарат ждёт.</span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={() => void save()} className="rounded-md bg-accent px-4 py-2 text-accent-ink">Сохранить</button>
        {saved && <span className="text-sm text-success">{saved}</span>}
        {error && <span role="alert" className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  )
}
