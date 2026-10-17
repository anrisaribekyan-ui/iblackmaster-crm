import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'

/** Вся строка списка открывает заказ (а не только номер). Ctrl/⌘/средняя кнопка — в новой вкладке.
 *  Клик по кнопке, ссылке или полю внутри строки работает как обычно и строку не открывает. */
export function useRowLink() {
  const navigate = useNavigate()
  return (to: string) => ({
    onClick: (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('a, button, input, select, textarea, label')) return
      if (event.metaKey || event.ctrlKey) window.open(to, '_blank')
      else navigate(to)
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1) window.open(to, '_blank')
    },
    className: 'cursor-pointer',
  })
}
