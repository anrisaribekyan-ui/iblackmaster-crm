import { useState } from 'react'
import { useAuth } from '../auth'
import Modal from './Modal'
import { ALL_TIPS_OFF, TOUR, TOUR_ID } from '../tips'

/** Экскурсия по CRM: показывается один раз при первом входе, потом по кнопке «?». */
export default function Tour({ onClose }: { onClose: () => void }) {
  const { me, can, markTip } = useAuth()
  const steps = TOUR.filter((s) => !s.permission || can(s.permission))
  const [index, setIndex] = useState(0)
  const step = steps[index]
  const last = index === steps.length - 1

  const finish = () => {
    markTip(TOUR_ID)
    onClose()
  }
  const skipEverything = () => {
    markTip(ALL_TIPS_OFF)
    finish()
  }

  return (
    <Modal title={index === 0 && me ? `${step.title}, ${me.short_name}` : step.title} onClose={finish}>
      <div className="grid gap-4">
        <ul className="grid gap-3 text-[15px] leading-relaxed">
          {step.body.map((line) => <li key={line}>{line}</li>)}
        </ul>
        {step.warning && <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{step.warning}</p>}
        <div className="flex items-center justify-center gap-1.5" aria-label={`Шаг ${index + 1} из ${steps.length}`}>
          {steps.map((_, i) => <span key={i} className={`h-1.5 rounded-full ${i === index ? 'w-6 bg-accent' : 'w-1.5 bg-line'}`} />)}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="px-1 text-sm text-muted hover:text-ink" onClick={index === 0 ? skipEverything : () => setIndex(index - 1)}>
            {index === 0 ? 'Не показывать подсказки' : 'Назад'}
          </button>
          <button type="button" className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-accent-ink" onClick={last ? finish : () => setIndex(index + 1)} autoFocus>
            {last ? 'Начать работу' : 'Дальше'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
