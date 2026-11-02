import { useAuth } from '../auth'
import { ALL_TIPS_OFF, type PageTip as Tip } from '../tips'

/** Карточка «Что здесь» вверху страницы. Показывается при первом заходе, потом открывается кнопкой «?». */
export default function PageTip({ tip, onClose, onTour }: { tip: Tip; onClose: () => void; onTour: () => void }) {
  const { markTip } = useAuth()
  const done = () => {
    markTip(tip.id)
    onClose()
  }
  return (
    <section className="mb-4 rounded-xl border border-accent/40 border-l-4 border-l-accent bg-surface p-4 shadow-sm" aria-label={`Подсказка: ${tip.title}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">Что здесь: {tip.title}</h2>
        <button type="button" onClick={done} aria-label="Закрыть подсказку" className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-xl leading-none text-muted hover:bg-canvas hover:text-ink">×</button>
      </div>
      <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-sm leading-relaxed">
        {tip.items.map((item) => <li key={item}>{item}</li>)}
      </ul>
      {tip.warning && <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"><b>Важно. </b>{tip.warning}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={done} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink">Понятно</button>
        <button type="button" onClick={onTour} className="text-sm text-muted hover:text-ink">Экскурсия по CRM</button>
        <button type="button" onClick={() => { markTip(ALL_TIPS_OFF); onClose() }} className="text-sm text-muted hover:text-ink">Больше не показывать подсказки</button>
      </div>
    </section>
  )
}
