/* Service worker iBlackMaster CRM.
 * Задача — открываться как приложение и мгновенно показывать интерфейс.
 * Данные (/api) НИКОГДА не кэшируем: заказы, деньги и склад всегда свежие с сервера.
 */
const VERSION = 'v3'
const SHELL = `shell-${VERSION}`
const ASSETS = 'assets' // файлы сборки с хэшем в имени — неизменяемые, кэш между версиями общий

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // данные — только из сети
  // «Закупки» — отдельное приложение во встроенном окне: его страницы не наши, оболочку CRM подставлять нельзя
  if (url.pathname.startsWith('/zakupki-app')) return

  // Страницы: сразу показываем сохранённую оболочку (мгновенный старт), а свежую версию тянем в фоне —
  // на следующем заходе будет новая. Первого захода без кэша это не касается: он идёт из сети.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone()
              caches.open(SHELL).then((cache) => cache.put('/', copy))
            }
            return response
          })
          .catch(() => cached || Response.error())
        if (cached) {
          event.waitUntil(network)
          return cached
        }
        return network
      }),
    )
    return
  }

  // Файлы сборки (/assets/…-хэш.js|css), шрифты, иконки: из кэша, иначе из сети с сохранением
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(request).then(
          (cached) =>
            cached ||
            fetch(request).then((response) => {
              if (response.ok) cache.put(request, response.clone())
              return response
            }),
        ),
      ),
    )
  }
})
