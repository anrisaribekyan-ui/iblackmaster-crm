/** Общие типы для раздела «Доски» (backend/app/api/boards.py). */

export type CardShort = {
  id: number
  column_id: number
  title: string
  color: string | null
  sort: number
  assignee_id: number | null
  assignee_name: string | null
  deadline: string | null
  order_id: number | null
  order_number: string | null
  has_text: boolean
  checklist_done: number
  checklist_total: number
  comments: number
}

export type Column = { id: number; name: string; sort: number; cards: CardShort[] }
export type Board = { id: number; name: string; sort: number; columns: Column[] }
export type SpaceDetail = { id: number; name: string; location_id: number | null; boards: Board[] }
export type SpaceRef = { id: number; name: string; location_id: number | null; sort: number; cards: number }

export type ChecklistItem = { text: string; done: boolean }
export type Comment = { id: number; author_name: string | null; text: string; created_at: string }

export type CardDetail = CardShort & {
  text: string | null
  checklist: ChecklistItem[]
  author_name: string | null
  board_id: number
  column_name: string
  created_at: string
  updated_at: string
  comment_list: Comment[]
}

export type EmployeeShort = { id: number; short_name: string }

/** Цвета карточки (6–8 кружков в модалке). Первый — по умолчанию (фиолетовый, как в Kaiten). */
export const CARD_COLORS = ['#9c27b0', '#e64823', '#12a150', '#1d4ed8', '#d92d20', '#f59e0b', '#0ea5e9', '#6b7280']
