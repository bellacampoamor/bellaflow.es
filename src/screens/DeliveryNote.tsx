import { Printer } from 'lucide-react'
import type { Language } from '../data/types'
import { markNotePrinted } from '../domain/services'
import { useApp } from '../ui/app-context'
import { fmtDate, Head, Pill } from '../ui/kit'

const T: Record<Language, Record<string, string>> = {
  es: { title: 'Albarán de entrega', date: 'Fecha de entrega', slot: 'Franja horaria', order: 'Pedido', ref: 'Su referencia', to: 'Entregar a', bill: 'Cliente', tel: 'Tel.', part: 'Entrega parcial', of: 'de', code: 'Referencia', prod: 'Producto', opts: 'Acabado', pkg: 'Bultos', qty: 'Cant.', from: 'Almacén', notes: 'Observaciones', floor: 'Planta', lift: 'Ascensor', assembly: 'Montaje', remove: 'Retirar muebles antiguos', yes: 'sí', no: 'no', confirm: 'El cliente declara haber recibido los productos indicados en buen estado.', remarks: 'Observaciones en la recepción', name: 'Nombre', sign: 'Firma del cliente', when: 'Fecha y hora', stop: 'Parada' },
  nl: { title: 'Afleverbon', date: 'Leverdatum', slot: 'Tijdvak', order: 'Order', ref: 'Uw referentie', to: 'Afleveren bij', bill: 'Klant', tel: 'Tel.', part: 'Deellevering', of: 'van', code: 'Artikel', prod: 'Product', opts: 'Uitvoering', pkg: 'Colli', qty: 'Aantal', from: 'Magazijn', notes: 'Instructies', floor: 'Verdieping', lift: 'Lift', assembly: 'Montage', remove: 'Oude meubels meenemen', yes: 'ja', no: 'nee', confirm: 'De klant verklaart de genoemde producten in goede staat te hebben ontvangen.', remarks: 'Opmerkingen bij ontvangst', name: 'Naam', sign: 'Handtekening klant', when: 'Datum en tijd', stop: 'Stop' },
  en: { title: 'Delivery note', date: 'Delivery date', slot: 'Time slot', order: 'Order', ref: 'Your reference', to: 'Deliver to', bill: 'Customer', tel: 'Tel.', part: 'Part delivery', of: 'of', code: 'Item', prod: 'Product', opts: 'Finish', pkg: 'Packages', qty: 'Qty', from: 'Warehouse', notes: 'Instructions', floor: 'Floor', lift: 'Lift', assembly: 'Assembly', remove: 'Remove old furniture', yes: 'yes', no: 'no', confirm: 'The customer confirms receipt of the listed products in good condition.', remarks: 'Remarks on receipt', name: 'Name', sign: 'Customer signature', when: 'Date and time', stop: 'Stop' },
}

export function DeliveryNote({ id }: { id: string }) {
  const { s, run } = useApp()
  const d = s.deliveries.find((x) => x.id === id)
  if (!d) return <div className="panel">Levering niet gevonden. <a href="#levering">Terug naar de planning</a>.</div>
  const o = s.sales_orders.find((x) => x.id === d.sales_order_id)!
  const c = s.customers.find((x) => x.id === o.customer_id)!
  const co = s.settings[0]
  const t = T[c.language]
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
  return (
    <>
      <Head title={`Afleverbon ${d.number}`} back={{ href: '#levering', label: 'Levering aan klant' }} sub={<>
        {ready ? <Pill tone="good">Akkoord door {d.approved_by || 'onbekend'}</Pill> : <Pill tone="warn">Nog niet klaargezet</Pill>}{' '}
        {d.note_printed_at ? <Pill tone="info">Afgedrukt</Pill> : <Pill>Nog niet afgedrukt</Pill>}
      </>}>
        <a className="btn" href={`#orders-${o.id}`}>Naar {o.number}</a>
        {canPrint
          ? <button className="btn primary" disabled={!ready} onClick={print}><Printer size={16} />Afleverbon afdrukken</button>
          : <span className="small muted">Afdrukken kan in de eigen app, niet in deze preview.</span>}
      </Head>
      <div className="paper">
        <div className="paper-top">
          <div>
            <h2 style={{ fontSize: '1.3rem' }}>{co.company_name}</h2>
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: '1.45rem' }}>{t.title}</h1>
            <div className="strong">{d.number}</div>
            <div className="small muted">
              {t.date}: {fmtDate(d.planned_date)}{d.time_slot && <><br />{t.slot}: {d.time_slot}</>}
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
        <div className="note-sign">
          <div className="pre" style={{ gridColumn: '1 / -1', minHeight: 0 }}>{t.confirm}</div>
          <div style={{ gridColumn: '1 / -1' }}>{t.remarks}</div>
          <div>{t.name}</div>
          <div>{t.when}</div>
          <div className="sig">{t.sign}</div>
        </div>
      </div>
    </>
  )
}
