import { useEffect, useState } from 'react'
import Icon from './icons'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

/** Кнопка «Установить приложение»: появляется, только когда Chrome готов установить CRM (HTTPS, не установлено). */
export default function InstallApp() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault() // свой баннер Chrome не показываем — есть кнопка в меню
      setPromptEvent(event as InstallPromptEvent)
    }
    const onInstalled = () => setPromptEvent(null)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!promptEvent) return null
  return (
    <button
      type="button"
      onClick={async () => {
        await promptEvent.prompt()
        await promptEvent.userChoice
        setPromptEvent(null)
      }}
      className="mx-3 mb-1 flex items-center gap-3 rounded-lg border border-white/10 px-3 py-2.5 text-left text-sm text-white hover:bg-rail-hover"
    >
      <Icon name="download" className="h-[18px] w-[18px] text-accent" />
      Установить приложение
    </button>
  )
}
