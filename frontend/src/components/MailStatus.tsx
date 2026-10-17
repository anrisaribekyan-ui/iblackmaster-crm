import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

type Status = { configured: boolean; sender: string | null; host: string | null }

/** Почта для писем сотрудникам: подключена ли и кнопка «прислать проверочное письмо себе». */
export default function MailStatus() {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get<Status>('/settings/mail').then(setStatus).catch(() => setStatus(null))
  }, [])

  if (!status) return null

  const test = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const r = await api.post<{ sent_to: string }>('/settings/mail/test', {})
      setMessage({ ok: true, text: `Письмо ушло на ${r.sent_to} — проверьте ящик и «Спам»` })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiError ? e.message : 'Не удалось отправить' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Почта для сотрудников</h3>
          <p className="text-sm text-muted">Коды «Забыли пароль?», письма «Пароль изменён» и «Добро пожаловать».</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.configured ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
          {status.configured ? `Подключена · ${status.sender}` : 'Не подключена'}
        </span>
      </div>
      {status.configured ? (
        <button disabled={busy} className="mt-3 rounded-md border border-line px-3 py-2 text-sm disabled:opacity-60" onClick={() => void test()}>
          {busy ? 'Отправляем…' : 'Прислать проверочное письмо себе'}
        </button>
      ) : (
        <p className="mt-3 text-sm">
          Заведите отдельный ящик, например crm@ваш-домен в Яндекс 360, создайте в нём «пароль приложения» и впишите на сервере в файл <code className="rounded bg-canvas px-1">.env</code>:
          SMTP_HOST, SMTP_USER, SMTP_PASSWORD. Пока почта не подключена, пароли меняет владелец в «Сотрудниках».
        </p>
      )}
      {message && <p role="status" className={`mt-2 text-sm ${message.ok ? 'text-success' : 'text-danger'}`}>{message.text}</p>}
    </section>
  )
}
