import { useEffect, type ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="flex h-dvh w-full flex-col bg-surface sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:border sm:border-line sm:shadow-xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line py-2 pl-5 pr-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] sm:py-3 sm:pt-3">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="grid h-10 w-10 place-items-center rounded-md text-2xl leading-none text-muted hover:bg-canvas hover:text-ink">
            ×
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">{children}</div>
      </section>
    </div>
  )
}
