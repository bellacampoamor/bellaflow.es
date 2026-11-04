import { useMemo, useState } from 'react'
import { CalendarClock, Copy, Pencil, Plus, Truck } from 'lucide-react'
import type { Delivery, Payment, SalesOrder } from '../data/types'
import { depositAvailable, depositPaid, invoiceBalance, lineTotal, onHandMap, orderLines, orderOutstanding, orderStage, orderTotal, plannedQty, shippedQty, STAGE_LABEL, stockKey, todayISO, uninvoicedDeliveries, type OrderStage } from '../domain/calc'
import { addOrderPayment, cancelOrder, createDelivery, defaultMethod, rescheduleOrder, setLineWarehouse } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Check, Empty, eur, fmtDate, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField, type Tone } from '../ui/kit'

export const stageTone: Record<OrderStage, Tone> = {
  geannuleerd: '', wacht_op_goederen: 'warn', te_plannen: 'sell', gepland: 'info', deels_geleverd: 'warn', te_factureren: 'bill', gefactureerd: 'good',
}

type Filter = 'alle' | 'verwerken' | 'lopend' | 'klaar'

export function Orders() {
  const { s } = useApp()
  const [filter, setFilter] = useState<Filter>('verwerken')
  const [q, setQ] = useState('')
  const rows = useMemo(() => [...s.sales_orders].sort((a, b) => b.order_date.localeCompare(a.order_date) || b.number.localeCompare(a.number)).map((o) => ({ o, stage: orderStage(s, o), cust: s.customers.find((c) => c.id === o.customer_id) })), [s])
  const groups: Record<Filter, OrderStage[]> = { alle: [], verwerken: ['te_plannen', 'wacht_op_goederen'], lopend: ['gepland', 'deels_geleverd', 'te_factureren'], klaar: ['gefactureerd', 'geannuleerd'] }
  const inGroup = (f: Filter, st: OrderStage) => f === 'alle' || groups[f].includes(st)
  const t = q.trim().toLowerCase()
  const shown = rows.filter((r) => inGroup(filter, r.stage) && (!t || `${r.o.number} ${r.cust?.name} ${r.cust?.company} ${r.o.customer_reference}`.toLowerCase().includes(t)))
  return (
    <>
      <Head title="Orders" sub="Verkoop in de winkel en online. Hier bepaal je leverdata en plan je deelleveringen.">
        <a className="btn primary" href="#orders-nieuw"><Plus size={16} />Nieuwe order</a>
      </Head>
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-end' }}>
          <Tabs<Filter> value={filter} onChange={setFilter} tabs={(['verwerken', 'lopend', 'klaar', 'alle'] as Filter[]).map((f) => ({ value: f, label: { verwerken: 'Te verwerken', lopend: 'Lopend', klaar: 'Afgerond', alle: 'Alles' }[f], n: rows.filter((r) => inGroup(f, r.stage)).length }))} />
          <input style={{ maxWidth: 280, marginBottom: 14 }} aria-label="Orders zoeken" placeholder="Zoek op nummer of klant" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {shown.length === 0 && <Empty>Geen orders in dit overzicht.</Empty>}
        {shown.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>Order</th><th>Datum</th><th>Klant</th><th>Soort</th><th>Leverdatum</th><th className="num">Totaal</th><th className="num">Nog te betalen</th><th>Status</th></tr></thead>
          <tbody>{shown.map(({ o, stage, cust }) => (
            <tr key={o.id} className="click" onClick={() => go(`orders-${o.id}`)}>
              <td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td>
              <td>{fmtDate(o.order_date)}</td>
              <td>{cust?.company || cust?.name}<div className="muted small">{o.channel[0].toUpperCase() + o.channel.slice(1)}</div></td>
              <td>{o.order_type === 'direct' ? 'Direct' : 'Bestelling'}<div className="muted small">{{ meenemen: 'Meenemen', bezorgen: 'Bezorgen', verzenden: 'Verzenden' }[o.fulfilment]}</div></td>
              <td>{o.promised_date ? fmtDate(o.promised_date) : o.requested_date ? <span className="muted">Gewenst {fmtDate(o.requested_date)}</span> : <span className="muted">Nog niet bepaald</span>}</td>
              <td className="num">{eur(orderTotal(s, o.id))}</td>
              <td className="num">{o.status === 'cancelled' ? '–' : eur(orderOutstanding(s, o.id))}</td>
              <td><Pill tone={stageTone[stage]}>{STAGE_LABEL[stage]}</Pill></td>
            </tr>
          ))}</tbody>
        </table></div>}
      </section>
    </>
  )
}

