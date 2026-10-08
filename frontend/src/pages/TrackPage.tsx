import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

type Track = {
  number: string
  device: string
  status: string
  stage: 'new' | 'inWork' | 'wait' | 'finish' | 'closed'
  stage_title: string
  created_at: string
  total: string
  debt: string
  approximate_price: string | null
  location: { name: string | null; address: string | null; phones: string | null; work_hours: string | null }
}

const steps: { stage: Track['stage'][]; title: string }[] = [
  { stage: ['new'], title: 'Принят' },
  { stage: ['inWork', 'wait'], title: 'Ремонт' },
  { stage: ['finish'], title: 'Готов' },
  { stage: ['closed'], title: 'Выдан' },
]

const rub = (v: string | number) => `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`

/** Публичная страница «Статус ремонта» — открывается по QR с квитанции, без входа. */
export default function TrackPage() {
  const { code } = useParams()
  const [data, setData] = useState<Track | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'missing' | 'error'>('loading')

  useEffect(() => {
    document.title = 'Статус ремонта — iBlackMaster'
    let cancelled = false
    const load = () =>
      fetch(`/api/track/${encodeURIComponent(code ?? '')}`)
        .then(async (r) => {
          if (cancelled) return
          if (r.status === 404) return setState('missing')
          if (!r.ok) return setState('error')
          setData(await r.json())
          setState('ok')
        })
        .catch(() => !cancelled && setState('error'))
    void load()
    const timer = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [code])

  const current = data ? steps.findIndex((s) => s.stage.includes(data.stage)) : -1
  const phone = data?.location.phones?.split(',')[0]?.trim()
  const ready = data?.stage === 'finish'

  return (
    <main className="min-h-dvh bg-canvas px-4 py-6">
      <div className="mx-auto max-w-md">
        <p className="mb-4 text-center text-lg font-bold tracking-tight">
          iBlack<span className="text-accent">Master</span>
        </p>
        {state === 'loading' && <p className="text-center text-muted">Загрузка…</p>}
        {state === 'missing' && (
          <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
            <p className="text-lg font-semibold">Заказ не найден</p>
            <p className="mt-2 text-sm text-muted">Проверьте ссылку или отсканируйте QR-код с квитанции ещё раз.</p>
          </div>
        )}
        {state === 'error' && (
          <div className="rounded-2xl bg-surface p-6 text-center shadow-sm">
            <p className="font-semibold">Не удалось загрузить</p>
            <p className="mt-2 text-sm text-muted">Попробуйте обновить страницу через минуту.</p>
          </div>
        )}
        {state === 'ok' && data && (
          <div className="space-y-3">
            <div className="rounded-2xl bg-surface p-5 shadow-sm">
              <p className="text-sm text-muted">Заказ {data.number}</p>
              <p className="mt-0.5 text-lg font-semibold">{data.device}</p>
              <p className={`mt-4 text-2xl font-bold ${ready ? 'text-success' : ''}`}>{data.stage_title}</p>
              {data.stage === 'wait' && <p className="mt-1 text-sm text-muted">{data.status}</p>}

              <ol className="mt-5 grid grid-cols-4 gap-1" aria-label="Этапы ремонта">
                {steps.map((s, i) => (
                  <li key={s.title} className="text-center">
                    <div className={`h-1.5 rounded-full ${i <= current ? (ready && i === current ? 'bg-success' : 'bg-accent') : 'bg-line'}`} />
                    <span className={`mt-1.5 block text-xs ${i === current ? 'font-semibold text-ink' : 'text-muted'}`}>{s.title}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl bg-surface p-5 shadow-sm">
              {Number(data.total) > 0 ? (
                <div className="flex items-baseline justify-between">
                  <span className="text-muted">{data.stage === 'closed' ? 'Сумма' : 'К оплате'}</span>
                  <span className="text-xl font-semibold tabular-nums">{rub(data.stage === 'closed' ? data.total : data.debt)}</span>
                </div>
              ) : data.approximate_price ? (
                <div className="flex items-baseline justify-between">
                  <span className="text-muted">Ориентировочно</span>
                  <span className="text-lg font-semibold">{data.approximate_price}</span>
                </div>
              ) : (
                <p className="text-sm text-muted">Стоимость мастер сообщит после диагностики.</p>
              )}
            </div>

            <div className="rounded-2xl bg-surface p-5 shadow-sm">
              <p className="font-semibold">{data.location.name}</p>
              {data.location.address && <p className="mt-1 text-sm">{data.location.address}</p>}
              {data.location.work_hours && <p className="mt-1 text-sm text-muted">{data.location.work_hours}</p>}
              {phone && (
                <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}
                  className="mt-4 block rounded-xl bg-accent py-3 text-center font-semibold text-accent-ink">
                  Позвонить {phone}
                </a>
              )}
            </div>
            <p className="pt-2 text-center text-xs text-muted">Страница обновляется сама</p>
          </div>
        )}
      </div>
    </main>
  )
}
