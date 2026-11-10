import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { arrowNav } from './ui'

/**
 * Выпадающее меню в шапке: рисуется поверх всей страницы (через body), с непрозрачным фоном и
 * высоким z-index, поэтому его не перекрывают карточки ниже и не обрезает шапка.
 */
export default function HeaderMenu({ label, width = 256, children }: { label: string; width?: number; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    // Фокус уходит в меню (оно нарисовано в конце страницы), Esc возвращает его на кнопку
    menu.current?.querySelector<HTMLElement>('a, button')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') { setOpen(false); button.current?.focus() }
      else arrowNav(event, menu.current, 'a, button')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const toggle = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) {
      const w = Math.min(width, window.innerWidth - 16)
      setPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - w, window.innerWidth - w - 8)) })
    }
    setOpen((value) => !value)
  }

  return (
    <>
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} className="cursor-pointer whitespace-nowrap rounded-lg px-3 py-1.5 text-sm max-md:min-h-11 text-white/80 transition-colors hover:bg-white/10 hover:text-white" onClick={toggle}>{label}</button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} aria-hidden />
          <div ref={menu} role="menu" aria-label={label} className="quick-menu bg-surface fixed z-[1001] flex flex-col rounded-lg border border-line p-1 text-ink shadow-[var(--shadow-pop)]" style={{ top: pos.top, left: pos.left, width: Math.min(width, window.innerWidth - 16), maxHeight: window.innerHeight - pos.top - 8, overflowY: 'auto' }}>
            {children(() => setOpen(false))}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
