import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from '../components/Modal'
import OtpInput from '../components/OtpInput'
import Skeleton from '../components/Skeleton'
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
}
type IosApp = { id: number; adam_id: number; bundle_id: string; name: string; version: string | null; version_id: number | null; source: string }
type Job = {
  id: number
  station_id: number
  station_name: string
  kind: 'scan' | 'purchases' | 'login' | 'install'
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
    default:
      return `${job.app?.name ?? 'Приложение'} → ${job.target_name ?? 'телефон'}`
  }
}

/** Код подключения для установщика: адрес CRM и токен станции в одной строке. */
function connectionCode(token: string) {
  // Адрес и токен — только латиница, поэтому btoa без перекодировки
  return btoa(JSON.stringify({ url: window.location.origin, token }))
}

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError ? e.message : fallback
}

// ------------------------------------------------------------------ станция: добавление

function NewStationModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.post<{ token: string }>('/app-install/stations', { name })
      setCode(connectionCode(r.token))
      onCreated()
    } catch (e) {
      setError(errorText(e, 'Не удалось добавить станцию'))
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

  return (
    <Modal title="Новая станция" onClose={onClose}>
      {!code ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted">Станция — компьютер в точке, к которому по USB подключают айфоны. Назовите его так, чтобы мастера понимали, где он стоит.</p>
          <div className="grid gap-1">
            <label htmlFor="station-name" className="text-sm">Название</label>
            <input id="station-name" className={inputClass} value={name} autoFocus
              placeholder="Например, «Панфа — компьютер приёмки»" onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void create() }} />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <button className={primary} disabled={!name.trim() || busy} onClick={() => void create()}>
              {busy ? 'Добавляю…' : 'Добавить'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <ol className="grid list-decimal gap-2 pl-5 text-sm">
            <li>На компьютере станции скачайте и запустите <b>установщик помощника</b> (Windows или Mac).</li>
            <li>Когда установщик попросит <b>код подключения</b>, вставьте этот:</li>
          </ol>
          <div className="rounded-lg border border-line bg-canvas p-3">
            <code className="block break-all text-xs">{code}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={primary} onClick={() => void copy()}>{copied ? 'Скопировано' : 'Скопировать код'}</button>
            <span className="text-xs text-muted">Код показывается один раз. Потеряли — нажмите у станции «Новый код».</span>
          </div>
          <p className="text-sm text-muted">Через несколько секунд после запуска помощника станция загорится зелёным.</p>
        </div>
      )}
    </Modal>
  )
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
    <li className="grid gap-2 rounded-xl border border-line bg-surface p-3">
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
      {job.message && <p className={`text-sm ${job.state === 'failed' ? 'text-danger' : 'text-muted'}`}>{job.message}</p>}
      {waitingCode && (
        <div className="grid max-w-xs gap-1">
          <label htmlFor={`code-${job.id}`} className="text-sm">Код из Apple на вашем iPhone</label>
          <OtpInput id={`code-${job.id}`} value={code} onChange={setCode} error={!!error} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap gap-2 empty:hidden">
        {(job.state === 'queued' || job.state === 'need_code') && (
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
  const [newCode, setNewCode] = useState('')

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

  const regenerate = async () => {
    if (!station || !confirm(`Выдать станции «${station.name}» новый код? Старый перестанет работать.`)) return
    try {
      const r = await api.post<{ token: string }>(`/app-install/stations/${station.id}/token`)
      setNewCode(connectionCode(r.token))
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
        {manage && <button className={`${button} ml-auto`} onClick={() => setModal('station')}>Добавить станцию</button>}
      </header>

      {stations.length === 0 ? (
        <section className="grid gap-2 rounded-xl border border-dashed border-line p-6 text-center">
          <p className="font-medium">Станций пока нет</p>
          <p className="text-sm text-muted">
            Станция — компьютер в точке с помощником, к которому по USB подключают айфоны.
            {manage ? ' Нажмите «Добавить станцию» и следуйте подсказкам.' : ' Попросите руководителя добавить станцию.'}
          </p>
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
                  {manage && <button className={button} onClick={() => void regenerate()}>Новый код</button>}
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
                    </div>
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
            <h2 id="jobs-title" className="font-semibold">Последние задачи</h2>
            {jobs.length === 0
              ? <p className="text-sm text-muted">Здесь появится ход скана, входа и установки.</p>
              : <ul className="grid gap-2">{jobs.map((j) => <JobRow key={j.id} job={j} onChanged={() => void loadJobs()} />)}</ul>}
          </section>
        </>
      )}

      {modal === 'station' && <NewStationModal onClose={() => setModal(null)} onCreated={() => void refresh()} />}
      {modal === 'login' && station && <LoginModal station={station} onClose={() => setModal(null)} onQueued={() => void loadJobs()} />}
      {newCode && (
        <Modal title="Новый код подключения" onClose={() => setNewCode('')}>
          <div className="grid gap-3">
            <p className="text-sm">Откройте помощника на компьютере станции и вставьте этот код вместо старого:</p>
            <div className="rounded-lg border border-line bg-canvas p-3"><code className="block break-all text-xs">{newCode}</code></div>
            <button className={primary} onClick={() => void navigator.clipboard.writeText(newCode).catch(() => undefined)}>Скопировать код</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
