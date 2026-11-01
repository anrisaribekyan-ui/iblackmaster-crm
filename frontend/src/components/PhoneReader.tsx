import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

type Device = { udid: string; name: string | null; product_type: string | null; paired: boolean; problem: string | null }
type Station = { id: number; name: string; online: boolean; devices: Device[] }
type Job = { id: number; state: string; message: string | null; report: PhoneData | null }
export type PhoneData = { model_name: string | null; product_type: string | null; serial: string | null; imei: string | null }

/** Кнопка в приёмке: считать модель и серийный номер с телефона, подключённого к станции в магазине. */
export default function PhoneReader({ onRead }: { onRead: (data: PhoneData) => void }) {
  const [targets, setTargets] = useState<{ stationId: number; device: Device }[]>([])
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get<Station[]>('/app-install/stations')
      .then((stations) => {
        const list = stations.filter((s) => s.online).flatMap((s) => s.devices.filter((d) => d.paired && !d.problem).map((device) => ({ stationId: s.id, device })))
        setTargets(list)
        setChosen(list[0]?.device.udid ?? '')
      })
      .catch(() => setTargets([]))
  }, [])

  if (targets.length === 0) return null
  const target = targets.find((t) => t.device.udid === chosen) ?? targets[0]

  const read = async () => {
    setBusy(true)
    setError('')
    try {
      const job = await api.post<Job>('/app-install/jobs', { station_id: target.stationId, kind: 'report', target_udid: target.device.udid })
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        const found = (await api.get<Job[]>('/app-install/jobs')).find((j) => j.id === job.id)
        if (found?.state === 'done' && found.report) { onRead(found.report); return }
        if (found?.state === 'failed' || found?.state === 'cancelled') { setError(found.message || 'Не удалось прочитать телефон'); return }
      }
      setError('Телефон не ответил за минуту. Проверьте, что он разблокирован')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось прочитать телефон')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
      <span className="text-muted">Телефон на станции:</span>
      {targets.length > 1 ? (
        <select className="rounded-md border border-line bg-surface px-2 py-1.5" value={target.device.udid} onChange={(e) => setChosen(e.target.value)} aria-label="Телефон">
          {targets.map((t) => <option key={t.device.udid} value={t.device.udid}>{t.device.name ?? t.device.product_type}</option>)}
        </select>
      ) : <span className="font-medium">{target.device.name ?? target.device.product_type}</span>}
      <button type="button" className="rounded-md border border-line px-3 py-1.5 hover:bg-canvas disabled:opacity-60" disabled={busy} onClick={() => void read()}>
        {busy ? 'Читаю…' : 'Взять модель и серийный номер'}
      </button>
      {error && <span role="alert" className="text-danger">{error}</span>}
    </div>
  )
}