const TRACK: { k: string; l: string }[] = [{ k: 'order', l: 'Order' }, { k: 'goods', l: 'Goederen binnen' }, { k: 'plan', l: 'Gepland' }, { k: 'delivered', l: 'Geleverd' }, { k: 'invoiced', l: 'Gefactureerd' }, { k: 'paid', l: 'Betaald' }]

export function OrderDetail({ id }: { id: string }) {
  const { s, run } = useApp()
  const o = s.sales_orders.find((x) => x.id === id)
  const [modal, setModal] = useState<'date' | 'plan' | 'pay' | 'cancel' | null>(null)
  if (!o) return <div className="panel">Order niet gevonden. <a href="#orders">Terug naar orders</a>.</div>
  const c = s.customers.find((x) => x.id === o.customer_id)!
  const lines = orderLines(s, id)
  const stage = orderStage(s, o)
  const deliveries = s.deliveries.filter((d) => d.sales_order_id === id).sort((a, b) => a.sequence - b.sequence)
  const invoices = s.invoices.filter((i) => i.sales_order_id === id)
  const events = s.order_events.filter((e) => e.sales_order_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const payments = s.payments.filter((p) => p.sales_order_id === id)
  const total = orderTotal(s, id)
  const outstanding = orderOutstanding(s, id)
  const hand = onHandMap(s)
  const open = o.status === 'open'

  const qty = lines.reduce((n, l) => n + l.qty, 0)
  const shipped = lines.reduce((n, l) => n + shippedQty(s, l.id), 0)
  const planned = lines.reduce((n, l) => n + plannedQty(s, l.id), 0)
  const done = {
    order: true, goods: lines.every((l) => l.warehouse_id), plan: planned >= qty, delivered: shipped >= qty,
    invoiced: shipped >= qty && !uninvoicedDeliveries(s, id).length, paid: outstanding <= 0,
  } as Record<string, boolean>
  const firstOpen = TRACK.findIndex((t) => !done[t.k])
  const plannable = lines.filter((l) => l.warehouse_id && l.qty - plannedQty(s, l.id) > 0)

  return (
    <>
      <Head title={o.number} sub={<>{c.company || c.name}, {fmtDate(o.order_date)} <Pill tone={stageTone[stage]}>{STAGE_LABEL[stage]}</Pill></>} back={{ href: '#orders', label: 'Orders' }}>
        {open && stage !== 'gefactureerd' && <>
          <button className="btn" onClick={() => setModal('date')}><CalendarClock size={16} />Leverdatum</button>
          <a className="btn" href={`#orders-wijzig-${id}`}><Pencil size={16} />Wijzigen</a>
          <button className="btn" onClick={() => setModal('pay')}>Betaling</button>
          <button className="btn primary" disabled={!plannable.length} onClick={() => setModal('plan')}><Truck size={16} />Levering plannen</button>
        </>}
      </Head>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="track">{TRACK.map((t, i) => <div key={t.k} className={done[t.k] ? 'done' : i === firstOpen ? 'now' : ''}>{t.l}</div>)}</div>
      </section>

      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>Producten</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>Product</th><th>Magazijn</th><th className="num">Aantal</th><th className="num">Gepland</th><th className="num">Geleverd</th><th className="num">Prijs</th><th className="num">Korting</th><th className="num">Totaal</th></tr></thead>
              <tbody>{lines.map((l) => {
                const unplanned = plannedQty(s, l.id) === 0
                const here = l.warehouse_id ? hand.get(stockKey(l.product_id, l.warehouse_id)) ?? 0 : 0
                return (
                  <tr key={l.id}>
                    <td className="strong">{l.description}{l.options && <div className="muted small" style={{ fontWeight: 400 }}>{l.options}</div>}</td>
                    <td style={{ minWidth: 170 }}>
                      {!l.warehouse_id ? <Pill tone="warn">Op bestelling</Pill>
                        : open && unplanned ? (
                          <select aria-label={`Magazijn voor ${l.description}`} value={l.warehouse_id} onChange={(e) => run((db) => setLineWarehouse(db, l.id, e.target.value), 'Magazijn aangepast')}>
                            {s.warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name} ({hand.get(stockKey(l.product_id, w.id)) ?? 0})</option>)}
                          </select>
                        ) : s.warehouses.find((w) => w.id === l.warehouse_id)?.name}
                      {l.warehouse_id && unplanned && here < l.qty && <div className="small" style={{ color: 'var(--bad)' }}>{here} aanwezig</div>}
                    </td>
                    <td className="num">{l.qty}</td><td className="num">{plannedQty(s, l.id)}</td><td className="num">{shippedQty(s, l.id)}</td>
                    <td className="num">{eur(l.unit_price)}</td><td className="num">{l.discount_pct ? `${l.discount_pct}%` : <span className="zero">0</span>}</td>
                    <td className="num">{eur(lineTotal(l))}</td>
                  </tr>
                )
              })}</tbody>
              <tfoot><tr><td colSpan={7}>Totaal incl. IVA</td><td className="num">{eur(total)}</td></tr></tfoot>
            </table></div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Leveringen</h2>{open && plannable.length > 0 && <button className="btn sm" onClick={() => setModal('plan')}><Plus size={14} />Deellevering plannen</button>}</div>
            {deliveries.length === 0 && <Empty>{plannable.length ? 'Nog niets gepland. Plan alles ineens of in delen.' : 'Plannen kan zodra de goederen binnen zijn.'}</Empty>}
            {deliveries.map((d) => (
              <a key={d.id} href="#levering" className="task">
                <div><div className="task-t">{d.number}{d.sequence > 1 || deliveries.length > 1 ? `, deellevering ${d.sequence}` : ''}</div>
                  <div className="muted small">{s.delivery_lines.filter((l) => l.delivery_id === d.id).map((l) => `${l.qty} × ${lines.find((x) => x.id === l.sales_order_line_id)?.description}`).join(', ')}</div></div>
                <DeliveryPill d={d} />
              </a>
            ))}
          </section>

          <section className="panel">
            <h2>Facturen</h2>
            {invoices.length === 0 && <Empty>{uninvoicedDeliveries(s, id).length ? <>Er is geleverd en nog niet gefactureerd. <a href="#facturatie">Naar facturatie</a>.</> : 'Facturen volgen na levering.'}</Empty>}
            {invoices.map((i) => {
              const bal = invoiceBalance(s, i)
              return (
                <a key={i.id} href={`#facturatie-${i.id}`} className="task">
                  <div><div className="task-t">{i.number}</div><div className="muted small">{fmtDate(i.invoice_date)}, {i.kind}, {eur(i.total)}{i.deposit_settled ? `, ${eur(i.deposit_settled)} verrekend` : ''}</div></div>
                  <Pill tone={bal <= 0 ? 'good' : 'bill'}>{bal <= 0 ? 'Betaald' : `Open ${eur(bal)}`}</Pill>
                </a>
              )
            })}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>Klant en levering</h2>
            <dl className="dl">
              <dt>Klant</dt><dd><div>{c.company || c.name}</div><div className="muted small">{[c.phone, c.email].filter(Boolean).join(', ')}</div></dd>
              {o.customer_reference && <><dt>Referentie</dt><dd>{o.customer_reference}</dd></>}
              <dt>Afleverwijze</dt><dd>{{ meenemen: 'Klant neemt mee', bezorgen: 'Bezorgen door eigen team', verzenden: 'Verzenden met vervoerder' }[o.fulfilment]}</dd>
              <dt>Gewenst</dt><dd>{fmtDate(o.requested_date)}</dd>
              <dt>Beloofd</dt><dd>{fmtDate(o.promised_date)}</dd>
              {o.fulfilment !== 'meenemen' && <><dt>Adres</dt><dd>{o.delivery_name}<br />{o.delivery_address}<br />{o.delivery_postal_code} {o.delivery_city}</dd>
                <dt>Situatie</dt><dd>{[o.floor, o.has_elevator && 'lift', o.needs_assembly && 'montage', o.remove_old_furniture && 'oude meubels mee'].filter(Boolean).join(', ') || '–'}</dd></>}
              {o.delivery_notes && <><dt>Instructies</dt><dd>{o.delivery_notes}</dd></>}
              {o.notes && <><dt>Notitie</dt><dd>{o.notes}</dd></>}
            </dl>
          </section>
          <section className="panel">
            <h2>Betalingen</h2>
            <div className="totals" style={{ maxWidth: 'none' }}>
              <div><span>Ordertotaal</span><span>{eur(total)}</span></div>
              {payments.map((p) => <div key={p.id} className="small"><span className="muted">{fmtDate(p.paid_at)} {p.kind} ({p.method})</span><span>−{eur(p.amount)}</span></div>)}
              <div className="grand"><span>Nog te betalen</span><span>{eur(outstanding)}</span></div>
              {depositAvailable(s, id) > 0 && <div className="small muted"><span>Nog te verrekenen op factuur</span><span>{eur(depositAvailable(s, id))}</span></div>}
              {depositPaid(s, id) === 0 && payments.length === 0 && <div className="small muted"><span>Geen vooruitbetaling</span></div>}
            </div>
          </section>
          <section className="panel">
            <h2>Geschiedenis</h2>
            <ul className="timeline">{events.map((e) => (
              <li key={e.id}><time>{fmtDate(e.created_at).slice(0, 5)}</time><div>{e.message}
                {e.new_date && <div className="muted small">{e.old_date ? `${fmtDate(e.old_date)} naar ` : 'Nieuw: '}{fmtDate(e.new_date)}, klant {e.customer_notified ? 'geïnformeerd' : 'nog niet geïnformeerd'}</div>}
              </div></li>
            ))}</ul>
            {open && !lines.some((l) => shippedQty(s, l.id) > 0) && <button className="btn sm danger" style={{ marginTop: 14 }} onClick={() => setModal('cancel')}>Order annuleren</button>}
          </section>
        </div>
      </div>

      {modal === 'date' && <RescheduleModal order={o} onClose={() => setModal(null)} />}
      {modal === 'plan' && <PlanDeliveryModal order={o} onClose={() => setModal(null)} />}
      {modal === 'pay' && <PaymentModal order={o} onClose={() => setModal(null)} />}
      {modal === 'cancel' && <CancelModal order={o} onClose={() => setModal(null)} />}
    </>
  )
}

