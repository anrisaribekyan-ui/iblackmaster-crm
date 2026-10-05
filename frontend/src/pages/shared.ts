import { useEffect, useState } from 'react'
import { api } from '../api/client'

/** Общие типы и загрузчики для экранов склада и продаж. */

export const inputClass = 'w-full rounded-md border border-line bg-surface px-3 py-2'

export type StoreRef = { id: number; name: string; is_default: boolean }
export type LocationRef = { id: number; name: string; color: string; stores: StoreRef[] }
export type CashRegisterRef = { id: number; name: string; location_id: number | null; accepts_cash: boolean; accepts_bank: boolean }
export type CatalogItem = {
  id: number
  code: number
  article: string | null
  name: string
  is_work: boolean
  purchase_price: string | null
  prices: { price_type_id: number; name: string; price: string }[]
  stock_quantity: string | null
}

export function money(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`
}

export function qty(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 3 })
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(d)
}

/** Первая розничная цена товара (или 0). */
export function retailPrice(item: CatalogItem): string {
  return item.prices.find((p) => p.name === 'Розничная')?.price ?? item.prices[0]?.price ?? '0'
}

/** Локации со складами и кассы, доступные сотруднику. */
export function useLocationsAndRegisters() {
  const [locations, setLocations] = useState<LocationRef[]>([])
  const [registers, setRegisters] = useState<CashRegisterRef[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    Promise.all([api.get<LocationRef[]>('/locations'), api.get<CashRegisterRef[]>('/cash-registers')])
      .then(([locs, regs]) => {
        setLocations(locs)
        setRegisters(regs)
      })
      .catch(() => setError('Не удалось загрузить локации и кассы'))
  }, [])
  return { locations, registers, error }
}
