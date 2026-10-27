import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import SupplierOrders, { useSupplierConfig } from '../components/SupplierOrders'

/**
 * Закупки — общая доска «Что купить → Купил → Отдал» (тот же сервис, что в APK «Доска»).
 * Доска живёт отдельным сервисом; Caddy проксирует её по пути /zakupki-app/ (см. Caddyfile, DOSKA_UPSTREAM),
 * поэтому она открывается по HTTPS с того же адреса, что и CRM.
 * Автор карточек — вошедший сотрудник (параметр name), тема — как в CRM (параметр theme + postMessage при смене).
 */
const APP = '/zakupki-app/'

function currentTheme(): string {
  return document.documentElement.dataset.theme || 'light'
}

export default function PurchasesPage() {
  const { me } = useAuth()
  const frameRef = useRef<HTMLIFrameElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(600)
  const [failed, setFailed] = useState(false)
  const supplierConfig = useSupplierConfig()
  const [tab, setTab] = useState<'board' | 'order'>('board')
  const canOrder = Boolean(supplierConfig?.enabled)
  // Адрес фиксируем при открытии: смена темы идёт сообщением, без перезагрузки доски
  const [src] = useState(() => {
    const q = new URLSearchParams({ embed: '1', theme: currentTheme(), name: me?.short_name ?? '' })
    return `${APP}?${q.toString()}`
  })

  // Доска занимает всё место до низа экрана (на телефоне — до нижней панели), окна внутри неё открываются по центру
  useEffect(() => {
    const fit = () => {
      const top = boxRef.current?.getBoundingClientRect().top ?? 0
      const mobile = window.matchMedia('(max-width: 767px)').matches
      const bottom = mobile ? 80 : 24
      setHeight(Math.max(420, Math.round(window.innerHeight - Math.max(top, 0) - bottom)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Тема CRM поменялась — сообщаем доске
  useEffect(() => {
    const observer = new MutationObserver(() => {
      frameRef.current?.contentWindow?.postMessage({ type: 'doska-theme', theme: currentTheme() }, window.location.origin)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  // Проверяем, что сервис доски отвечает, чтобы вместо пустой рамки показать понятный текст
  useEffect(() => {
    let alive = true
    fetch(`${APP}api/health`, { cache: 'no-store' })
      .then((r) => { if (alive && !r.ok) setFailed(true) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Закупки</h1>
        {canOrder && (
          <div className="flex rounded-full border border-line bg-surface p-0.5 text-sm" role="tablist" aria-label="Режим закупок">
            {([['board', 'Доска'], ['order', 'Оформить']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`rounded-full px-4 py-1.5 ${tab === id ? 'bg-accent font-medium text-accent-ink' : 'text-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        <a href={APP} target="_blank" rel="noreferrer" className="ml-auto rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-ink">
          Открыть отдельно
        </a>
      </div>
      {tab === 'order' && supplierConfig?.enabled && <SupplierOrders config={supplierConfig} />}
      {tab !== 'board' ? null : failed ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">
          Доска закупок сейчас недоступна. Проверьте, что сервис доски запущен, и обновите страницу.
        </p>
      ) : (
        // Доска остаётся загруженной и при открытой вкладке «Оформить» — переключение мгновенное
        <div ref={boxRef} hidden={tab !== 'board'}>
          <iframe
            ref={frameRef}
            src={src}
            title="Доска закупок"
            className="block w-full rounded-xl"
            style={{ height, border: 0, background: 'transparent' }}
            allow="camera"
          />
        </div>
      )}
    </section>
  )
}
