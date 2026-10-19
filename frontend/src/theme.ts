/** Режим оформления: auto (как в телефоне) · light · dark · glass. Хранится на устройстве. */
export type ThemeMode = 'auto' | 'light' | 'dark' | 'glass'

const KEY = 'theme'
const META: Record<string, string> = { light: '#eef0f3', dark: '#0e1013', glass: '#0b0c0e' }

export function getMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'glass' || v === 'auto') return v
  } catch { /* приватный режим */ }
  return 'auto'
}

export function resolve(mode: ThemeMode): 'light' | 'dark' | 'glass' {
  if (mode !== 'auto') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(mode: ThemeMode) {
  const theme = resolve(mode)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META[theme])
}

/** Сменить режим. from — точка, откуда раскрывается новая тема (кнопка, на которую нажали). */
export function setMode(mode: ThemeMode, from?: { x: number; y: number }) {
  try { localStorage.setItem(KEY, mode) } catch { /* приватный режим */ }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce || resolve(mode) === document.documentElement.dataset.theme) {
    apply(mode)
    return
  }
  const root = document.documentElement
  if (from) {
    root.style.setProperty('--tx', `${from.x}px`)
    root.style.setProperty('--ty', `${from.y}px`)
    const r = Math.hypot(Math.max(from.x, innerWidth - from.x), Math.max(from.y, innerHeight - from.y))
    root.style.setProperty('--tr', `${r}px`)
  }
  doc.startViewTransition(() => apply(mode))
}

/** Режим «как в телефоне» следит за системой и после загрузки. */
export function watchSystem() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getMode() === 'auto') apply('auto')
  })
}
