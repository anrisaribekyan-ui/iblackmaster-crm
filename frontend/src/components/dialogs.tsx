/**
 * Окна подтверждения и ввода в стиле CRM — вместо системных confirm / prompt / alert браузера.
 * Вызываются как функции и возвращают Promise: `if (!(await confirmDialog('Удалить?'))) return`.
 * Enter — подтвердить, Esc и клик мимо окна — отмена. Фокус возвращается туда, где был.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { btn, field } from './ui'

type Request =
  | { kind: 'confirm'; text: string; ok?: string; danger?: boolean; resolve: (value: boolean) => void }
  | { kind: 'prompt'; text: string; initial: string; required: boolean; resolve: (value: string | null) => void }
  | { kind: 'alert'; text: string; resolve: () => void }

let root: Root | null = null
let push: ((request: Request) => void) | null = null
const waiting: Request[] = []

function ensureHost() {
  if (root) return
  const node = document.createElement('div')
  document.body.appendChild(node)
  root = createRoot(node)
  root.render(<Host />)
}

function open(request: Request) {
  ensureHost()
  if (push) push(request)
  else waiting.push(request)
}

/** «Удалить…», «Стереть…», «Отключить…» — опасное действие: кнопка красная и называется по делу. */
function dangerLabel(text: string): string | null {
  const word = /^(Удалить|Стереть|Отключить|Архивировать)/.exec(text.trim())?.[1]
  return word ?? null
}

export function confirmDialog(text: string, options: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const word = dangerLabel(text)
    open({ kind: 'confirm', text, ok: options.ok ?? word ?? 'Да', danger: options.danger ?? (word !== null && word !== 'Архивировать'), resolve })
  })
}

/** Ввод строки. Отмена — null (как у системного prompt). */
export function promptDialog(text: string, initial = '', options: { required?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => open({ kind: 'prompt', text, initial, required: options.required ?? false, resolve }))
}

export function alertDialog(text: string): Promise<void> {
  return new Promise((resolve) => open({ kind: 'alert', text, resolve }))
}

function Host() {
  const [queue, setQueue] = useState<Request[]>([])
  useEffect(() => {
    push = (request) => setQueue((current) => [...current, request])
    if (waiting.length) setQueue((current) => [...current, ...waiting.splice(0)])
    return () => { push = null }
  }, [])
  const current = queue[0]
  if (!current) return null
  return <Dialog key={queue.length} request={current} onDone={() => setQueue((q) => q.slice(1))} />
}

function Dialog({ request, onDone }: { request: Request; onDone: () => void }) {
  const [value, setValue] = useState(request.kind === 'prompt' ? request.initial : '')
  const okRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const finish = (accepted: boolean) => {
    if (request.kind === 'confirm') request.resolve(accepted)
    else if (request.kind === 'prompt') request.resolve(accepted ? value : null)
    else request.resolve()
    onDone()
  }

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    ;(inputRef.current ?? okRef.current)?.focus()
    inputRef.current?.select()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(false) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      before?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blocked = request.kind === 'prompt' && request.required && !value.trim()
  const okClass = request.kind === 'confirm' && request.danger
    ? 'inline-flex h-10 items-center justify-center rounded-md bg-danger px-4 text-sm font-semibold text-white disabled:opacity-50 sm:h-9'
    : btn('primary', 'md', 'h-10 px-4 sm:h-9')

  return (
    <div
      className="modal-backdrop fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) finish(false) }}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ui-dialog-text"
        className="modal-panel quick-menu w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-pop)]"
        onSubmit={(event) => { event.preventDefault(); if (!blocked) finish(true) }}
      >
        <p id="ui-dialog-text" className="whitespace-pre-line text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">{request.text}</p>
        {request.kind === 'prompt' && (
          <input ref={inputRef} className={`${field} mt-3 h-10 w-full`} value={value} onChange={(event) => setValue(event.target.value)} aria-labelledby="ui-dialog-text" />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {request.kind !== 'alert' && <button type="button" className={btn('secondary', 'md', 'h-10 px-4 sm:h-9')} onClick={() => finish(false)}>Отмена</button>}
          <button ref={okRef} type="submit" disabled={blocked} className={okClass}>{request.kind === 'confirm' ? request.ok : request.kind === 'prompt' ? 'Готово' : 'Понятно'}</button>
        </div>
      </form>
    </div>
  )
}
