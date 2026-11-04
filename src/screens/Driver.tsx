import { useRef, useState } from 'react'
import { ArrowLeft, Check as CheckIcon, ChevronLeft, ChevronRight, Map as MapIcon, Phone } from 'lucide-react'
import type { Delivery } from '../data/types'
import { addDays, documentLanguage, todayISO } from '../domain/calc'
import { googleMapsRouteUrl, MAPS_MAX_WAYPOINTS, type Point } from '../domain/route'
import { signDelivery } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Empty, fmtDate, fmtShort, Pill } from '../ui/kit'
import { SignaturePad, type SignaturePadHandle } from '../ui/SignaturePad'
import { NOTE_TEXT } from './DeliveryNote'
import { tx } from '../i18n'

const canSign = (d: Delivery) => d.status === 'ready' || d.status === 'in_transit'

/** Mobiele app van de chauffeur: de route van de dag en per bezorging de digitale afleverbon. */
export function Driver({ param }: { param: string }) {
  const { s } = useApp()
  const [day, setDay] = useState(todayISO())
  if (s.settings[0]?.delivery_note_mode !== 'digitaal') {
    return <div className="drv"><section className="panel"><h2>{tx("Chauffeursapp")}</h2><p>{tx("De digitale afleverbon staat uit. Zet hem aan onder Beheer, op het tabblad met de bedrijfsgegevens.")}</p><a className="btn" href="#levering">{tx("Naar Levering")}</a></section></div>
  }
  return <div className="drv">{param ? <DriverStop key={param} id={param} /> : <DriverRoute day={day} setDay={setDay} />}</div>
}

function DriverRoute({ day, setDay }: { day: string; setDay: (d: string) => void }) {
  const { s } = useApp()
  const stops = s.deliveries
    .filter((d) => d.planned_date === day && d.method === 'eigen_team' && d.status !== 'cancelled')
    .sort((a, b) => (a.route_position ?? 999) - (b.route_position ?? 999) || a.number.localeCompare(b.number))
  const orderOf = (d: Delivery) => s.sales_orders.find((o) => o.id === d.sales_order_id)!
  const done = stops.filter((d) => d.status === 'delivered').length
  const origin = s.warehouses.find((w) => w.is_route_origin && w.latitude != null && w.longitude != null)
  const points = stops.filter((d) => d.status !== 'delivered').map(orderOf).filter((o) => o.delivery_latitude != null && o.delivery_longitude != null).map((o): Point => ({ latitude: o.delivery_latitude!, longitude: o.delivery_longitude! }))
  return (
    <>
      <header className="drv-head">
        <div className="drv-day">
          <button className="btn icon" aria-label={tx("Vorige dag")} onClick={() => setDay(addDays(day, -1))}><ChevronLeft size={24} /></button>
          <div><h1>{fmtShort(day)}</h1><div className="muted small">{day === todayISO() ? tx("Vandaag") : fmtDate(day)}, {tx("{0} van {1} bezorgd", done, stops.length)}</div></div>
          <button className="btn icon" aria-label={tx("Volgende dag")} onClick={() => setDay(addDays(day, 1))}><ChevronRight size={24} /></button>
        </div>
        {origin && points.length > 0 && points.length <= MAPS_MAX_WAYPOINTS && <a className="btn drv-wide" href={googleMapsRouteUrl({ latitude: origin.latitude!, longitude: origin.longitude! }, points)} target="_blank" rel="noreferrer"><MapIcon size={18} />{tx("Route in Google Maps")}</a>}
      </header>
      {stops.length === 0 && <section className="panel"><Empty>{tx("Geen bezorgingen op deze dag.")}</Empty></section>}
      <ol className="drv-stops">{stops.map((d, i) => {
        const o = orderOf(d)
        const c = s.customers.find((x) => x.id === o.customer_id)!
        const qty = s.delivery_lines.filter((l) => l.delivery_id === d.id).reduce((n, l) => n + l.qty, 0)
        const isDone = d.status === 'delivered'
        return (
          <li key={d.id}>
            <a className={`drv-stop${isDone ? ' done' : ''}`} href={`#chauffeur-${d.id}`}>
              <span className="drv-nr">{isDone ? <CheckIcon size={20} /> : i + 1}</span>
              <span className="drv-body">
                <strong>{o.delivery_name || c.company || c.name}</strong>
                <span>{o.delivery_address}, {o.delivery_city}</span>
                <span className="muted small">{tx("{0} artikelen", qty)}, {d.number}</span>
              </span>
              {isDone ? <Pill tone="good">{tx("Getekend")}</Pill> : canSign(d) ? <ChevronRight size={22} /> : <Pill tone="warn">{tx("Niet klaargezet")}</Pill>}
            </a>
          </li>
        )
      })}</ol>
    </>
  )
}

