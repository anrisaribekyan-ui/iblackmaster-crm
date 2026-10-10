import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import Modal from './Modal'
import { ChecklistInput, ChecklistSummary, SignaturePad, useChecklistItems, type ChecklistValues, type Mark } from './Checklist'
import { escapeHtml } from '../print'

export type Signatures = { in?: string; out?: string }
const SIGNATURE_NAMES = { in: 'Подпись клиента — приём.png', out: 'Подпись клиента — выдача.png' } as const
export const isSignatureFile = (filename: string) => filename.startsWith('Подпись клиента')

const MARK_PRINT: Record<Mark, string> = { ok: '✓ работает', fail: '✗ не работает', na: '— не проверить' }

/** Таблица чек-листа для печати. С двумя колонками (приём → выдача) — для акта. */
export function checklistHtml(checkIn: ChecklistValues, checkOut?: ChecklistValues) {
  const items = Array.from(new Set([...Object.keys(checkIn), ...Object.keys(checkOut ?? {})]))
  if (items.length === 0) return ''
  if (!checkOut) {
    // Квитанция: компактно, в две колонки — чтобы лист не растягивался
    const lines = items.map((item) => `<li>${checkIn[item] === 'ok' ? '✓' : checkIn[item] === 'fail' ? '<strong>✗</strong>' : '—'} ${escapeHtml(item)}${
      checkIn[item] === 'fail' ? ' <strong>(не работает)</strong>' : checkIn[item] === 'na' ? ' (не проверить)' : ''}</li>`).join('')
    return `<h2>Проверка при приёме</h2><ul style="columns:2;list-style:none;padding:0;margin:0;font-size:13px;line-height:1.7">${lines}</ul>`
  }
  const rows = items
    .map((item) => `<tr><td>${escapeHtml(item)}</td><td>${checkIn[item] ? MARK_PRINT[checkIn[item]] : '—'}</td>${
      checkOut ? `<td>${checkOut[item] ? MARK_PRINT[checkOut[item]] : '—'}</td>` : ''}</tr>`)
    .join('')
  return `<h2>Проверка устройства</h2><table><thead><tr><th>Что проверяли</th><th>При приёме</th>${checkOut ? '<th>При выдаче</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`
}

export const signatureHtml = (dataUrl: string | undefined, caption: string) =>
  dataUrl ? `<div style="margin-top:4mm"><img src="${dataUrl}" alt="" style="height:22mm"/><p class="muted">${escapeHtml(caption)}</p></div>` : ''

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

/** Блок «Проверка устройства» в заказе: что было при приёме, проверка при выдаче, подписи клиента. */
export default function OrderChecklistCard({
  orderId,
  checkIn,
  checkOut,
  disabled,
  onChanged,
  onSignatures,
}: {
  orderId: number
  checkIn: ChecklistValues
  checkOut: ChecklistValues
  disabled: boolean
  onChanged: () => void
  onSignatures: (s: Signatures) => void
}) {
  const items = useChecklistItems()
  const [signatures, setSignatures] = useState<Signatures>({})
  const [editing, setEditing] = useState<'in' | 'out' | null>(null)
  const [values, setValues] = useState<ChecklistValues>({})
  const [signature, setSignature] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadSignatures = useCallback(async () => {
    try {
      const files = await api.get<{ id: number; filename: string }[]>(`/orders/${orderId}/files`)
      const result: Signatures = {}
      for (const stage of ['in', 'out'] as const) {
        const file = files.find((f) => f.filename === SIGNATURE_NAMES[stage])
        if (file) result[stage] = await toDataUrl(await api.blob(`/orders/${orderId}/files/${file.id}`))
      }
      setSignatures(result)
      onSignatures(result)
    } catch {
      /* без подписей карточка работает */
    }
  }, [orderId, onSignatures])
  useEffect(() => { void loadSignatures() }, [loadSignatures])

  const open = (stage: 'in' | 'out') => {
    // При выдаче начинаем с того, что было при приёме — обычно меняется пара пунктов
    setValues(stage === 'out' ? { ...checkIn, ...checkOut } : { ...checkIn })
    setSignature(null)
    setError('')
    setEditing(stage)
  }

  const save = async () => {
    if (!editing) return
    setSaving(true)
    setError('')
    try {
      await api.put(`/orders/${orderId}/checklist`, { stage: editing, values })
      if (signature) await api.post(`/orders/${orderId}/signature`, { stage: editing, image: signature })
      setEditing(null)
      onChanged()
      await loadSignatures()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  const row = (title: string, stage: 'in' | 'out', v: ChecklistValues) => (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <ChecklistSummary values={v} />
      </div>
      {signatures[stage] && <img src={signatures[stage]} alt={`Подпись: ${title.toLowerCase()}`} className="h-10 max-w-28 rounded border border-line bg-white object-contain" />}
      {!disabled && (
        <button type="button" onClick={() => open(stage)} className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm">
          {Object.keys(v).length ? 'Изменить' : stage === 'out' ? 'Проверить' : 'Заполнить'}
        </button>
      )}
    </div>
  )

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 font-semibold">Проверка устройства</h2>
      <div className="space-y-3">
        {row('При приёме', 'in', checkIn)}
        {row('При выдаче', 'out', checkOut)}
      </div>
      {editing && (
        <Modal title={editing === 'out' ? 'Проверка при выдаче' : 'Проверка при приёме'} onClose={() => setEditing(null)}>
          {items.length === 0 ? (
            <p className="text-muted">Пункты чек-листа не настроены (Настройки → Чек-лист).</p>
          ) : (
            <div className="grid gap-4">
              <ChecklistInput items={items} value={values} onChange={setValues} />
              <SignaturePad onChange={setSignature} />
              {error && <p role="alert" className="text-sm text-danger">{error}</p>}
              <button type="button" disabled={saving} onClick={() => void save()}
                className="rounded-md bg-accent px-4 py-2.5 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохраняю…' : 'Сохранить'}</button>
            </div>
          )}
        </Modal>
      )}
    </section>
  )
}
