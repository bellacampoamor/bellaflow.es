import { useMemo, useState } from 'react'
import { CalendarClock, Copy, FileText, Pencil, Plus, ReceiptText, Truck, UserPlus } from 'lucide-react'
import type { Delivery, Payment, SalesOrder } from '../data/types'
import { articleNo, flowCounts, linePurchaseStatus, linesToPurchase, depositAvailable, depositPaid, invoiceBalance, lineTotal, onHandMap, orderLines, orderOutstanding, orderStage, orderTotal, plannedQty, shippedQty, stockKey, todayISO, uninvoicedDeliveries } from '../domain/calc'
import { addOrderPayment, cancelOrder, createDelivery, defaultMethod, rescheduleOrder, setLineWarehouse } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Check, Empty, eur, fmtDate, Head, Modal, NumberField, NumInput, Pill, SelectField, Sku, Tabs, TextField, type Tone } from '../ui/kit'
import { tx } from '../i18n'
import { activeIn, currentPhase, followRank, inOrdersTab, orderFlow, ordersHref, PHASES, PHASE_LABEL, type FollowUp, type OrdersTab, type PhaseKey } from '../domain/orderFlow'
import { FlowTrack, FOLLOW_LABEL, MiniTrack, NextStep, PhaseCell, PHASE_ICON, phaseText } from '../ui/OrderFlowTrack'
import { replaceHash, useNavUi } from '../ui/nav'

const FOLLOW_TONE: Record<FollowUp, Tone> = { te_laat: 'bad', actie: 'sell', wacht: 'info', afgerond: 'good', geannuleerd: '' }

type Filter = OrdersTab