export function DeliveryPill({ d }: { d: Delivery }) {
  const today = todayISO()
  if (d.status === 'delivered') return <Pill tone="good">Geleverd {fmtDate(d.delivered_at)}</Pill>
  if (d.status === 'cancelled') return <Pill>Geannuleerd</Pill>
  if (d.status === 'in_transit') return <Pill tone="info">Onderweg</Pill>
  return <Pill tone={d.planned_date < today ? 'bad' : d.planned_date === today ? 'warn' : ''}>{fmtDate(d.planned_date)}</Pill>
}

const DATE_MSG: Record<string, (name: string, nr: string, date: string, reason: string) => string> = {
  es: (n, nr, d, r) => `Estimado/a ${n}: la fecha de entrega de su pedido ${nr} ha cambiado. La nueva fecha es ${d}.${r ? ` Motivo: ${r}.` : ''} Disculpe las molestias. Bella Outdoor and Furnishing`,
  nl: (n, nr, d, r) => `Beste ${n}, de leverdatum van uw order ${nr} is gewijzigd. De nieuwe datum is ${d}.${r ? ` Reden: ${r}.` : ''} Onze excuses voor het ongemak. Bella Outdoor and Furnishing`,
  en: (n, nr, d, r) => `Dear ${n}, the delivery date of your order ${nr} has changed. The new date is ${d}.${r ? ` Reason: ${r}.` : ''} We apologise for the inconvenience. Bella Outdoor and Furnishing`,
}

