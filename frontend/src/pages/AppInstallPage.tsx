import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from '../components/Modal'
import OtpInput from '../components/OtpInput'
import Skeleton from '../components/Skeleton'
import { AgentFilesPanel, StationWizard } from '../components/StationSetup'
import { formatDateTime, inputClass } from './shared'

/**
 * Установка iOS-приложений через станцию: компьютер в точке с помощником, к которому
 * по USB подключены айфоны. Страница только ставит задачи и показывает их ход —
 * всю работу с телефонами делает помощник (station-agent).
 */

type Device = { udid: string; name: string | null; product_type: string | null; ios_version: string | null; paired: boolean; problem: string | null }
type Station = {
  id: number
  name: string
  location_name: string | null
  online: boolean
  last_seen_at: string | null
  os: string | null
  agent_version: string | null
  devices: Device[]
  apple_id: string | null
  apple_auth: 'ok' | 'needed' | 'unknown'
  apple_route: string | null
}
type IosApp = {
  id: number
  adam_id: number
  bundle_id: string
  name: string
  version: string | null
  version_id: number | null
  source: string
  ipa_size: number | null
  ipa_version: string | null
  ipa_apple_id: string | null
}
type Job = {
  id: number
  station_id: number
  station_name: string
  kind: 'scan' | 'purchases' | 'login' | 'install' | 'archive'
  app: IosApp | null
  target_name: string | null
  state: 'queued' | 'running' | 'need_code' | 'done' | 'failed' | 'cancelled'
  progress: number
  message: string | null
  error_code: string | null
  email: string | null
  code_sent: boolean
  created_at: string
  created_by_name: string | null
}

const OPEN = ['queued', 'running', 'need_code']
const STATE_TITLE: Record<Job['state'], string> = {
  queued: 'В очереди',
  running: 'Выполняется',
  need_code: 'Нужен код',
  done: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено',
}
const STATE_CLASS: Record<Job['state'], string> = {
  queued: 'text-muted',
  running: 'text-accent',
  need_code: 'text-warning',
  done: 'text-success',
  failed: 'text-danger',
  cancelled: 'text-muted',
}
const button = 'rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-line disabled:hover:text-inherit'
const primary = 'rounded-md bg-accent px-3 py-1.5 text-sm text-accent-ink disabled:opacity-50'

function deviceTitle(d: { name: string | null }) {
  return d.name || 'iPhone'
}

function jobTitle(job: Job) {
  switch (job.kind) {
    case 'scan':
      return `Скан донора «${job.target_name ?? 'телефон'}»`
    case 'purchases':
      return 'Покупки Apple ID'
    case 'login':
      return `Вход в Apple ID ${job.email ?? ''}`
    case 'archive':
      return `${job.app?.name ?? 'Приложение'} → в архив CRM`
    default:
      return `${job.app?.name ?? 'Приложение'} → ${job.target_name ?? 'телефон'}`
  }
}

/** Длинные ссылки (адреса файлов Apple с ключами) не нужны мастеру и растягивали страницу. */
function shortMessage(text: string) {
  return text.replace(/https?:\/\/[^\s"']+/g, (url) => {
    try {
      return `[${new URL(url).host}]`
    } catch {
      return '[ссылка]'
    }
  })
}

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// ------------------------------------------------------------------ вход в Apple ID

