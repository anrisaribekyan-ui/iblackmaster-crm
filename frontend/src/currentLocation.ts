import { useSyncExternalStore } from 'react'

const KEY = 'crm:location'
const listeners = new Set<() => void>()

/** '' — «Все локации»; null — выбор ещё не делали (подставим первую при загрузке списка). */
export function getCurrentLocation(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setCurrentLocation(id: string) {
  try { localStorage.setItem(KEY, id) } catch { /* приватный режим */ }
  listeners.forEach((l) => l())
}

/** Текущая локация (id строкой), запоминается между сессиями. */
export function useCurrentLocation(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb) } },
    () => getCurrentLocation() ?? '',
  )
}
