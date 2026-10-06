import type { ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
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
        className="flex h-full w-full flex-col bg-surface sm:h-auto sm:max-h-[90vh] sm:max-w-lg sm:rounded-xl sm:border sm:border-line sm:shadow-xl"
        role="dialog"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="text-xl text-muted hover:text-ink">
            ×
          </button>
        </header>
        <div className="flex-1 overflow-auto p-5">{children}</div>
      </section>
    </div>
  )
}
