import { useMemo, useState } from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { inboundWarehouse, linesToPurchase, round2, shipmentDestination, shipmentIsOpen, todayISO } from '../domain/calc'
import { assignShipmentsToTransport, cancelPurchaseOrder, createPurchaseOrder, setPurchaseLabel } from '../domain/services'
import type { PurchaseLabel } from '../data/types'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { AreaField, Combo, Empty, eur, fmtDate, Head, Modal, Pill, SelectField, Sku, Tabs, TextField, type Tone } from '../ui/kit'
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
  const [labelFilter, setLabelFilter] = useState<PurchaseLabel | ''>('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const all = [...s.purchase_orders].sort((a, b) => b.order_date.localeCompare(a.order_date) || b.number.localeCompare(a.number))
  // De aantallen op de labels volgen de gekozen leverancier, zodat ze kloppen met wat je te zien krijgt.
  const forSupplier = all.filter((po) => !supplierFilter || po.supplier_id === supplierFilter)
  const rows = forSupplier.filter((po) => !labelFilter || (po.label ?? 'magazijn') === labelFilter)
  const labelCount = (l: PurchaseLabel | '') => forSupplier.filter((po) => !l || (po.label ?? 'magazijn') === l).length
  const usedSuppliers = s.suppliers.filter((x) => all.some((po) => po.supplier_id === x.id)).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <Head title={tx("Inkooporders")} sub={tx("Gedurende de dag ontstaan verkooporders. Zet de regels die ingekocht moeten worden door naar een inkooporder bij de leverancier.")}>
        <a className="btn primary" href="#inkoop-nieuw"><Plus size={16} />{tx("Nieuwe inkooporder")}</a>
      </Head>
      <Tabs<'queue' | 'orders'> value={tab} onChange={setTab} tabs={[{ value: 'queue', label: tx("Inkoop vereist"), n: waiting.length }, { value: 'orders', label: tx("Inkooporders"), n: all.length }]} />
      {tab === 'queue' && <PurchaseQueue onDone={() => setTab('orders')} />}
      {tab === 'orders' && <section className="panel">
        <div className="panel-head">
          <div className="chips" role="group" aria-label={tx("Filter op label")}>
            {([['', tx("Alle labels")], ['verkoop', tx("Verkoop")], ['magazijn', tx("Magazijn")], ['showroom', tx("Showroom")]] as [PurchaseLabel | '', string][]).map(([value, text]) => (
              <button key={value || 'alle'} type="button" className={`chip${labelFilter === value ? ' on' : ''}`} aria-pressed={labelFilter === value} onClick={() => setLabelFilter(value)}>{text} <span>{labelCount(value)}</span></button>
            ))}
          </div>
          <select id="inkoop-leverancier" style={{ width: 'auto', maxWidth: 340 }} aria-label={tx("Filter op leverancier")} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">{tx("Alle leveranciers")}</option>
            {usedSuppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <span className="small muted">{tx("{0} van {1} inkooporders", rows.length, all.length)}</span>
        </div>
        {rows.length === 0 && <Empty>{all.length ? tx("Geen inkooporders met dit filter.") : tx("Nog geen inkooporders. Maak de eerste met de knop rechtsboven.")}</Empty>}
        <div className="table-wrap"><table>
          <thead><tr><th aria-label="PDF" /><th>{tx("Nummer")}</th><th>{tx("Leverancier")}</th><th>{tx("Besteld")}</th><th>{tx("Label")}</th><th>{tx("Verkooporder")}</th><th>{tx("Referentie")}</th><th className="num">{tx("Op transport")}</th><th className="num">{tx("Waarde")}</th><th>{tx("Status")}</th></tr></thead>
          <tbody>{rows.map((po) => {
            const { total, planned, received } = poProgress(s, po.id)
            const value = round2(s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).reduce((n, l) => n + l.qty * l.unit_cost, 0))
            // Een inkooporder kan regels voor meerdere verkooporders hebben.
            const orderIds = new Set(s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id && l.sales_order_line_id).map((l) => s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.sales_order_id))
            const salesOrders = s.sales_orders.filter((o) => orderIds.has(o.id)).sort((a, b) => a.number.localeCompare(b.number))
            const [label, tone]: [string, Tone] = po.status === 'cancelled' ? [tx("Geannuleerd"), ''] : received === total ? [tx("Ontvangen"), 'good'] : planned === total ? [tx("Ingepland"), 'info'] : [tx("Besteld"), 'warn']
            return (
              <tr key={po.id} className="click" onClick={() => go(`inkoop-${po.id}`)}>
                <td><a className="pdf-ic" href={`#inkoop-print-${po.id}`} title={tx("Inkooporder {0} afdrukken als PDF", po.number)} aria-label={tx("Inkooporder {0} afdrukken als PDF", po.number)} onClick={(e) => e.stopPropagation()}><FileText size={18} /><span>PDF</span></a></td>
                <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a></td>
                <td>{s.suppliers.find((x) => x.id === po.supplier_id)?.name}</td>
                <td>{fmtDate(po.order_date)}</td><td><LabelPill label={po.label} /></td>
                <td>{salesOrders.length ? salesOrders.map((o) => <div key={o.id}><a className="rowlink" href={`#orders-${o.id}`} onClick={(e) => e.stopPropagation()}>{o.number}</a></div>) : <span className="muted">–</span>}</td>
                <td className="muted">{po.supplier_reference || '–'}</td>
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

const LABELS: Record<PurchaseLabel, [string, Tone]> = { showroom: ['Showroom', 'info'], magazijn: ['Magazijn', ''], verkoop: ['Verkoop', 'sell'] }
// Testgegevens uit een oudere versie hebben nog geen label.
export const LabelPill = ({ label = 'magazijn' }: { label?: PurchaseLabel }) => <Pill tone={LABELS[label][1]}>{tx(LABELS[label][0])}</Pill>

export function PurchaseDetail({ id }: { id: string }) {
  const { s, run } = useApp()
  const [confirm, setConfirm] = useState(false)
  const po = s.purchase_orders.find((p) => p.id === id)
  if (!po) return <div className="panel">{tx("Inkooporder niet gevonden.")} <a href="#inkoop">{tx("Terug naar inkoop")}</a>.</div>
  const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === id)
  const planned = s.transports.filter((t) => t.status === 'planned').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const shipmentOf = (lineId: string) => s.inbound_shipments.find((x) => s.inbound_shipment_lines.some((l) => l.shipment_id === x.id && l.purchase_order_line_id === lineId))!
  const supplier = s.suppliers.find((x) => x.id === po.supplier_id)
  const forSale = lines.some((l) => l.sales_order_line_id)
  const hasReceipts = lines.some((l) => s.goods_receipt_lines.some((r) => r.shipment_line_id === s.inbound_shipment_lines.find((x) => x.purchase_order_line_id === l.id)?.id))
  return (
    <>
      <Head title={<>{po.number} {forSale && <LabelPill label="verkoop" />}</>} sub={tx("{0}, besteld op {1}{2}", supplier?.name, fmtDate(po.order_date), po.supplier_reference ? tx(", referentie {0}", po.supplier_reference) : '')} back={{ href: '#inkoop', label: tx("Inkooporders") }}>
        {!forSale && <select style={{ width: 'auto' }} aria-label={tx("Label")} value={po.label ?? 'magazijn'} onChange={(e) => run((db) => setPurchaseLabel(db, id, e.target.value as PurchaseLabel), tx("Label aangepast"))}>
          <option value="showroom">{tx("Showroom")}</option>
          <option value="magazijn">{tx("Magazijn")}</option>
        </select>}
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
                  <td className="strong">{s.products.find((p) => p.id === l.product_id)?.name}<Sku code={s.products.find((p) => p.id === l.product_id)?.sku} /></td>
                  <td>{so ? <a className="rowlink" href={`#orders-${so.id}`}>{so.number}</a> : <span className="muted">{tx("Voorraad")}</span>}</td>
                  <td className="num">{l.qty}</td><td className="num">{eur(l.unit_cost)}</td><td className="num">{eur(l.qty * l.unit_cost)}</td>
                  <td>{open && (!t || t.status === 'planned')
                    ? <select aria-label={tx("Transport voor {0}", s.products.find((p) => p.id === l.product_id)?.name)} value={x.transport_id ?? ''} onChange={(e) => run((db) => assignShipmentsToTransport(db, [x.id], e.target.value || null), tx("Transport aangepast"))}>
                        <option value="">{tx("Nog niet ingepland")}</option>
                        {planned.map((r) => <option key={r.id} value={r.id}>{tx("{0}, vertrek {1}", r.number, fmtDate(r.departure_date))}</option>)}
                      </select>
                    : t?.number ?? '–'}</td>
                  <td>{t ? fmtDate(x.expected_date) : <span className="muted">–</span>}</td>
                  <td>{shipmentDestination(s, x)}{x.status === 'received' && <> <Pill tone="good">{tx("Ontvangen")}</Pill></>}</td>
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
        </>}><p style={{ margin: 0 }}>{tx("De regels vervallen. Verkooporders die hierop wachten, verschijnen weer bij Inkoop vereist.")}</p></Modal>
      )}
    </>
  )
}

interface PoLine { key: number; product_id: string; qty: number; unit_cost: number; sales_order_line_id: string | null }
let k = 1

export function PurchaseForm({ orderId }: { orderId?: string } = {}) {
  const { s, run } = useApp()
  const suppliers = s.suppliers.filter((x) => x.is_active)
  // Vanuit een verkooporder: wat nog ingekocht moet worden, per leverancier één inkooporder.
  const fromOrder = orderId ? linesToPurchase(s).filter((l) => l.sales_order_id === orderId) : []
  const productOf = (id: string) => s.products.find((p) => p.id === id)
  const orderSupplier = fromOrder.map((l) => productOf(l.product_id)?.supplier_id).find(Boolean) ?? ''
  const [supplier, setSupplier] = useState(orderSupplier)
  const [orderDate, setOrderDate] = useState(todayISO())
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [label, setLabel] = useState<'showroom' | 'magazijn'>('magazijn')
  const [lines, setLines] = useState<PoLine[]>(() => fromOrder
    .filter((l) => !orderSupplier || productOf(l.product_id)?.supplier_id === orderSupplier)
    .map((l) => ({ key: k++, product_id: l.product_id, qty: l.qty, unit_cost: productOf(l.product_id)?.purchase_price ?? 0, sales_order_line_id: l.id })))
  const products = useMemo(() => s.products.filter((p) => p.is_active && (!supplier || p.supplier_id === supplier || !p.supplier_id)).map((p) => ({ value: p.id, label: p.name, sub: tx("{0}, inkoop {1}", p.sku, eur(p.purchase_price)), search: p.sku })), [s.products, supplier])
  const patchLine = (key: number, patch: Partial<PoLine>) => setLines((v) => v.map((l) => l.key === key ? { ...l, ...patch } : l))
  const total = round2(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0))
  const isSale = lines.some((l) => l.sales_order_line_id)
  const save = async () => {
    let id = ''
    const ok = await run(async (db) => {
      id = await createPurchaseOrder(db, { supplier_id: supplier, order_date: orderDate, supplier_reference: reference, notes, label: isSale ? 'verkoop' : label, lines: lines.map(({ key: _k, ...l }) => l) })
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
            {isSale
              ? <div className="field"><span className="lbl">{tx("Label")}</span><div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }}><LabelPill label="verkoop" /></div></div>
              : <SelectField label={tx("Label")} value={label} onChange={setLabel} options={[{ value: 'magazijn', label: tx("Magazijn") }, { value: 'showroom', label: tx("Showroom") }]} />}
            <div className="field span-2"><span className="lbl">{tx("Bestemming")}</span><div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }}>{inboundWarehouse(s.warehouses)?.name}</div></div>
          </div>
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
                    <td><Combo value={l.product_id} options={products} placeholder={tx("Zoek op naam of artikelnummer")} onChange={(v) => patchLine(l.key, { product_id: v, unit_cost: s.products.find((p) => p.id === v)?.purchase_price ?? 0 })} /><Sku code={s.products.find((p) => p.id === l.product_id)?.sku} /></td>
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
