import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import Modal from '../../components/Modal'
import { useAuth } from '../../auth'

type Store = { id: number; location_id: number; name: string; is_default: boolean }
type Location = {
  id: number
  name: string
  address: string | null
  phones: string | null
  color: string
  sort: number
  stores: Store[]
}
type CashRegister = {
  id: number
  location_id: number | null
  name: string
  accepts_cash: boolean
  accepts_bank: boolean
  bank_percent: string
  allow_negative: boolean
  allow_internal_move: boolean
  is_default: boolean
  cash_balance: string | null
  bank_balance: string | null
}
type Editor =
  | { kind: 'location'; item?: Location }
  | { kind: 'store'; locationId: number; item?: Store }
  | { kind: 'register'; locationId: number | null; item?: CashRegister }

const fieldClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'
const labelClass = 'grid gap-1 text-sm text-muted'

export default function LocationsPage() {
  const { can } = useAuth()
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [registers, setRegisters] = useState<CashRegister[]>([])
  const [editor, setEditor] = useState<Editor | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [locationData, registerData] = await Promise.all([
        api.get<Location[]>('/locations'),
        api.get<CashRegister[]>('/cash-registers'),
      ])
      setLocations(locationData)
      setRegisters(registerData)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить настройки локаций')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editor) return
    const form = new FormData(event.currentTarget)
    const text = (key: string) => String(form.get(key) ?? '').trim()
    const checked = (key: string) => form.get(key) === 'on'
    setSaving(true)
    setError('')
    try {
      if (editor.kind === 'location') {
        const payload = {
          name: text('name'),
          address: text('address') || null,
          phones: text('phones') || null,
          color: text('color'),
          sort: Number(text('sort') || 0),
        }
        if (editor.item) await api.put(`/locations/${editor.item.id}`, payload)
        else await api.post('/locations', payload)
      } else if (editor.kind === 'store') {
        const payload = {
          location_id: editor.locationId,
          name: text('name'),
          is_default: checked('is_default'),
        }
        if (editor.item) await api.put(`/stores/${editor.item.id}`, payload)
        else await api.post('/stores', payload)
      } else {
        const selectedLocation = text('location_id')
        const payload = {
          name: text('name'),
          location_id: selectedLocation ? Number(selectedLocation) : null,
          accepts_cash: checked('accepts_cash'),
          accepts_bank: checked('accepts_bank'),
          bank_percent: text('bank_percent') || '0',
          allow_negative: checked('allow_negative'),
          allow_internal_move: checked('allow_internal_move'),
          is_default: checked('is_default'),
        }
        if (editor.item) await api.put(`/cash-registers/${editor.item.id}`, payload)
        else await api.post('/cash-registers', payload)
      }
      setEditor(null)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить изменения')
    } finally {
      setSaving(false)
    }
  }

  const archive = async (kind: 'store' | 'register', item: Store | CashRegister) => {
    const title = item.name
    if (!confirm(`Архивировать «${title}»?`)) return
    setError('')
    try {
      await api.del(`/${kind === 'store' ? 'stores' : 'cash-registers'}/${item.id}`)
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось архивировать')
    }
  }

  const locationRegisters = (locationId: number) =>
    registers.filter((register) => register.location_id === locationId)
  const globalRegisters = registers.filter((register) => register.location_id === null)

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Локации, склады и кассы</h2>
        {can('settingAccess') && (
          <button className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink" onClick={() => setEditor({ kind: 'location' })}>
            Добавить локацию
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-4 rounded-md border border-danger p-3 text-danger">{error}</p>}
      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : locations === null ? (
        <p className="text-muted">Не удалось загрузить список локаций.</p>
      ) : locations.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface p-5 text-muted">Локаций пока нет. Добавьте первую локацию, чтобы настроить склады и кассы.</p>
      ) : (
        <div className="space-y-4">
          {locations.map((location) => {
            const locationCashRegisters = locationRegisters(location.id)
            return (
              <article key={location.id} className="rounded-xl border border-line bg-surface p-4">
                <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-1 h-4 w-4 shrink-0 rounded-full border border-line" style={{ backgroundColor: location.color }} />
                    <div>
                      <h3 className="font-semibold">{location.name}</h3>
                      <p className="text-sm text-muted">{location.address || 'Адрес не указан'}</p>
                      {location.phones && <p className="text-sm text-muted">{location.phones}</p>}
                    </div>
                  </div>
                  {can('settingAccess') && (
                    <button className="text-sm text-muted hover:text-ink" onClick={() => setEditor({ kind: 'location', item: location })}>
                      Изменить локацию
                    </button>
                  )}
                </header>
                <div className="grid gap-4 xl:grid-cols-2">
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-medium">Склады</h4>
                      {can('storeSettingAccess') && (
                        <button className="text-sm text-accent" onClick={() => setEditor({ kind: 'store', locationId: location.id })}>
                          + Склад
                        </button>
                      )}
                    </div>
                    {location.stores.length === 0 ? (
                      <p className="text-sm text-muted">Складов пока нет.</p>
                    ) : (
                      <ul className="divide-y divide-line rounded-lg border border-line">
                        {location.stores.map((store) => (
                          <li key={store.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span>{store.name}{store.is_default && <small className="ml-2 text-muted">по умолчанию</small>}</span>
                            {can('storeSettingAccess') && (
                              <span className="flex gap-3 text-sm">
                                <button className="text-muted" onClick={() => setEditor({ kind: 'store', locationId: location.id, item: store })}>Изменить</button>
                                <button className="text-danger" onClick={() => void archive('store', store)}>Архивировать</button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="font-medium">Кассы</h4>
                      {can('changeCashRegisterAccess') && (
                        <button className="text-sm text-accent" onClick={() => setEditor({ kind: 'register', locationId: location.id })}>
                          + Касса
                        </button>
                      )}
                    </div>
                    {locationCashRegisters.length === 0 ? (
                      <p className="text-sm text-muted">Касс в этой локации пока нет.</p>
                    ) : (
                      <ul className="divide-y divide-line rounded-lg border border-line">
                        {locationCashRegisters.map((register) => (
                          <li key={register.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div>
                              <span>{register.name}{register.is_default && <small className="ml-2 text-muted">по умолчанию</small>}</span>
                              <p className="text-xs text-muted">
                                {register.accepts_cash ? 'Наличные' : ''}
                                {register.accepts_cash && register.accepts_bank ? ' · ' : ''}
                                {register.accepts_bank ? `Безналичные · комиссия ${register.bank_percent}%` : ''}
                              </p>
                            </div>
                            {can('changeCashRegisterAccess') && (
                              <span className="flex gap-3 text-sm">
                                <button className="text-muted" onClick={() => setEditor({ kind: 'register', locationId: location.id, item: register })}>Изменить</button>
                                <button className="text-danger" onClick={() => void archive('register', register)}>Архивировать</button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </article>
            )
          })}
          <section className="rounded-xl border border-line bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">Глобальные кассы</h3>
              {can('changeCashRegisterAccess') && (
                <button className="text-sm text-accent" onClick={() => setEditor({ kind: 'register', locationId: null })}>
                  + Касса
                </button>
              )}
            </div>
            {globalRegisters.length === 0 ? (
              <p className="text-sm text-muted">Глобальных касс пока нет.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {globalRegisters.map((register) => (
                  <li key={register.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>{register.name} · {register.accepts_cash ? 'Наличные' : ''}{register.accepts_cash && register.accepts_bank ? ' / ' : ''}{register.accepts_bank ? `Безналичные · ${register.bank_percent}%` : ''}</span>
                    {can('changeCashRegisterAccess') && (
                      <span className="flex gap-3 text-sm">
                        <button className="text-muted" onClick={() => setEditor({ kind: 'register', locationId: null, item: register })}>Изменить</button>
                        <button className="text-danger" onClick={() => void archive('register', register)}>Архивировать</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {editor && (
        <Modal
          title={
            editor.kind === 'location'
              ? editor.item ? 'Изменить локацию' : 'Новая локация'
              : editor.kind === 'store'
                ? editor.item ? 'Изменить склад' : 'Новый склад'
                : editor.item ? 'Изменить кассу' : 'Новая касса'
          }
          onClose={() => setEditor(null)}
        >
          <form onSubmit={save} className="grid gap-3">
            <label className={labelClass}>Название
              <input className={fieldClass} name="name" required defaultValue={editor.item?.name ?? ''} />
            </label>
            {editor.kind === 'location' && (
              <>
                <label className={labelClass}>Адрес
                  <input className={fieldClass} name="address" defaultValue={editor.item?.address ?? ''} />
                </label>
                <label className={labelClass}>Телефоны
                  <input className={fieldClass} name="phones" defaultValue={editor.item?.phones ?? ''} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelClass}>Цвет
                    <input className={fieldClass} name="color" type="color" defaultValue={editor.item?.color ?? '#171717'} />
                  </label>
                  <label className={labelClass}>Порядок
                    <input className={fieldClass} name="sort" type="number" defaultValue={editor.item?.sort ?? 0} />
                  </label>
                </div>
              </>
            )}
            {editor.kind === 'store' && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="is_default" defaultChecked={editor.item?.is_default ?? false} />
                Склад по умолчанию
              </label>
            )}
            {editor.kind === 'register' && (
              <>
                <label className={labelClass}>Локация
                  <select className={fieldClass} name="location_id" defaultValue={editor.item?.location_id ?? editor.locationId ?? ''}>
                    <option value="">Глобальная касса</option>
                    {(locations ?? []).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  </select>
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="accepts_cash" defaultChecked={editor.item?.accepts_cash ?? true} />Наличные</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="accepts_bank" defaultChecked={editor.item?.accepts_bank ?? false} />Безналичные</label>
                </div>
                <label className={labelClass}>Комиссия банка, %
                  <input className={fieldClass} name="bank_percent" type="number" min="0" max="100" step="0.01" defaultValue={editor.item?.bank_percent ?? '0'} />
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2"><input type="checkbox" name="allow_negative" defaultChecked={editor.item?.allow_negative ?? true} />Разрешить отрицательный остаток</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="allow_internal_move" defaultChecked={editor.item?.allow_internal_move ?? true} />Разрешить перемещение</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="is_default" defaultChecked={editor.item?.is_default ?? false} />По умолчанию</label>
                </div>
              </>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="rounded-md border border-line px-3 py-2" onClick={() => setEditor(null)}>Отмена</button>
              <button disabled={saving} className="rounded-md bg-accent px-3 py-2 font-medium text-accent-ink disabled:opacity-60">
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
