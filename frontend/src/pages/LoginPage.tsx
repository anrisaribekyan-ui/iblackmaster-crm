import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import OtpInput from '../components/OtpInput'

type Mode = 'login' | 'forgot' | 'code'

const field = 'w-full border px-3 py-2 text-base'

export default function LoginPage() {
  const { me, login, loginWithToken } = useAuth()
  const [params] = useSearchParams()
  const resetEmail = params.get('reset') // ссылка «Открыть CRM» из письма — сразу на ввод кода
  const [mode, setMode] = useState<Mode>(resetEmail ? 'code' : 'login')
  const [email, setEmail] = useState(() => {
    if (resetEmail) return resetEmail
    try { return localStorage.getItem('login:email') ?? '' } catch { return '' }
  })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState(false)
  const [done, setDone] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  if (me) return <Navigate to="/" replace />

  const go = (next: Mode) => {
    setMode(next)
    setError('')
    setNotice('')
  }

  const run = async (action: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Нет связи с сервером')
    } finally {
      setBusy(false)
    }
  }

  const submitLogin = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      await login(email, password)
      try { localStorage.setItem('login:email', email) } catch { /* приватный режим */ }
    })
  }

  const sendCode = (e?: FormEvent) => {
    e?.preventDefault()
    void run(async () => {
      await api.post('/auth/forgot', { email })
      setMode('code')
      setCode('')
      setResendIn(60)
      setNotice(`Если ${email} есть в CRM, код уже в письме. Проверьте и «Спам».`)
    })
  }

  const submitReset = (e: FormEvent) => {
    e.preventDefault()
    void run(async () => {
      try {
        const { access_token } = await api.post<{ access_token: string }>('/auth/reset', { email, code, password: newPassword })
        try { localStorage.setItem('login:email', email) } catch { /* приватный режим */ }
        // Даём увидеть «Пароль обновлён» — это единственный момент радости во всём сценарии
        setDone(true)
        await new Promise((r) => setTimeout(r, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 400 : 1300))
        await loginWithToken(access_token)
      } catch (err) {
        if (err instanceof ApiError && /код/i.test(err.message)) setCodeError(true)
        throw err
      }
    })
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-rail p-4">
      <div className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-accent text-xl font-bold text-white" aria-hidden>i</span>
        <span className="text-2xl font-semibold tracking-tight text-white">iBlack<span className="text-rail-ink">Master</span></span>
      </div>

      <div key={mode} className="pop-in w-full max-w-sm rounded-2xl bg-surface p-7 shadow-2xl">
        {mode === 'login' && (
          <form onSubmit={submitLogin}>
            <h1 className="text-xl font-semibold">Вход</h1>
            <p className="mb-6 mt-1 text-sm text-muted">Сервисные центры iBlackMaster</p>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={`mb-4 ${field}`} required />
            <div className="mb-1.5 flex items-baseline justify-between">
              <label className="text-sm font-medium" htmlFor="password">Пароль</label>
              <button type="button" className="text-sm text-muted hover:text-accent" onClick={() => go('forgot')}>Забыли пароль?</button>
            </div>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`mb-5 ${field}`} required />
            {error && <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="h-11 w-full rounded-lg bg-accent px-3 font-medium text-accent-ink disabled:opacity-60">
              {busy ? 'Входим…' : 'Войти'}
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={sendCode}>
            <h1 className="text-xl font-semibold">Новый пароль</h1>
            <p className="mb-6 mt-1 text-sm text-muted">Пришлём шестизначный код на рабочую почту — с ним зададите новый пароль.</p>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="forgot-email">Email</label>
            <input id="forgot-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={`mb-5 ${field}`} required autoFocus />
            {error && <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy} className="h-11 w-full rounded-lg bg-accent px-3 font-medium text-accent-ink disabled:opacity-60">
              {busy ? 'Отправляем…' : 'Прислать код'}
            </button>
            <button type="button" className="mt-4 w-full text-sm text-muted hover:text-ink" onClick={() => go('login')}>← Вспомнил, войти</button>
          </form>
        )}

        {mode === 'code' && (
          <form onSubmit={submitReset}>
            <h1 className="text-xl font-semibold">Код из письма</h1>
            <p className="mb-5 mt-1 text-sm text-muted">{notice || <>Отправили на <span className="text-ink">{email}</span>. Код действует 15 минут.</>}</p>
            <label className="sr-only" htmlFor="code">Код из письма</label>
            <div className="mb-5">
              <OtpInput id="code" value={code} onChange={(v) => { setCode(v); setCodeError(false) }} error={codeError} done={done} doneLabel="Пароль обновлён" />
            </div>
            <label className="mb-1.5 block text-sm font-medium" htmlFor="new-password">Новый пароль</label>
            <div className="relative mb-1">
              <input id="new-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} className={`${field} pr-20`} required />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-muted hover:text-ink" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'скрыть' : 'показать'}
              </button>
            </div>
            <p className={`mb-5 text-xs ${newPassword && newPassword.length < 8 ? 'text-danger' : 'text-muted'}`}>Не короче 8 символов{newPassword.length > 0 && newPassword.length < 8 ? ` — ещё ${8 - newPassword.length}` : ''}</p>
            {error && <p role="alert" className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <button type="submit" disabled={busy || done || code.length !== 6 || newPassword.length < 8} className="h-11 w-full rounded-lg bg-accent px-3 font-medium text-accent-ink disabled:opacity-50">
              {done ? 'Входим…' : busy ? 'Сохраняем…' : 'Сохранить и войти'}
            </button>
            <div className="mt-4 flex justify-between text-sm">
              <button type="button" className="text-muted hover:text-ink" onClick={() => go('login')}>← Ко входу</button>
              <button type="button" disabled={resendIn > 0 || busy} className="text-muted hover:text-accent disabled:hover:text-muted" onClick={() => sendCode()}>
                {resendIn > 0 ? `Прислать снова через ${resendIn} с` : 'Прислать код снова'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
