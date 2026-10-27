import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from './Modal'
import { DOSKA_BOARDS, doska } from './PartOrder'

/**
 * «Оформить» в «Закупках»: карточки из «Что купить» с выбранным магазином, сгруппированные по поставщику.
 * Кнопка группы ищет товары у поставщика (наличие в Митино, цена), показывает подтверждение и оформляет
 * ОДИН заказ (самовывоз Митино). Сами входы и оформление — сервис автозаказа на сервере (zakupka_api).
 * После оформления карточки переезжают в «Купил» с номером заказа.
 */

type Account = { id: string; name: string }
type SupplierCfg = { id: string; doska: string; name: string; accounts: Account[] }
type Config = { enabled: boolean; live: boolean; max_rub?: number; suppliers: SupplierCfg[] }
type DoskaItem = { id: string; loc: string; col: number; text: string; supplier: string | null; price?: number | null; note?: string | null; deleted?: boolean }
type Candidate = { product_id: string; name: string; price: number | null; mitino: number | null; url: string; article: string; recommended: boolean }
type QuoteRow = { id: string; text: string; candidates: Candidate[]; problem: string | null }
type Line = { card: DoskaItem; candidates: Candidate[]; problem: string | null; pick: number; qty: number; include: boolean }
type OrderResult = {
  status: 'placed' | 'dry_run_ok' | 'rejected' | 'unknown'
  order_number: string | null
  total: number | null
  got: Record<string, number>
  problems: string[]
  live: boolean
  repeat?: boolean
}

const rub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`
const boardName = (loc: string) => DOSKA_BOARDS.find((b) => b.id === loc)?.name ?? loc
const newRequestId = () => `crm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const inMitino = (c: Candidate | undefined) => Boolean(c && (c.mitino ?? 0) > 0)
const mitinoLabel = (c: Candidate) => (c.mitino === null ? 'Митино: не понял' : c.mitino > 0 ? (c.mitino === 1 ? 'есть в Митино' : `Митино ${c.mitino} шт.`) : 'нет в Митино')

function errorText(e: unknown, fallback: string) {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback
}

export function useSupplierConfig() {
  const { can } = useAuth()
  const [config, setConfig] = useState<Config | null>(null)
  useEffect(() => {
    if (!can('supplierOrderAccess')) return
    api.get<Config>('/supplier-orders/config').then(setConfig).catch(() => setConfig({ enabled: false, live: false, suppliers: [] }))
  }, [can])
  return config
}

