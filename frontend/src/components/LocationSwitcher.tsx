import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { getCurrentLocation, setCurrentLocation, useCurrentLocation } from '../currentLocation'
import { shortLocation } from '../pages/shared'

type Loc = { id: number; name: string; color: string }

let cache: Promise<Loc[]> | null = null
const loadLocations = () => (cache ??= api.get<Loc[]>('/locations').catch(() => { cache = null; return [] }))

/** Переключатель локации как в LiveSklad: у каждой точки свой цвет, выбор запоминается. */
export default function LocationSwitcher({ className = '' }: { className?: string }) {
  const [locations, setLocations] = useState<Loc[]>([])
  const [open, setOpen] = useState(false)
  const current = useCurrentLocation()
  const [params, setParams] = useSearchParams()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadLocations().then((list) => {
      setLocations(list)
      // первый вход: как в LiveSklad, открываем первую локацию
      if (list.length && getCurrentLocation() === null) setCurrentLocation(String(list[0].id))
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (locations.length < 2) return null
  const active = locations.find((l) => String(l.id) === current)
  const color = active?.color ?? '#667085'

  const choose = (id: string) => {
    setCurrentLocation(id)
    setOpen(false)
    if (params.has('location_id')) {
      const next = new URLSearchParams(params)
      next.delete('location_id')
      next.delete('page')
      setParams(next, { replace: true })
    }
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Локация: ${active ? shortLocation(active.name) : 'Все локации'}`}
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold"
        style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)` }}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="truncate">{active ? shortLocation(active.name) : 'Все локации'}</span>
        <span aria-hidden className="text-muted">▾</span>
      </button>
      {open && (
        <ul role="listbox" className="absolute left-0 z-50 mt-1 min-w-[14rem] rounded-lg border border-line bg-surface p-1 shadow-xl">
          {locations.map((l) => (
            <li key={l.id} role="option" aria-selected={String(l.id) === current}>
              <button type="button" onClick={() => choose(String(l.id))} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-canvas ${String(l.id) === current ? 'font-semibold' : ''}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} aria-hidden />
                {l.name}
              </button>
            </li>
          ))}
          <li role="option" aria-selected={current === ''}>
            <button type="button" onClick={() => choose('')} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-canvas ${current === '' ? 'font-semibold' : ''}`}>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-muted" aria-hidden />
              Все локации
            </button>
          </li>
        </ul>
      )}
    </div>
  )
}