function DriverStop({ id }: { id: string }) {
  const { s, run } = useApp()
  const pad = useRef<SignaturePadHandle>(null)
  const [hasInk, setHasInk] = useState(false)
  const d = s.deliveries.find((x) => x.id === id)
  const o = d && s.sales_orders.find((x) => x.id === d.sales_order_id)
  const c = o && s.customers.find((x) => x.id === o.customer_id)
  const [name, setName] = useState(o?.delivery_name || c?.name || '')
  if (!d || !o || !c) return <section className="panel">{tx("Levering niet gevonden.")} <a href="#chauffeur">{tx("Terug naar de route")}</a>.</section>
  const t = NOTE_TEXT[documentLanguage(s.settings[0]?.language_delivery_note, c.language)]
  const lines = s.delivery_lines.filter((l) => l.delivery_id === id).map((l) => ({ ...l, sol: s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)! }))
  const address = [o.delivery_address, o.delivery_postal_code, o.delivery_city].filter(Boolean).join(', ')
  const confirm = async () => {
    const signature = pad.current?.toDataUrl() ?? ''
    if (await run((db) => signDelivery(db, id, { signature, signed_by: name, date: todayISO() }), tx("{0} is afgeleverd", d.number))) go('chauffeur')
  }
  return (
    <>
      <a className="drv-back" href="#chauffeur"><ArrowLeft size={20} />{tx("Route")}</a>
      <section className="panel drv-note">
        <div className="drv-note-head"><h1>{t.title}</h1><div className="strong">{d.number}</div><div className="muted small">{t.order}: {o.number}</div></div>
        <div>
          <div className="muted small">{t.to}</div>
          <div className="strong">{o.delivery_name || c.company || c.name}</div>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer">{address}</a>
          {o.delivery_phone && <div><a className="drv-tel" href={`tel:${o.delivery_phone.replace(/\s/g, '')}`}><Phone size={15} />{o.delivery_phone}</a></div>}
        </div>
        <ul className="drv-lines">{lines.map((l) => (
          <li key={l.id}><b>{l.qty} ×</b><span>{l.sol.description}{l.sol.options && <span className="muted small"><br />{l.sol.options}</span>}</span></li>
        ))}</ul>
        <div className="note-box" style={{ margin: 0 }}>
          {t.floor}: {o.floor || '–'}, {t.lift}: {o.has_elevator ? t.yes : t.no}, {t.assembly}: {o.needs_assembly ? t.yes : t.no}, {t.remove}: {o.remove_old_furniture ? t.yes : t.no}
          {(o.delivery_notes || d.notes) && <div style={{ marginTop: 4 }}>{t.notes}: {[o.delivery_notes, d.notes].filter(Boolean).join('. ')}</div>}
        </div>
        <p className="strong" style={{ margin: 0 }}>{t.confirm}</p>
      </section>
      {d.status === 'delivered' && (
        <section className="panel drv-signed">
          <Pill tone="good">{tx("Getekend")}</Pill>
          {d.signature_data && <img src={d.signature_data} alt={tx("Handtekening van {0}", d.signed_by)} />}
          <div className="small">{d.signed_by}, {fmtDate(d.delivered_at)}</div>
        </section>
      )}
      {!canSign(d) && d.status !== 'delivered' && <section className="panel"><p style={{ margin: 0 }}>{tx("Deze levering is nog niet klaargezet. Tekenen kan zodra het magazijn hem heeft klaargezet.")}</p></section>}
      {canSign(d) && (
        <section className="drv-sign">
          <label className="drv-name"><span className="small muted">{t.name}</span><input id="drv-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          <div className="drv-pad-head"><span className="strong">{t.sign}</span><button className="btn sm" disabled={!hasInk} onClick={() => pad.current?.clear()}>{tx("Wissen")}</button></div>
          <SignaturePad ref={pad} label={t.sign} onInk={setHasInk} />
          <button className="btn primary drv-confirm" disabled={!hasInk || !name.trim()} onClick={confirm}>{tx("Bevestigen")}</button>
        </section>
      )}
    </>
  )
}