function LoginModal({ station, onClose, onQueued }: { station: Station; onClose: () => void; onQueued: () => void }) {
  const [email, setEmail] = useState(station.apple_id ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await api.post('/app-install/jobs', { station_id: station.id, kind: 'login', email, password })
      onQueued()
      onClose()
    } catch (e) {
      setError(errorText(e, 'Не удалось начать вход'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Вход в Apple ID" onClose={onClose}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <p className="text-sm text-muted">
          Под этим Apple ID станция будет скачивать приложения. Пароль сразу уходит на станцию и в CRM не сохраняется.
          Потом Apple пришлёт код на ваш iPhone — его нужно будет ввести здесь, в списке задач.
        </p>
        <div className="grid gap-1">
          <label htmlFor="apple-email" className="text-sm">Apple ID</label>
          <input id="apple-email" type="email" autoComplete="username" className={inputClass} value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="apple-password" className="text-sm">Пароль</label>
          <input id="apple-password" type="password" autoComplete="current-password" className={inputClass} value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className={primary} disabled={busy || !email || !password}>{busy ? 'Отправляю…' : 'Войти'}</button>
        </div>
      </form>
    </Modal>
  )
}

// ------------------------------------------------------------------ задача в списке

function JobRow({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const waitingCode = job.state === 'need_code' && !job.code_sent

  const act = async (path: string, body?: unknown) => {
    setError('')
    try {
      await api.post(`/app-install/jobs/${job.id}/${path}`, body)
      onChanged()
    } catch (e) {
      setError(errorText(e, 'Не получилось'))
    }
  }

  useEffect(() => {
    if (code.length !== 6 || sending) return
    setSending(true)
    void act('code', { code }).finally(() => setSending(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  return (
    <li className="grid min-w-0 gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-medium">{jobTitle(job)}</span>
        <span className={`text-sm ${STATE_CLASS[job.state]}`}>{STATE_TITLE[job.state]}</span>
        <span className="ml-auto text-xs text-muted">
          {formatDateTime(job.created_at)}{job.created_by_name ? ` · ${job.created_by_name}` : ''}
        </span>
      </div>
      {job.kind === 'install' && job.state === 'running' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(job.progress, 3)}%` }} />
        </div>
      )}
      {job.message && (
        <p className={`text-sm [overflow-wrap:anywhere] ${job.state === 'failed' ? 'text-danger' : 'text-muted'}`}>
          {shortMessage(job.message)}
        </p>
      )}
      {waitingCode && (
        <div className="grid max-w-xs gap-1">
          <label htmlFor={`code-${job.id}`} className="text-sm">Код из Apple на вашем iPhone</label>
          <OtpInput id={`code-${job.id}`} value={code} onChange={setCode} error={!!error} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2 empty:hidden">
        {(job.state === 'queued' || job.state === 'need_code' || (job.state === 'running' && (job.kind !== 'install' || job.progress < 40))) && (
          <button className={button} onClick={() => void act('cancel')}>Отменить</button>
        )}
        {(job.state === 'failed' || job.state === 'cancelled') && job.kind !== 'login' && (
          <button className={button} onClick={() => void act('retry')}>Повторить</button>
        )}
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ страница

export default function AppInstallPage() {
  const { can } = useAuth()
  const manage = can('appInstallStationAccess')
  const [stations, setStations] = useState<Station[] | null>(null)
  const [stationId, setStationId] = useState<number | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [apps, setApps] = useState<IosApp[]>([])
  const [query, setQuery] = useState('')
  const [targetUdid, setTargetUdid] = useState<string>('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [modal, setModal] = useState<'station' | 'login' | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reissue, setReissue] = useState<{ stationId: number; name: string; token: string } | null>(null)

  const station = stations?.find((s) => s.id === stationId) ?? null
  const paired = useMemo(() => station?.devices.filter((d) => d.paired) ?? [], [station])

  const loadStations = useCallback(async () => {
    const list = await api.get<Station[]>('/app-install/stations')
    setStations(list)
    setStationId((current) => (current && list.some((s) => s.id === current) ? current : list[0]?.id ?? null))
  }, [])

  const loadJobs = useCallback(async () => {
    setJobs(await api.get<Job[]>('/app-install/jobs?limit=20'))
  }, [])

  const loadApps = useCallback(async (q: string) => {
    setApps(await api.get<IosApp[]>(`/app-install/apps${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`))
  }, [])

  const refresh = useCallback(async () => {
    try {
      await Promise.all([loadStations(), loadJobs()])
      setError('')
    } catch (e) {
      setError(errorText(e, 'Не удалось загрузить станции'))
    }
  }, [loadStations, loadJobs])

  useEffect(() => { void refresh() }, [refresh])

  // Станция и задачи живут своей жизнью — опрашиваем, пока страница открыта
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 3000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const timer = setTimeout(() => void loadApps(query).catch(() => undefined), 250)
    return () => clearTimeout(timer)
  }, [query, loadApps])

  // Скан или покупки закончились — библиотека пополнилась
  const finishedLists = jobs.filter((j) => (j.kind === 'scan' || j.kind === 'purchases') && j.state === 'done').map((j) => j.id).join(',')
  useEffect(() => { void loadApps(query).catch(() => undefined) }, [finishedLists]) // eslint-disable-line react-hooks/exhaustive-deps

  // Целевой телефон выбирается сам, если подключён один
  useEffect(() => {
    if (targetUdid && paired.some((d) => d.udid === targetUdid)) return
    setTargetUdid(paired.length === 1 ? paired[0].udid : '')
  }, [paired, targetUdid])

  const startJob = async (body: Record<string, unknown>, okText: string) => {
    if (!station) return
    setNotice('')
    setError('')
    try {
      await api.post('/app-install/jobs', { station_id: station.id, ...body })
      setNotice(okText)
      await loadJobs()
    } catch (e) {
      setError(errorText(e, 'Не удалось поставить задачу'))
    }
  }

  const uploadIpa = async (file: File) => {
    setUploading(true)
    setError('')
    setNotice('')
    try {
      const form = new FormData()
      form.append('file', file)
      const app = await api.upload<IosApp>('/app-install/apps/upload', form)
      setNotice(`«${app.name}» в архиве CRM`)
      await loadApps(query)
    } catch (e) {
      setError(errorText(e, 'Не удалось загрузить файл'))
    } finally {
      setUploading(false)
    }
  }

  const archiveAll = async () => {
    if (!station) return
    setError('')
    try {
      const r = await api.post<{ queued: number }>('/app-install/jobs/archive-all', { station_id: station.id })
      setNotice(r.queued ? `В очереди на скачивание в архив: ${r.queued}` : 'Всё уже в архиве или в очереди')
      await loadJobs()
    } catch (e) {
      setError(errorText(e, 'Не удалось поставить в очередь'))
    }
  }

  const clearHistory = async () => {
    if (!confirm('Стереть завершённые задачи? Текущие останутся.')) return
    try {
      await api.del('/app-install/jobs')
      await loadJobs()
    } catch (e) {
      setError(errorText(e, 'Не удалось очистить историю'))
    }
  }

  const regenerate = async () => {
    if (!station || !confirm(`Выдать станции «${station.name}» новый код? Старый перестанет работать.`)) return
    try {
      const r = await api.post<{ token: string }>(`/app-install/stations/${station.id}/token`)
      setReissue({ stationId: station.id, name: station.name, token: r.token })
    } catch (e) {
      setError(errorText(e, 'Не удалось выдать код'))
    }
  }

  const removeStation = async () => {
    if (!station || !confirm(`Удалить станцию «${station.name}»?`)) return
    try {
      await api.del(`/app-install/stations/${station.id}`)
      await refresh()
    } catch (e) {
      setError(errorText(e, 'Не удалось удалить станцию'))
    }
  }

  const openJobs = jobs.filter((j) => OPEN.includes(j.state))
  const busyApp = (appId: number) => openJobs.some((j) => j.kind === 'install' && j.app?.id === appId)
  const archiving = (appId: number) => openJobs.some((j) => j.kind === 'archive' && j.app?.id === appId)
  const notArchived = apps.filter((a) => !a.ipa_size).length

  if (stations === null) {
    return (
      <div className="mx-auto grid max-w-5xl gap-4 p-4">
        <h1 className="text-xl font-semibold">Установка приложений</h1>
        {error ? <p role="alert" className="text-danger">{error}</p> : <Skeleton rows={4} />}
      </div>
    )
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Установка приложений</h1>
        {manage && <button className={`${button} ml-auto`} onClick={() => setModal('station')}>Подключить компьютер</button>}
      </header>

      {stations.length === 0 ? (
        <section className="grid gap-4 rounded-xl border border-dashed border-line p-6">
          <div className="grid gap-1">
            <p className="font-medium">Подключите компьютер, к которому будете подключать айфоны</p>
            <p className="text-sm text-muted">
              Откройте CRM на том компьютере (Windows или Mac) и нажмите кнопку ниже — мастер проведёт по шагам:
              скачать помощника, вставить код, подключить телефон. Это делается один раз.
            </p>
          </div>
          <ol className="grid list-decimal gap-1 pl-5 text-sm text-muted">
            <li>Назвать компьютер, например «Панфа — приёмка».</li>
            <li>Скачать помощника прямо отсюда и запустить.</li>
            <li>Вставить в него код подключения из CRM.</li>
            <li>Подключить айфон кабелем и нажать на нём «Доверять».</li>
          </ol>
          {manage
            ? <button className="justify-self-start rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink" onClick={() => setModal('station')}>Подключить компьютер</button>
            : <p className="text-sm text-warning">Подключать компьютеры может руководитель или сотрудник с правом «Может добавлять станции».</p>}
        </section>
      ) : (
        <>
          {stations.length > 1 && (
            <nav className="flex flex-wrap gap-2" aria-label="Станции">
              {stations.map((s) => (
                <button key={s.id} onClick={() => setStationId(s.id)} aria-pressed={s.id === stationId}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${s.id === stationId ? 'border-accent text-accent' : 'border-line'}`}>
                  <span className={`h-2 w-2 rounded-full ${s.online ? 'bg-success' : 'bg-line'}`} aria-hidden />
                  {s.name}
                </button>
              ))}
            </nav>
          )}

          {station && (
            <section className="grid gap-4 rounded-xl border border-line bg-surface p-4" aria-label={`Станция ${station.name}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${station.online ? 'bg-success' : 'bg-line'}`} aria-hidden />
                  <span className="font-medium">{station.name}</span>
                  <span className="text-sm text-muted">
                    {station.online
                      ? `на связи${station.os ? ` · ${station.os === 'windows' ? 'Windows' : station.os === 'macos' ? 'Mac' : station.os}` : ''}`
                      : station.last_seen_at ? `не на связи с ${formatDateTime(station.last_seen_at)}` : 'помощник ещё не подключался'}
                  </span>
                  {station.online && station.apple_route && (
                    <span className={`text-sm ${/не поднят/.test(station.apple_route) ? 'text-warning' : 'text-muted'}`}>
                      · к Apple: {station.apple_route}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm sm:ml-auto">
                  {station.apple_auth === 'ok' && station.apple_id
                    ? <span className="text-muted">Apple ID: {station.apple_id}</span>
                    : <span className="text-warning">Нужен вход в Apple ID</span>}
                  {manage && station.online && (
                    <button className={button} onClick={() => setModal('login')}>
                      {station.apple_auth === 'ok' ? 'Сменить Apple ID' : 'Войти'}
                    </button>
                  )}
                  {manage && <button className={button} onClick={() => void regenerate()}>Переподключить</button>}
                  {manage && <button className={`${button} hover:border-danger hover:text-danger`} onClick={() => void removeStation()}>Удалить</button>}
                </div>
              </div>

              {!station.online ? (
                <p className="text-sm text-muted">Включите компьютер станции. Помощник запускается сам и через несколько секунд выйдет на связь.</p>
              ) : station.devices.length === 0 ? (
                <p className="text-sm text-muted">Подключите айфон кабелем к компьютеру станции и разблокируйте его.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Подключённые телефоны">
                  {station.devices.map((d) => (
                    <li key={d.udid} className={`grid gap-2 rounded-lg border p-3 ${d.udid === targetUdid ? 'border-accent' : 'border-line'}`}>
                      <div className="flex items-baseline gap-2">
                        <span className="font-medium">{deviceTitle(d)}</span>
                        <span className="text-xs text-muted">{[d.product_type, d.ios_version && `iOS ${d.ios_version}`].filter(Boolean).join(' · ')}</span>
                      </div>
                      {d.problem
                        ? <p className="text-sm text-warning">{d.problem}</p>
                        : (
                          <div className="flex flex-wrap gap-2">
                            <button className={button} onClick={() => void startJob({ kind: 'scan', target_udid: d.udid },
                              `Читаю приложения с «${deviceTitle(d)}»`)}>
                              Это донор: прочитать приложения
                            </button>
                            <button className={d.udid === targetUdid ? primary : button} aria-pressed={d.udid === targetUdid}
                              onClick={() => setTargetUdid(d.udid)}>
                              {d.udid === targetUdid ? 'Ставим сюда' : 'Ставить сюда'}
                            </button>
                          </div>
                        )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(notice || error) && (
            <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-danger' : 'text-muted'}`}>{error || notice}</p>
          )}

          <section className="grid gap-3" aria-labelledby="library-title">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="library-title" className="font-semibold">Приложения</h2>
              <input type="search" className={`${inputClass} max-w-xs sm:ml-auto`} placeholder="Поиск по названию"
                aria-label="Поиск приложения" value={query} onChange={(e) => setQuery(e.target.value)} />
              <button className={button} disabled={!station?.online}
                onClick={() => void startJob({ kind: 'purchases' }, 'Загружаю покупки Apple ID')}>
                Покупки Apple ID
              </button>
              {notArchived > 0 && (
                <button className={button} disabled={!station?.online} onClick={() => void archiveAll()}
                  title="Станция скачает у Apple всё, чего ещё нет в архиве, и положит в CRM">
                  Скачать всё в архив ({notArchived})
                </button>
              )}
              {manage && (
                <label className={`${button} relative cursor-pointer`}>
                  {uploading ? 'Загружаю…' : 'Загрузить IPA'}
                  <input type="file" accept=".ipa" className="sr-only" disabled={uploading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadIpa(f) }} />
                </label>
              )}
            </div>
            {apps.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
                {query ? 'Ничего не нашлось.' : 'Библиотека пуста. Подключите телефон-донор и нажмите «Это донор: прочитать приложения» или загрузите покупки Apple ID.'}
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {apps.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.name}</div>
                      <div className="truncate text-xs text-muted">{a.bundle_id}{a.version ? ` · ${a.version}` : ''}</div>
                      {a.ipa_size ? (
                        <div className="truncate text-xs text-success" title="Файл хранится на сервере CRM: ставится без Apple и без донора">
                          В архиве CRM · {a.ipa_version ?? ''} · {Math.max(1, Math.round(a.ipa_size / 1_048_576))} МБ
                          {a.ipa_apple_id ? ` · ${a.ipa_apple_id}` : ''}
                        </div>
                      ) : null}
                    </div>
                    {!a.ipa_size && (
                      <button className={button} disabled={!station?.online || archiving(a.id)}
                        title="Скачать у Apple заранее и хранить в CRM — установка потом без ожидания"
                        onClick={() => void startJob({ kind: 'archive', app_id: a.id }, `Кладу «${a.name}» в архив`)}>
                        {archiving(a.id) ? 'В архив…' : 'В архив'}
                      </button>
                    )}
                    <button className={primary} disabled={!targetUdid || busyApp(a.id)}
                      title={!targetUdid ? 'Сначала выберите телефон: «Ставить сюда»' : undefined}
                      onClick={() => void startJob({ kind: 'install', app_id: a.id, target_udid: targetUdid }, `Ставлю «${a.name}»`)}>
                      {busyApp(a.id) ? 'Ставится…' : 'Установить'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {apps.length > 0 && !targetUdid && station?.online && (
              <p className="text-sm text-muted">Чтобы установить, нажмите «Ставить сюда» у нужного телефона.</p>
            )}
          </section>

          <section className="grid gap-3" aria-labelledby="jobs-title">
            <div className="flex items-center gap-2">
              <h2 id="jobs-title" className="font-semibold">Последние задачи</h2>
              {jobs.some((j) => !OPEN.includes(j.state)) && (
                <button className={`${button} ml-auto`} onClick={() => void clearHistory()}>Очистить историю</button>
              )}
            </div>
            {jobs.length === 0
              ? <p className="text-sm text-muted">Здесь появится ход скана, входа и установки.</p>
              : <ul className="grid gap-2">{jobs.map((j) => <JobRow key={j.id} job={j} onChanged={() => void loadJobs()} />)}</ul>}
          </section>
        </>
      )}

      <AgentFilesPanel canUpload={manage} />

      {modal === 'station' && <StationWizard onClose={() => setModal(null)} onChanged={() => void refresh()} />}
      {modal === 'login' && station && <LoginModal station={station} onClose={() => setModal(null)} onQueued={() => void loadJobs()} />}
      {reissue && <StationWizard reissue={reissue} onClose={() => setReissue(null)} onChanged={() => void refresh()} />}
    </div>
  )
}
