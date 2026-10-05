import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth'
import Modal from '../components/Modal'
import { formatDateTime, inputClass } from './shared'
import { LAST_SPACE_KEY } from './BoardsPage'
import CardModal from './CardModal'
import type { Board, CardShort, Column, EmployeeShort, SpaceDetail, SpaceRef } from './boardsTypes'

type SearchResult = { id: number; title: string; space_id: number; space_name: string; board_name: string; column_name: string }
type MenuState = { kind: 'board' | 'column' | 'card'; id: number; name: string } | null
type RenameState = { kind: 'board' | 'column'; id: number; name: string } | null

// --- чистые помощники --------------------------------------------------------------

function cardIdOf(id: UniqueIdentifier): number {
  return Number(String(id).replace('card-', ''))
}

function findColumnByCard(space: SpaceDetail, cardId: number): Column | null {
  for (const board of space.boards) for (const col of board.columns) if (col.cards.some((c) => c.id === cardId)) return col
  return null
}

function findColumnById(space: SpaceDetail, columnId: number): Column | null {
  for (const board of space.boards) for (const col of board.columns) if (col.id === columnId) return col
  return null
}

function findBoardOfColumn(space: SpaceDetail, columnId: number): Board | null {
  return space.boards.find((b) => b.columns.some((c) => c.id === columnId)) ?? null
}

function allColumns(space: SpaceDetail): { id: number; name: string; boardName: string }[] {
  return space.boards.flatMap((b) => b.columns.map((c) => ({ id: c.id, name: c.name, boardName: b.name })))
}

function moveCardLocal(space: SpaceDetail, cardId: number, toColumnId: number, toIndex: number): SpaceDetail {
  let moving: CardShort | null = null
  const boards = space.boards.map((board) => ({
    ...board,
    columns: board.columns.map((col) => {
      const idx = col.cards.findIndex((c) => c.id === cardId)
      if (idx === -1) return col
      moving = col.cards[idx]
      return { ...col, cards: col.cards.filter((c) => c.id !== cardId) }
    }),
  }))
  if (!moving) return space
  return {
    ...space,
    boards: boards.map((board) => ({
      ...board,
      columns: board.columns.map((col) => {
        if (col.id !== toColumnId) return col
        const cards = [...col.cards]
        const clamped = Math.max(0, Math.min(toIndex, cards.length))
        cards.splice(clamped, 0, moving as CardShort)
        return { ...col, cards }
      }),
    })),
  }
}

function resolveOver(space: SpaceDetail, overId: UniqueIdentifier): { columnId: number; index: number } | null {
  const s = String(overId)
  if (s.startsWith('column-')) {
    const col = findColumnById(space, Number(s.slice('column-'.length)))
    return col ? { columnId: col.id, index: col.cards.length } : null
  }
  if (s.startsWith('card-')) {
    const cardId = Number(s.slice('card-'.length))
    const col = findColumnByCard(space, cardId)
    return col ? { columnId: col.id, index: col.cards.findIndex((c) => c.id === cardId) } : null
  }
  return null
}

function isOverdue(deadline: string): boolean {
  return new Date(deadline).getTime() < Date.now()
}

function loadList(key: string): number[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(Number).filter((n) => !Number.isNaN(n)) : []
  } catch {
    return []
  }
}

