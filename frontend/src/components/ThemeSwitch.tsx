import { useState, type MouseEvent } from 'react'
import Icon from './icons'
import { getMode, setMode, type ThemeMode } from '../theme'

const MODES: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: 'auto', icon: 'auto', label: 'Как в системе' },
  { mode: 'light', icon: 'sun', label: 'Светлая' },
  { mode: 'dark', icon: 'moon', label: 'Тёмная' },
  { mode: 'glass', icon: 'glass', label: 'Стекло' },
]

/** Переключатель оформления в меню: четыре режима, текущий подсвечен, новая тема раскрывается от кнопки. */
export default function ThemeSwitch() {
  const [mode, set] = useState<ThemeMode>(getMode)
  const choose = (next: ThemeMode, event: MouseEvent<HTMLButtonElement>) => {
    const r = event.currentTarget.getBoundingClientRect()
    set(next)
    setMode(next, { x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }
  return (
    <div className="mx-3 mb-2 flex items-center gap-1 rounded-lg bg-rail-hover/60 p-1" role="radiogroup" aria-label="Оформление">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          role="radio"
          aria-checked={mode === m.mode}
          title={m.label}
          onClick={(e) => choose(m.mode, e)}
          className={`grid h-8 flex-1 place-items-center rounded-md ${mode === m.mode ? 'bg-white/10 text-white' : 'text-rail-muted hover:text-white'}`}
        >
          <Icon name={m.icon} className="h-4 w-4" />
          <span className="sr-only">{m.label}</span>
        </button>
      ))}
    </div>
  )
}
