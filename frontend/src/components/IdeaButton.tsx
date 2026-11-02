import { useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import Icon from './icons'
import Modal from './Modal'

/** Плавающая кнопка «Идея для Анри»: любой сотрудник пишет, что неудобно или чего не хватает — владелец разбирает на странице «Идеи». */
export default function IdeaButton() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const close = () => {
    setOpen(false)
    setError('')
    setSent(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      await api.post('/ideas', { text, page: location.pathname })
      setText('')
      setSent(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не получилось отправить. Попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Что неудобно или чего не хватает? Напишите — Анри увидит"
        aria-label="Идея для Анри"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] right-3 z-30 flex items-center gap-2 rounded-full bg-ink p-3 md:px-4 md:py-2.5 text-sm font-medium text-white shadow-lg hover:opacity-90 md:bottom-5 md:right-5"
      >
        <Icon name="idea" className="h-[18px] w-[18px]" />
        <span className="hidden md:inline">Идея для Анри</span>
      </button>
      {open && (
        <Modal title="Идея для Анри" onClose={close}>
          {sent ? (
            <div className="grid gap-4">
              <p>Спасибо, идея отправлена. Анри её увидит и разберёт.</p>
              <div className="flex gap-2">
                <button className="rounded-md bg-accent px-4 py-2 font-medium text-white" onClick={() => setSent(false)}>Написать ещё</button>
                <button className="rounded-md border border-line px-4 py-2" onClick={close}>Закрыть</button>
              </div>
            </div>
          ) : (
            <form onSubmit={(event) => void submit(event)} className="grid gap-3">
              <p className="text-sm text-muted">Что неудобно, чего не хватает, что можно улучшить — пишите всё, что пришло в голову. Страница, на которой вы сейчас, запомнится сама.</p>
              <textarea
                autoFocus
                rows={6}
                maxLength={5000}
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="w-full rounded-md border border-line bg-surface p-3"
                placeholder="Например: в заказе не хватает кнопки…"
                aria-label="Текст идеи"
              />
              {error && <p className="text-danger" role="alert">{error}</p>}
              <button type="submit" disabled={busy || !text.trim()} className="rounded-md bg-accent px-4 py-2.5 font-medium text-white disabled:opacity-50">
                {busy ? 'Отправляю…' : 'Отправить'}
              </button>
            </form>
          )}
        </Modal>
      )}
    </>
  )
}
