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
}

type AuthState = {
  me: Me | null
  loading: boolean
  /** Нет связи с сервером (телефон без интернета) — вход не сбрасываем, показываем «Нет связи» */
  offline: boolean
  retry: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  /** Есть ли у текущего сотрудника право (код из backend/app/permissions.py) */
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [offline, setOffline] = useState(false)

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null)
      setLoading(false)
      return
    }
    try {
      setMe(await api.get<Me>('/auth/me'))
      setOffline(false)
    } catch (error) {
      // Сервер ответил ошибкой (истёк вход) — на страницу входа; сети нет — сохраняем вход и ждём связь
      if (error instanceof ApiError) setMe(null)
      else setOffline(true)
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

  const logout = () => {
    setToken(null)
    setMe(null)
  }

  const can = (permission: string) => !!me && (me.is_owner || me.permissions.includes(permission))

  return <AuthContext.Provider value={{ me, loading, offline, retry, login, logout, can }}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}
