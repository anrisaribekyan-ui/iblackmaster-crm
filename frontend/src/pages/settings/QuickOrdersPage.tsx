import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import Modal from '../../components/Modal'
import type { QuickOrder } from '../../components/QuickOrderPicker'

type Suggestion = { name: string; brand: string | null; model: string; device_type: string | null; work: string; price: number; guarantee_days: number; count: number }
type Work = { name: string; price: number; guarantee_days: number }

const field = 'w-full rounded-md border border-line bg-surface px-3 py-2'
const rub = (v: number) => `${v.toLocaleString('ru-RU')} ₽`

function Editor({ item, onClose, onSaved }: { item: Partial<QuickOrder> | null; onClose: () => void; onSaved: () => void }) {
  const [works, setWorks] = useState<Work[]>(item?.works?.length ? item.works : [{ name: '', price: 0, guarantee_days: 30 }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '').trim()
    const payload = {
      name: text('name'),
      device_type: text('device_type') || null,
      brand: text('brand') || null,
      model: text('model') || null,
      problems: text('problems').split(',').map((p) => p.trim()).filter(Boolean),
      approximate_price: text('approximate_price') || null,
      works: works.filter((w) => w.name.trim()),
      parts_note: text('parts_note') || null,
      sort: Number(text('sort') || 0),
      is_active: form.get('is_active') === 'on',
    }
    setSaving(true)
    setError('')
    try {
      if (item?.id) await api.put(`/quick-orders/${item.id}`, payload)
      else await api.post('/quick-orders', payload)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={item?.id ? 'Быстрый заказ' : 'Новый быстрый заказ'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3">
        <label className="grid gap-1 text-sm text-muted">Название кнопки
          <input name="name" required className={field} defaultValue={item?.name ?? ''} placeholder="Замена АКБ iPhone 11" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm text-muted">Марка<input name="brand" className={field} defaultValue={item?.brand ?? ''} /></label>
          <label className="grid gap-1 text-sm text-muted">Модель<input name="model" className={field} defaultValue={item?.model ?? ''} /></label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-sm text-muted">Тип устройства<input name="device_type" className={field} defaultValue={item?.device_type ?? ''} placeholder="Телефон" /></label>
          <label className="grid gap-1 text-sm text-muted">Ориентир. цена<input name="approximate_price" className={field} defaultValue={item?.approximate_price ?? ''} /></label>
        </div>
        <label className="grid gap-1 text-sm text-muted">Неисправность (через запятую)
          <input name="problems" className={field} defaultValue={(item?.problems ?? []).join(', ')} placeholder="Быстро разряжается" />
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm text-muted">Работы (добавятся в заказ)</legend>
          {works.map((w, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_5rem_auto] items-center gap-2">
              <input aria-label="Работа" className={field} value={w.name} placeholder="Замена аккумулятора"
                onChange={(e) => setWorks(works.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label="Цена" type="number" min={0} step={100} className={field} value={w.price}
                onChange={(e) => setWorks(works.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} />
              <input aria-label="Гарантия, дней" type="number" min={0} className={field} value={w.guarantee_days} title="Гарантия, дней"
                onChange={(e) => setWorks(works.map((x, j) => (j === i ? { ...x, guarantee_days: Number(e.target.value) } : x)))} />
              <button type="button" aria-label="Убрать работу" className="h-10 w-8 text-muted" onClick={() => setWorks(works.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <p className="text-xs text-muted">Цена · гарантия в днях</p>
          <button type="button" className="justify-self-start text-sm text-accent" onClick={() => setWorks([...works, { name: '', price: 0, guarantee_days: 30 }])}>+ работа</button>
        </fieldset>
        <label className="grid gap-1 text-sm text-muted">Запчасть — подсказка мастеру (со склада не списывается)
          <input name="parts_note" className={field} defaultValue={item?.parts_note ?? ''} placeholder="АКБ iPhone 11, оригинальная ёмкость" />
        </label>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={item?.is_active ?? true} /> Показывать на приёмке</label>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">Порядок <input name="sort" type="number" className="w-20 rounded-md border border-line px-2 py-1" defaultValue={item?.sort ?? 0} /></label>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button disabled={saving} className="rounded-md bg-accent px-4 py-2.5 font-medium text-accent-ink disabled:opacity-60">{saving ? 'Сохраняю…' : 'Сохранить'}</button>
      </form>
    </Modal>
  )
}

/** Настройки → Быстрые заказы (ТЗ этап 3, E3). */
export default function QuickOrdersPage() {
  const [items, setItems] = useState<QuickOrder[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [editing, setEditing] = useState<Partial<QuickOrder> | null | undefined>(undefined)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, sugg] = await Promise.all([
        api.get<QuickOrder[]>('/quick-orders?all=true'),
        api.get<Suggestion[]>('/quick-orders/suggestions'),
      ])
      setItems(list)
      setSuggestions(sugg)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const addSuggestion = async (s: Suggestion) => {
    try {
      await api.post('/quick-orders', {
        name: s.name, brand: s.brand, model: s.model, device_type: s.device_type, problems: [],
        approximate_price: String(s.price), works: [{ name: s.work, price: s.price, guarantee_days: s.guarantee_days }], is_active: true, sort: 0,
      })
      await load()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось добавить')
    }
  }

  const remove = async (q: QuickOrder) => {
    await api.del(`/quick-orders/${q.id}`)
    await load()
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Быстрые заказы</h2>
          <p className="text-sm text-muted">Частый ремонт — одна кнопка на приёмке: устройство, неисправность, цена и работы заполняются сами.</p>
        </div>
        <button type="button" onClick={() => setEditing(null)} className="rounded-md bg-accent px-4 py-2 text-accent-ink">Добавить</button>
      </header>
      {error && <p role="alert" className="rounded-md border border-danger p-3 text-danger">{error}</p>}

      {items.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Пока нет ни одного. Начните с подсказок ниже — это ваши самые частые ремонты.</p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {items.map((q) => (
            <li key={q.id} className={`flex items-center gap-3 rounded-xl border border-line bg-surface p-3 ${q.is_active ? '' : 'opacity-50'}`}>
              <button type="button" onClick={() => setEditing(q)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-medium">{q.name}</span>
                <span className="block truncate text-sm text-muted">
                  {q.works.map((w) => w.name).join(', ') || 'без работ'} · {rub(q.total)}{q.uses ? ` · применён ${q.uses} раз` : ''}
                </span>
              </button>
              <button type="button" onClick={() => void remove(q)} className="text-sm text-danger">Удалить</button>
            </li>
          ))}
        </ul>
      )}

      {suggestions.length > 0 && (
        <div>
          <h3 className="mb-1 font-semibold">Частые ремонты за год</h3>
          <p className="mb-3 text-sm text-muted">Из выданных заказов: модель, работа, обычная цена и гарантия. Нажмите «+», чтобы сделать кнопкой.</p>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {suggestions.map((s) => (
              <li key={s.name} className="flex items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="shrink-0 text-sm text-muted">{s.count} раз</span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums">{rub(s.price)}</span>
                <button type="button" aria-label={`Добавить ${s.name}`} onClick={() => void addSuggestion(s)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line text-lg leading-none hover:border-accent hover:text-accent">+</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {editing !== undefined && <Editor item={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); void load() }} />}
    </section>
  )
}