export default function SupplierOrders({ config }: { config: Config }) {
  const { me } = useAuth()
  const [items, setItems] = useState<DoskaItem[] | null>(null)
  const [error, setError] = useState('')
  const [accounts, setAccounts] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<{ supplier: SupplierCfg; account: Account; cards: DoskaItem[] } | null>(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const state = await doska<{ items?: DoskaItem[] }>('/api/state')
      setItems((state.items ?? []).filter((i) => !i.deleted && i.col === 0))
    } catch (e) {
      setError(errorText(e, 'Доска закупок недоступна'))
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    if (!items) return []
    return config.suppliers.map((s) => ({ supplier: s, cards: items.filter((i) => i.supplier === s.doska) }))
  }, [items, config.suppliers])
  const withoutShop = items?.filter((i) => !i.supplier).length ?? 0

  if (error) return <p role="alert" className="rounded-xl border border-line bg-surface p-5 text-danger">{error}</p>
  if (!items) return <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-surface" />)}</div>

  return (
    <div className="grid gap-4">
      {!config.live && (
        <p className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <strong>Пробный режим.</strong> Кнопка проверит вход, наличие и сумму, но заказ на сайте не оформит.
          Боевой режим включается на сервере: <code>ZAKUPKA_LIVE=1</code> в <code>~/moba/.env</code>.
        </p>
      )}
      {groups.length === 0 && (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Нет магазинов с логинами в сервисе закупок.</p>
      )}
      {groups.map(({ supplier, cards }) => {
        const accountId = accounts[supplier.id] ?? supplier.accounts[0]?.id
        const account = supplier.accounts.find((a) => a.id === accountId) ?? supplier.accounts[0]
        const sum = cards.reduce((s, c) => s + (c.price ?? 0), 0)
        return (
          <section key={supplier.id} className="rounded-xl border border-line bg-surface p-4" aria-label={supplier.name}>
            <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 className="text-lg font-semibold">{supplier.name}</h2>
              <span className="text-sm text-muted">{cards.length ? `${cards.length} поз.${sum ? ` · ≈${rub(sum)}` : ''}` : 'пусто'}</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {supplier.accounts.length > 1 && (
                  <div className="flex rounded-full border border-line p-0.5 text-sm" role="radiogroup" aria-label={`Аккаунт ${supplier.name}`}>
                    {supplier.accounts.map((a) => (
                      <button key={a.id} type="button" role="radio" aria-checked={a.id === account?.id}
                        onClick={() => setAccounts((cur) => ({ ...cur, [supplier.id]: a.id }))}
                        className={`rounded-full px-3 py-1 ${a.id === account?.id ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink'}`}>
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" disabled={!cards.length || !account}
                  onClick={() => account && setOpen({ supplier, account, cards })}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink disabled:opacity-40">
                  Оформить в {supplier.name}{supplier.accounts.length > 1 && account ? ` · ${account.name}` : ''}
                </button>
              </div>
            </header>
            {cards.length ? (
              <ul className="divide-y divide-line text-sm">
                {cards.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 py-2">
                    <span className="min-w-0 flex-1"><span className="line-clamp-2">{c.text}</span>
                      <span className="text-xs text-muted">{boardName(c.loc)}</span></span>
                    {c.price ? <span className="num shrink-0">{rub(c.price)}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">В «Что купить» нет карточек с магазином {supplier.name}.</p>
            )}
          </section>
        )
      })}
      {withoutShop > 0 && (
        <p className="text-sm text-muted">Ещё {withoutShop} карт. в «Что купить» без магазина — выберите магазин на доске, и они появятся здесь.</p>
      )}
      {open && (
        <ConfirmOrder
          supplier={open.supplier}
          account={open.account}
          cards={open.cards}
          live={config.live}
          author={me?.short_name ?? 'CRM'}
          onClose={() => setOpen(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  )
}

function ConfirmOrder({ supplier, account, cards, live, author, onClose, onDone }: {
  supplier: SupplierCfg; account: Account; cards: DoskaItem[]; live: boolean; author: string; onClose: () => void; onDone: () => void
}) {
  const [lines, setLines] = useState<Line[] | null>(null)
  const [error, setError] = useState('')
  const [placing, setPlacing] = useState(false)
  const [result, setResult] = useState<OrderResult | null>(null)
  const [moveNote, setMoveNote] = useState('')
  // Один id на это окно: повтор после обрыва связи не оформит второй заказ
  const requestId = useRef(newRequestId())

  useEffect(() => {
    let alive = true
    api.post<{ items: QuoteRow[] }>('/supplier-orders/quote', {
      supplier: supplier.id, account: account.id, items: cards.map((c) => ({ id: c.id, text: c.text })),
    }).then((data) => {
      if (!alive) return
      const byId = new Map(data.items.map((row) => [row.id, row]))
      setLines(cards.map((card) => {
        const row = byId.get(card.id)
        const candidates = row?.candidates ?? []
        let pick = candidates.findIndex((c) => c.recommended)
        if (pick < 0) pick = candidates.findIndex(inMitino)
        if (pick < 0) pick = 0
        return { card, candidates, problem: row?.problem ?? null, pick, qty: 1, include: inMitino(candidates[pick]) }
      }))
    }).catch((e) => alive && setError(errorText(e, 'Не удалось проверить наличие')))
    return () => { alive = false }
  }, [supplier.id, account.id, cards])

  const chosen = (lines ?? []).filter((l) => l.include && l.candidates[l.pick])
  const total = chosen.reduce((s, l) => s + (l.candidates[l.pick].price ?? 0) * l.qty, 0)
  const update = (i: number, patch: Partial<Line>) => setLines((cur) => cur && cur.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const place = async () => {
    setPlacing(true)
    setError('')
    try {
      const res = await api.post<OrderResult>('/supplier-orders/order', {
        supplier: supplier.id, account: account.id, request_id: requestId.current,
        lines: chosen.map((l) => ({ product_id: l.candidates[l.pick].product_id, qty: l.qty, price: l.candidates[l.pick].price ?? 0 })),
      })
      setResult(res)
      if (res.status === 'placed') await moveToBought(res)
    } catch (e) {
      setError(`${errorText(e, 'Не удалось оформить')}. Можно нажать ещё раз — второй заказ не создастся.`)
    } finally {
      setPlacing(false)
    }
  }

  // Оформленные позиции → «Купил» с номером заказа и ценой; что магазин не дал — остаётся в «Что купить»
  const moveToBought = async (res: OrderResult) => {
    const left: Record<string, number> = { ...res.got }
    const label = `${supplier.name} · ${account.name} · заказ №${res.order_number ?? '?'}`
    let moved = 0
    for (const l of chosen) {
      const c = l.candidates[l.pick]
      if ((left[c.product_id] ?? 0) < l.qty) continue
      left[c.product_id] -= l.qty
      try {
        await doska(`/api/items/${l.card.id}/edit`, { note: [label, l.qty > 1 ? `${l.qty} шт.` : '', l.card.note ?? ''].filter(Boolean).join('\n'), author })
        if (c.price !== null) await doska(`/api/items/${l.card.id}/price`, { price: c.price * l.qty, author })
        await doska(`/api/items/${l.card.id}/move`, { col: 1, author })
        moved += 1
      } catch {
        // карточку можно перенести руками — заказ уже оформлен
      }
    }
    setMoveNote(moved === chosen.length ? `Все ${moved} карт. перенесены в «Купил».` : `В «Купил» перенесено ${moved} из ${chosen.length}; остальные остались в «Что купить».`)
    onDone()
  }

  return (
    <Modal title={`${supplier.name} · ${account.name}`} onClose={onClose} wide>
      {error && <p role="alert" className="mb-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      {result ? (
        <OrderSummary result={result} supplier={supplier.name} moveNote={moveNote} onClose={onClose} onRetry={result.status === 'rejected' ? () => { requestId.current = newRequestId(); setResult(null) } : undefined} />
      ) : !lines ? (
        <div className="grid gap-2" aria-busy>
          <p className="text-sm text-muted">Ищу у {supplier.name} и проверяю наличие в Митино — до минуты…</p>
          {cards.map((c) => <div key={c.id} className="h-14 animate-pulse rounded-lg bg-canvas" />)}
        </div>
      ) : (
        <div className="grid gap-3">
          <ul className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
            {lines.map((l, i) => {
              const c = l.candidates[l.pick]
              return (
                <li key={l.card.id} className={`rounded-lg border p-3 ${l.include ? 'border-accent/60' : 'border-line opacity-80'}`}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={l.include} disabled={!c}
                      aria-label={`Заказать: ${l.card.text}`} onChange={(e) => update(i, { include: e.target.checked })} />
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium">{l.card.text}</p>
                      <p className="text-xs text-muted">{boardName(l.card.loc)}</p>
                      {l.candidates.length > 0 ? (
                        <select className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm" value={l.pick}
                          aria-label="Товар у поставщика"
                          onChange={(e) => { const pick = Number(e.target.value); update(i, { pick, include: inMitino(l.candidates[pick]) }) }}>
                          {l.candidates.map((cand, k) => (
                            <option key={cand.product_id} value={k}>
                              {cand.price !== null ? `${rub(cand.price)} · ` : ''}{mitinoLabel(cand)} · {cand.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="mt-1 text-sm text-danger">{l.problem ?? 'у поставщика не нашлось'}</p>
                      )}
                      {c && !inMitino(c) && <p className="mt-1 text-xs text-warning">Нет в Митино — по умолчанию не заказываю</p>}
                      {c?.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-muted underline-offset-2 hover:text-accent hover:underline">Открыть на сайте</a>}
                    </div>
                    {c && (
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="num font-semibold">{c.price !== null ? rub((c.price ?? 0) * l.qty) : '—'}</span>
                        <input type="number" min={1} max={50} value={l.qty} aria-label="Количество"
                          onChange={(e) => update(i, { qty: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
                          className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-right text-sm" />
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
            <span className="text-sm text-muted">{chosen.length} поз. · самовывоз Митино, оплата при получении</span>
            <button type="button" onClick={() => void place()} disabled={placing || chosen.length === 0}
              className="ml-auto rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-ink disabled:opacity-40">
              {placing ? 'Оформляю… до пары минут' : `${live ? 'Оформить' : 'Проверить (пробно)'} · ${rub(total)}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function OrderSummary({ result, supplier, moveNote, onClose, onRetry }: {
  result: OrderResult; supplier: string; moveNote: string; onClose: () => void; onRetry?: () => void
}) {
  const title = {
    placed: `Заказ ${supplier} №${result.order_number ?? '?'} оформлен`,
    dry_run_ok: 'Пробно: всё сходится, заказ не оформлялся',
    unknown: `Заказ МОГ уйти — проверьте «Мои заказы» на сайте ${supplier}`,
    rejected: 'Не оформлено',
  }[result.status]
  const tone = result.status === 'placed' || result.status === 'dry_run_ok' ? 'text-success' : result.status === 'unknown' ? 'text-warning' : 'text-danger'
  return (
    <div className="grid gap-3" role="status">
      <p className={`text-lg font-semibold ${tone}`}>{title}</p>
      {result.total !== null && <p className="text-sm">Сумма: <span className="num font-medium">{rub(result.total)}</span>{result.status === 'placed' ? ' · забрать в Митино' : ''}</p>}
      {moveNote && <p className="text-sm text-muted">{moveNote}</p>}
      {result.problems.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">{result.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <div className="flex gap-2 pt-1">
        {onRetry && <button type="button" onClick={onRetry} className="rounded-md border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent">Попробовать снова</button>}
        <button type="button" onClick={onClose} className="ml-auto rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink">Готово</button>
      </div>
    </div>
  )
}
