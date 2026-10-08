import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import Modal from './Modal'
import { formatDateTime, smsParts, smsStateClass, type Sms } from '../pages/settings/NotificationsPage'

const quick = [
  'Здравствуйте, {имя}! Ваш {устройство} готов, к оплате {долг} руб. {адрес}, {часы}',
  'Здравствуйте, {имя}! Заказ {номер}: нужна ваша консультация, перезвоните, пожалуйста: {телефон_точки}',
  'Здравствуйте, {имя}! Статус ремонта {номер}: {ссылка}',
]

/** SMS по заказу: что ушло клиенту и кнопка «Написать клиенту». */
export default function OrderSms({ orderId, hasPhone, disabled, onSent }: { orderId: number; hasPhone: boolean; disabled: boolean; onSent: () => void }) {
  const [items, setItems] = useState<Sms[]>([])
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setItems(await api.get<Sms[]>(`/orders/${orderId}/notifications`))
    } catch {
      /* блок не главный — без SMS карточка заказа всё равно работает */
    }
  }, [orderId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!items.some((i) => i.state === 'queued' || i.state === 'sending' || i.state === 'sent')) return
    const timer = setInterval(() => void load(), 15000)
    return () => clearInterval(timer)
  }, [items, load])

  const send = async () => {
    setSending(true)
    setError('')
    try {
      await api.post(`/orders/${orderId}/notify`, { text })
      setOpen(false)
      setText('')
      await load()
      onSent()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">SMS клиенту</h2>
        <button
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
          disabled={disabled || !hasPhone}
          title={hasPhone ? '' : 'У клиента нет мобильного номера'}
          onClick={() => setOpen(true)}
        >
          Написать клиенту
        </button>
      </header>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{hasPhone ? 'Сообщений по заказу ещё не было.' : 'У клиента нет мобильного номера.'}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 5).map((i) => (
            <li key={i.id} className="text-sm">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${smsStateClass[i.state]}`}>{i.state_title}</span>
                <small className="tabular-nums text-muted">{formatDateTime(i.sent_at ?? i.created_at)}</small>
              </div>
              <p className="mt-1">{i.text}</p>
              {i.error && i.state !== 'cancelled' && <small className="text-danger">{i.error}</small>}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <Modal title="SMS клиенту" onClose={() => setOpen(false)}>
          <div className="grid gap-3">
            <div className="flex flex-col gap-1">
              {quick.map((q) => (
                <button key={q} type="button" onClick={() => setText(q)}
                  className="rounded-md border border-line px-2 py-1 text-left text-sm text-muted hover:border-accent hover:text-ink">
                  {q}
                </button>
              ))}
            </div>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus
              className="w-full rounded-md border border-line bg-surface px-3 py-2" placeholder="Текст сообщения" />
            <p className="text-xs text-muted">
              Переменные в фигурных скобках подставятся сами. {[...text].length} зн. · ~{smsParts(text)} SMS.
            </p>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <button onClick={send} disabled={sending || !text.trim()}
              className="justify-self-end rounded-md bg-accent px-4 py-2 text-accent-ink disabled:opacity-50">
              {sending ? 'Отправляю…' : 'Отправить'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}
