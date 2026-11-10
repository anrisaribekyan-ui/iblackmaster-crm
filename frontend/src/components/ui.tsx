/**
 * Дизайн-система v2 — базовые кирпичики интерфейса. Страницы собираются из них и задают только раскладку.
 * Цвета, радиусы и тени — токены из index.css (светлая, тёмная и «Стекло» — те же компоненты, другие значения).
 *
 * Шкала размеров (других в новых экранах не используем):
 *   текст    12 подписи · 13 вторичное · 14 основной · 16 важное в строке · 20 заголовок блока · 26 заголовок страницы
 *   высоты   26 плашка · 32 малая кнопка · 36 кнопка и поле · 44 строка списка и касание на телефоне
 *   отступы  4 · 8 · 12 · 16 · 24 · 32
 */
import { useEffect, useState, type ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'soft'
type ButtonSize = 'sm' | 'md'

const BTN_BASE = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium disabled:opacity-50'
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent font-semibold text-accent-ink',
  secondary: 'border border-line bg-surface text-ink',
  ghost: 'text-ink-2 hover:bg-line-soft hover:text-ink',
  dark: 'bg-ink font-semibold text-surface',
  soft: 'border border-accent-line bg-accent-soft font-semibold text-accent-strong',
}
const BTN_SIZE: Record<ButtonSize, string> = { sm: 'h-8 px-2.5 text-[13px]', md: 'h-9 px-3.5 text-sm' }

/** Классы кнопки — чтобы одинаково выглядели и <button>, и <Link>. */
export function btn(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = ''): string {
  return `${BTN_BASE} ${BTN_VARIANT[variant]} ${BTN_SIZE[size]} ${extra}`
}

/** Единое поле ввода и выпадающий список. */
export const field = 'h-9 rounded-md border border-line bg-surface px-3 text-sm'

/** Шапка страницы: заголовок слева, действия справа. */
export function PageHeader({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-2">
      <h1 className="text-[22px] font-bold leading-tight md:text-[26px]">{title}</h1>
      {aside}
      <div className="ml-auto flex flex-wrap items-center gap-1.5">{children}</div>
    </header>
  )
}

/** Карточка-блок. */
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-line bg-surface shadow-[var(--shadow-card)] ${className}`}>{children}</div>
}

type Tone = 'neutral' | 'danger' | 'success' | 'warning' | 'accent'
const TONE: Record<Tone, string> = {
  neutral: 'bg-line-soft text-ink-2',
  danger: 'bg-danger-soft text-danger',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  accent: 'bg-accent-soft text-accent-strong',
}

/** Маленькая метка: «долг», «оплачен», «срочный». */
export function Tag({ tone = 'neutral', className = '', children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-[6px] px-1.5 py-px text-[11.5px] font-semibold leading-[18px] ${TONE[tone]} ${className}`}>{children}</span>
}

/** Плитка с цифрой над списком. Кликабельная — работает как быстрый фильтр. */
export function Stat({ label, value, hint, tone = 'neutral', active = false, onClick }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'neutral' | 'danger'; active?: boolean; onClick?: () => void }) {
  const danger = tone === 'danger'
  const box = `flex min-w-0 flex-col gap-0.5 rounded-xl border px-4 py-3 text-left ${danger ? 'border-accent-line bg-danger-soft' : 'border-line bg-surface'} ${active ? 'ring-2 ring-ink/80' : ''}`
  const body = (
    <>
      <span className={`truncate text-xs font-medium ${danger ? 'text-accent-strong' : 'text-muted'}`}>{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={`num text-2xl font-bold leading-7 tracking-tight ${danger ? 'text-accent-strong' : 'text-ink'}`}>{value}</span>
        {hint != null && <span className={`truncate text-xs ${danger ? 'text-accent-strong' : 'text-muted'}`}>{hint}</span>}
      </span>
    </>
  )
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={active} className={`${box} hover:border-line-strong`}>{body}</button>
    : <div className={box}>{body}</div>
}

export type TabItem = { key: string; label: string; count?: number | null; onEdit?: () => void }

/** Вкладки с подчёркиванием и счётчиками. На узком экране прокручиваются пальцем. */
export function Tabs({ items, value, onChange, label, after }: { items: TabItem[]; value: string; onChange: (key: string) => void; label: string; after?: ReactNode }) {
  return (
    <nav aria-label={label} className="flex items-end gap-0.5 overflow-x-auto border-b border-line">
      {items.map((item) => {
        const on = item.key === value
        return (
          <span key={item.key} className={`-mb-px flex shrink-0 items-center border-b-2 ${on ? 'border-accent' : 'border-transparent'}`}>
            <button
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => onChange(item.key)}
              className={`flex h-10 items-center gap-1.5 whitespace-nowrap px-3 text-sm md:h-[38px] ${on ? 'font-semibold text-ink' : 'font-medium text-ink-2 hover:text-ink'}`}
            >
              {item.label}
              {item.count != null && (
                <span className={`num rounded-full px-1.5 text-xs font-medium leading-[18px] ${on ? 'bg-accent-soft text-accent-strong' : 'bg-line-soft text-ink-2'}`}>{item.count.toLocaleString('ru-RU')}</span>
              )}
            </button>
            {item.onEdit && (
              <button type="button" aria-label={`Изменить вкладку ${item.label}`} title="Изменить" onClick={item.onEdit} className="-ml-1.5 grid h-8 w-6 place-items-center text-xs text-muted hover:text-ink">✎</button>
            )}
          </span>
        )
      })}
      {after}
    </nav>
  )
}

/** Скелетон плотного списка: те же высоты строк, что у настоящего, — страница не прыгает при загрузке. */
export function ListSkeleton({ rows = 12, rowHeight = 44 }: { rows?: number; rowHeight?: number }) {
  return (
    <div role="status" aria-label="Загрузка" className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="h-8 border-b border-line-soft bg-head" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line-soft px-4 md:px-5" style={{ height: rowHeight }}>
          <span className="ui-skel h-4 w-16" />
          <span className="ui-skel h-5 w-28" />
          <span className="ui-skel h-4 flex-1" style={{ maxWidth: `${55 - (i % 4) * 9}%` }} />
          <span className="ui-skel hidden h-4 w-32 md:block" />
          <span className="ui-skel ml-auto h-4 w-16" />
        </div>
      ))}
    </div>
  )
}

/** Пустое состояние списка. */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line-strong bg-surface px-5 py-8 text-center text-muted">{children}</p>
}

/** Срабатывает ли медиазапрос. Нужен, чтобы рисовать только одну раскладку (телефон или компьютер), а не обе. */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatch(list.matches)
    onChange()
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return match
}
