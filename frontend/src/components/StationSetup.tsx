import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import Modal from './Modal'
import { formatDateTime, inputClass } from '../pages/shared'

/**
 * Мастер «Подключить компьютер» и файлы помощника.
 * Любой сотрудник с правом на станции открывает CRM на нужном компьютере и проходит шаги:
 * название → скачать помощника → вставить код → дождаться, пока станция выйдет на связь.
 */

export type AgentFile = {
  platform: 'windows' | 'macos'
  title: string
  available: boolean
  filename: string
  size: number | null
  version: string | null
  uploaded_at: string | null
}
type StationLite = { id: number; name: string; online: boolean; last_seen_at: string | null }

const button = 'rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50'
const primary = 'rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink disabled:opacity-50'

export function connectionCode(token: string) {
  // Адрес и токен — только латиница, поэтому btoa без перекодировки
  return btoa(JSON.stringify({ url: window.location.origin, token }))
}

function detectPlatform(): AgentFile['platform'] {
  const ua = navigator.userAgent
  return /Mac|iPhone|iPad/.test(ua) && !/Windows/.test(ua) ? 'macos' : 'windows'
}

function mb(size: number | null) {
  return size ? `${Math.max(1, Math.round(size / 1_048_576))} МБ` : ''
}

export function useAgentFiles() {
  const [files, setFiles] = useState<AgentFile[] | null>(null)
  const reload = useCallback(async () => {
    try {
      setFiles(await api.get<AgentFile[]>('/app-install/agent-files'))
    } catch {
      setFiles([])
    }
  }, [])
  useEffect(() => { void reload() }, [reload])
  return { files, reload }
}

function Step({ n, title, done, active, children }: { n: number; title: string; done: boolean; active: boolean; children?: React.ReactNode }) {
  return (
    <li className={`grid grid-cols-[1.75rem_1fr] gap-x-3 ${active || done ? '' : 'opacity-50'}`}>
      <span aria-hidden
        className={`mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium ${done ? 'bg-success text-white' : active ? 'bg-accent text-accent-ink' : 'border border-line text-muted'}`}>
        {done ? '✓' : n}
      </span>
      <div className="grid gap-2 pb-5">
        <p className="pt-1 font-medium">{title}</p>
        {active && children}
      </div>
    </li>
  )
}

function DownloadButtons({ files, preferred }: { files: AgentFile[]; preferred: AgentFile['platform'] }) {
  const sorted = [...files].sort((a, b) => (a.platform === preferred ? -1 : b.platform === preferred ? 1 : 0))
  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map((f) => f.available ? (
        <a key={f.platform} href={`/api/app-install/agent-files/${f.platform}`} download={f.filename}
          className={f.platform === preferred ? primary : button}>
          Скачать для {f.title}{f.size ? ` · ${mb(f.size)}` : ''}
        </a>
      ) : (
        <span key={f.platform} className={`${button} cursor-not-allowed opacity-50`} title="Установщик ещё не загружен в CRM">
          {f.title}: нет файла
        </span>
      ))}
    </div>
  )
}

function InstallHint({ platform }: { platform: AgentFile['platform'] }) {
  return platform === 'windows' ? (
    <ul className="grid list-disc gap-1 pl-5 text-sm text-muted">
      <li>Нужен <b className="text-ink">iTunes</b> или <b className="text-ink">Apple Devices</b> из Microsoft Store — без них Windows не видит айфоны.</li>
      <li>Если Windows покажет «Система Windows защитила ваш компьютер» — нажмите «Подробнее» → «Выполнить в любом случае».</li>
      <li>Права администратора не нужны.</li>
    </ul>
  ) : (
    <ul className="grid list-disc gap-1 pl-5 text-sm text-muted">
      <li>Распакуйте архив и откройте <b className="text-ink">install-mac.command</b> правой кнопкой → «Открыть» → «Открыть».</li>
      <li>iTunes на Mac не нужен.</li>
    </ul>
  )
}

