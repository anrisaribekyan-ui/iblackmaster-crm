import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { matchChoices, normalizeBrand, normalizeModel, suggestBrands } from '../intake'

// Поля формы приёмки с подсказками: всё выбирается с клавиатуры —
// стрелки двигают подсветку, Enter/Tab выбирают, Escape закрывает список.

const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

function useListNav(count: number) {
  const [active, setActive] = useState(0)
  // Список поменялся — подсветка снова на первом пункте (сброс прямо в рендере, без лишнего эффекта)
  const [prevCount, setPrevCount] = useState(count)
  if (prevCount !== count) {
    setPrevCount(count)
    setActive(0)
  }

  const onKey = (
    e: KeyboardEvent<HTMLInputElement>,
    open: boolean,
    choose: (i: number) => void,
    close: () => void,
  ): boolean => {
    if (!open || count === 0) return false
    const current = Math.min(active, count - 1)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((current + step + count) % count)
      return true
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      choose(current)
      return true
    }
    if (e.key === 'Tab') {
      // Выбираем подсвеченное, а фокус уходит дальше сам
      choose(current)
      return false
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return true
    }
    return false
  }

  return { active, onKey }
}

type SuggestItem = { key: string; label: string; hint?: string }

export function Suggest({ id, items, active, onPick }: { id: string; items: SuggestItem[]; active: number; onPick: (i: number) => void }) {
  return (
    <ul id={id} role="listbox" className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
      {items.map((item, i) => (
        <li key={item.key} role="option" aria-selected={i === active}>
          <button
            type="button"
            tabIndex={-1}
            // Не отбираем фокус у поля, иначе сработает blur раньше клика
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(i)}
            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-ink ${i === active ? 'bg-canvas font-medium' : 'hover:bg-canvas'}`}
          >
            {item.label}
            {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}

export function BrandInput({ value, known, required, onChange }: { value: string; known: string[]; required?: boolean; onChange: (v: string) => void }) {
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // Актуальное значение для проверки после потери фокуса
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])

  const items = suggestBrands(value, known)
  const open = focused && !dismissed && value.trim() !== '' && items.length > 0
    && !(items.length === 1 && items[0] === value.trim())
  const nav = useListNav(items.length)
  const choose = (i: number) => {
    if (items[i]) onChange(items[i])
    setDismissed(true)
  }

  return (
    <div className="relative">
      <input
        data-field="brand"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="brand-list"
        autoComplete="off"
        className={inputClass}
        value={value}
        required={required}
        onChange={(e) => {
          setDismissed(false)
          onChange(e.target.value)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => {
            // «эпл» → «Apple», «самсунг» → «Samsung»
            const fixed = normalizeBrand(valueRef.current, known)
            if (fixed && fixed !== valueRef.current) onChange(fixed)
            setFocused(false)
            setDismissed(false)
          }, 120)
        }}
        onKeyDown={(e) => { nav.onKey(e, open, choose, () => setDismissed(true)) }}
      />
      {open && <Suggest id="brand-list" items={items.map((b) => ({ key: b, label: b }))} active={nav.active} onPick={choose} />}
    </div>
  )
}

export type Device = { id: number; brand: string; model: string; name: string }

export function ModelInput<D extends Device>({
  value, brand, devices, required, onChange, onChooseDevice,
}: {
  value: string
  brand: string
  devices: D[]
  required?: boolean
  onChange: (v: string) => void
  onChooseDevice: (d: D) => void
}) {
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  // Актуальное значение для проверки после потери фокуса
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value }, [value])
  const brandRef = useRef(brand)
  useEffect(() => { brandRef.current = brand }, [brand])

  const fixedNow = normalizeModel(value, brand)
  const items: SuggestItem[] = []
  if (fixedNow && fixedNow !== value.trim()) items.push({ key: '__fix', label: fixedNow, hint: 'исправить' })
  for (const d of devices) {
    if (d.model !== fixedNow) items.push({ key: `d${d.id}`, label: d.name })
  }
  const open = focused && !dismissed && value.trim() !== '' && items.length > 0
  const nav = useListNav(items.length)

  const choose = (i: number) => {
    const item = items[i]
    if (item?.key === '__fix') onChange(fixedNow)
    else if (item) {
      const device = devices.find((d) => `d${d.id}` === item.key)
      if (device) onChooseDevice(device)
    }
    setDismissed(true)
  }

  return (
    <div className="relative">
      <input
        data-field="model"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="model-list"
        autoComplete="off"
        className={inputClass}
        value={value}
        required={required}
        onChange={(e) => {
          setDismissed(false)
          onChange(e.target.value)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => {
            // «7» при марке Apple → «iPhone 7»
            const fixed = normalizeModel(valueRef.current, brandRef.current)
            if (fixed && fixed !== valueRef.current) onChange(fixed)
            setFocused(false)
            setDismissed(false)
          }, 120)
        }}
        onKeyDown={(e) => { nav.onKey(e, open, choose, () => setDismissed(true)) }}
      />
      {open && <Suggest id="model-list" items={items} active={nav.active} onPick={choose} />}
    </div>
  )
}

export function MultiValueInput({
  value, suggestions, placeholder, onlyDictionary, dataField, onChange,
}: {
  value: string[]
  suggestions: string[]
  placeholder: string
  onlyDictionary?: boolean
  dataField: string
  onChange: (v: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  const free = suggestions.filter((s) => !value.includes(s))
  const matching = matchChoices(draft, free)
  const open = focused && !dismissed && draft.trim() !== '' && matching.length > 0
  const nav = useListNav(matching.length)

  const add = (raw: string) => {
    const item = raw.trim()
    if (!item) return
    const dict = suggestions.find((s) => s.toLocaleLowerCase('ru-RU') === item.toLocaleLowerCase('ru-RU'))
    if (onlyDictionary && !dict) return
    const v = dict ?? item
    if (!value.includes(v)) onChange([...value, v])
    setDraft('')
    setDismissed(false)
  }

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-1 flex flex-wrap gap-1">
          {value.map((item) => (
            <li key={item} className="flex items-center gap-1 rounded-full bg-canvas px-2 py-1 text-xs text-ink">
              {item}
              <button type="button" aria-label={`Убрать ${item}`} className="text-danger" onClick={() => onChange(value.filter((x) => x !== item))}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative flex gap-1">
        <input
          data-field={dataField}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${dataField}-list`}
          autoComplete="off"
          className={inputClass}
          value={draft}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => { window.setTimeout(() => setFocused(false), 120) }}
          onChange={(e) => {
            setDraft(e.target.value)
            setDismissed(false)
          }}
          onKeyDown={(e) => {
            if (nav.onKey(e, open, (i) => add(matching[i]), () => setDismissed(true))) return
            if (open && e.key === 'Tab') return
            if ((e.key === 'Enter' || e.key === ',') && draft.trim() !== '') {
              e.preventDefault()
              add(draft)
              return
            }
            if (e.key === 'Backspace' && draft === '' && value.length > 0) onChange(value.slice(0, -1))
          }}
        />
        <button type="button" tabIndex={-1} aria-label="Добавить" className="rounded-md border border-line px-2" onClick={() => add(draft)}>+</button>
        {open && <Suggest id={`${dataField}-list`} items={matching.map((m) => ({ key: m, label: m }))} active={nav.active} onPick={(i) => add(matching[i])} />}
      </div>
      {draft === '' && free.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {free.slice(0, 5).map((item) => (
            <button key={item} type="button" tabIndex={-1} className="rounded-full border border-line px-2 py-0.5 text-xs text-muted hover:text-ink" onClick={() => add(item)}>{item}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export function PriceInput({
  label, value, agreed, terms, required, onChange, onAgreedChange, onTermsChange,
}: {
  label: string
  value: string
  agreed: boolean
  terms: string
  required?: boolean
  onChange: (v: string) => void
  onAgreedChange: (v: boolean) => void
  onTermsChange: (v: string) => void
}) {
  return (
    <div className="grid gap-1 text-sm text-muted">
      <div className="flex items-center justify-between gap-2">
        <span>
          {agreed ? 'Согласованная цена' : label}
          {(required || agreed) && <span className="ml-1 text-danger">*</span>}
        </span>
        <button type="button" role="switch" aria-checked={agreed} onClick={() => onAgreedChange(!agreed)} className="flex items-center gap-2 text-xs text-ink">
          <span className={`relative h-5 w-9 rounded-full transition-colors ${agreed ? 'bg-accent' : 'bg-line-strong'}`}>
            <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform ${agreed ? 'translate-x-4' : ''}`} />
          </span>
          Согласована
        </button>
      </div>
      <input
        data-field="approximatePrice"
        className={inputClass}
        inputMode={agreed ? 'decimal' : 'text'}
        placeholder={agreed ? 'Например, 4500' : 'Например, 3000–4500'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {agreed && (
        <>
          <textarea data-field="priceTerms" rows={2} className={inputClass} placeholder="Что именно сделаем за эту сумму" value={terms} onChange={(e) => onTermsChange(e.target.value)} />
          <span className="text-xs text-muted">Цена зафиксирована с клиентом — её увидят в акте и на странице отслеживания</span>
        </>
      )}
    </div>
  )
}

export type CashRegister = { id: number; location_id: number | null; name: string; accepts_cash: boolean; accepts_bank: boolean }

export function PrepaymentInput({
  enabled, amount, method, registerId, registers, onEnabledChange, onAmountChange, onMethodChange, onRegisterChange,
}: {
  enabled: boolean
  amount: string
  method: 'cash' | 'bank'
  registerId: string
  registers: CashRegister[]
  onEnabledChange: (v: boolean) => void
  onAmountChange: (v: string) => void
  onMethodChange: (v: 'cash' | 'bank') => void
  onRegisterChange: (v: string) => void
}) {
  const suitable = registers.filter((r) => (method === 'cash' ? r.accepts_cash : r.accepts_bank))
  const suitableKey = suitable.map((r) => r.id).join(',')

  // Касса подставляется сама; сменили способ оплаты — берём подходящую
  useEffect(() => {
    if (!enabled) return
    if (!suitable.some((r) => String(r.id) === registerId)) onRegisterChange(suitable[0] ? String(suitable[0].id) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, suitableKey, registerId])

  const amountRef = useRef<HTMLInputElement>(null)
  const prevEnabled = useRef(enabled)
  useEffect(() => {
    if (enabled && !prevEnabled.current) amountRef.current?.focus()
    prevEnabled.current = enabled
  }, [enabled])

  return (
    <div className="grid gap-2 text-sm text-muted">
      <label className="flex items-center gap-2 text-ink">
        <input type="checkbox" data-field="prepayment" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
        Предоплата
      </label>
      {enabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={amountRef}
            data-field="prepaymentAmount"
            inputMode="decimal"
            aria-label="Сумма предоплаты"
            placeholder="Сумма, ₽"
            className={`${inputClass} max-w-40`}
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
          />
          <div role="radiogroup" aria-label="Способ оплаты" className="inline-flex overflow-hidden rounded-md border border-line">
            {(['cash', 'bank'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => onMethodChange(m)}
                className={`px-3 py-2 ${method === m ? 'bg-accent text-accent-ink' : 'bg-surface text-ink'}`}
              >
                {m === 'cash' ? 'Наличные' : 'Карта'}
              </button>
            ))}
          </div>
          {suitable.length > 1 && (
            <select aria-label="Касса" className={`${inputClass} max-w-56`} value={registerId} onChange={(e) => onRegisterChange(e.target.value)}>
              {suitable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {suitable.length === 0 && <span className="text-danger">Нет кассы для этого способа оплаты</span>}
        </div>
      )}
    </div>
  )
}
