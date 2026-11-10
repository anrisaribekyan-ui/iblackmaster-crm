import { useEffect, useRef, useState } from 'react'
import { confirmDialog } from '../../components/dialogs'
import { api, getToken } from '../../api/client'

type Result = {
  status: 'queued' | 'running' | 'done' | 'error'
  rows?: number
  commit?: boolean
  stats?: Record<string, number>
  warnings?: string[]
  errors?: string[]
  errors_total?: number
  seconds?: number
  message?: string
}

/** Перенос заказов из выгрузки LiveSklad «Заказы»: сначала пробный прогон, потом запись. */
export default function LiveskladImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [job, setJob] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!job) return
    const tick = async () => {
      try {
        const next = await api.get<Result>(`/admin/livesklad-import/${job}`)
        setResult(next)
        if (next.status === 'queued' || next.status === 'running') timer.current = window.setTimeout(tick, 3000)
      } catch {
        timer.current = window.setTimeout(tick, 5000)
      }
    }
    void tick()
    return () => window.clearTimeout(timer.current)
  }, [job])

  const start = async (commit: boolean) => {
    if (!file) return
    if (commit && !(await confirmDialog('Записать заказы в базу? Заказы Панфиловского не будут изменены, у Ленты и «1000 мелочей» обновятся и добавятся.'))) return
    setError('')
    setResult(null)
    setJob(null)
    try {
      const response = await fetch(`/api/admin/livesklad-import/orders?commit=${commit}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() ?? ''}`, 'Content-Type': 'application/octet-stream' },
        body: file,
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.message ?? 'Не удалось загрузить файл')
      setJob(body.job)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить файл')
    }
  }

  const running = result?.status === 'queued' || result?.status === 'running'
  return (
    <section className="max-w-3xl">
      <h2 className="mb-2 text-lg font-semibold">Перенос заказов из LiveSklad</h2>
      <p className="mb-4 text-sm text-muted">
        Выберите файл «Заказы.xlsx», выгруженный из LiveSklad по всем точкам. Сначала сделайте пробный прогон: он ничего не сохраняет, а только показывает,
        что будет создано и обновлено. Повторная загрузка безопасна: заказы не дублируются, а обновляются по номеру. У Ленты номера получают приставку «ЛН-».
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Файл выгрузки заказов" />
        <button type="button" disabled={!file || running} className="rounded-md border border-line px-3 py-2 disabled:opacity-50" onClick={() => void start(false)}>
          Пробный прогон
        </button>
        <button type="button" disabled={!file || running} className="rounded-md bg-accent font-semibold px-3 py-2 text-accent-ink disabled:opacity-50" onClick={() => void start(true)}>
          Записать в базу
        </button>
      </div>
      {error && <p role="alert" className="mt-3 text-danger">{error}</p>}
      {result && (
        <div className="mt-4 rounded-xl border border-line bg-surface p-4 text-sm" aria-live="polite">
          {running && <p>Обработано строк: {result.rows ?? 0}…</p>}
          {result.status === 'error' && <p className="text-danger">Ошибка: {result.message}</p>}
          {result.status === 'done' && (
            <>
              <p className="font-semibold">{result.commit ? 'Записано в базу' : 'Пробный прогон — ничего не сохранено'} за {result.seconds} с</p>
              <ul className="mt-2 grid gap-1">
                {Object.entries(result.stats ?? {}).map(([key, value]) => (
                  <li key={key}>{key}: <b>{value}</b></li>
                ))}
              </ul>
              {(result.warnings ?? []).map((w) => <p key={w} className="mt-1 text-muted">! {w}</p>)}
              {!!result.errors_total && (
                <details className="mt-2">
                  <summary>Ошибок: {result.errors_total}</summary>
                  <ul className="mt-1 text-muted">{(result.errors ?? []).map((e) => <li key={e}>{e}</li>)}</ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  )
}