export function Orders({ tab = 'opvolgen', phase: initialPhase = null }: { tab?: OrdersTab; phase?: PhaseKey | null }) {
  const { s } = useApp()
  const [filter, setFilterState] = useState<Filter>(tab)
  const [phase, setPhaseState] = useState<PhaseKey | null>(initialPhase)
  // Tabblad en fase staan in de adresbalk, zodat een link (bijv. vanaf Overzicht) en Terug op dezelfde plek uitkomen.
  const remember = (f: Filter, p: PhaseKey | null) => replaceHash(ordersHref(f, p ?? undefined))
  const setFilter = (f: Filter) => { setFilterState(f); setPhaseState(null); remember(f, null) }
  const setPhase = (p: PhaseKey | null) => { setPhaseState(p); remember(filter, p) }
  const [q, setQ] = useNavUi('zoek', '')
  const today = todayISO()
  const rows = useMemo(() => s.sales_orders.map((o) => ({ o, flow: orderFlow(s, o, today), cust: s.customers.find((c) => c.id === o.customer_id) }))
    .sort((a, b) => followRank(a.flow.follow) - followRank(b.flow.follow) || b.o.order_date.localeCompare(a.o.order_date) || b.o.number.localeCompare(a.o.number)), [s, today])
  const t = q.trim().toLowerCase()
  const matches = (r: typeof rows[number]) => !t || `${r.o.number} ${r.cust?.name ?? ''} ${r.cust?.company ?? ''} ${r.o.customer_reference}`.toLowerCase().includes(t)
  const inTab = rows.filter((r) => inOrdersTab(filter, r.flow.follow) && matches(r))
  const shown = inTab.filter((r) => !phase || activeIn(r.flow, phase))
  const late = rows.filter((r) => r.flow.follow === 'te_laat').length
  const counts = flowCounts(s, today)
  return (
    <>
      <Head title={tx("Verkooporders")} sub={tx("Elke verkooporder loopt van links naar rechts door de flow. Koperkleur vraagt actie, rood is te laat, blauw loopt, groen is klaar.")}>
        <a className="btn" href="#levering"><Truck size={16} />{tx("Levering")}{counts.levering > 0 && <span className="btn-n">{tx("{0} vandaag", counts.levering)}</span>}</a>
        <a className="btn" href="#facturatie"><ReceiptText size={16} />{tx("Facturatie")}{counts.facturatie > 0 && <span className="btn-n">{tx("{0} te factureren", counts.facturatie)}</span>}</a>
        <a className="btn primary" href="#orders-nieuw"><Plus size={16} />{tx("Nieuwe verkooporder")}</a>
      </Head>
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-end' }}>
          <Tabs<Filter> value={filter} onChange={setFilter} tabs={(['opvolgen', 'loopt', 'afgerond', 'alle'] as Filter[]).map((f) => ({ value: f, label: { opvolgen: tx("Opvolgen"), loopt: tx("Loopt"), afgerond: tx("Afgerond"), alle: tx("Alles") }[f], n: rows.filter((r) => inOrdersTab(f, r.flow.follow)).length }))} />
          <input style={{ maxWidth: 280, marginBottom: 14 }} aria-label={tx("Verkooporders zoeken")} placeholder={tx("Zoek op nummer of klant")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          {{ opvolgen: tx("Verkooporders waar iemand iets moet doen, wat te laat is bovenaan."), loopt: tx("Verkooporders die op schema lopen: goederen onderweg of bezorging gepland. Hier hoeft nu niemand iets te doen."), afgerond: tx("Volledig geleverd en gefactureerd."), alle: tx("Alle verkooporders, ook geannuleerde.") }[filter]}
          {filter === 'opvolgen' && late > 0 && <> <strong style={{ color: 'var(--bad)' }}>{tx("{0} te laat.", late)}</strong></>}
        </p>
        {inTab.length === 0 && <Empty>{filter === 'opvolgen' ? tx("Niets op te volgen. Alles loopt.") : tx("Geen verkooporders in dit overzicht.")}</Empty>}
        {inTab.length > 0 && <div className="table-wrap sticky-flow"><table className="flow-table">
          <thead><tr>
            <th aria-label="PDF" /><th>{tx("Verkooporder")}</th>
            {PHASES.map((k, i) => {
              const Icon = PHASE_ICON[k]
              const n = inTab.filter((r) => activeIn(r.flow, k)).length
              return (
                <th key={k} className={`ph-head${phase === k ? ' on' : ''}`}>
                  <button type="button" onClick={() => setPhase(phase === k ? null : k)} aria-pressed={phase === k} title={phase === k ? tx("Filter op deze fase opheffen") : tx("Alleen verkooporders in deze fase")}>
                    <span className="ph-head-n"><Icon size={14} />{i + 1}</span>
                    <span className="ph-head-l">{tx(PHASE_LABEL[k])}</span>
                    <span className="ph-head-c">{n > 0 ? n : ''}</span>
                  </button>
                </th>
              )
            })}
            <th>{tx("Volgende stap")}</th>
          </tr></thead>
          <tbody>{shown.map(({ o, flow, cust }) => {
            const cur = currentPhase(flow)
            return (
              <tr key={o.id} className={`click fl-${flow.follow}${o.status === 'proforma' ? ' is-proforma' : ''}`} onClick={() => go(`orders-${o.id}`)}>
                <td><a className="pdf-ic" href={`#orders-print-${o.id}`} title={tx("Verkooporder {0} afdrukken als PDF", o.number)} aria-label={tx("Verkooporder {0} afdrukken als PDF", o.number)} onClick={(e) => e.stopPropagation()}><FileText size={18} /><span>PDF</span></a></td>
                <td className="fl-who">
                  <a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a>
                  <div>{cust ? cust.company || cust.name : <span className="muted">{tx("Nog geen klant")}, {s.salespeople.find((x) => x.id === o.salesperson_id)?.name}</span>}</div>
                  <div className="muted small">{fmtDate(o.order_date)}, {eur(orderTotal(s, o.id))}{o.status === 'cancelled' && <> <Pill>{tx("Geannuleerd")}</Pill></>}</div>
                  <MiniTrack flow={flow} />
                </td>
                {flow.phases.map((p) => <td key={p.key} className="ph-td"><PhaseCell phase={p} current={p.key === cur && flow.follow !== 'afgerond'} /></td>)}
                <td className="fl-next"><NextStep flow={flow} /></td>
              </tr>
            )
          })}</tbody>
        </table></div>}
        {inTab.length > 0 && shown.length === 0 && <Empty>{tx("Geen verkooporders in deze fase.")}</Empty>}
        {phase && <p className="small muted">{tx("Gefilterd op fase {0}.", tx(PHASE_LABEL[phase]))} <button type="button" className="btn sm" onClick={() => setPhase(null)}>{tx("Toon alle fasen")}</button></p>}
      </section>
    </>
  )
}

export function OrderDetail({ id }: { id: string }) {
  const { s, run } = useApp()
  const o = s.sales_orders.find((x) => x.id === id)
  const [modal, setModal] = useState<'date' | 'plan' | 'pay' | 'cancel' | null>(null)
  const withSku = (l?: { product_id: string; description: string }) => `${articleNo(s, l?.product_id)} ${l?.description ?? ''}`.trim()
  if (!o) return <div className="panel">{tx("Verkooporder niet gevonden.")} <a href="#orders">{tx("Terug naar verkooporders")}</a>.</div>
  const c = s.customers.find((x) => x.id === o.customer_id)
  const proforma = o.status === 'proforma'
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
  const flow = orderFlow(s, o)
  const onOrder = lines.filter((l) => l.source === 'bestelling')
  const arrivals = onOrder.filter((l) => shippedQty(s, l.id) < l.qty && linePurchaseStatus(s, l.id).received < l.qty).map((l) => {
    const st = linePurchaseStatus(s, l.id)
    const next = st.shipments.filter((x) => x.transport_id && (x.status === 'expected' || x.status === 'partial')).sort((a, b) => a.expected_date.localeCompare(b.expected_date))[0]
    return { id: l.id, qty: l.qty, description: withSku(l), bought: st.purchased >= l.qty, date: next?.expected_date, transport: s.transports.find((t) => t.id === next?.transport_id)?.number }
  })
  const toPurchase = linesToPurchase(s).filter((l) => l.sales_order_id === id).length
  const plannable = lines.filter((l) => l.warehouse_id && l.qty - plannedQty(s, l.id) > 0)

  return (
    <>
      <Head title={o.number} sub={<>{c ? c.company || c.name : tx("Nog geen klant")}, {fmtDate(o.order_date)} <Pill tone={proforma ? 'proforma' : FOLLOW_TONE[flow.follow]}>{proforma ? tx("Proforma") : tx(FOLLOW_LABEL[flow.follow])}</Pill></>} back={{ href: '#orders', label: tx("Verkooporders") }}>
        {proforma && <>
          <button className="btn danger" onClick={() => setModal('cancel')}>{tx("Proforma annuleren")}</button>
          <a className="btn primary" href={`#orders-wijzig-${id}`}><UserPlus size={16} />{tx("Klant invullen en bevestigen")}</a>
        </>}
        {open && stage !== 'gefactureerd' && <>
          {shipped < qty && <button className="btn" onClick={() => setModal('date')}><CalendarClock size={16} />{tx("Leverdatum")}</button>}
          <a className="btn" href={`#orders-wijzig-${id}`}><Pencil size={16} />{tx("Wijzigen")}</a>
          <button className="btn" onClick={() => setModal('pay')}>{tx("Betaling")}</button>
          <button className="btn primary" disabled={!plannable.length} onClick={() => setModal('plan')}><Truck size={16} />{tx("Levering plannen")}</button>
        </>}
      </Head>

      {proforma && (
        <div className="note proforma" style={{ marginBottom: 16 }}>
          <div>
            <strong>{tx("Proforma, nog geen verkooporder")}</strong>
            <div>{tx("Gescand door {0} in de winkel. {1} is een tijdelijk nummer. Vul samen met de klant de klantgegevens in en bevestig; dan krijgt de verkooporder zijn VO-nummer en start de levering en inkoop. De gescande artikelen zijn zolang gereserveerd.", s.salespeople.find((x) => x.id === o.salesperson_id)?.name ?? '–', o.number)}</div>
          </div>
          <a className="btn primary" href={`#orders-wijzig-${id}`}><UserPlus size={16} />{tx("Klant invullen en bevestigen")}</a>
        </div>
      )}

      {open && arrivals.length > 0 && (
        <div className="note" style={{ marginBottom: 16 }}>
          <strong>{tx("Verwachte ontvangst")}</strong>
          {arrivals.map((r) => <div key={r.id}>{tx("{0} × {1}", r.qty, r.description)}: {r.date ? <strong>{fmtDate(r.date)}</strong> : <span className="muted">{r.bought ? tx("ingekocht, nog niet op een transport") : tx("nog niet ingekocht")}</span>}{r.transport ? ` (${r.transport})` : ''}</div>)}
        </div>
      )}

      <section className="panel" style={{ marginBottom: 16 }}>
        <FlowTrack flow={flow} />
        {!proforma && flow.next && flow.follow !== 'geannuleerd' && (
          <div className={`flow-next fl-${flow.follow}`}>
            <div>
              <span className="lbl">{flow.follow === 'wacht' ? tx("Loopt, nu geen actie") : flow.follow === 'te_laat' ? tx("Te laat, eerst doen") : tx("Volgende stap")}</span>
              <strong>{tx(PHASE_LABEL[flow.next.key])}: {phaseText(flow.next)}</strong>
            </div>
            {flow.follow !== 'wacht' && (flow.next.key === 'planning'
              ? <button className="btn primary" disabled={!plannable.length} onClick={() => setModal('plan')}><Truck size={16} />{tx("Levering plannen")}</button>
              : flow.next.href && <a className="btn primary" href={flow.next.href}>{tx("Naar {0}", tx(PHASE_LABEL[flow.next.key]).toLowerCase())}</a>)}
          </div>
        )}
        {flow.follow === 'afgerond' && <div className="flow-next fl-afgerond"><strong>{tx("Afgerond: volledig geleverd en gefactureerd.")}</strong></div>}
      </section>

      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>{tx("Producten")}</h2>
            <div className="table-wrap"><table>
              <thead><tr><th>{tx("Product")}</th><th>{tx("Magazijn")}</th><th className="num">{tx("Aantal")}</th><th className="num">{tx("Gepland")}</th><th className="num">{tx("Geleverd")}</th><th className="num">{tx("Prijs")}</th><th className="num">{tx("Korting")}</th><th className="num">{tx("Totaal")}</th></tr></thead>
              <tbody>{lines.map((l) => {
                const unplanned = plannedQty(s, l.id) === 0
                const here = l.warehouse_id ? hand.get(stockKey(l.product_id, l.warehouse_id)) ?? 0 : 0
                return (
                  <tr key={l.id}>
                    <td className="strong">{l.description}<Sku code={articleNo(s, l.product_id)} />{l.take_now && <> <Pill tone="good">{tx("Meegenomen")}</Pill></>}{l.options && <div className="muted small" style={{ fontWeight: 400 }}>{l.options}</div>}</td>
                    <td style={{ minWidth: 170 }}>
                      {!l.warehouse_id ? <Pill tone="warn">{tx("Op bestelling")}</Pill>
                        : open && unplanned ? (
                          <select aria-label={tx("Magazijn voor {0}", l.description)} value={l.warehouse_id} onChange={(e) => run((db) => setLineWarehouse(db, l.id, e.target.value), tx("Magazijn aangepast"))}>
                            {s.warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name} ({hand.get(stockKey(l.product_id, w.id)) ?? 0})</option>)}
                          </select>
                        ) : s.warehouses.find((w) => w.id === l.warehouse_id)?.name}
                      {l.warehouse_id && unplanned && here < l.qty && <div className="small" style={{ color: 'var(--bad)' }}>{here} {tx("aanwezig")}</div>}
                    </td>
                    <td className="num">{l.qty}</td><td className="num">{plannedQty(s, l.id)}</td><td className="num">{shippedQty(s, l.id)}</td>
                    <td className="num">{eur(l.unit_price)}</td><td className="num">{l.discount_pct ? `${l.discount_pct}%` : <span className="zero">0</span>}</td>
                    <td className="num">{eur(lineTotal(l))}</td>
                  </tr>
                )
              })}</tbody>
              <tfoot><tr><td colSpan={7}>{tx("Totaal incl. IVA")}</td><td className="num">{eur(total)}</td></tr></tfoot>
            </table></div>
          </section>

          {!proforma && onOrder.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h2>{tx("Inkoop voor deze verkooporder")}</h2>
                {open && toPurchase > 0 && <a className="btn sm primary" href={`#inkoop-nieuw-order-${id}`}><Plus size={14} />{tx("Inkooporder maken")}</a>}
              </div>
              <div className="table-wrap"><table>
                <thead><tr><th>{tx("Product")}</th><th className="num">{tx("Op bestelling")}</th><th className="num">{tx("Ingekocht")}</th><th className="num">{tx("Binnen")}</th><th>{tx("Inkooporder")}</th><th>{tx("Verwacht")}</th></tr></thead>
                <tbody>{onOrder.map((l) => {
                  const st = linePurchaseStatus(s, l.id)
                  const next = st.shipments.filter((x) => x.transport_id && (x.status === 'expected' || x.status === 'partial')).sort((a, b) => a.expected_date.localeCompare(b.expected_date))[0]
                  return (
                    <tr key={l.id}>
                      <td className="strong">{l.description}<Sku code={articleNo(s, l.product_id)} />{l.options && <div className="muted small" style={{ fontWeight: 400 }}>{l.options}</div>}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num" style={st.purchased < l.qty ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{st.purchased}</td>
                      <td className="num">{st.received}</td>
                      <td>{st.orders.map((p, i) => <span key={p.id}>{i > 0 && ', '}<a className="rowlink" href={`#inkoop-${p.id}`}>{p.number}</a></span>)}
                        {st.purchased < l.qty && (() => {
                          // Wat nog niet is ingekocht, staat op een proforma-inkooporder die omgezet kan worden.
                          const pf = s.purchase_orders.find((p) => p.status === 'proforma' && s.purchase_order_lines.some((x) => x.purchase_order_id === p.id && x.sales_order_line_id === l.id))
                          return <>{st.orders.length > 0 && ' '}{pf ? <a href={`#inkoop-${pf.id}`}><Pill tone="warn">{tx("Proforma {0}", pf.number)}</Pill></a> : <Pill tone="warn">{tx("Nog in te kopen")}</Pill>}</>
                        })()}</td>
                      <td>{next ? <>{fmtDate(next.expected_date)}{next.transport_id && <div className="muted small">{s.transports.find((t) => t.id === next.transport_id)?.number}</div>}</> : '–'}</td>
                    </tr>
                  )
                })}</tbody>
              </table></div>
            </section>
          )}

          {!proforma && <><section className="panel">
            <div className="panel-head"><h2>{tx("Leveringen")}</h2></div>
            {deliveries.length === 0 && <Empty>{plannable.length ? tx("Nog niets gepland. Plan alles ineens of in delen.") : tx("Plannen kan zodra de goederen binnen zijn.")}</Empty>}
            {deliveries.map((d) => (
              <a key={d.id} href={d.status === 'planned' || d.status === 'cancelled' || d.method === 'meenemen' ? `#levering-naar-${d.id}` : `#levering-${d.id}`} className="task">
                <div><div className="task-t">{d.number}{d.sequence > 1 || deliveries.length > 1 ? tx(", deellevering {0}", d.sequence) : ''}</div>
                  <div className="muted small">{s.delivery_lines.filter((l) => l.delivery_id === d.id).map((l) => tx("{0} × {1}", l.qty, withSku(lines.find((x) => x.id === l.sales_order_line_id)))).join(', ')}</div></div>
                <DeliveryPill d={d} />
              </a>
            ))}
          </section>

          <section className="panel">
            <h2>{tx("Facturen")}</h2>
            {invoices.length === 0 && <Empty>{uninvoicedDeliveries(s, id).length ? <>{tx("Er is geleverd en nog niet gefactureerd.")} <a href="#facturatie">{tx("Naar facturatie")}</a>.</> : tx("Facturen volgen na levering.")}</Empty>}
            {invoices.map((i) => {
              const bal = invoiceBalance(s, i)
              return (
                <a key={i.id} href={`#facturatie-${i.id}`} className="task">
                  <div><div className="task-t"><span className="pdf-ic" title={tx("Factuur {0} openen als PDF", i.number)}><FileText size={16} /><span>PDF</span></span> {i.number}</div><div className="muted small">{fmtDate(i.invoice_date)}, {tx(i.kind)}, {eur(i.total)}{i.deposit_settled ? tx(", {0} verrekend", eur(i.deposit_settled)) : ''}</div></div>
                  <Pill tone={bal <= 0 ? 'good' : 'bill'}>{bal <= 0 ? tx("Betaald") : tx("Open {0}", eur(bal))}</Pill>
                </a>
              )
            })}
          </section></>}
        </div>

        <div className="stack">
          <section className="panel">
            <h2>{tx("Klant en levering")}</h2>
            <dl className="dl">
              <dt>{tx("Klant")}</dt><dd>{c ? <><div>{c.company || c.name}</div><div className="muted small">{[c.phone, c.email].filter(Boolean).join(', ')}</div></> : <span className="muted">{tx("Nog geen klant")}</span>}</dd>
              {o.customer_reference && <><dt>{tx("Referentie")}</dt><dd>{o.customer_reference}</dd></>}
              <dt>{tx("Verkoper")}</dt><dd>{s.salespeople.find((x) => x.id === o.salesperson_id)?.name ?? '–'}</dd>
              {!proforma && <><dt>{tx("Afleverwijze")}</dt><dd>{{ meenemen: tx("Klant neemt mee"), bezorgen: tx("Bezorgen door eigen team"), verzenden: tx("Verzenden met vervoerder") }[o.fulfilment]}</dd>
              <dt>{tx("Gewenst")}</dt><dd>{fmtDate(o.requested_date)}</dd>
              <dt>{shipped > 0 ? tx("Beloofd, nog te leveren") : tx("Beloofd")}</dt><dd>{fmtDate(o.promised_date)}</dd></>}
              {o.fulfilment !== 'meenemen' && <><dt>{tx("Adres")}</dt><dd>{o.delivery_name}<br />{o.delivery_address}<br />{o.delivery_postal_code} {o.delivery_city}</dd>
                <dt>{tx("Situatie")}</dt><dd>{[o.floor, o.has_elevator && 'lift', o.needs_assembly && 'montage', o.remove_old_furniture && tx("oude meubels mee")].filter(Boolean).join(', ') || '–'}</dd></>}
              {o.delivery_notes && <><dt>{tx("Instructies")}</dt><dd>{o.delivery_notes}</dd></>}
              {o.notes && <><dt>{tx("Notitie")}</dt><dd>{o.notes}</dd></>}
            </dl>
          </section>
          <section className="panel">
            <h2>{tx("Betalingen")}</h2>
            <div className="totals" style={{ maxWidth: 'none' }}>
              <div><span>{tx("Totaal verkooporder")}</span><span>{eur(total)}</span></div>
              {payments.map((p) => <div key={p.id} className="small"><span className="muted">{fmtDate(p.paid_at)} {tx(p.kind)} ({tx(p.method)})</span><span>−{eur(p.amount)}</span></div>)}
              <div className="grand"><span>{tx("Nog te betalen")}</span><span>{eur(outstanding)}</span></div>
              {depositAvailable(s, id) > 0 && <div className="small muted"><span>{tx("Nog te verrekenen op factuur")}</span><span>{eur(depositAvailable(s, id))}</span></div>}
              {depositPaid(s, id) === 0 && payments.length === 0 && <div className="small muted"><span>{tx("Geen vooruitbetaling")}</span></div>}
            </div>
          </section>
          <section className="panel">
            <h2>{tx("Geschiedenis")}</h2>
            <ul className="timeline">{events.map((e) => (
              <li key={e.id}><time>{fmtDate(e.created_at).slice(0, 5)}</time><div>{e.message}
                {e.new_date && <div className="muted small">{e.old_date ? tx("{0} naar ", fmtDate(e.old_date)) : tx("Nieuw: ")}{fmtDate(e.new_date)}{tx(", klant")} {e.customer_notified ? 'geïnformeerd' : tx("nog niet geïnformeerd")}</div>}
              </div></li>
            ))}</ul>
            {open && !lines.some((l) => shippedQty(s, l.id) > 0) && <button className="btn sm danger" style={{ marginTop: 14 }} onClick={() => setModal('cancel')}>{tx("Verkooporder annuleren")}</button>}
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
  if (d.status === 'delivered') return <Pill tone="good">{tx("Geleverd")} {fmtDate(d.delivered_at)}</Pill>
  if (d.status === 'cancelled') return <Pill>{tx("Geannuleerd")}</Pill>
  if (d.status === 'ready') return <Pill tone="good">{tx("Klaargezet,")} {fmtDate(d.planned_date)}</Pill>
  if (d.status === 'in_transit') return <Pill tone="info">{tx("Onderweg")}</Pill>
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
  const planned = s.deliveries.filter((d) => d.sales_order_id === order.id && (d.status === 'planned' || d.status === 'ready'))
  const delivered = s.deliveries.filter((d) => d.sales_order_id === order.id && d.status === 'delivered')
  const remaining = orderLines(s, order.id).map((l) => ({ id: l.id, description: `${articleNo(s, l.product_id)} ${l.description}`.trim(), qty: l.qty - shippedQty(s, l.id) })).filter((r) => r.qty > 0)
  const message = date ? DATE_MSG[c.language](c.name, order.number, fmtDate(date), reason) : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); toast(tx("Bericht gekopieerd")) } catch { toast(tx("Kopiëren lukte niet. Selecteer de tekst handmatig."), true) }
  }
  return (
    <Modal title={tx("Leverdatum aanpassen")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => rescheduleOrder(db, order.id, { new_date: date, reason, customer_notified: notified }), tx("Leverdatum aangepast"))) onClose() }}>{tx("Leverdatum opslaan")}</button>
    </>}>
      {delivered.length > 0 && (
        <div className="note">
          <strong>{tx("Geldt alleen voor wat nog geleverd moet worden")}</strong>
          {remaining.map((r) => <div key={r.id}>{tx("{0} × {1}", r.qty, r.description)}</div>)}
          <div className="muted small" style={{ marginTop: 6 }}>{tx("Al geleverd, blijft ongewijzigd:")} {delivered.map((d) => tx("{0} op {1}", d.number, fmtDate(d.delivered_at))).join(', ')}</div>
        </div>
      )}
      <div className="form-grid">
        <TextField label={tx("Nieuwe leverdatum")} type="date" value={date} onChange={setDate} hint={tx("Nu: {0}", fmtDate(order.promised_date))} />
        <TextField className="span-2" label={tx("Reden")} value={reason} onChange={setReason} placeholder={tx("Bijvoorbeeld op verzoek van de klant")} />
      </div>
      {planned.length > 0 && <div className="note">{planned.length === 1 ? tx("De geplande levering schuift mee") : tx("De {0} geplande leveringen schuiven mee", planned.length)} {tx("naar deze datum.")}</div>}
      {message && <div className="stack" style={{ gap: 6 }}>
        <div className="panel-head" style={{ marginBottom: 0 }}><span className="lbl">{tx("Bericht voor de klant")}</span><button className="btn sm" onClick={copy}><Copy size={14} />{tx("Kopiëren")}</button></div>
        <div className="note" style={{ userSelect: 'text' }}>{message}</div>
      </div>}
      <Check label={tx("Klant is geïnformeerd")} checked={notified} onChange={setNotified} />
    </Modal>
  )
}