function saveList(key: string, list: number[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch {
    /* приватный режим — не запоминаем */
  }
}

// --- карточка (перетаскиваемая) ----------------------------------------------------

function SortableCard({ card, onOpen, onMenu }: { card: CardShort; onOpen: () => void; onMenu: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `card-${card.id}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const overdue = card.deadline ? isOverdue(card.deadline) : false
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className="cursor-pointer rounded-lg border border-line bg-surface shadow-sm"
    >
      <div className="h-1.5 rounded-t-lg" style={{ backgroundColor: card.color || '#9c27b0' }} />
      <div className="p-2">
        <div className="flex items-start justify-between gap-1">
          <p className="whitespace-pre-wrap text-sm">{card.title}</p>
          <button
            type="button"
            aria-label="Меню карточки"
            className="shrink-0 text-muted hover:text-ink"
            onClick={(e) => { e.stopPropagation(); onMenu() }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            ⋮
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {card.assignee_name && <span>{card.assignee_name}</span>}
          {card.deadline && <span className={overdue ? 'font-medium text-danger' : ''}>{formatDateTime(card.deadline)}</span>}
          {card.order_number && <span className="text-accent">{card.order_number}</span>}
          {card.checklist_total > 0 && <span>☑ {card.checklist_done}/{card.checklist_total}</span>}
          {card.comments > 0 && <span>💬 {card.comments}</span>}
        </div>
      </div>
    </div>
  )
}

// --- поле «Сформулируйте задачу» ---------------------------------------------------

function QuickAdd({ columnId, onAdded }: { columnId: number; onAdded: (card: CardShort) => void }) {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = title.trim()
    if (!value) return
    setTitle('')
    setError('')
    try {
      const card = await api.post<CardShort>(`/boards/columns/${columnId}/cards`, { title: value })
      onAdded(card)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать карточку')
    }
    ref.current?.focus()
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-auto">
      <input
        ref={ref}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Сформулируйте задачу"
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </form>
  )
}

// --- колонка -----------------------------------------------------------------------

function ColumnView({
  column,
  collapsed,
  onToggleCollapse,
  onMenu,
  onOpenCard,
  onCardMenu,
  onAdded,
}: {
  column: Column
  collapsed: boolean
  onToggleCollapse: () => void
  onMenu: () => void
  onOpenCard: (id: number) => void
  onCardMenu: (card: CardShort) => void
  onAdded: (card: CardShort) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${column.id}` })
  return (
    <div
      ref={setNodeRef}
      className={`flex w-[85vw] shrink-0 snap-start flex-col rounded-xl border border-line bg-canvas sm:w-72 ${isOver ? 'ring-2 ring-accent' : ''}`}
    >
      <header className="flex items-center gap-1 border-b border-line px-2 py-2">
        <span className="flex-1 truncate font-medium">{column.name}</span>
        <span className="text-xs text-muted">{column.cards.length}</span>
        <button type="button" aria-label="Меню колонки" className="text-muted hover:text-ink" onClick={onMenu}>⋮</button>
        <button type="button" aria-label="Свернуть" className="text-muted hover:text-ink" onClick={onToggleCollapse}>
          {collapsed ? '▾' : '▴'}
        </button>
      </header>
      {!collapsed && (
        <div className="flex max-h-[70vh] flex-1 flex-col gap-2 overflow-y-auto p-2">
          <SortableContext items={column.cards.map((c) => `card-${c.id}`)} strategy={verticalListSortingStrategy}>
            {column.cards.map((card) => (
              <SortableCard key={card.id} card={card} onOpen={() => onOpenCard(card.id)} onMenu={() => onCardMenu(card)} />
            ))}
          </SortableContext>
          <QuickAdd columnId={column.id} onAdded={onAdded} />
        </div>
      )}
    </div>
  )
}

