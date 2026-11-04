import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { linesToPurchase, purchaseKind, round2, shipmentIsOpen, todayISO } from '../domain/calc'
import { assignShipmentsToTransport, cancelPurchaseOrder, createPurchaseOrder, setShipmentWarehouse } from '../domain/services'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { AreaField, Combo, Empty, eur, fmtDate, Head, Modal, Pill, SelectField, Tabs, TextField, type Tone } from '../ui/kit'
import { PurchaseQueue } from './PurchaseQueue'

type Snap = ReturnType<typeof useApp>['s']

/** Stand van een inkooporder. Ingekocht is altijd alles; de vraag is of elke regel op een transport staat. */
export function poProgress(s: Snap, poId: string) {
  const lines = s.inbound_shipments.filter((x) => x.purchase_order_id === poId)
  return { total: lines.length, planned: lines.filter((x) => x.transport_id).length, received: lines.filter((x) => !shipmentIsOpen(x)).length }
}

export function Purchases() {
  const { s } = useApp()
  const waiting = linesToPurchase(s)
  const [tab, setTab] = useState<'queue' | 'orders'>(waiting.length ? 'queue' : 'orders')
  const rows = [...s.purchase_orders].sort((a, b) => b.order_date.localeCompare(a.order_date) || b.number.localeCompare(a.number))
  return (
    <>
      <Head title={tx("Inkooporders")} sub={tx("Gedurende de dag ontstaan verkooporders. Zet de regels die ingekocht moeten worden door naar een inkooporder bij de leverancier.")}>
        <a className="btn primary" href="#inkoop-nieuw"><Plus size={16} />{tx("Nieuwe inkooporder")}</a>
      </Head>
      <Tabs<'queue' | 'orders'> value={tab} onChange={setTab} tabs={[{ value: 'queue', label: tx("Door te zetten"), n: waiting.length }, { value: 'orders', label: tx("Inkooporders"), n: rows.length }]} />
      {tab === 'queue' && <PurchaseQueue onDone={() => setTab('orders')} />}
      {tab === 'orders' && <section className="panel">
        {rows.length === 0 && <Empty>{tx("Nog geen inkooporders. Maak de eerste met de knop rechtsboven.")}</Empty>}
        <div className="table-wrap"><table>
          <thead><tr><th>{tx("Nummer")}</th><th>{tx("Leverancier")}</th><th>{tx("Besteld")}</th><th>{tx("Soort")}</th><th>{tx("Referentie")}</th><th className="num">{tx("Op transport")}</th><th className="num">{tx("Waarde")}</th><th>{tx("Status")}</th></tr></thead>
          <tbody>{rows.map((po) => {
            const { total, planned, received } = poProgress(s, po.id)
            const value = round2(s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).reduce((n, l) => n + l.qty * l.unit_cost, 0))
            const [label, tone]: [string, Tone] = po.status === 'cancelled' ? [tx("Geannuleerd"), ''] : received === total ? [tx("Ontvangen"), 'good'] : planned === total ? [tx("Ingepland"), 'info'] : [tx("Besteld"), 'warn']
            return (
              <tr key={po.id} className="click" onClick={() => go(`inkoop-${po.id}`)}>
                <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a></td>
                <td>{s.suppliers.find((x) => x.id === po.supplier_id)?.name}</td>
                <td>{fmtDate(po.order_date)}</td><td><KindPill kind={purchaseKind(s, po.id)} /></td><td className="muted">{po.supplier_reference || '–'}</td>
                <td className="num">{tx("{0} van {1} regels", planned, total)}</td><td className="num">{eur(value)}</td>
                <td><Pill tone={tone}>{label}</Pill></td>
              </tr>
            )
          })}</tbody>
        </table></div>
      </section>}
    </>
  )
}

export function KindPill({ kind }: { kind: 'vulorder' | 'klantorder' | 'gemengd' }) {
  const map: Record<string, [string, Tone]> = { vulorder: [tx("Vulorder"), 'info'], klantorder: [tx("Voor verkooporder"), 'sell'], gemengd: [tx("Gemengd"), ''] }
  return <Pill tone={map[kind][1]}>{map[kind][0]}</Pill>
}

