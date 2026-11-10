import { useAuth } from '../auth'
import { ALL_TIPS_OFF, type PageTip as Tip } from '../tips'

/** Карточка «Что здесь» вверху страницы. Показывается при первом заходе, потом открывается кнопкой «?». */
export default function PageTip({ tip, onClose, onTour }: { tip: Tip; onClose: () => void; onTour: () => void }) {
  const { markTip } = useAuth()
  const done = () => {
    markTip(tip.id)
    onClose()
  }
  // Дизайн v2: подсказка компактная — пункты в две колонки, кнопки в одну строку; не съедает треть экрана
  return (
    <section className="mb-4 rounded-xl border border-accent-line bg-accent-soft px-4 py-3" aria-label={`Подсказка: ${tip.title}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Что здесь: {tip.title}</h2>
        <button type="button" onClick={done} aria-label="Закрыть подсказку" className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-md text-xl leading-none text-ink-2 hover:bg-surface hover:text-ink">×</button>
      </div>
      <ul className="mt-1 grid list-disc gap-x-8 gap-y-1 pl-5 text-[13px] leading-relaxed text-ink md:grid-cols-2">
        {tip.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      {tip.warning && <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-ink"><b className="text-warning">Важно. </b>{tip.warning}</p>}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={done} className="h-8 rounded-md bg-accent px-3.5 text-[13px] font-semibold text-accent-ink">Понятно</button>
        <button type="button" onClick={onTour} className="text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">Экскурсия по CRM</button>
        <button type="button" onClick={() => { markTip(ALL_TIPS_OFF); onClose() }} className="text-[13px] text-ink-2 underline-offset-2 hover:text-ink hover:underline">Больше не показывать подсказки</button>
      </div>
    </section>
  )
}
