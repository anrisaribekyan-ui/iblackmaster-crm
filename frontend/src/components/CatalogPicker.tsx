import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { inputClass, qty, type CatalogItem } from '../pages/shared'

/** Поиск товара/работы для документов склада и чеков. onlyProducts — скрыть работы. */
export default function CatalogPicker({
  locationId,
  onlyProducts = false,
  onPick,
}: {
  locationId: string
  onlyProducts?: boolean
  onPick: (item: CatalogItem) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<CatalogItem[] | null>(null)
  const [error, setError] = useState('')

  // Без <form>: компонент стоит внутри формы документа, а вложенные формы браузер не поддерживает.
  const search = async () => {
    if (!locationId) {
      setError('Сначала выберите локацию')
      return
    }
    setError('')
    try {
      const found = await api.get<CatalogItem[]>(`/nomenclature/search?q=${encodeURIComponent(q)}&location_id=${locationId}`)
      setResults(onlyProducts ? found.filter((i) => !i.is_work) : found)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось выполнить поиск')
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          className={`${inputClass} min-w-0 flex-1`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void search()
            }
          }}
          placeholder="Название, артикул или код"
        />
        <button type="button" className="rounded-md border border-line bg-surface px-3 py-2" onClick={() => void search()}>Найти</button>
      </div>
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      {results && (
        results.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Ничего не найдено. Добавьте позицию в «Справочники → Товары».</p>
        ) : (
          <ul className="mt-2 max-h-64 divide-y divide-line overflow-auto rounded-md border border-line bg-surface">
            {results.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-canvas"
                  onClick={() => {
                    onPick(item)
                    setResults(null)
                    setQ('')
                  }}
                >
                  <span>{item.name}<small className="ml-2 text-muted">{item.article ?? `код ${item.code}`}</small></span>
                  <span className="text-xs text-muted">{item.is_work ? 'Работа' : `в наличии ${qty(item.stock_quantity)}`}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}
