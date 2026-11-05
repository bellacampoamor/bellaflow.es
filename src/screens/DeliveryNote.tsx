import { useState } from 'react'
import { Printer } from 'lucide-react'
import { documentLanguage } from '../domain/calc'
import { NOTE_TEXT } from '../domain/noteText'
import { markNotePrinted } from '../domain/services'
import { go, useApp, useAutoPrint } from '../ui/app-context'
import { fmtDate, Head, Modal, Pill, DocPaper } from '../ui/kit'
import { tx } from '../i18n'


export function DeliveryNote({ id, autoPrint = false, fromArchive = false }: { id: string; autoPrint?: boolean; fromArchive?: boolean }) {
  const { s, run } = useApp()
  const [confirmed, setConfirmed] = useState(autoPrint || fromArchive)
  const d = s.deliveries.find((x) => x.id === id)
  useAutoPrint(autoPrint, !!d)
  if (!d) return <div className="panel">{tx("Levering niet gevonden.")} <a href="#levering">{tx("Terug naar de planning")}</a>.</div>
  const o = s.sales_orders.find((x) => x.id === d.sales_order_id)!
  const c = s.customers.find((x) => x.id === o.customer_id)!
  const co = s.settings[0]
  const language = documentLanguage(co.language_delivery_note, c.language)
  const t = NOTE_TEXT[language]
  const lines = s.delivery_lines.filter((l) => l.delivery_id === id).map((l) => {
    const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
    return { ...l, sol, p: s.products.find((x) => x.id === sol.product_id)!, wh: s.warehouses.find((w) => w.id === l.warehouse_id)! }
  })
  const siblings = s.deliveries.filter((x) => x.sales_order_id === o.id && x.status !== 'cancelled').length
  const packages = lines.reduce((n, l) => n + l.qty * l.p.colli, 0)
  const canPrint = !import.meta.env.VITE_PREVIEW
  const ready = d.status !== 'planned'
  const print = async () => {
    await run((db) => markNotePrinted(db, id))
    window.print()
  }
  const delivered = d.status === 'delivered'
  return (
    <>
      {delivered && !confirmed && (
        <Modal title={tx("{0} is al afgeleverd", d.number)} onClose={() => go('levering')} footer={<>
          <button className="btn" onClick={() => go('levering')}>{tx("Terug naar Levering")}</button>
          <button className="btn primary" onClick={() => setConfirmed(true)}>{tx("Afleverbon toch openen")}</button>
        </>}>
          <p style={{ margin: 0 }}>{tx("Deze levering is afgeleverd op {0}{1}. De afleverbon is alleen nog nodig als naslag of voor een kopie.", fmtDate(d.delivered_at ?? d.planned_date), d.signed_by ? tx(", getekend door {0}", d.signed_by) : '')}</p>
        </Modal>
      )}
      <Head title={tx("Afleverbon {0}", d.number)} back={fromArchive ? { href: '#archief', label: tx("Archief") } : { href: '#levering', label: tx("Levering aan klant") }} sub={<>
        {delivered && !fromArchive && <><Pill tone="bad">{tx("Al afgeleverd op {0}", fmtDate(d.delivered_at ?? d.planned_date))}</Pill>{' '}</>}
        {ready ? <Pill tone="good">{tx("Akkoord door")} {d.approved_by || 'onbekend'}</Pill> : <Pill tone="warn">{tx("Nog niet klaargezet")}</Pill>}{' '}
        {d.note_printed_at ? <Pill tone="info">{tx("Afgedrukt")}</Pill> : <Pill>{tx("Nog niet afgedrukt")}</Pill>}
      </>}>
        <a className="btn" href={`#orders-${o.id}`}>{tx("Naar")} {o.number}</a>
        {canPrint
          ? <button className="btn primary" disabled={!ready} onClick={print}><Printer size={16} />{tx("Afleverbon afdrukken")}</button>
          : <span className="small muted">{tx("Afdrukken kan in de eigen app, niet in deze preview.")}</span>}
      </Head>
      <DocPaper language={language}>
        <div className="paper-top">
          <div>
            <h2 style={{ fontSize: '1.3rem' }}>{co.company_name}</h2>
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: '1.45rem' }}>{t.title}</h1>
            <div className="strong">{d.number}</div>
            <div className="small muted">
              {t.date}: {fmtDate(d.planned_date)}
              <br />{t.order}: {o.number}{o.customer_reference && <><br />{t.ref}: {o.customer_reference}</>}
              {siblings > 1 && <><br />{t.part} {d.sequence} {t.of} {siblings}</>}
              {d.route_position && <><br />{t.stop} {d.route_position}</>}
            </div>
          </div>
        </div>
        <div className="note-meta">
          <div>
            <div className="small muted">{t.to}</div>
            <div className="strong">{o.delivery_name || c.company || c.name}</div>
            <div className="small">{o.delivery_address}<br />{o.delivery_postal_code} {o.delivery_city}{o.delivery_phone && <><br />{t.tel} {o.delivery_phone}</>}</div>
          </div>
          <div>
            <div className="small muted">{t.bill}</div>
            <div className="strong">{c.company || c.name}</div>
            <div className="small">{c.address}<br />{c.postal_code} {c.city}</div>
          </div>
        </div>
        <div className="table-wrap flush"><table>
          <thead><tr><th>{t.code}</th><th>{t.prod}</th><th>{t.from}</th><th className="num">{t.pkg}</th><th className="num">{t.qty}</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{l.p.sku}</td>
              <td className="strong">{l.sol.description}{l.sol.options && <div className="small muted" style={{ fontWeight: 400 }}>{t.opts}: {l.sol.options}</div>}</td>
              <td>{l.wh.name}</td>
              <td className="num">{l.qty * l.p.colli}</td>
              <td className="num strong">{l.qty}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={3}></td><td className="num">{packages}</td><td className="num">{lines.reduce((n, l) => n + l.qty, 0)}</td></tr></tfoot>
        </table></div>
        <div className="note-box">
          {t.floor}: {o.floor || '–'}, {t.lift}: {o.has_elevator ? t.yes : t.no}, {t.assembly}: {o.needs_assembly ? t.yes : t.no}, {t.remove}: {o.remove_old_furniture ? t.yes : t.no}
          {(o.delivery_notes || d.notes) && <div style={{ marginTop: 4 }}>{t.notes}: {[o.delivery_notes, d.notes].filter(Boolean).join('. ')}</div>}
        </div>
        {d.signature_data && (
          <div className="note-signature">
            <div className="pre">{t.confirm}</div>
            <img src={d.signature_data} alt={tx("Handtekening van {0}", d.signed_by)} />
            <div className="small">{t.name}: {d.signed_by}<br />{t.when}: {new Date(d.signed_at ?? d.delivered_at ?? d.planned_date).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })}</div>
          </div>
        )}
        {!d.signature_data && <div className="note-sign">
          <div className="pre" style={{ gridColumn: '1 / -1', minHeight: 0 }}>{t.confirm}</div>
          <div style={{ gridColumn: '1 / -1' }}>{t.remarks}</div>
          <div>{t.name}</div>
          <div>{t.when}</div>
          <div className="sig">{t.sign}</div>
        </div>}
      </DocPaper>
    </>
  )
}
