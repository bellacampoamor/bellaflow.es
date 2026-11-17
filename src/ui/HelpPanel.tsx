import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp, FileDown, X } from 'lucide-react'
import { HELP_ORDER, helpNeighbours, helpTopicFor, type HelpTopic } from '../domain/help'
import { HELP_NL, HELP_PDF_URL, type HelpBlock, type HelpStep } from '../domain/helpContent'
import { getLanguage, tx } from '../i18n'
import { NAV_UI_EVENT, recallUi } from './nav'

const OPEN_KEY = 'bella-flow-help-open'

/**
 * Hulp per scherm (opdracht Rick 17 november 2026). F1 of de knop Hulp opent rechts een venster met de uitleg
 * van het scherm waar je bent. Het werkvlak krijgt dan 80% van de breedte, de hulp 20%.
 * Het venster volgt mee als je naar een ander scherm of tabblad gaat.
 * Gekozen sneltoets: F1 (F11 is in de browser volledig scherm en is niet betrouwbaar over te nemen).
 */
export function HelpButton({ hash }: { hash: string }) {
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(OPEN_KEY) === '1' } catch { return false } })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setOpen((v) => !v) }
    }
    // Sommige browsers openen bij F1 hun eigen hulp; dat houden we tegen.
    const onHelp = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', onKey)
    window.addEventListener('help', onHelp)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('help', onHelp) }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('help-open', open)
    try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* alleen dit scherm */ }
    return () => document.documentElement.classList.remove('help-open')
  }, [open])
  return (
    <>
      <button className={open ? 'btn-toggle on' : 'btn-toggle'} aria-pressed={open} aria-label={tx("Hulp bij dit scherm (F1)")} title={tx("Hulp bij dit scherm (F1)")} onClick={() => setOpen((v) => !v)}>
        <CircleHelp size={18} />{tx("Hulp")}
      </button>
      {open && <HelpPanel hash={hash} onClose={() => setOpen(false)} />}
    </>
  )
}

function useAdminTab() {
  const [tab, setTab] = useState(() => recallUi<string>('admin-tab', ''))
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; if (d?.key === 'admin-tab') setTab(String(d.value)) }
    window.addEventListener(NAV_UI_EVENT, on)
    return () => window.removeEventListener(NAV_UI_EVENT, on)
  }, [])
  return tab
}

function HelpPanel({ hash, onClose }: { hash: string; onClose: () => void }) {
  const adminTab = useAdminTab()
  const auto = helpTopicFor(hash, { adminTab })
  // Zelf gekozen onderwerp blijft staan tot je naar een ander scherm gaat.
  const [picked, setPicked] = useState<{ topic: HelpTopic; at: string } | null>(null)
  const here = `${hash}|${adminTab}`
  const topic = picked && picked.at === here ? picked.topic : auto
  const page = HELP_NL[topic]
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { body.current?.scrollTo({ top: 0 }) }, [topic])
  const pick = (t: HelpTopic) => setPicked({ topic: t, at: here })
  const { prev, next } = helpNeighbours(topic)
  const onKey = (e: ReactKeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }

  return (
    <aside className="help-panel" aria-label={tx("Hulp bij dit scherm")} onKeyDown={onKey}>
      <div className="help-head">
        <div className="help-kicker"><CircleHelp size={15} />{tx("Hulp")} · F1</div>
        <button className="help-close" onClick={onClose} aria-label={tx("Sluiten")} title={tx("Sluiten (F1)")}><X size={18} /></button>
      </div>
      <label className="help-topic">
        <span className="sr-only">{tx("Onderwerp")}</span>
        <select value={topic} onChange={(e) => pick(e.target.value as HelpTopic)}>
          {HELP_ORDER.map((t) => <option key={t} value={t}>{HELP_NL[t].chapter} · {HELP_NL[t].title}</option>)}
        </select>
      </label>
      <div className="help-body" ref={body}>
        <h2>{page.title}</h2>
        {topic !== auto && <button className="linklike small" onClick={() => setPicked(null)}>{tx("Terug naar de hulp bij dit scherm")}</button>}
        {getLanguage() !== 'nl' && <p className="help-lang small">{tx("De hulp is nog alleen in het Nederlands beschikbaar.")}</p>}
        {page.blocks.map((b, i) => <Block key={i} b={b} pick={pick} />)}
      </div>
      <div className="help-foot">
        <button className="btn small" disabled={!prev} onClick={() => prev && pick(prev)} aria-label={tx("Vorig onderwerp")}><ChevronLeft size={15} /></button>
        <a className="btn small" href={HELP_PDF_URL} target="_blank" rel="noopener"><FileDown size={15} />{tx("Handleiding (PDF)")}</a>
        <button className="btn small" disabled={!next} onClick={() => next && pick(next)} aria-label={tx("Volgend onderwerp")}><ChevronRight size={15} /></button>
      </div>
      <div className="help-copy">© bellaflow.es</div>
    </aside>
  )
}

function Block({ b, pick }: { b: HelpBlock; pick: (t: HelpTopic) => void }) {
  switch (b.t) {
    case 'why': return <p className="help-why"><strong>{tx("Waarvoor?")}</strong> {b.text}</p>
    case 'p': return <p>{b.text}</p>
    case 'h': return <h3>{b.text}</h3>
    case 'img': return (
      <figure className={b.narrow ? 'help-shot narrow' : 'help-shot'}>
        <a href={b.src} target="_blank" rel="noopener" title={tx("Groter bekijken")}><img src={b.src} alt={b.cap} loading="lazy" /></a>
        <figcaption>{b.cap}</figcaption>
      </figure>
    )
    case 'steps': return <ol className="help-steps">{b.items.map((s, i) => <Step key={i} s={s} n={i + 1} />)}</ol>
    case 'note': case 'tip': return (
      <div className={`help-box ${b.t}`}>
        <strong>{b.t === 'note' ? tx("Let op:") : tx("Tip:")}</strong>
        {b.items.length === 1 ? <p>{b.items[0]}</p> : <ul>{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      </div>
    )
    case 'see': return <p className="help-see"><button className="linklike" onClick={() => pick(b.topic)}>{b.text} ›</button></p>
  }
}

function Step({ s, n }: { s: HelpStep; n: number }) {
  return (
    <li>
      <span className={s.mark ? 'help-num mark' : 'help-num'}>{s.n ?? n}</span>
      <span>{s.b && <strong>{s.b} </strong>}{s.t}
        {s.sub && <ul>{s.sub.map((x, i) => <li key={i}>{x.b && <strong>{x.b} </strong>}{x.t}</li>)}</ul>}
      </span>
    </li>
  )
}
