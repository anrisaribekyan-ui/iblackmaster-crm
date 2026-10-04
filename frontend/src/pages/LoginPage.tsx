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
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border border-line bg-surface p-6">
        <h1 className="mb-4 text-xl font-semibold">Вход в CRM</h1>
        <label className="mb-1 block text-sm text-muted" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded-md border border-line px-3 py-2 text-base"
          required
        />
        <label className="mb-1 block text-sm text-muted" htmlFor="password">
          Пароль
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-md border border-line px-3 py-2 text-base"
          required
        />
        {error && <p className="mb-3 text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60"
        >
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  )
}
