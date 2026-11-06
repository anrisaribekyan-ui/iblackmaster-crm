import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../auth'
import StatusBadge, { type SmsMark } from './StatusBadge'

export type QuickStatusItem = {
  id: number
  name: string
  color: string
  comment_mode?: string
  role_access?: Record<string, { view?: boolean; set?: boolean; change?: boolean }>
}
export type QuickStatusGroup = { group: string; title: string; statuses: QuickStatusItem[] }

type Props = {
  status: { id: number; group: string; name: string; color: string | null | undefined; sms?: SmsMark }
  groups: QuickStatusGroup[]
  disabled?: boolean
  onPick: (next: QuickStatusItem, comment: string | null) => void
}

/**
 * Бейдж статуса в списке заказов: тап открывает быстрый выбор статуса (внизу на телефоне, рядом на компьютере).
 * Меняет статус тем же запросом, что и карточка заказа, — SMS, зарплата и склад срабатывают на сервере так же.
 * «Выдан» отсюда не ставится: выдача требует оплаты и идёт через карточку заказа.
 */
export default function QuickStatus({ status, groups, disabled, onPick }: Props) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)

  const all = groups.flatMap((g) => g.statuses.map((s) => ({ ...s, group: g.group })))
  const current = all.find((s) => s.id === status.id)
  const allowed = (item: QuickStatusItem | undefined, right: 'set' | 'change') => {
    if (!me) return false
    if (me.is_owner) return true
    const access = item?.role_access?.[String(me.role_id)]
    return access?.[right] !== false // права роли не заданы — разрешено всем
  }
  const options = groups.filter((g) => g.group !== 'closed').flatMap((g) => g.statuses).filter((s) => allowed(s, 'set'))
  const canChange = status.group !== 'closed' && allowed(current, 'change') && options.length > 0

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!canChange) return <StatusBadge big group={status.group} name={status.name} color={status.color} sms={status.sms} />

  const toggle = (event: MouseEvent) => {
    event.preventDefault() // внутри ссылки на заказ: не открываем карточку
    event.stopPropagation()
    if (disabled) return
    const rect = button.current?.getBoundingClientRect()
    if (rect) {
      const width = 260
      const height = Math.min(options.length * 44 + 16, 360)
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
      const top = rect.bottom + height + 8 > window.innerHeight ? Math.max(8, rect.top - height - 4) : rect.bottom + 4
      setPos({ top, left })
    }
    setOpen((value) => !value)
  }

  const pick = (event: MouseEvent, next: QuickStatusItem) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    if (next.id === status.id) return
    let comment: string | null = ''
    if (next.comment_mode && next.comment_mode !== 'none') {
      comment = prompt(next.comment_mode === 'required' ? 'Укажите обязательный комментарий' : 'Комментарий к смене статуса (необязательно)')
      if (comment === null || (next.comment_mode === 'required' && !comment.trim())) return
    }
    onPick(next, comment || null)
  }

  return (
    <>
      <button ref={button} type="button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open} aria-label={`Статус: ${status.name}. Изменить`}
        className="-mx-1 -my-3.5 inline-flex max-w-full items-center rounded-full px-1 py-3.5 disabled:opacity-60" disabled={disabled}>
        <StatusBadge big chevron group={status.group} name={status.name} color={status.color} sms={status.sms} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40 bg-black/30 md:bg-transparent" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(false) }} aria-hidden />
          <ul role="listbox" aria-label="Выберите статус"
            style={pos && window.matchMedia('(min-width: 768px)').matches ? { top: pos.top, left: pos.left, width: 260 } : undefined}
            className="quick-menu fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border border-line bg-surface p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-xl md:inset-x-auto md:bottom-auto md:max-h-[360px] md:rounded-xl">
            {options.map((item) => (
              <li key={item.id}>
                <button type="button" role="option" aria-selected={item.id === status.id} onClick={(event) => pick(event, item)}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-canvas ${item.id === status.id ? 'bg-accent-soft font-medium' : ''}`}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} aria-hidden />
                  <span className="min-w-0 flex-1 break-words">{item.name}</span>
                  {item.id === status.id && <span aria-hidden>✓</span>}
                </button>
              </li>
            ))}
          </ul>
        </>,
        document.body, // в стеклянной теме у предков есть blur: fixed-меню внутри них обрезалось и съезжало
      )}
    </>
  )
}