export default function BoardPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const { spaceId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const canCreate = can('createTaskAccess')

  const [space, setSpace] = useState<SpaceDetail | null>(null)
  const [spaces, setSpaces] = useState<SpaceRef[]>([])
  const [employees, setEmployees] = useState<EmployeeShort[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const [collapsedBoards, setCollapsedBoards] = useState<number[]>(() => loadList('boards_collapsed_boards'))
  const [collapsedColumns, setCollapsedColumns] = useState<number[]>(() => loadList('boards_collapsed_columns'))

  const [menu, setMenu] = useState<MenuState>(null)
  const [rename, setRename] = useState<RenameState>(null)
  const [addMenu, setAddMenu] = useState(false)
  const [newBoard, setNewBoard] = useState(false)
  const [newColumn, setNewColumn] = useState(false)
  const [moveCard, setMoveCard] = useState<{ id: number; name: string } | null>(null)

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])

  const openCardId = searchParams.get('card')
  const draggingRef = useRef(false)
  const modalOpenRef = useRef(false)
  modalOpenRef.current = !!openCardId
  const spaceRef = useRef<SpaceDetail | null>(null)
  spaceRef.current = space

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  )

  const load = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      setSpace(await api.get<SpaceDetail>(`/boards/spaces/${spaceId}`))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить доску')
      setSpace(null)
    } finally {
      setLoading(false)
    }
  }, [spaceId])

  useEffect(() => {
    api.get<SpaceRef[]>('/boards/spaces').then(setSpaces).catch(() => setSpaces([]))
    api.get<EmployeeShort[]>('/employees/short').then(setEmployees).catch(() => setEmployees([]))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!modalOpenRef.current && !draggingRef.current) void load()
    }, 30000)
    return () => clearInterval(timer)
  }, [load])

  const changeSpace = (id: number) => {
    try {
      localStorage.setItem(LAST_SPACE_KEY, String(id))
    } catch {
      /* ignore */
    }
    navigate(`/boards/${id}`)
  }

  const openCard = (id: number) => setSearchParams({ card: String(id) }, { replace: true })
  const closeCard = () => setSearchParams({}, { replace: true })

  // --- перетаскивание -----------------------------------------------------------

  const onDragStart = () => {
    draggingRef.current = true
  }

  const onDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    const s = spaceRef.current
    if (!s) return
    const activeCardId = cardIdOf(active.id)
    const fromCol = findColumnByCard(s, activeCardId)
    const info = resolveOver(s, over.id)
    if (!fromCol || !info) return
    if (fromCol.id !== info.columnId) return
    const currentIndex = fromCol.cards.findIndex((c) => c.id === activeCardId)
    if (currentIndex === info.index) return
    setSpace((prev) => (prev ? moveCardLocal(prev, activeCardId, info.columnId, info.index) : prev))
  }

  const onDragEnd = (event: DragEndEvent) => {
    draggingRef.current = false
    const { active, over } = event
    const s = spaceRef.current
    if (!s) return
    const activeCardId = cardIdOf(active.id)
    const fromCol = findColumnByCard(s, activeCardId)
    if (!fromCol) return
    let targetColumnId = fromCol.id
    let targetIndex = fromCol.cards.findIndex((c) => c.id === activeCardId)
    if (over && over.id !== active.id) {
      const info = resolveOver(s, over.id)
      if (info) {
        targetColumnId = info.columnId
        targetIndex = info.index
      }
    }
    setSpace((prev) => (prev ? moveCardLocal(prev, activeCardId, targetColumnId, targetIndex) : prev))
    api
      .post(`/boards/cards/${activeCardId}/move`, { column_id: targetColumnId, index: targetIndex })
      .then(() => void load())
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : 'Не удалось переместить карточку')
        void load()
      })
  }

  const addCardToColumn = (card: CardShort) => {
    setSpace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        boards: prev.boards.map((b) => ({
          ...b,
          columns: b.columns.map((c) => (c.id === card.column_id ? { ...c, cards: [...c.cards, card] } : c)),
        })),
      }
    })
  }

  const removeCard = async (id: number) => {
    if (!confirm('Удалить карточку?')) return
    try {
      await api.del(`/boards/cards/${id}`)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить карточку')
    }
  }

  const createBoard = async (name: string) => {
    try {
      await api.post(`/boards/spaces/${spaceId}/boards`, { name })
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать доску')
    }
  }

  const createColumn = async (boardId: number, name: string) => {
    try {
      await api.post(`/boards/${boardId}/columns`, { name })
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать колонку')
    }
  }

  const submitRename = async (name: string) => {
    if (!rename) return
    try {
      if (rename.kind === 'board') await api.put(`/boards/${rename.id}`, { name })
      else await api.put(`/boards/columns/${rename.id}`, { name })
      setRename(null)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переименовать')
    }
  }

  const moveBoard = async (id: number, delta: number) => {
    const s = spaceRef.current
    if (!s) return
    const index = s.boards.findIndex((b) => b.id === id)
    const target = index + delta
    if (index === -1 || target < 0 || target >= s.boards.length) return
    setSpace((prev) => (prev ? { ...prev, boards: arrayMove(prev.boards, index, target) } : prev))
    try {
      await api.post(`/boards/${id}/move`, { index: target })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переместить доску')
    }
    void load()
  }

  const moveColumn = async (id: number, delta: number) => {
    const s = spaceRef.current
    if (!s) return
    const board = findBoardOfColumn(s, id)
    if (!board) return
    const index = board.columns.findIndex((c) => c.id === id)
    const target = index + delta
    if (index === -1 || target < 0 || target >= board.columns.length) return
    setSpace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        boards: prev.boards.map((b) => (b.id === board.id ? { ...b, columns: arrayMove(b.columns, index, target) } : b)),
      }
    })
    try {
      await api.post(`/boards/columns/${id}/move`, { index: target })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переместить колонку')
    }
    void load()
  }

  const deleteBoard = async (id: number) => {
    if (!confirm('Удалить доску со всеми колонками и карточками?')) return
    try {
      await api.del(`/boards/${id}`)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить доску')
    }
  }

  const deleteColumn = async (id: number) => {
    if (!confirm('Удалить колонку?')) return
    try {
      await api.del(`/boards/columns/${id}`)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось удалить колонку')
    }
  }

  const moveCardTo = async (columnId: number) => {
    if (!moveCard) return
    try {
      await api.post(`/boards/cards/${moveCard.id}/move`, { column_id: columnId, index: 0 })
      setMoveCard(null)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось переместить карточку')
    }
  }

  const toggleBoardCollapse = (id: number) => {
    setCollapsedBoards((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      saveList('boards_collapsed_boards', next)
      return next
    })
  }

  const toggleColumnCollapse = (id: number) => {
    setCollapsedColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      saveList('boards_collapsed_columns', next)
      return next
    })
  }

  const runSearch = async (q: string) => {
    setSearchQuery(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    try {
      setSearchResults(await api.get<SearchResult[]>(`/boards/search?q=${encodeURIComponent(q.trim())}`))
    } catch {
      setSearchResults([])
    }
  }

  const openSearchResult = (r: SearchResult) => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults([])
    if (r.space_id === Number(spaceId)) openCard(r.id)
    else navigate(`/boards/${r.space_id}?card=${r.id}`)
  }

  return (
    <section className="flex h-full flex-col">
      <header className="mb-3 flex items-center gap-2">
        <select
          className="rounded-md border border-line bg-surface px-2 py-1.5"
          value={spaceId}
          onChange={(event) => changeSpace(Number(event.target.value))}
        >
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {canCreate && (
          <button type="button" className="rounded-md border border-line bg-surface px-2.5 py-1.5" onClick={() => setAddMenu(true)} aria-label="Создать">
            +
          </button>
        )}
        <button type="button" className="rounded-md border border-line bg-surface px-2.5 py-1.5" onClick={() => setSearchOpen((v) => !v)} aria-label="Поиск">
          🔍
        </button>
        {searchOpen && (
          <div className="relative flex-1">
            <input
              autoFocus
              className="w-full rounded-md border border-line bg-surface px-3 py-1.5"
              placeholder="Поиск по карточкам…"
              value={searchQuery}
              onChange={(event) => void runSearch(event.target.value)}
            />
            {searchResults.length > 0 && (
              <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-md border border-line bg-surface shadow-lg">
                {searchResults.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="w-full px-3 py-2 text-left hover:bg-canvas" onClick={() => openSearchResult(r)}>
                      <span className="block text-sm">{r.title}</span>
                      <span className="block text-xs text-muted">{r.space_name} · {r.board_name} · {r.column_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </header>

      {error && <p role="alert" className="mb-3 text-danger">{error}</p>}

      {loading ? (
        <p className="text-muted">Загрузка…</p>
      ) : space === null ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Доска недоступна.</p>
      ) : space.boards.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface p-5 text-muted">Досок нет. Создайте первую доску кнопкой «+».</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className="flex flex-1 gap-4 overflow-x-auto pb-4 snap-x">
            {space.boards.map((board) => {
              const boardCollapsed = collapsedBoards.includes(board.id)
              return (
                <div key={board.id} className="flex shrink-0 flex-col rounded-xl border border-line bg-surface p-2">
                  <header className="mb-1 flex items-center gap-1 px-1">
                    <span className="flex-1 truncate font-semibold">{board.name}</span>
                    <button type="button" aria-label="Меню доски" className="text-muted hover:text-ink" onClick={() => setMenu({ kind: 'board', id: board.id, name: board.name })}>⋮</button>
                    <button type="button" aria-label="Свернуть" className="text-muted hover:text-ink" onClick={() => toggleBoardCollapse(board.id)}>{boardCollapsed ? '▾' : '▴'}</button>
                  </header>
                  {!boardCollapsed && (
                    <div className="flex gap-3">
                      {board.columns.map((col) => (
                        <ColumnView
                          key={col.id}
                          column={col}
                          collapsed={collapsedColumns.includes(col.id)}
                          onToggleCollapse={() => toggleColumnCollapse(col.id)}
                          onMenu={() => setMenu({ kind: 'column', id: col.id, name: col.name })}
                          onOpenCard={openCard}
                          onCardMenu={(card) => setMenu({ kind: 'card', id: card.id, name: card.title })}
                          onAdded={addCardToColumn}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </DndContext>
      )}

      {menu && (
        <MenuModal
          title={menu.name}
          actions={
            menu.kind === 'card'
              ? [
                  { label: 'Открыть', onClick: () => { setMenu(null); openCard(menu.id) } },
                  { label: 'Переместить в…', onClick: () => { setMoveCard({ id: menu.id, name: menu.name }); setMenu(null) } },
                  { label: 'Удалить', danger: true, onClick: () => { setMenu(null); void removeCard(menu.id) } },
                ]
              : menu.kind === 'board'
                ? [
                    { label: 'Переименовать', onClick: () => { setRename({ kind: 'board', id: menu.id, name: menu.name }); setMenu(null) } },
                    { label: 'Влево', onClick: () => { setMenu(null); void moveBoard(menu.id, -1) } },
                    { label: 'Вправо', onClick: () => { setMenu(null); void moveBoard(menu.id, 1) } },
                    { label: 'Удалить', danger: true, onClick: () => { setMenu(null); void deleteBoard(menu.id) } },
                  ]
                : [
                    { label: 'Переименовать', onClick: () => { setRename({ kind: 'column', id: menu.id, name: menu.name }); setMenu(null) } },
                    { label: 'Влево', onClick: () => { setMenu(null); void moveColumn(menu.id, -1) } },
                    { label: 'Вправо', onClick: () => { setMenu(null); void moveColumn(menu.id, 1) } },
                    { label: 'Удалить', danger: true, onClick: () => { setMenu(null); void deleteColumn(menu.id) } },
                  ]
          }
          onClose={() => setMenu(null)}
        />
      )}

      {addMenu && (
        <MenuModal
          title="Создать"
          actions={[
            { label: 'Новая доска', onClick: () => { setAddMenu(false); setNewBoard(true) } },
            { label: 'Новая колонка', onClick: () => { setAddMenu(false); setNewColumn(true) } },
          ]}
          onClose={() => setAddMenu(false)}
        />
      )}

      {newBoard && (
        <NameModal title="Новая доска" initial="" submitLabel="Создать" onSubmit={createBoard} onClose={() => setNewBoard(false)} />
      )}

      {newColumn && space && (
        <NewColumnModal boards={space.boards} onCreate={createColumn} onClose={() => setNewColumn(false)} />
      )}

      {rename && (
        <NameModal title="Переименовать" initial={rename.name} submitLabel="Сохранить" onSubmit={submitRename} onClose={() => setRename(null)} />
      )}

      {moveCard && space && (
        <MoveCardModal columns={allColumns(space)} title={moveCard.name} onMove={moveCardTo} onClose={() => setMoveCard(null)} />
      )}

      {openCardId && (
        <CardModal cardId={Number(openCardId)} employees={employees} onClose={closeCard} onChanged={() => void load()} />
      )}
    </section>
  )
}

// --- вспомогательные модалки ------------------------------------------------------

type Action = { label: string; danger?: boolean; onClick: () => void }

function MenuModal({ title, actions, onClose }: { title: string; actions: Action[]; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="grid gap-1">
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.onClick} className={`rounded-md px-3 py-2 text-left hover:bg-canvas ${a.danger ? 'text-danger' : ''}`}>
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  )
}

function NameModal({
  title,
  initial,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string
  initial: string
  submitLabel: string
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!value) return
    setError('')
    setSaving(true)
    try {
      await onSubmit(value)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3">
        <input autoFocus className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">
            {saving ? '…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function NewColumnModal({
  boards,
  onCreate,
  onClose,
}: {
  boards: Board[]
  onCreate: (boardId: number, name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [boardId, setBoardId] = useState(boards[0]?.id ?? 0)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = name.trim()
    if (!value || !boardId) return
    setError('')
    setSaving(true)
    try {
      await onCreate(boardId, value)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Новая колонка" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="grid gap-3">
        <input autoFocus className={inputClass} placeholder="Название колонки" value={name} onChange={(event) => setName(event.target.value)} />
        {boards.length > 1 && (
          <select className={inputClass} value={boardId} onChange={(event) => setBoardId(Number(event.target.value))}>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md border border-line px-3 py-2" onClick={onClose}>Отмена</button>
          <button disabled={saving} className="rounded-md bg-accent px-3 py-2 text-accent-ink disabled:opacity-60">
            {saving ? '…' : 'Создать'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function MoveCardModal({
  columns,
  title,
  onMove,
  onClose,
}: {
  columns: { id: number; name: string; boardName: string }[]
  title: string
  onMove: (columnId: number) => Promise<void>
  onClose: () => void
}) {
  return (
    <Modal title={`Переместить «${title}»`} onClose={onClose}>
      <div className="grid gap-1">
        {columns.length === 0 && <p className="text-muted">Нет колонок.</p>}
        {columns.map((c) => (
          <button
            key={c.id}
            type="button"
            className="rounded-md px-3 py-2 text-left hover:bg-canvas"
            onClick={() => void onMove(c.id)}
          >
            <span className="block">{c.name}</span>
            <span className="block text-xs text-muted">{c.boardName}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}







