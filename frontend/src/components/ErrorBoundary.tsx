import { Component, type ErrorInfo, type ReactNode } from 'react'

const RELOAD_KEY = 'crm:chunk-reload'

/** Ошибка загрузки куска приложения: после обновления CRM старые файлы страниц на сервере заменены новыми. */
export function isChunkError(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(text)
}

/** Один раз перезагружает страницу, чтобы подтянуть свежую версию; второй раз подряд — не зацикливается. */
export function reloadOnceForNewVersion(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < 30000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* приватный режим: просто перезагрузим */ }
  window.location.reload()
  return true
}

type Props = { children: ReactNode; resetKey?: string }
type State = { error: Error | null }

/** Ловит падение отрисовки: вместо белого экрана — понятное сообщение и кнопка. Сбрасывается при переходе на другую страницу. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Ошибка экрана', error, info.componentStack)
    if (isChunkError(error)) reloadOnceForNewVersion()
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    const chunk = isChunkError(this.state.error)
    return (
      <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
        <h2 className="mb-2 text-lg font-semibold">{chunk ? 'Вышла новая версия CRM' : 'Экран не открылся'}</h2>
        <p className="mb-4 text-sm text-muted">{chunk ? 'Нажмите «Обновить», страница загрузится заново. Ваши данные не потеряны.' : 'Что-то пошло не так на этой странице. Остальные разделы работают.'}</p>
        <div className="flex justify-center gap-2">
          <button className="rounded-md bg-accent font-semibold px-4 py-2 text-accent-ink" onClick={() => window.location.reload()}>Обновить</button>
          {!chunk && <button className="rounded-md border border-line px-4 py-2" onClick={() => this.setState({ error: null })}>Попробовать снова</button>}
        </div>
      </div>
    )
  }
}
