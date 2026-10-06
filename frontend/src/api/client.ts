/**
 * Единый клиент API. Все запросы к бэкенду — только через api.get/post/put/del.
 * Токен хранится в localStorage, ошибки бэкенда приходят как ApiError с русским текстом.
 */

const TOKEN_KEY = 'crm_token'

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* приватный режим браузера — работаем без сохранения */
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401) {
    setToken(null)
    if (!location.pathname.startsWith('/login')) location.href = '/login'
  }
  if (res.status === 204) return undefined as T

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 422) {
      throw new ApiError(422, 'validation', 'Проверьте правильность заполнения полей')
    }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Ошибка сервера')
  }
  return data as T
}

async function requestHtml(path: string): Promise<string> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`/api${path}`, { headers })
  if (res.status === 401) {
    setToken(null)
    if (!location.pathname.startsWith('/login')) location.href = '/login'
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (res.status === 422) {
      throw new ApiError(422, 'validation', 'Проверьте правильность заполнения полей')
    }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Ошибка сервера')
  }
  return res.text()
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  getHtml: requestHtml,
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  del: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}
