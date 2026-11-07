// De verkoop-flow als spoor van links naar rechts, voor de lijst Verkooporders en het scherm van één verkooporder.
import { AlertTriangle, ArrowRight, Boxes, CalendarDays, Check, CheckCircle2, ClipboardCheck, Clock, FileText, Minus, ScanLine, Truck } from 'lucide-react'
import type { ComponentType } from 'react'
import { PHASE_HINT, PHASE_LABEL, type FollowUp, type OrderFlow, type Phase, type PhaseKey, type PhaseState } from '../domain/orderFlow'
import { locale, tx } from '../i18n'

export const PHASE_ICON: Record<PhaseKey, ComponentType<{ size?: number }>> = {
  proforma: ScanLine, verkooporder: ClipboardCheck, goederen: Boxes, planning: CalendarDays, afleveren: Truck, factureren: FileText,
}

const STATE_ICON: Partial<Record<PhaseState, ComponentType<{ size?: number }>>> = { done: Check, laat: AlertTriangle, wacht: Clock, skip: Minus }

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
/** Korte datum in het spoor (8 nov.), met jaar alleen als het een ander jaar is. */
const shortDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Tekst van een fase in de schermtaal, met datums in de gewone notatie. */
export const phaseText = (p: Phase) => (p.label ? tx(p.label, ...(p.args ?? []).map((a) => (isDate(a) ? shortDate(String(a)) : a))) : '')

export const FOLLOW_LABEL: Record<FollowUp, string> = {
  te_laat: 'Te laat', actie: 'Opvolgen', wacht: 'Loopt', afgerond: 'Afgerond', geannuleerd: 'Geannuleerd',
}

/** Eén cel in de lijst: een stuk spoor met een stip en een korte tekst. */
export function PhaseCell({ phase, current }: { phase: Phase; current: boolean }) {
  const Icon = STATE_ICON[phase.state]
  const text = phaseText(phase)
  return (
    <div className={`ph ph-${phase.state}${current ? ' ph-now' : ''}${phase.partial ? ' ph-partial' : ''}`} title={`${tx(PHASE_LABEL[phase.key])}: ${text || tx(STATE_TEXT[phase.state])}`}>
      <span className="ph-dot" aria-hidden>{Icon && <Icon size={11} />}</span>
      <span className="ph-t">{text || (phase.state === 'open' ? '' : tx(STATE_TEXT[phase.state]))}</span>
    </div>
  )
}

const STATE_TEXT: Record<PhaseState, string> = {
  done: 'Klaar', actie: 'Actie nodig', laat: 'Te laat', wacht: 'Wacht', open: 'Komt nog', skip: 'Niet van toepassing',
}

/** Klein spoor van stippen, voor op de telefoon. */
export function MiniTrack({ flow }: { flow: OrderFlow }) {
  return <div className="mini-track" aria-hidden>{flow.phases.map((p) => <span key={p.key} className={`ph-${p.state}`} />)}</div>
}

/** De volgende stap van een verkooporder, met link naar het scherm waar het gebeurt. */
export function NextStep({ flow }: { flow: OrderFlow }) {
  const p = flow.next
  if (flow.follow === 'afgerond') return <span className="next next-afgerond"><CheckCircle2 size={15} />{tx("Afgerond")}</span>
  if (!p) return <span className="next">–</span>
  const body = <><span className="next-ph">{tx(PHASE_LABEL[p.key])}</span><span className="next-t">{phaseText(p) || tx(STATE_TEXT[p.state])}</span></>
  const cls = `next next-${flow.follow}`
  return p.href && flow.follow !== 'wacht'
    ? <a className={cls} href={p.href} onClick={(e) => e.stopPropagation()}>{body}<ArrowRight size={15} className="next-arrow" /></a>
    : <span className={cls}>{body}</span>
}

/** Groot spoor bovenaan het scherm van één verkooporder. */
export function FlowTrack({ flow }: { flow: OrderFlow }) {
  const nextKey = flow.next?.key
  return (
    <ol className="flow-track" aria-label={tx("Verkoop-flow")}>
      {flow.phases.map((p, i) => {
        const Icon = PHASE_ICON[p.key]
        const SIcon = STATE_ICON[p.state]
        return (
          <li key={p.key} className={`ft ph-${p.state}${p.key === nextKey ? ' ft-next' : ''}`}>
            <div className="ft-dot">{SIcon && p.state !== 'skip' ? <SIcon size={16} /> : <Icon size={16} />}</div>
            <div className="ft-n">{i + 1}. {tx(PHASE_LABEL[p.key])}</div>
            <div className="ft-t">{phaseText(p) || <span className="muted">{p.state === 'open' ? tx(PHASE_HINT[p.key]) : tx(STATE_TEXT[p.state])}</span>}</div>
            {p.partial && <div className="ft-partial">{tx("deels")}</div>}
          </li>
        )
      })}
    </ol>
  )
}