export function RescheduleModal({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { s, run, toast } = useApp()
  const [date, setDate] = useState(order.promised_date ?? '')
  const [reason, setReason] = useState('')
  const [notified, setNotified] = useState(false)
  const c = s.customers.find((x) => x.id === order.customer_id)!
  const planned = s.deliveries.filter((d) => d.sales_order_id === order.id && d.status === 'planned')
  const message = date ? DATE_MSG[c.language](c.name, order.number, fmtDate(date), reason) : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); toast('Bericht gekopieerd') } catch { toast('Kopiëren lukte niet. Selecteer de tekst handmatig.', true) }
  }
  return (
    <Modal title="Leverdatum aanpassen" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => rescheduleOrder(db, order.id, { new_date: date, reason, customer_notified: notified }), 'Leverdatum aangepast')) onClose() }}>Leverdatum opslaan</button>
    </>}>
      <div className="form-grid">
        <TextField label="Nieuwe leverdatum" type="date" value={date} onChange={setDate} hint={`Nu: ${fmtDate(order.promised_date)}`} />
        <TextField className="span-2" label="Reden" value={reason} onChange={setReason} placeholder="Bijvoorbeeld op verzoek van de klant" />
      </div>
      {planned.length > 0 && <div className="note">{planned.length === 1 ? 'De geplande levering schuift mee' : `De ${planned.length} geplande leveringen schuiven mee`} naar deze datum.</div>}
      {message && <div className="stack" style={{ gap: 6 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}><span className="lbl">Bericht voor de klant</span><button className="btn sm" onClick={copy}><Copy size={14} />Kopiëren</button></div>
        <div className="note" style={{ userSelect: 'text' }}>{message}</div>
      </div>}
      <Check label="Klant is geïnformeerd" checked={notified} onChange={setNotified} />
    </Modal>
  )
}

