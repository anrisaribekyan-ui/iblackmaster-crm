import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { money } from '../pages/shared'
import Modal from './Modal'

/** Оклад «за смену»: при первом заходе за день спрашиваем сотрудника с таким окладом, была ли у него смена. */
export default function ShiftPrompt() {
  const { me } = useAuth()
  const [amount, setAmount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<{ ask: boolean; amount: number }>('/salary/shift')
      .then((r) => setAmount(r.ask ? Number(r.amount) : null))
      .catch(() => setAmount(null))
  }, [])

  if (amount === null) return null

  const answer = async (worked: boolean) => {
    setBusy(true)
    setError('')
    try {
      await api.post('/salary/shift', { worked })
      setAmount(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить ответ')
    } finally {
      setBusy(false)
    }
  }

  const name = (me?.short_name ?? '').split(' ').find((part) => part.length > 3 && !part.endsWith('.')) ?? me?.short_name ?? ''
  return (
    <Modal title="Смена сегодня" onClose={() => setAmount(null)}>
      <p className="text-base">{name}, у тебя сегодня смена? Если да, поставлю оклад {money(amount)}.</p>
      {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={busy} onClick={() => void answer(true)} className="rounded-md bg-accent px-4 py-3 font-medium text-accent-ink disabled:opacity-60">
          Да, у меня смена
        </button>
        <button type="button" disabled={busy} onClick={() => void answer(false)} className="rounded-md border border-line bg-surface px-4 py-3 font-medium disabled:opacity-60">
          Нет, у меня нет смены
        </button>
      </div>
    </Modal>
  )
}
