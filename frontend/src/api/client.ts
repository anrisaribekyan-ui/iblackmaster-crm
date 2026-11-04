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
  references.clear() // другой пользователь — другие права и справочники
  try {
    localStorage.removeItem('crm_me') // профиль и главная принадлежат прежнему пользователю
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
    for (const key of Object.keys(localStorage)) if (key.startsWith('crm_dash:')) localStorage.removeItem(key)
  } catch {
    /* приватный режим браузера — работаем без сохранения */
  }
}

const REQUEST_TIMEOUT_MS = 40000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Запрос с ограничением по времени: раньше «зависший» запрос крутил «Загрузка…» вечно.
 *  Чтение (GET) при обрыве связи или перезапуске сервера (502/503/504 — идёт обновление CRM) повторяется до трёх раз. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const canRetry = (init.method ?? 'GET') === 'GET'
  const attempts = canRetry ? 4 : 1
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      if (attempt < attempts && [502, 503, 504].includes(res.status)) {
        await sleep(attempt * 1500)
        continue
      }
      return res
    } catch (e) {
      if (attempt < attempts) {
        await sleep(attempt * 1500)
        continue
      }
      const aborted = (e as { name?: string })?.name === 'AbortError'
      throw new ApiError(0, 'network', aborted ? 'Сервер не отвечает. Проверьте интернет и повторите.' : 'Нет связи с сервером. Проверьте интернет и повторите.')
    } finally {
      clearTimeout(timer)
    }
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetchWithRetry(`/api${path}`, {
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
    const friendly = [502, 503, 504].includes(res.status) ? 'Сервер обновляется, повторите через минуту' : 'Ошибка сервера'
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? friendly)
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

async function requestRaw(method: string, path: string, body?: FormData): Promise<Response> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api${path}`, { method, headers, body })
  if (res.status === 401) {
    setToken(null)
    if (!location.pathname.startsWith('/login')) location.href = '/login'
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Ошибка сервера')
  }
  return res
}

// --- Быстрее на медленном интернете ------------------------------------------------------
// 1) Одинаковые GET-запросы, ушедшие одновременно, выполняются один раз (карточка заказа просила сотрудников трижды).
// 2) Справочники (точки, статусы, сотрудники…) живут 5 минут: при каждом переходе их не перекачиваем.
//    Любое изменение (POST/PUT/DELETE) сбрасывает справочники — правки в настройках видны сразу.
const REFERENCE_PATHS = [
  '/locations', '/order-statuses', '/order-types', '/employees/short', '/how-knows', '/cash-registers',
  '/stores', '/settings/checklist', '/problems', '/complete-sets', '/roles', '/quick-orders',
]
const REFERENCE_TTL = 5 * 60 * 1000
const inFlight = new Map<string, Promise<unknown>>()
const references = new Map<string, { at: number; data: unknown }>()
const isReference = (path: string) => REFERENCE_PATHS.some((p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`))

function cachedGet<T>(path: string): Promise<T> {
  if (isReference(path)) {
    const hit = references.get(path)
    if (hit && Date.now() - hit.at < REFERENCE_TTL) return Promise.resolve(hit.data as T)
  }
  const pending = inFlight.get(path)
  if (pending) return pending as Promise<T>
  const promise = request<T>('GET', path)
    .then((data) => {
      if (isReference(path)) references.set(path, { at: Date.now(), data })
      return data
    })
    .finally(() => inFlight.delete(path))
  inFlight.set(path, promise)
  return promise
}

function mutate<T>(method: string, path: string, body?: unknown): Promise<T> {
  references.clear()
  return request<T>(method, path, body)
}

export function clearApiCache() {
  references.clear()
}

export const api = {
  /** Файл с токеном (фото заказа): <img src> не умеет слать заголовок, поэтому берём blob. */
  blob: async (path: string) => (await requestRaw('GET', path)).blob(),
  /** Загрузка файлов: FormData уходит как multipart, Content-Type ставит браузер. */
  upload: async <T>(path: string, form: FormData) => {
    references.clear()
    return (await requestRaw('POST', path, form)).json() as Promise<T>
  },
  get: <T>(path: string) => cachedGet<T>(path),
  getHtml: requestHtml,
  post: <T>(path: string, body?: unknown) => mutate<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => mutate<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => mutate<T>('PATCH', path, body ?? {}),
  del: <T = void>(path: string, body?: unknown) => mutate<T>('DELETE', path, body),
}