export function PurchaseDetail({ id }: { id: string }) {
  const { s, run } = useApp()
  const [confirm, setConfirm] = useState(false)
  const po = s.purchase_orders.find((p) => p.id === id)
  if (!po) return <div className="panel">{tx("Inkooporder niet gevonden.")} <a href="#inkoop">{tx("Terug naar inkoop")}</a>.</div>
  const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === id)
  const planned = s.transports.filter((t) => t.status === 'planned').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const shipmentOf = (lineId: string) => s.inbound_shipments.find((x) => s.inbound_shipment_lines.some((l) => l.shipment_id === x.id && l.purchase_order_line_id === lineId))!
  const supplier = s.suppliers.find((x) => x.id === po.supplier_id)
  const hasReceipts = lines.some((l) => s.goods_receipt_lines.some((r) => r.shipment_line_id === s.inbound_shipment_lines.find((x) => x.purchase_order_line_id === l.id)?.id))
  return (
    <>
      <Head title={<>{po.number} <KindPill kind={purchaseKind(s, po.id)} /></>} sub={tx("{0}, besteld op {1}{2}", supplier?.name, fmtDate(po.order_date), po.supplier_reference ? tx(", referentie {0}", po.supplier_reference) : '')} back={{ href: '#inkoop', label: tx("Inkooporders") }}>
        {po.status === 'open' && !hasReceipts && <button className="btn danger" onClick={() => setConfirm(true)}>{tx("Inkooporder annuleren")}</button>}
      </Head>
      <div className="stack">
        <section className="panel">
          <h2>{tx("Bestelde producten")}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{tx("Product")}</th><th>{tx("Voor")}</th><th className="num">{tx("Aantal")}</th><th className="num">{tx("Inkoopprijs")}</th><th className="num">{tx("Totaal")}</th><th style={{ minWidth: 190 }}>{tx("Transport")}</th><th>{tx("Verwacht")}</th><th style={{ minWidth: 170 }}>{tx("Bestemming")}</th></tr></thead>
            <tbody>{lines.map((l) => {
              const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)
              const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
              const x = shipmentOf(l.id)
              const t = s.transports.find((r) => r.id === x.transport_id)
              const open = shipmentIsOpen(x) && po.status === 'open'
              return (
                <tr key={l.id}>
                  <td className="strong">{s.products.find((p) => p.id === l.product_id)?.name}</td>
                  <td>{so ? <a className="rowlink" href={`#orders-${so.id}`}>{so.number}</a> : <span className="muted">{tx("Voorraad")}</span>}</td>
                  <td className="num">{l.qty}</td><td className="num">{eur(l.unit_cost)}</td><td className="num">{eur(l.qty * l.unit_cost)}</td>
                  <td>{open && (!t || t.status === 'planned')
                    ? <select aria-label={tx("Transport voor {0}", s.products.find((p) => p.id === l.product_id)?.name)} value={x.transport_id ?? ''} onChange={(e) => run((db) => assignShipmentsToTransport(db, [x.id], e.target.value || null), tx("Transport aangepast"))}>
                        <option value="">{tx("Nog niet ingepland")}</option>
                        {planned.map((r) => <option key={r.id} value={r.id}>{tx("{0}, vertrek {1}", r.number, fmtDate(r.departure_date))}</option>)}
                      </select>
                    : t?.number ?? '–'}</td>
                  <td>{t ? fmtDate(x.expected_date) : <span className="muted">–</span>}</td>
                  <td>{open
                    ? <select aria-label={tx("Bestemming voor {0}", s.products.find((p) => p.id === l.product_id)?.name)} value={x.warehouse_id} onChange={(e) => run((db) => setShipmentWarehouse(db, x.id, e.target.value), tx("Bestemming aangepast"))}>
                        {s.warehouses.filter((w) => w.is_active && w.receives_goods).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    : <>{s.warehouses.find((w) => w.id === x.warehouse_id)?.name}{x.status === 'received' && <> <Pill tone="good">{tx("Ontvangen")}</Pill></>}</>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
        </section>
        {po.notes && <section className="panel"><h2>{tx("Notitie")}</h2><p style={{ margin: 0 }}>{po.notes}</p></section>}
      </div>
      {confirm && (
        <Modal title={tx("{0} annuleren?", po.number)} onClose={() => setConfirm(false)} footer={<>
          <button className="btn" onClick={() => setConfirm(false)}>{tx("Terug")}</button>
          <button className="btn danger" onClick={async () => { await run((db) => cancelPurchaseOrder(db, id), tx("Inkooporder geannuleerd")); setConfirm(false) }}>{tx("Inkooporder annuleren")}</button>
        </>}><p style={{ margin: 0 }}>{tx("De regels vervallen. Verkooporders die hierop wachten, verschijnen weer bij Door te zetten.")}</p></Modal>
      )}
    </>
  )
}

interface PoLine { key: number; product_id: string; qty: number; unit_cost: number; sales_order_line_id: string | null }
let k = 1

export function PurchaseForm({ transportId, orderId }: { transportId?: string; orderId?: string } = {}) {
  const { s, run } = useApp()
  const suppliers = s.suppliers.filter((x) => x.is_active)
  const receivers = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  const transport = s.transports.find((t) => t.id === transportId && t.status === 'planned')
  // Vanuit een verkooporder: wat nog ingekocht moet worden, per leverancier één inkooporder.
  const fromOrder = orderId ? linesToPurchase(s).filter((l) => l.sales_order_id === orderId) : []
  const productOf = (id: string) => s.products.find((p) => p.id === id)
  const orderSupplier = fromOrder.map((l) => productOf(l.product_id)?.supplier_id).find(Boolean) ?? ''
  const [supplier, setSupplier] = useState(orderSupplier)
  const [orderDate, setOrderDate] = useState(todayISO())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [warehouse, setWarehouse] = useState(receivers.find((w) => (orderId ? w.is_route_origin : w.kind === 'winkel'))?.id ?? receivers[0]?.id ?? '')
  const [lines, setLines] = useState<PoLine[]>(() => fromOrder
    .filter((l) => !orderSupplier || productOf(l.product_id)?.supplier_id === orderSupplier)
    .map((l) => ({ key: k++, product_id: l.product_id, qty: l.qty, unit_cost: productOf(l.product_id)?.purchase_price ?? 0, sales_order_line_id: l.id })))
  const products = useMemo(() => s.products.filter((p) => p.is_active && (!supplier || p.supplier_id === supplier || !p.supplier_id)).map((p) => ({ value: p.id, label: p.name, sub: tx("{0}, inkoop {1}", p.sku, eur(p.purchase_price)), search: p.sku })), [s.products, supplier])
  const patchLine = (key: number, patch: Partial<PoLine>) => setLines((v) => v.map((l) => l.key === key ? { ...l, ...patch } : l))
  const total = round2(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0))
  const save = async () => {
    let id = ''
    const ok = await run(async (db) => {
      id = await createPurchaseOrder(db, { supplier_id: supplier, order_date: orderDate, supplier_reference: reference, notes, warehouse_id: warehouse, transport_id: transport?.id ?? null, lines: lines.map(({ key: _k, ...l }) => l) })
    }, tx("Inkooporder aangemaakt"))
    if (ok) go(`inkoop-${id}`)
  }
  return (
    <>
      <Head title={tx("Nieuwe inkooporder")} back={{ href: '#inkoop', label: tx("Inkooporders") }} />
      <div className="stack">
        <section className="panel">
          <h2>{tx("Inkooporder")}</h2>
          <div className="form-grid">
            <SelectField className="span-2" label={tx("Leverancier")} value={supplier} onChange={setSupplier} placeholder={tx("Kies een leverancier")} options={suppliers.map((x) => ({ value: x.id, label: `${x.name} (${x.country})` }))} />
            <TextField label={tx("Besteldatum")} type="date" value={orderDate} onChange={setOrderDate} />
            <TextField label={tx("Referentie leverancier")} value={reference} onChange={setReference} placeholder={tx("Ordernummer bij leverancier")} />
            <SelectField className="span-2" label={tx("Bestemming")} value={warehouse} onChange={setWarehouse} options={receivers.map((w) => ({ value: w.id, label: w.name }))} hint={tx("Later per regel aan te passen.")} />
          </div>
          {transport && <div className="note" style={{ marginTop: 12 }}>{tx("Deze inkooporder komt direct op {0}, vertrek {1}.", transport.number, fmtDate(transport.departure_date))}</div>}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{tx("Producten")}</h2><button className="btn sm" onClick={() => setLines((v) => [...v, { key: k++, product_id: '', qty: 1, unit_cost: 0, sales_order_line_id: null }])}><Plus size={14} />{tx("Regel toevoegen")}</button></div>
          {lines.length === 0 && <Empty>{tx("Voeg het eerste product toe.")}</Empty>}
          {lines.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th style={{ minWidth: 260 }}>{tx("Product")}</th><th>{tx("Voor verkooporder")}</th><th className="num">{tx("Aantal")}</th><th className="num">{tx("Inkoopprijs")}</th><th className="num">{tx("Totaal")}</th><th></th></tr></thead>
              <tbody>{lines.map((l) => {
                const so = l.sales_order_line_id && s.sales_orders.find((o) => o.id === s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.sales_order_id)
                return (
                  <tr key={l.key}>
                    <td><Combo value={l.product_id} options={products} placeholder={tx("Zoek op naam of artikelnummer")} onChange={(v) => patchLine(l.key, { product_id: v, unit_cost: s.products.find((p) => p.id === v)?.purchase_price ?? 0 })} /></td>
                    <td className="muted">{so ? so.number : tx("Voorraad")}</td>
                    <td className="num"><input className="qty" aria-label={tx("Aantal")} type="number" min={1} value={l.qty} onChange={(e) => patchLine(l.key, { qty: Number(e.target.value) })} /></td>
                    <td className="num"><input className="price" aria-label={tx("Inkoopprijs")} type="number" step="0.01" min={0} value={l.unit_cost} onChange={(e) => patchLine(l.key, { unit_cost: Number(e.target.value) })} /></td>
                    <td className="num">{eur(l.qty * l.unit_cost)}</td>
                    <td><button className="btn icon" aria-label={tx("Regel verwijderen")} onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button></td>
                  </tr>
                )
              })}</tbody>
              <tfoot><tr><td colSpan={4}>{tx("Totaal exclusief IVA")}</td><td className="num">{eur(total)}</td><td></td></tr></tfoot>
            </table></div>
          )}
        </section>
        <section className="panel"><AreaField label={tx("Notitie")} value={notes} onChange={setNotes} /></section>
        <div className="sticky-save">
          <a className="btn" href="#inkoop">{tx("Annuleren")}</a>
          <button className="btn primary" onClick={save}>{tx("Inkooporder aanmaken")}</button>
        </div>
      </div>
    </>
  )
}