export function PlanDeliveryModal({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { s, run } = useApp()
  const lines = orderLines(s, order.id).filter((l) => l.qty - plannedQty(s, l.id) > 0)
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(lines.map((l) => [l.id, l.warehouse_id ? Math.min(l.qty - plannedQty(s, l.id), Math.max(0, onHandMap(s).get(stockKey(l.product_id, l.warehouse_id)) ?? 0)) : 0])))
  const [date, setDate] = useState(order.promised_date ?? order.requested_date ?? todayISO())
  const [method, setMethod] = useState<Delivery['method']>(defaultMethod(order.fulfilment))
  const [carrier, setCarrier] = useState('')
  const [notes, setNotes] = useState('')
  const hand = onHandMap(s)
  const isPartial = lines.some((l) => qty[l.id] < l.qty - plannedQty(s, l.id))
  return (
    <Modal wide title={isPartial ? tx("Deellevering plannen") : tx("Levering plannen")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={async () => {
        if (await run((db) => createDelivery(db, { sales_order_id: order.id, method, planned_date: date, carrier: method === 'vervoerder' ? carrier : '', notes, lines: Object.entries(qty).map(([sales_order_line_id, q]) => ({ sales_order_line_id, qty: q })) }), tx("Levering gepland"))) onClose()
      }}>{tx("Levering plannen")}</button>
    </>}>
      <div className="form-grid">
        <TextField label={tx("Leverdatum")} type="date" value={date} onChange={setDate} />
        <SelectField label={tx("Wijze")} value={method} onChange={setMethod} options={[{ value: 'eigen_team', label: tx("Bezorgen door eigen team") }, { value: 'vervoerder', label: tx("Vervoerder") }, { value: 'meenemen', label: tx("Klant haalt op") }]} />
        {method === 'vervoerder' && <TextField label={tx("Vervoerder")} value={carrier} onChange={setCarrier} />}
      </div>
      <div className="table-wrap flush"><table>
        <thead><tr><th>{tx("Product")}</th><th>{tx("Uit magazijn")}</th><th className="num">{tx("Aanwezig")}</th><th className="num">{tx("Open")}</th><th>{tx("Mee in deze levering")}</th></tr></thead>
        <tbody>{lines.map((l) => {
          const open = l.qty - plannedQty(s, l.id)
          const here = l.warehouse_id ? hand.get(stockKey(l.product_id, l.warehouse_id)) ?? 0 : 0
          return (
            <tr key={l.id}>
              <td>{l.description}<Sku code={articleNo(s, l.product_id)} /></td>
              <td>{l.warehouse_id ? s.warehouses.find((w) => w.id === l.warehouse_id)?.name : <Pill tone="warn">{tx("Nog niet binnen")}</Pill>}</td>
              <td className="num">{l.warehouse_id ? here : '–'}</td><td className="num">{open}</td>
              <td><NumInput className="qty" aria-label={tx("Aantal {0}", l.description)} min={0} max={open} disabled={!l.warehouse_id} value={qty[l.id]} onValue={(n) => setQty((v) => ({ ...v, [l.id]: n }))} /></td>
            </tr>
          )
        })}</tbody>
      </table></div>
      <TextField label={tx("Notitie voor deze levering")} value={notes} onChange={setNotes} />
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
    <Modal title={tx("Vooruitbetaling registreren")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={async () => { if (await run((db) => addOrderPayment(db, { sales_order_id: order.id, amount, method, paid_at: date, reference: ref }), tx("Betaling geregistreerd"))) onClose() }}>{tx("Betaling registreren")}</button>
    </>}>
      <div className="form-grid">
        <NumberField label={tx("Bedrag")} value={amount} step="0.01" min={0} onChange={setAmount} />
        <SelectField label={tx("Betaalwijze")} value={method} onChange={setMethod} options={[{ value: 'pin', label: tx("Pin") }, { value: 'contant', label: tx("Contant") }, { value: 'overboeking', label: tx("Overboeking") }, { value: 'online', label: tx("Online") }]} />
        <TextField label={tx("Datum")} type="date" value={date} onChange={setDate} />
        <TextField label={tx("Referentie")} value={ref} onChange={setRef} />
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tx("Wordt verrekend op de eerstvolgende factuur van deze verkooporder.")}</p>
    </Modal>
  )
}

function CancelModal({ order, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { run } = useApp()
  const [reason, setReason] = useState('')
  return (
    <Modal title={tx("{0} annuleren?", order.number)} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Terug")}</button>
      <button className="btn danger" onClick={async () => { if (await run((db) => cancelOrder(db, order.id, reason), tx("Verkooporder geannuleerd"))) onClose() }}>{tx("Verkooporder annuleren")}</button>
    </>}>
      <p style={{ margin: 0 }}>{tx("Geplande leveringen vervallen en de reservering op de voorraad komt vrij. Eventuele vooruitbetalingen moet je zelf terugboeken.")}</p>
      <TextField label={tx("Reden")} value={reason} onChange={setReason} />
    </Modal>
  )
}
