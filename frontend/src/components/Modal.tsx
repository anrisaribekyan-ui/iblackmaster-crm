import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useDialogFocus } from './ui'

export default function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean // широкое окно — карточки с таблицами (товар, история)
}) {
  const panel = useRef<HTMLElement>(null)
  const titleId = useId()
  useDialogFocus(panel)
  // Пока окно открыто, страница под ним не прокручивается (на телефоне прокручивается весь документ),
  // а Esc закрывает окно
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={panel}
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal-panel flex h-dvh outline-none w-full flex-col bg-surface sm:h-auto sm:max-h-[90vh] ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} sm:rounded-2xl sm:border sm:border-line sm:shadow-[var(--shadow-pop)]`}
        role="dialog"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft py-2 pl-5 pr-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:py-3 sm:pt-3">
          <h2 id={titleId} className="text-lg font-bold leading-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-muted hover:bg-canvas hover:text-ink">
            ×
          </button>
        </header>
        <div className="flex-1 overflow-auto overscroll-contain p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">{children}</div>
      </section>
    </div>
  )
}
