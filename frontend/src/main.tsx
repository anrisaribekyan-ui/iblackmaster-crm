import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/onest'
import './index.css'
import App from './App.tsx'

import { reloadOnceForNewVersion } from './components/ErrorBoundary'
import { watchSystem } from './theme'
watchSystem()

// Vite сообщает, что кусок приложения не загрузился (после обновления CRM): один раз перезагружаем страницу
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  reloadOnceForNewVersion()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Установка как приложение: service worker работает только в собранной версии и по HTTPS (или localhost)
if (import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  })
}
