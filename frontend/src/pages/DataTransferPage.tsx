import { useMemo, useState } from 'react'
import { escapeHtml, openPrint } from '../print'
import { buildGuide, CATEGORIES, DESTS, SOURCES, type Dest, type Source } from '../transferGuide'

/** Перенос данных с телефона: выбираем откуда, куда и что — получаем пошаговую инструкцию, которую можно распечатать клиенту. */
export default function DataTransferPage() {
  const [source, setSource] = useState<Source | null>(null)
  const [dest, setDest] = useState<Dest | null>(null)
  const [cats, setCats] = useState<string[]>([])
  const [client, setClient] = useState('')

  const guide = useMemo(() => (source && dest ? buildGuide(source, dest, cats) : null), [source, dest, cats])
  const sourceTitle = SOURCES.find((s) => s.id === source)?.title ?? ''
  const destTitle = DESTS.find((d) => d.id === dest)?.title ?? ''

  const toggle = (id: string) => setCats((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]))

  const print = () => {
    if (!guide) return
    const list = (items: string[]) => `<ol>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ol>`
    openPrint('Перенос данных', `
      <h1>Перенос данных: ${escapeHtml(sourceTitle)} → ${escapeHtml(destTitle)}</h1>
      ${client ? `<p><b>Клиент:</b> ${escapeHtml(client)}</p>` : ''}
      <h2>Перед началом</h2>${list(guide.before)}
      ${guide.sections.map((s) => `<h2>${escapeHtml(s.title)}</h2>${list(s.steps)}`).join('')}
      <h2>После переноса</h2>${list(guide.after)}
      ${guide.warnings.map((w) => `<p class="muted">${escapeHtml(w)}</p>`).join('')}
      <div class="signatures"><div class="signature">Мастер</div><div class="signature">Клиент: данные перенесены и проверены</div></div>
    `)
  }

  const pick = 'rounded-xl border p-3 text-left transition-colors'
  const chip = (on: boolean) => `${pick} ${on ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:bg-canvas'}`

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header>
        <h1 className="text-xl font-semibold">Перенос данных</h1>
        <p className="text-sm text-muted">Выберите, откуда и куда переносим, и отметьте нужные данные. CRM составит пошаговую инструкцию для мастера и для клиента.</p>
      </header>

      <section className="grid gap-2" aria-labelledby="from-title">
        <h2 id="from-title" className="font-medium">1. С какого телефона</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <button key={s.id} type="button" aria-pressed={source === s.id} className={chip(source === s.id)} onClick={() => setSource(s.id)}>
              <b className="block">{s.title}</b><small className="text-muted">{s.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2" aria-labelledby="to-title">
        <h2 id="to-title" className="font-medium">2. Куда переносим</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DESTS.map((d) => (
            <button key={d.id} type="button" aria-pressed={dest === d.id} className={chip(dest === d.id)} onClick={() => setDest(d.id)}>
              <b className="block">{d.title}</b><small className="text-muted">{d.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2" aria-labelledby="what-title">
        <h2 id="what-title" className="font-medium">3. Что переносим</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label key={c.id} className={`${chip(cats.includes(c.id))} flex cursor-pointer items-center gap-3`}>
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={cats.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.title}
            </label>
          ))}
        </div>
        {cats.length === 0 && source && dest && <p className="text-sm text-muted">Ничего не отмечено — покажу инструкцию для полной копии.</p>}
      </section>

      {guide ? (
        <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5" aria-label="Инструкция">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{sourceTitle} → {destTitle}</h2>
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Клиент (для печати)" aria-label="Клиент"
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm sm:ml-auto" />
            <button type="button" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink" onClick={print}>Распечатать</button>
          </div>
          {guide.warnings.map((w) => <p key={w} className="rounded-lg bg-warning/10 p-3 text-sm">{w}</p>)}
          <Block title="Перед началом" steps={guide.before} />
          {guide.sections.map((s) => <Block key={s.title} title={s.title} steps={s.steps} />)}
          <Block title="После переноса" steps={guide.after} />
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">Выберите телефон и место назначения — ниже появится инструкция.</p>
      )}
    </div>
  )
}

function Block({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="grid gap-1.5">
      <h3 className="font-medium">{title}</h3>
      <ol className="grid list-decimal gap-1.5 pl-5 text-sm">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
    </div>
  )
}
