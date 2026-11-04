import { useRef, useState } from 'react'
import { api, ApiError } from '../api/client'

type Result = {
  device: string | null
  ios: string | null
  sensors: string[]
  key_lines: string[]
  findings: { title: string; advice: string }[]
  ai: string | null
  ai_enabled: boolean
  text: string
}

export default function PanicPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const pick = (f: File | null) => {
    setFile(f)
    setResult(null)
    setError('')
    setPreview(f && f.type.startsWith('image/') ? URL.createObjectURL(f) : '')
  }

  const run = async () => {
    if (!file && text.trim().length < 20) {
      setError('Сфотографируйте лог, приложите файл или вставьте текст')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const form = new FormData()
      if (file) form.append('file', file)
      form.append('text', text)
      setResult(await api.upload<Result>('/panic/check', form))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось проверить')
    } finally {
      setBusy(false)
    }
  }

  const btn = 'rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-2'

  return (
    <section className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold">Проверка паник лог</h1>
      <p className="mb-4 text-sm text-muted">Сфотографируйте экран с логом, приложите файл (.ips, .txt) или вставьте текст. Подскажем, что проверять в первую очередь.</p>

      <div className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => photoRef.current?.click()}>📷 Сфотографировать</button>
          <button type="button" className={btn} onClick={() => fileRef.current?.click()}>📎 Выбрать файл или фото</button>
          {file && <button type="button" className="rounded-md px-3 py-2.5 text-sm text-muted hover:underline" onClick={() => pick(null)}>Убрать</button>}
        </div>
        <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = '' }} />
        <input ref={fileRef} type="file" accept="image/*,.ips,.txt,.log,.json,.crash,.panic" className="hidden" onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = '' }} />

        {file && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            {preview && <img src={preview} alt="Фото лога" className="h-24 w-24 rounded-md border border-line object-cover" />}
            <span className="break-all">{file.name} · {Math.max(1, Math.round(file.size / 1024))} КБ</span>
          </div>
        )}

        <label className="mt-4 block text-sm text-muted" htmlFor="panic-text">Или вставьте текст лога</label>
        <textarea id="panic-text" rows={6} value={text} onChange={(e) => { setText(e.target.value); setResult(null) }} placeholder="panicString: … Missing sensor(s): …" className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs" />

        <button type="button" onClick={run} disabled={busy} className="mt-3 rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'Читаю лог…' : 'Проверить'}
        </button>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {result && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-semibold">Что нашли в логе</h2>
            <p className="text-sm text-muted">
              {result.device ? `Модель: ${result.device}` : 'Модель не указана'}{result.ios ? ` · iOS ${result.ios}` : ''}
              {result.sensors.length > 0 && ` · Датчики: ${result.sensors.join(', ')}`}
            </p>
            {result.findings.length === 0 ? (
              <p className="mt-2 text-sm">Типовых признаков не нашли — смотрите разбор ниже.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {result.findings.map((f) => (
                  <li key={f.title} className="rounded-md bg-surface-2 p-3 text-sm"><b>{f.title}.</b> {f.advice}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-2 font-semibold">Разбор ИИ</h2>
            {result.ai ? (
              <p className="whitespace-pre-wrap text-sm">{result.ai}</p>
            ) : (
              <p className="text-sm text-muted">{result.ai_enabled ? 'ИИ сейчас не ответил — попробуйте ещё раз. Подсказки выше собраны по правилам.' : 'ИИ не подключён (нет ключа DeepSeek на сервере) — показаны только подсказки по правилам.'}</p>
            )}
            <p className="mt-3 text-xs text-muted">Это подсказка, не приговор: лог показывает узел, который не ответил, а не саму сломанную деталь.</p>
          </div>

          <details className="rounded-xl border border-line bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Прочитанный текст</summary>
            {result.key_lines.length > 0 && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{result.key_lines.join('\n')}</pre>}
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-muted">{result.text}</pre>
          </details>
        </div>
      )}
    </section>
  )
}
