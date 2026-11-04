import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, getToken, setToken } from './api/client'

export type Me = {
  id: number
  short_name: string
  email: string
  role_id: number
  role_name: string
  home_page: string
  is_owner: boolean
  permissions: string[]
  scopes: Record<string, string>
  location_ids: number[]
  /** Подсказки и экскурсии, которые сотрудник уже видел */
  seen_tips: string[]
}

type AuthState = {
  me: Me | null
  loading: boolean
  /** Нет связи с сервером (телефон без интернета) — вход не сбрасываем, показываем «Нет связи» */
  offline: boolean
  retry: () => void
  login: (email: string, password: string) => Promise<void>
  loginWithToken: (token: string) => Promise<void>
  logout: () => void
  /** Есть ли у текущего сотрудника право (код из backend/app/permissions.py) */
  can: (permission: string) => boolean
  /** Отметить подсказку показанной (хранится на сервере) */
  markTip: (id: string) => void
  /** «Показать экскурсию заново» */
  resetTips: () => Promise<void>
}

const ME_KEY = 'crm_me'
function readCachedMe(): Me | null {
  try {
    const raw = localStorage.getItem(ME_KEY)
    return raw ? (JSON.parse(raw) as Me) : null
  } catch {
    return null
  }
}
function writeCachedMe(value: Me | null) {
  try {
    if (value) localStorage.setItem(ME_KEY, JSON.stringify(value))
    else localStorage.removeItem(ME_KEY)
  } catch { /* приватный режим */ }
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Профиль с прошлого захода показываем сразу, а свежий подтягиваем в фоне — экран не ждёт сервер
  const cached = getToken() ? readCachedMe() : null
  const [me, setMe] = useState<Me | null>(cached)
  const [loading, setLoading] = useState(!cached)
  const [offline, setOffline] = useState(false)

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      const fresh = await api.get<Me>('/auth/me')
      setMe(fresh)
      writeCachedMe(fresh)
      setOffline(false)
    } catch (error) {
      // Сервер ответил ошибкой (истёк вход) — на страницу входа; сети нет — сохраняем вход и ждём связь
      if (error instanceof ApiError) {
        setMe(null)
        writeCachedMe(null)
      } else if (!readCachedMe()) setOffline(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMe()
  }, [loadMe])

  // Связь вернулась — сразу пробуем снова
  useEffect(() => {
    if (!offline) return
    const onOnline = () => {
      setLoading(true)
      void loadMe()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [offline, loadMe])

  const retry = () => {
    setLoading(true)
    void loadMe()
  }

  const login = async (email: string, password: string) => {
    const { access_token } = await api.post<{ access_token: string }>('/auth/login', { email, password })
    setToken(access_token)
    await loadMe()
  }

  // Вход по токену, который выдал сервер после сброса пароля по коду
  const loginWithToken = async (token: string) => {
    setToken(token)
    await loadMe()
  }

  const logout = () => {
    setToken(null)
    setMe(null)
  }

  const can = (permission: string) => !!me && (me.is_owner || me.permissions.includes(permission))

  const markTip = (id: string) => {
    setMe((current) => (current && !current.seen_tips.includes(id) ? { ...current, seen_tips: [...current.seen_tips, id] } : current))
    void api.post('/auth/tips/seen', { id }).catch(() => undefined)
  }

  const resetTips = async () => {
    await api.post('/auth/tips/reset', {})
    setMe((current) => (current ? { ...current, seen_tips: [] } : current))
  }

  return <AuthContext.Provider value={{ me, loading, offline, retry, login, loginWithToken, logout, can, markTip, resetTips }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}
