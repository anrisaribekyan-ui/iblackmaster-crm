import { useCallback, useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import { inputClass } from '../pages/shared'

/**
 * «Заказать запчасть» из заказа: ищем варианты на Поиск123 (Митинский радиорынок) и кладём выбранный
 * в колонку «Что купить» доски закупок нужной точки. Доска — отдельный сервис, Caddy отдаёт её
 * с того же адреса по пути /zakupki-app/ (см. PurchasesPage), поэтому ходим к ней обычным fetch.
 */
const DOSKA = '/zakupki-app'

export type DoskaLoc = 'panfilovskogo' | '1000melochey'
export const DOSKA_BOARDS: { id: DoskaLoc; name: string }[] = [
  { id: 'panfilovskogo', name: 'Панфиловского' },
  { id: '1000melochey', name: '1000 мелочей' },
]

type Offer = { name: string; shop: string; color: string | null; stock: string; opt: number | null; price: number; url: string | null }
type Supplier = { id: string; name: string }
export type AddedPart = { id: string; text: string; price: number | null; shop: string | null; loc: DoskaLoc }

/** Доска закупок по названию точки CRM: «ТК Панфиловский» → Панфиловского, «1000 мелочей» / «Тыща» → 1000 мелочей. */
export function doskaLoc(locationName: string | null | undefined): DoskaLoc | null {
  const name = (locationName ?? '').toLowerCase()
  if (/панф/.test(name)) return 'panfilovskogo'
  if (/1000|тыщ|мелоч/.test(name)) return '1000melochey'
  return null
}

const PARTS: [RegExp, string][] = [
  [/диспле|экран|стекл|тач|сенсор|модул/, 'дисплей'],
  [/акб|аккум|батар|заряд не держ|не держит заряд|вздул|быстро сад/, 'аккумулятор'],
  [/разъ[её]м|гнезд|не заряжа|заряд|заряжа/, 'разъем зарядки'],
  [/задн|крышк|корпус/, 'задняя крышка'],
  [/камер/, 'камера'],
  [/слух|разговорн|не слышно собеседника/, 'динамик разговорный'],
  [/динамик|звук|полифон/, 'динамик'],
  [/микрофон|не слышат/, 'микрофон'],
  [/кнопк|шлейф/, 'шлейф кнопок'],
]

/** Что искать: деталь по неисправности + модель («Замена дисплея», Realme C30 → «дисплей realme c30»). */
export function partQuery(problems: string[], brand: string, model: string): string {
  const text = problems.join(' ').toLowerCase()
  const part = PARTS.find(([re]) => re.test(text))?.[1] ?? ''
  const cleanBrand = brand.trim()
  const cleanModel = model.trim()
  // «Apple iPhone 13» на Поиск123 ищется хуже, чем «iphone 13»; марку не дублируем, если она уже в модели
  const withBrand = !cleanBrand || /^apple$/i.test(cleanBrand) || cleanModel.toLowerCase().startsWith(cleanBrand.toLowerCase())
    ? cleanModel
    : `${cleanBrand} ${cleanModel}`
  return [part, withBrand.replace(/^galaxy\s+/i, '')].filter(Boolean).join(' ').toLowerCase().trim()
}

async function doska<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${DOSKA}${path}`, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error((data as { error?: string }).error || 'Доска закупок не отвечает')
  return data as T
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
const rub = (value: number) => `${value.toLocaleString('ru-RU')} ₽`

/** Пометка заметки на приёмке: номера у заказа ещё нет, его подставит linkPartsToOrder. */
export const INTAKE_MARK = 'Новый заказ'

/** Дописать номер заказа в заметку карточки (на приёмке карточка создаётся раньше, чем заказ получает номер). */
export async function linkPartsToOrder(parts: AddedPart[], orderNumber: string, author: string) {
  await Promise.all(parts.map(async (part) => {
    try {
      const state = await doska<{ items?: { id: string; note?: string | null }[] }>('/api/state')
      const note = state.items?.find((item) => item.id === part.id)?.note ?? ''
      const linked = note.startsWith(INTAKE_MARK) ? `Заказ ${orderNumber}${note.slice(INTAKE_MARK.length)}` : `Заказ ${orderNumber}${note ? ` · ${note}` : ''}`
      await doska(`/api/items/${part.id}/edit`, { note: linked, author })
    } catch {
      // номер в заметке — удобство, заказ от этого не страдает
    }
  }))
}

export default function PartOrderModal({
  initialQuery,
  locationName,
  author,
  note,
  onClose,
  onAdded,
}: {
  initialQuery: string
  locationName: string | null
  author: string
  /** Заметка к карточке: номер заказа, клиент, аппарат */
  note: string
  onClose: () => void
  onAdded: (part: AddedPart) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [searched, setSearched] = useState('')
  const [offers, setOffers] = useState<Offer[] | null>(null)
  const [site, setSite] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<number | null>(null)
  const [loc, setLoc] = useState<DoskaLoc | ''>(doskaLoc(locationName) ?? '')
  const [saving, setSaving] = useState(false)
  const suppliers = useRef<Supplier[] | null>(null)

  const search = useCallback(async (text: string) => {
    const q = text.trim()
    if (q.length < 2) return
    setLoading(true)
    setError('')
    setPicked(null)
    setSearched(q)
    setSite(`https://poisk123.ru/s/moskva/?s=${encodeURIComponent(q).replace(/%20/g, '+')}`)
    try {
      const data = await doska<{ items: Offer[]; site: string }>(`/api/p123?q=${encodeURIComponent(q)}`)
      setOffers(data.items)
      setSite(data.site)
      if (data.items.length) setPicked(0)
    } catch (e) {
      setOffers(null)
      setError(e instanceof Error ? e.message : 'Поиск123 сейчас не отвечает')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialQuery.trim().length >= 2) void search(initialQuery)
  }, [initialQuery, search])

  const supplierFor = async (shop: string): Promise<string | null> => {
    if (!shop) return null
    try {
      if (suppliers.current === null) {
        suppliers.current = (await doska<{ suppliers?: Supplier[] }>('/api/state')).suppliers ?? []
      }
    } catch {
      suppliers.current = []
    }
    const name = shop.toLowerCase()
    return suppliers.current.find((s) => name.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(name))?.id ?? null
  }

  const add = async (offer: Offer | null) => {
    if (!loc) {
      setError('Выберите, в какую доску положить')
      return
    }
    setSaving(true)
    setError('')
    try {
      const id = newId()
      const text = (offer?.name ?? query).trim().slice(0, 200)
      const lines = [note]
      if (offer) lines.push(`Поиск123: ${offer.shop || 'магазин'}, ${rub(offer.price)}${offer.stock ? ` · ${offer.stock}` : ''}`, offer.url ?? site)
      await doska('/api/items', {
        id, loc, text, author,
        supplier: offer ? await supplierFor(offer.shop) : null,
        note: lines.filter(Boolean).join('\n'),
      })
      if (offer) await doska(`/api/items/${id}/price`, { price: offer.price, author }).catch(() => undefined)
      onAdded({ id, text, price: offer?.price ?? null, shop: offer?.shop ?? null, loc })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось добавить в «Что купить»')
    } finally {
      setSaving(false)
    }
  }

  const offer = picked !== null && offers ? offers[picked] : null

  return (
    <Modal title="Заказать запчасть" onClose={onClose} wide>
      <div className="grid gap-3">
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void search(query) }}>
          <input
            className={`${inputClass} min-w-0 flex-1`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Деталь и модель: дисплей realme c30"
            aria-label="Что искать на Поиск123"
            autoFocus={!initialQuery}
            enterKeyHint="search"
          />
          <button type="submit" className="rounded-md border border-line px-4 text-sm font-medium hover:border-accent hover:text-accent" disabled={loading}>Найти</button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">В «Что купить»:</span>
          {DOSKA_BOARDS.map((board) => (
            <button key={board.id} type="button" onClick={() => setLoc(board.id)} aria-pressed={loc === board.id}
              className={`rounded-full border px-3 py-1 ${loc === board.id ? 'border-accent bg-accent-soft text-ink' : 'border-line text-muted hover:text-ink'}`}>
              {board.name}
            </button>
          ))}
        </div>

        <div className="min-h-40" aria-live="polite" aria-busy={loading}>
          {loading ? (
            <div className="grid gap-2" aria-label="Ищу на Митинском рынке">
              {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-canvas" />)}
            </div>
          ) : error && !offers ? (
            <p className="rounded-lg bg-canvas p-4 text-sm text-muted">{error}. Можно открыть сайт или добавить карточку без варианта.</p>
          ) : offers && offers.length === 0 ? (
            <p className="rounded-lg bg-canvas p-4 text-sm text-muted">На Митинском рынке по «{searched}» ничего нет. Попробуйте короче: деталь и модель.</p>
          ) : offers ? (
            <ul className="grid max-h-[46vh] gap-1.5 overflow-y-auto pr-1" role="listbox" aria-label="Варианты на Поиск123">
              {offers.slice(0, 40).map((item, index) => (
                <li key={`${item.shop}-${item.name}-${index}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={picked === index}
                    onClick={() => setPicked(index)}
                    onDoubleClick={() => void add(item)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${picked === index ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent/60'}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm text-ink">{item.name}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="rounded px-1.5 py-0.5 font-medium text-white" style={{ background: item.color || '#667085' }}>{item.shop || 'Магазин'}</span>
                        {item.stock && <span>{item.stock}</span>}
                        {item.opt && <span>опт {rub(item.opt)}</span>}
                        {index === 0 && <span className="text-success">дешевле всех</span>}
                      </span>
                    </span>
                    <span className="num shrink-0 text-base font-semibold">{rub(item.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg bg-canvas p-4 text-sm text-muted">Впишите деталь и модель — покажу, что есть на Митинском рынке.</p>
          )}
        </div>

        {error && offers && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {site && <a href={offer?.url || site} target="_blank" rel="noopener noreferrer" className="text-sm text-muted underline-offset-2 hover:text-accent hover:underline">{offer?.url ? 'Открыть вариант на сайте' : 'Открыть Поиск123'}</a>}
          <button type="button" className="ml-auto rounded-md border border-line px-3 py-2 text-sm hover:border-accent hover:text-accent disabled:opacity-50"
            disabled={saving || query.trim().length < 2} onClick={() => void add(null)}>
            Без варианта
          </button>
          <button type="button" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
            disabled={saving || !offer} onClick={() => offer && void add(offer)}>
            {saving ? 'Добавляю…' : offer ? `Утвердить · ${rub(offer.price)}` : 'Выберите вариант'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
