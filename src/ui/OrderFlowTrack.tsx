// Een flow als spoor van links naar rechts, voor de lijsten Verkooporders en Inkooporders en het scherm van één order.
// Dezelfde stippen, kleuren en oordelen voor de verkoop-flow en de inkoop-flow.
import { AlertTriangle, ArrowRight, Boxes, CalendarDays, Check, CheckCircle2, ClipboardCheck, Clock, FileText, MapPin, Minus, PackageCheck, ScanLine, ShoppingCart, Truck, Warehouse } from 'lucide-react'
import type { ComponentType } from 'react'
import { PHASE_HINT, PHASE_LABEL, type FollowUp, type PhaseKey, type PhaseState } from '../domain/orderFlow'
import { PURCHASE_PHASE_HINT, PURCHASE_PHASE_LABEL, type PurchasePhaseKey } from '../domain/purchaseFlow'
import { locale, tx } from '../i18n'

type Icon = ComponentType<{ size?: number }>
/** Een fase zoals de domeinlaag hem geeft; voor beide flows gelijk van vorm. */
export interface FlowPhase { key: string; state: PhaseState; label: string; args?: (string | number)[]; href?: string; partial?: boolean }
export interface Flow { phases: FlowPhase[]; follow: FollowUp; next: FlowPhase | null }
export interface FlowDefs { labels: Record<string, string>; hints: Record<string, string>; icons: Record<string, Icon>; aria: string }

export const PHASE_ICON: Record<PhaseKey, Icon> = {
  proforma: ScanLine, verkooporder: ClipboardCheck, goederen: Boxes, planning: CalendarDays, afleveren: Truck, factureren: FileText,
}
export const PURCHASE_PHASE_ICON: Record<PurchasePhaseKey, Icon> = {
  proforma: FileText, inkooporder: ShoppingCart, nl: MapPin, transport: Truck, ontvangst: PackageCheck, aflevering: Warehouse,
}
export const SALES_DEFS: FlowDefs = { labels: PHASE_LABEL, hints: PHASE_HINT, icons: PHASE_ICON, aria: 'Verkoop-flow' }
export const PURCHASE_DEFS: FlowDefs = { labels: PURCHASE_PHASE_LABEL, hints: PURCHASE_PHASE_HINT, icons: PURCHASE_PHASE_ICON, aria: 'Inkoop-flow' }

const STATE_ICON: Partial<Record<PhaseState, Icon>> = { done: Check, laat: AlertTriangle, wacht: Clock, skip: Minus }

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
/** Korte datum in het spoor (8 nov.), met jaar alleen als het een ander jaar is. */
const shortDate = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(locale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Tekst van een fase in de schermtaal, met datums in de gewone notatie. */
export const phaseText = (p: FlowPhase) => (p.label ? tx(p.label, ...(p.args ?? []).map((a) => (isDate(a) ? shortDate(String(a)) : a))) : '')

export const FOLLOW_LABEL: Record<FollowUp, string> = {
  te_laat: 'Te laat', actie: 'Opvolgen', wacht: 'Loopt', afgerond: 'Afgerond', geannuleerd: 'Geannuleerd',
}

const STATE_TEXT: Record<PhaseState, string> = {
  done: 'Klaar', actie: 'Actie nodig', laat: 'Te laat', wacht: 'Wacht', open: 'Komt nog', skip: 'Niet van toepassing',
}

/** Eén cel in de lijst: een stuk spoor met een stip en een korte tekst. */
export function PhaseCell({ phase, current, defs = SALES_DEFS }: { phase: FlowPhase; current: boolean; defs?: FlowDefs }) {
  const Icon = STATE_ICON[phase.state]
  const text = phaseText(phase)
  return (
    <div className={`ph ph-${phase.state}${current ? ' ph-now' : ''}${phase.partial ? ' ph-partial' : ''}`} title={`${tx(defs.labels[phase.key])}: ${text || tx(STATE_TEXT[phase.state])}`}>
      <span className="ph-dot" aria-hidden>{Icon && <Icon size={11} />}</span>
      <span className="ph-t">{text || (phase.state === 'open' ? '' : tx(STATE_TEXT[phase.state]))}</span>
    </div>
  )
}

/** Klein spoor van stippen, voor op de telefoon. */
export function MiniTrack({ flow }: { flow: Flow }) {
  return <div className="mini-track" aria-hidden>{flow.phases.map((p) => <span key={p.key} className={`ph-${p.state}`} />)}</div>
}

/** De volgende stap, met link naar het scherm waar het gebeurt. */
export function NextStep({ flow, defs = SALES_DEFS }: { flow: Flow; defs?: FlowDefs }) {
  const p = flow.next
  if (flow.follow === 'afgerond') return <span className="next next-afgerond"><CheckCircle2 size={15} />{tx("Afgerond")}</span>
  if (!p) return <span className="next">–</span>
  const body = <><span className="next-ph">{tx(defs.labels[p.key])}</span><span className="next-t">{phaseText(p) || tx(STATE_TEXT[p.state])}</span></>
  const cls = `next next-${flow.follow}`
  return p.href
    ? <a className={cls} href={p.href} onClick={(e) => e.stopPropagation()}>{body}<ArrowRight size={15} className="next-arrow" /></a>
    : <span className={cls}>{body}</span>
}

/** Groot spoor bovenaan het scherm van één order. */
export function FlowTrack({ flow, defs = SALES_DEFS }: { flow: Flow; defs?: FlowDefs }) {
  const nextKey = flow.next?.key
  return (
    <ol className="flow-track" aria-label={tx(defs.aria)}>
      {flow.phases.map((p, i) => {
        const Icon = defs.icons[p.key]
        const SIcon = STATE_ICON[p.state]
        return (
          <li key={p.key} className={`ft ph-${p.state}${p.key === nextKey ? ' ft-next' : ''}`}>
            <div className="ft-dot">{SIcon && p.state !== 'skip' ? <SIcon size={16} /> : <Icon size={16} />}</div>
            <div className="ft-n">{i + 1}. {tx(defs.labels[p.key])}</div>
            <div className="ft-t">{phaseText(p) || <span className="muted">{p.state === 'open' ? tx(defs.hints[p.key]) : tx(STATE_TEXT[p.state])}</span>}</div>
            {p.partial && <div className="ft-partial">{tx("deels")}</div>}
          </li>
        )
      })}
    </ol>
  )
}