export function PlanDeliveryModal({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { s, run } = useApp()
  const lines = orderLines(s, order.id).filter((l) => l.qty - plannedQty(s, l.id) > 0)
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.warehouse_id ? l.qty - plannedQty(s, l.id) : 0])))
  const [date, setDate] = useState(order.promised_date ?? order.requested_date ?? todayISO())
  const [method, setMethod] = useState<Delivery['method']>(defaultMethod(order.fulfilment))
  const [slot, setSlot] = useState('')
  const [carrier, setCarrier] = useState('')
  const [notes, setNotes] = useState('')
  const hand = onHandMap(s)
  const isPartial = lines.some((l) => qty[l.id] < l.qty - plannedQty(s, l.id))
  return (
    <Modal wide title={isPartial ? 'Deellevering plannen' : 'Levering plannen'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" onClick={async () => {
        if (await run((db) => createDelivery(db, { sales_order_id: order.id, method, planned_date: date, time_slot: slot, carrier, notes, lines: Object.entries(qty).map(([sales_order_line_id, q]) => ({ sales_order_line_id, qty: q })) }), 'Levering gepland')) onClose()
      }}>Levering plannen</button>
    </>}>
      <div className="form-grid">
        <TextField label="Leverdatum" type="date" value={date} onChange={setDate} />
        <SelectField label="Wijze" value={method} onChange={setMethod} options={[{ value: 'eigen_team', label: 'Eigen team' }, { value: 'vervoerder', label: 'Vervoerder' }, { value: 'meenemen', label: 'Klant haalt op' }]} />
        <TextField label="Tijdvak" value={slot} onChange={setSlot} placeholder="09:00-12:00" />
        <TextField label={method === 'eigen_team' ? 'Team of chauffeur' : 'Vervoerder'} value={carrier} onChange={setCarrier} />
      </div>
      <div className="table-wrap flush"><table>
        <thead><tr><th>Product</th><th>Uit magazijn</th><th className="num">Aanwezig</th><th className="num">Open</th><th>Mee in deze levering</th></tr></thead>
        <tbody>{lines.map((l) => {
          const open = l.qty - plannedQty(s, l.id)
          const here = l.warehouse_id ? hand.get(stockKey(l.product_id, l.warehouse_id)) ?? 0 : 0
          return (
            <tr key={l.id}>
              <td>{l.description}</td>
              <td>{l.warehouse_id ? s.warehouses.find((w) => w.id === l.warehouse_id)?.name : <Pill tone="warn">Nog niet binnen</Pill>}</td>
              <td className="num">{l.warehouse_id ? here : '–'}</td><td className="num">{open}</td>
              <td><input className="qty" aria-label={`Aantal ${l.description}`} type="number" min={0} max={open} disabled={!l.warehouse_id} value={qty[l.id]} onChange={(e) => setQty((v) => ({ ...v, [l.id]: Number(e.target.value) }))} /></td>
            </tr>
          )
        })}</tbody>
      </table></div>
      <TextField label="Notitie voor deze levering" value={notes} onChange={setNotes} />
    </Modal>
  )
}

