import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from './Modal'

const field = 'w-full rounded-md border border-line bg-surface px-3 py-2'

/** Сотрудник сам меняет свой пароль. Нужен текущий пароль; после смены этот вход остаётся, остальные устройства выйдут. */
export default function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { loginWithToken } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (next.length < 8) return setError('Новый пароль — не короче 8 символов')
    if (next !== repeat) return setError('Новый пароль и повтор не совпадают')
    setBusy(true)
    try {
      const { access_token } = await api.post<{ access_token: string }>('/auth/change-password', { current_password: current, new_password: next })
      await loginWithToken(access_token)
      setDone(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сменить пароль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Сменить пароль" onClose={onClose}>
      {done ? (
        <div className="grid gap-4">
          <p role="status">Пароль изменён. На других устройствах войти нужно будет заново.</p>
          <button className="justify-self-end rounded-md bg-accent font-semibold px-4 py-2 text-accent-ink" onClick={onClose}>Готово</button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="grid gap-3">
          <label className="grid gap-1 text-sm text-muted">Текущий пароль
            <input className={field} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label className="grid gap-1 text-sm text-muted">Новый пароль (не короче 8 символов)
            <input className={field} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
          </label>
          <label className="grid gap-1 text-sm text-muted">Новый пароль ещё раз
            <input className={field} type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={8} />
          </label>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
            <button disabled={busy} className="rounded-md bg-accent font-semibold px-4 py-2 text-accent-ink disabled:opacity-60">{busy ? 'Сохраняю…' : 'Сменить пароль'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
