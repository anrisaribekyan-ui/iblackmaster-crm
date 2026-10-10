import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useAuth } from '../auth'

export default function LoginPage() {
  const { me, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (me) return <Navigate to="/" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-rail p-4">
      <div className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-xl font-bold text-white" aria-hidden>i</span>
        <span className="text-2xl font-semibold tracking-tight text-white">iBlack<span className="text-rail-ink">Master</span></span>
      </div>
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-surface p-7 shadow-2xl">
        <h1 className="text-xl font-semibold">Вход</h1>
        <p className="mb-6 mt-1 text-sm text-muted">Сервисные центры iBlackMaster</p>
        <label className="mb-1.5 block text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 w-full border px-3 py-2 text-base"
          required
        />
        <label className="mb-1.5 block text-sm font-medium" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-5 w-full border px-3 py-2 text-base"
          required
        />
        {error && <p role="alert" className="mb-4 rounded-lg bg-[#fef3f2] px-3 py-2 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="h-11 w-full rounded-lg bg-accent px-3 font-medium text-accent-ink disabled:opacity-60"
        >
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