/** Мастер подключения нового компьютера. `token` передаётся, если код уже выдан (кнопка «Новый код»). */
export function StationWizard({
  onClose,
  onChanged,
  reissue,
}: {
  onClose: () => void
  onChanged: () => void
  reissue?: { stationId: number; name: string; token: string }
}) {
  const { files } = useAgentFiles()
  const platform = detectPlatform()
  const [name, setName] = useState('')
  const [stationId, setStationId] = useState<number | null>(reissue?.stationId ?? null)
  const [code, setCode] = useState(reissue ? connectionCode(reissue.token) : '')
  const [downloaded, setDownloaded] = useState(!!reissue)
  const [copied, setCopied] = useState(false)
  const [online, setOnline] = useState<StationLite | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const startedAt = useRef(Date.now())
  // Страница под окном обновляется каждые 3 с и каждый раз даёт новый onChanged — держим его в ref,
  // иначе таймер ожидания перезапускался бы и не успевал сработать
  const changed = useRef(onChanged)
  changed.current = onChanged

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.post<{ token: string; station: { id: number } }>('/app-install/stations', { name })
      setStationId(r.station.id)
      setCode(connectionCode(r.token))
      startedAt.current = Date.now()
      changed.current()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось добавить компьютер')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  // Ждём, пока помощник выйдет на связь с новым кодом
  useEffect(() => {
    if (!stationId || online) return
    const timer = setInterval(async () => {
      try {
        const list = await api.get<StationLite[]>('/app-install/stations')
        const s = list.find((x) => x.id === stationId)
        // При переподключении станция могла быть «на связи» со старым кодом — ждём пульс после выдачи нового
        const fresh = s?.last_seen_at && new Date(s.last_seen_at).getTime() > startedAt.current - 2000
        if (s?.online && (!reissue || fresh)) {
          setOnline(s)
          changed.current()
        }
      } catch {
        /* следующая попытка */
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [stationId, online, reissue])

  const anyFile = files?.some((f) => f.available)
  const waitingLong = !online && copied && Date.now() - startedAt.current > 90_000

  return (
    <Modal title={reissue ? `Переподключить «${reissue.name}»` : 'Подключить компьютер'} onClose={onClose}>
      <ol className="grid">
        {!reissue && (
          <Step n={1} title="Как назвать этот компьютер?" done={!!stationId} active={!stationId}>
            <p className="text-sm text-muted">Так его будут видеть мастера. Например: «Панфа — приёмка».</p>
            <div className="flex gap-2">
              <input aria-label="Название компьютера" className={inputClass} value={name} autoFocus placeholder="Название"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void create() }} />
              <button className={primary} disabled={!name.trim() || busy} onClick={() => void create()}>
                {busy ? '…' : 'Дальше'}
              </button>
            </div>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </Step>
        )}

        <Step n={reissue ? 1 : 2} title="Скачайте и запустите помощника на этом компьютере" done={!!stationId && downloaded}
          active={!!stationId && !downloaded}>
          {files === null ? <p className="text-sm text-muted">Проверяю файлы…</p> : anyFile ? (
            <>
              <div onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) setDownloaded(true) }}>
                <DownloadButtons files={files} preferred={platform} />
              </div>
              <InstallHint platform={platform} />
              <button className="justify-self-start text-sm text-accent underline-offset-2 hover:underline" onClick={() => setDownloaded(true)}>
                Помощник уже установлен — дальше
              </button>
            </>
          ) : (
            <p className="text-sm text-warning">
              Установщик ещё не загружен в CRM. Его загружает руководитель внизу этой страницы, в блоке «Файлы помощника».
            </p>
          )}
        </Step>

        <Step n={reissue ? 2 : 3} title="Вставьте код подключения в окно помощника" done={!!online} active={!!stationId && downloaded && !online}>
          <p className="text-sm text-muted">Установщик спросит код на первом шаге. Код работает только для этого компьютера.</p>
          <div className="rounded-lg border border-line bg-canvas p-3">
            <code className="block max-h-24 overflow-auto break-all text-xs">{code}</code>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button className={primary} onClick={() => void copy()}>{copied ? 'Скопировано' : 'Скопировать код'}</button>
            <span className="flex items-center gap-2 text-sm text-muted" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-warning" aria-hidden />
              Жду, когда компьютер выйдет на связь…
            </span>
          </div>
          {waitingLong && (
            <p className="text-sm text-muted">
              Долго? Проверьте, что установка дошла до конца и есть интернет. Если код вставили с ошибкой —
              запустите установщик ещё раз.
            </p>
          )}
        </Step>

        <Step n={reissue ? 3 : 4} title="Готово" done={!!online} active={!!online}>
          <p className="text-sm">
            «{online?.name}» на связи. Подключите айфон кабелем, разблокируйте и нажмите на нём «Доверять».
            Помощник будет запускаться сам при включении компьютера.
          </p>
          <button className={`${primary} justify-self-start`} onClick={onClose}>Перейти к телефонам</button>
        </Step>
      </ol>
    </Modal>
  )
}

/** Блок для руководителя: какие установщики лежат в CRM, загрузить новый. */
export function AgentFilesPanel({ canUpload }: { canUpload: boolean }) {
  const { files, reload } = useAgentFiles()
  const [busy, setBusy] = useState<string>('')
  const [error, setError] = useState('')
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const upload = async (platform: string, file: File) => {
    setBusy(platform)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      await api.upload('/app-install/agent-files/' + platform, form)
      await reload()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить файл')
    } finally {
      setBusy('')
    }
  }

  if (!files) return null
  return (
    <section className="grid gap-3" aria-labelledby="agent-files-title">
      <div>
        <h2 id="agent-files-title" className="font-semibold">Файлы помощника</h2>
        <p className="text-sm text-muted">
          Программа для компьютера, к которому подключают айфоны. Скачайте вариант для своей системы и запустите.
          {canUpload && <> Свежие файлы собирает GitHub (репозиторий → Actions → «Помощник станции» → Artifacts) —
          скачайте и загрузите сюда как есть, распаковывать не нужно.</>}
        </p>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {files.map((f) => (
          <li key={f.platform} className="relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface p-3">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{f.title}</div>
              <div className="truncate text-xs text-muted">
                {f.available
                  ? [f.filename, mb(f.size), f.version && `версия ${f.version}`, f.uploaded_at && formatDateTime(f.uploaded_at)].filter(Boolean).join(' · ')
                  : `Не загружен — нужен ${f.filename}`}
              </div>
            </div>
            {canUpload && <input ref={(el) => { inputs.current[f.platform] = el }} type="file" className="sr-only"
              accept={f.platform === 'windows' ? '.exe,.zip' : '.zip'} aria-label={`Файл для ${f.title}`}
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(f.platform, file) }} />}
            {f.available && (
              <a href={`/api/app-install/agent-files/${f.platform}`} download={f.filename}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-ink">
                Скачать
              </a>
            )}
            {canUpload && (
              <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
                disabled={!!busy} onClick={() => inputs.current[f.platform]?.click()}>
                {busy === f.platform ? 'Загружаю…' : f.available ? 'Заменить' : 'Загрузить'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  )
}
