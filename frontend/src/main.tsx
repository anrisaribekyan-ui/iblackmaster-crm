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
  // Вышла новая версия CRM: приложение на телефоне может висеть открытым днями — предлагаем обновиться
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'shell-updated' || document.getElementById('update-banner')) return
    const bar = document.createElement('div')
    bar.id = 'update-banner'
    bar.setAttribute('role', 'status')
    bar.style.cssText = 'position:fixed;left:12px;right:12px;bottom:84px;z-index:9999;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 14px;border-radius:12px;background:#ff5a36;color:#fff;font:600 14px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)'
    const text = document.createElement('span')
    text.textContent = 'Вышла новая версия CRM'
    const btn = document.createElement('button')
    btn.textContent = 'Обновить'
    btn.style.cssText = 'padding:8px 14px;border:0;border-radius:8px;background:#fff;color:#111;font:600 14px system-ui,sans-serif'
    btn.onclick = () => location.reload()
    bar.append(text, btn)
    document.body.appendChild(bar)
  })
}
