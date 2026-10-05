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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-xl overflow-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
        role="dialog"
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <h2 id="modal-title" className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="text-xl text-muted hover:text-ink">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