function PaymentModal({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { s, run } = useApp()
  const [amount, setAmount] = useState(orderOutstanding(s, order.id))
  const [method, setMethod] = useState<Payment['method']>('pin')
  const [date, setDate] = useState(todayISO())
  const [ref, setRef] = useState('')
  return (
    <Modal title="Vooruitbetaling registreren" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Annuleren</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => addOrderPayment(db, { sales_order_id: order.id, amount, method, paid_at: date, reference: ref }), 'Betaling geregistreerd')) onClose() }}>Betaling registreren</button>
    </>}>
      <div className="form-grid">
        <NumberField label="Bedrag" value={amount} step="0.01" min={0} onChange={setAmount} />
        <SelectField label="Betaalwijze" value={method} onChange={setMethod} options={[{ value: 'pin', label: 'Pin' }, { value: 'contant', label: 'Contant' }, { value: 'overboeking', label: 'Overboeking' }, { value: 'online', label: 'Online' }]} />
        <TextField label="Datum" type="date" value={date} onChange={setDate} />
        <TextField label="Referentie" value={ref} onChange={setRef} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>Wordt verrekend op de eerstvolgende factuur van deze order.</p>
    </Modal>
  )
}

function CancelModal({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { run } = useApp()
  const [reason, setReason] = useState('')
  return (
    <Modal title={`${order.number} annuleren?`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Terug</button>
      <button className="btn danger" onClick={async () => { if (await run((db) => cancelOrder(db, order.id, reason), 'Order geannuleerd')) onClose() }}>Order annuleren</button>
    </>}>
      <p style={{ margin: 0 }}>Geplande leveringen vervallen en de reservering op de voorraad komt vrij. Eventuele vooruitbetalingen moet je zelf terugboeken.</p>
      <TextField label="Reden" value={reason} onChange={setReason} />
    </Modal>
  )
}
