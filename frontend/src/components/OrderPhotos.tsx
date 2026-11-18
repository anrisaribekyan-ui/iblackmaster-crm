import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import { isSignatureFile } from './OrderChecklistCard'

type OrderFileItem = {
  id: number
  created_at: string
  employee_id: number | null
  employee_name: string | null
  filename: string
  mimetype: string
  size: number
  is_image: boolean
  expires_at: string | null
}

const KEEP_OPTIONS = [['1h', '1 час'], ['12h', '12 часов'], ['10d', '10 дней'], ['30d', '30 дней'], ['never', 'Никогда']] as const
type Keep = (typeof KEEP_OPTIONS)[number][0]

const toDate = (v: string) => new Date(v.endsWith('Z') || v.includes('+') ? v : `${v}Z`)
/** «Удалится через 40 мин / 5 ч / 3 дн» — чтобы сотрудник видел, сколько файл ещё проживёт. */
function leftLabel(expires: string | null): string | null {
  if (!expires) return null
  const ms = toDate(expires).getTime() - Date.now()
  if (ms <= 0) return 'удаляется'
  const min = Math.ceil(ms / 60000)
  if (min < 60) return `${min} мин`
  if (min < 48 * 60) return `${Math.ceil(min / 60)} ч`
  return `${Math.ceil(min / 1440)} дн`
}

const stamp = (v: string) =>
  new Date(v.endsWith('Z') || v.includes('+') ? v : `${v}Z`).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Превью фото: грузим с токеном и показываем через object URL. */
function Thumb({ orderId, item, onOpen }: { orderId: number; item: OrderFileItem; onOpen: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!item.is_image) return
    let objectUrl = ''
    let cancelled = false
    api.blob(`/orders/${orderId}/files/${item.id}?thumb=1`).then((b) => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(b)
      setUrl(objectUrl)
    }).catch(() => undefined)
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [orderId, item.id, item.is_image])

  return (
    <button type="button" onClick={onOpen} title={`${item.filename} · ${stamp(item.created_at)}`}
      className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-canvas">
      {item.is_image ? (
        url ? <img src={url} alt={item.filename} className="h-full w-full object-cover" /> : <span className="text-xs text-muted">…</span>
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-1 p-1 text-xs text-muted">
          <span className="text-base font-semibold text-ink">{(item.filename.split('.').pop() ?? 'файл').slice(0, 5).toUpperCase()}</span>
          <span className="line-clamp-2 break-all">{item.filename}</span>
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-black/55 px-1 py-0.5 text-[10px] tabular-nums text-white">{stamp(item.created_at)}{leftLabel(item.expires_at) ? ` · ещё ${leftLabel(item.expires_at)}` : ''}</span>
    </button>
  )
}

/** Фото устройства при приёме (ТЗ этап 3, C9): снимок с камеры телефона, дата и кто снял. */
export default function OrderPhotos({ orderId, disabled, onChanged }: { orderId: number; disabled: boolean; onChanged: () => void }) {
  const { me, can } = useAuth()
  const [items, setItems] = useState<OrderFileItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [viewing, setViewing] = useState<{ item: OrderFileItem; url: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const camera = useRef<HTMLInputElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [keep, setKeep] = useState<Keep>('1h')

  const load = useCallback(async () => {
    try {
      // Подписи клиента показываются в блоке «Проверка устройства», не среди фото
      setItems((await api.get<OrderFileItem[]>(`/orders/${orderId}/files`)).filter((f) => !isSignatureFile(f.filename)))
    } catch {
      /* без фото карточка заказа работает */
    }
  }, [orderId])
  useEffect(() => { void load() }, [load])

  const upload = async (files: FileList | null, keepValue?: Keep) => {
    if (!files || files.length === 0) return
    const form = new FormData()
    Array.from(files).forEach((f) => form.append('files', f))
    if (keepValue) form.append('keep', keepValue)
    setUploading(true)
    setError('')
    try {
      await api.upload(`/orders/${orderId}/files`, form)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить')
    } finally {
      setUploading(false)
      if (camera.current) camera.current.value = ''
      if (picker.current) picker.current.value = ''
    }
  }

  const open = async (item: OrderFileItem) => {
    try {
      const blob = await api.blob(`/orders/${orderId}/files/${item.id}`)
      const url = URL.createObjectURL(blob)
      if (item.is_image) setViewing({ item, url })
      else if (item.mimetype === 'application/pdf') window.open(url, '_blank')
      else {
        const link = document.createElement('a')
        link.href = url
        link.download = item.filename
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 10000)
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось открыть файл')
    }
  }

  const close = () => {
    if (viewing) URL.revokeObjectURL(viewing.url)
    setViewing(null)
    setConfirmDelete(false)
  }

  const remove = async (item: OrderFileItem) => {
    try {
      await api.del(`/orders/${orderId}/files/${item.id}`)
      close()
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось удалить')
    }
  }

  const canDelete = (item: OrderFileItem) => {
    const fresh = Date.now() - new Date(item.created_at.endsWith('Z') || item.created_at.includes('+') ? item.created_at : `${item.created_at}Z`).getTime() < 24 * 3600 * 1000
    return can('deleteStorageFileAccess') || (item.employee_id === me?.id && fresh)
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Фото и файлы</h2>
        <input ref={camera} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => void upload(e.target.files, 'never')} />
        <input ref={picker} type="file" multiple hidden onChange={(e) => void upload(e.target.files, keep)} />
        <button type="button" disabled={disabled || uploading} onClick={() => camera.current?.click()}
          className="rounded-md bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {uploading ? 'Загружаю…' : 'Сфотографировать'}
        </button>
        <button type="button" disabled={disabled || uploading} onClick={() => picker.current?.click()}
          className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50">
          Прикрепить файл
        </button>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          Хранить
          <select aria-label="Срок хранения файла" className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" value={keep} onChange={(e) => setKeep(e.target.value as Keep)}>
            {KEEP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </header>
      {error && <p role="alert" className="mb-2 text-sm text-danger">{error}</p>}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Снимите аппарат при приёме: сколы, трещины, вмятины. Фото с камеры хранятся всегда. К заказу можно прикрепить и любой файл: он удалится через выбранный срок (по умолчанию час).</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-6">
          {items.map((item) => <Thumb key={item.id} orderId={orderId} item={item} onOpen={() => void open(item)} />)}
        </div>
      )}
      {viewing && (
        <div role="dialog" aria-modal="true" aria-label={viewing.item.filename} className="fixed inset-0 z-50 flex flex-col bg-[#0b0c0e]" onClick={close}>
          <div className="flex items-center gap-3 px-4 py-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="mr-auto">{stamp(viewing.item.created_at)}{viewing.item.employee_name ? ` · ${viewing.item.employee_name}` : ''}</span>
            {canDelete(viewing.item) && (confirmDelete
              ? <button type="button" className="rounded bg-danger px-2 py-1 text-white" onClick={() => void remove(viewing.item)}>Точно удалить фото?</button>
              : <button type="button" className="rounded px-2 py-1 text-white/80 hover:bg-white/10" onClick={() => setConfirmDelete(true)}>Удалить</button>)}
            <a className="rounded px-2 py-1 text-white/80 hover:bg-white/10" href={viewing.url} download={viewing.item.filename}>Скачать</a>
            <button type="button" className="rounded px-2 py-1 text-lg leading-none hover:bg-white/10" onClick={close} aria-label="Закрыть">×</button>
          </div>
          <img src={viewing.url} alt={viewing.item.filename} className="min-h-0 flex-1 object-contain p-4" />
        </div>
      )}
    </section>
  )
}
