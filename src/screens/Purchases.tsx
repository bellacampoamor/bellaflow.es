import { useMemo, useState } from 'react'
import type { InboundShipment } from '../data/types'
import { Plus, Trash2 } from 'lucide-react'
import { addDays, linesToPurchase, purchaseKind, round2, shipmentLineOpen, todayISO } from '../domain/calc'
import { assignShipmentToTransport, cancelPurchaseOrder, createPurchaseOrder, setShipmentWarehouse, splitQty } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Combo, Empty, eur, fmtDate, Head, Modal, NumberField, Pill, SelectField, TextField, AreaField, type Tone } from '../ui/kit'
import { tx } from '../i18n'

export function poProgress(s: ReturnType<typeof useApp>['s'], poId: string) {
  const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === poId)
  const ordered = s.purchase_order_lines.filter((l) => l.purchase_order_id === poId).reduce((n, l) => n + l.qty, 0)
  const ids = new Set(s.inbound_shipment_lines.filter((l) => shipments.some((x) => x.id === l.shipment_id)).map((l) => l.id))
  const received = s.goods_receipt_lines.filter((r) => ids.has(r.shipment_line_id)).reduce((n, r) => n + r.qty_received, 0)
  return { ordered, received, shipments }
}

export function Purchases() {
  const { s } = useApp()
  const waiting = linesToPurchase(s)
  const rows = [...s.purchase_orders].sort((a, b) => b.order_date.localeCompare(a.order_date) || b.number.localeCompare(a.number))
  return (
    <>
      <Head title={tx("Inkoop")} sub={tx("Bestellingen bij je leveranciers, met de zendingen waarin ze binnenkomen.")}>
        <a className="btn primary" href="#inkoop-nieuw"><Plus size={16} />{tx("Nieuwe inkooporder")}</a>
      </Head>
      <div className="stack">
        {waiting.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2>{tx("Nog in te kopen voor verkooporders")}</h2><a className="btn sm" href="#inkoop-nieuw">{tx("Neem over in inkooporder")}</a></div>
            <div className="table-wrap"><table>
              <thead><tr><th>{tx("Verkooporder")}</th><th>{tx("Klant")}</th><th>{tx("Product")}</th><th>{tx("Uitvoering")}</th><th className="num">{tx("Aantal")}</th></tr></thead>
              <tbody>{waiting.map((l) => {
                const o = s.sales_orders.find((x) => x.id === l.sales_order_id)!
                return <tr key={l.id}><td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td><td>{s.customers.find((c) => c.id === o.customer_id)?.name}</td><td>{l.description}</td><td className="muted">{l.options || '–'}</td><td className="num">{l.qty}</td></tr>
              })}</tbody>
            </table></div>
          </section>
        )}
        <section className="panel">
          <h2>{tx("Inkooporders")}</h2>
          {rows.length === 0 && <Empty>{tx("Nog geen inkooporders. Maak de eerste met de knop rechtsboven.")}</Empty>}
          <div className="table-wrap"><table>
            <thead><tr><th>{tx("Nummer")}</th><th>{tx("Leverancier")}</th><th>{tx("Besteld")}</th><th>{tx("Soort")}</th><th>{tx("Referentie")}</th><th>{tx("Zendingen")}</th><th className="num">{tx("Ontvangen")}</th><th className="num">{tx("Waarde")}</th><th>{tx("Status")}</th></tr></thead>
            <tbody>{rows.map((po) => {
              const { ordered, received, shipments } = poProgress(s, po.id)
              const value = round2(s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).reduce((n, l) => n + l.qty * l.unit_cost, 0))
              const closed = shipments.every((x) => x.status === 'received' || x.status === 'closed')
              const [label, tone]: [string, Tone] = po.status === 'cancelled' ? [tx("Geannuleerd"), ''] : closed ? [tx("Afgerond"), 'good'] : received > 0 ? [tx("Deels ontvangen"), 'warn'] : [tx("Besteld"), 'info']
              return (
                <tr key={po.id} className="click" onClick={() => go(`inkoop-${po.id}`)}>
                  <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a></td>
                  <td>{s.suppliers.find((x) => x.id === po.supplier_id)?.name}</td>
                  <td>{fmtDate(po.order_date)}</td><td><KindPill kind={purchaseKind(s, po.id)} /></td><td className="muted">{po.supplier_reference || '–'}</td>
                  <td>{shipments.length}</td><td className="num">{received} / {ordered}</td><td className="num">{eur(value)}</td>
                  <td><Pill tone={tone}>{label}</Pill></td>
                </tr>
              )
            })}</tbody>
          </table></div>
        </section>
      </div>
    </>
  )
}

export function PurchaseDetail({ id }: { id: string }) {
  const { s, run } = useApp()
  const [confirm, setConfirm] = useState(false)
  const po = s.purchase_orders.find((p) => p.id === id)
  if (!po) return <div className="panel">{tx("Inkooporder niet gevonden.")} <a href="#inkoop">{tx("Terug naar inkoop")}</a>.</div>
  const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === id)
  const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === id).sort((a, b) => a.sequence - b.sequence)
  const pname = (pid: string) => s.products.find((p) => p.id === pid)?.name
  const supplier = s.suppliers.find((x) => x.id === po.supplier_id)
  const plannedTransports = s.transports.filter((t) => t.status === 'planned').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const canChangeTransport = (x: InboundShipment) => { const t = s.transports.find((r) => r.id === x.transport_id); return !t || t.status === 'planned' }
  const hasReceipts = s.goods_receipts.some((r) => shipments.some((x) => x.id === r.shipment_id))
  return (
    <>
      <Head title={<>{po.number} <KindPill kind={purchaseKind(s, po.id)} /></>} sub={tx("{0}, besteld op {1}{2}", supplier?.name, fmtDate(po.order_date), po.supplier_reference ? tx(", referentie {0}", po.supplier_reference) : '')} back={{ href: '#inkoop', label: tx("Inkoop") }}>
        {po.status === 'open' && !hasReceipts && <button className="btn danger" onClick={() => setConfirm(true)}>{tx("Inkooporder annuleren")}</button>}
      </Head>
      <div className="stack">
        <section className="panel">
          <h2>{tx("Bestelde producten")}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{tx("Product")}</th><th>{tx("Voor verkooporder")}</th><th className="num">{tx("Aantal")}</th><th className="num">{tx("Inkoopprijs")}</th><th className="num">{tx("Totaal")}</th></tr></thead>
            <tbody>{lines.map((l) => {
              const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)
              const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
              return <tr key={l.id}><td>{pname(l.product_id)}</td><td>{so ? <a className="rowlink" href={`#orders-${so.id}`}>{so.number}</a> : <span className="muted">{tx("Voorraad")}</span>}</td><td className="num">{l.qty}</td><td className="num">{eur(l.unit_cost)}</td><td className="num">{eur(l.qty * l.unit_cost)}</td></tr>
            })}</tbody>
          </table></div>
        </section>
        <section className="panel">
          <h2>{tx("Zendingen")}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{tx("Zending")}</th><th>{tx("Verwacht")}</th><th>{tx("Transport")}</th><th>{tx("Bestemming")}</th><th>{tx("Inhoud")}</th><th>{tx("Status")}</th><th></th></tr></thead>
            <tbody>{shipments.map((x) => {
              const ls = s.inbound_shipment_lines.filter((l) => l.shipment_id === x.id)
              const open = x.status === 'expected' || x.status === 'partial'
              return (
                <tr key={x.id}>
                  <td>{tx("Zending")} {x.sequence}</td>
                  <td>{fmtDate(x.expected_date)}{x.expected_date !== x.original_date && <div className="muted small">{tx("was")} {fmtDate(x.original_date)}</div>}</td>
                  <td style={{ minWidth: 170 }}>{open && canChangeTransport(x)
                    ? <select aria-label={tx("Transport voor zending {0}", x.sequence)} value={x.transport_id ?? ''} onChange={(e) => run((db) => assignShipmentToTransport(db, x.id, e.target.value || null), tx("Transport aangepast"))}>
                        <option value="">{tx("Nog niet gekoppeld")}</option>
                        {plannedTransports.map((t) => <option key={t.id} value={t.id}>{tx("{0}, vertrek {1}", t.number, fmtDate(t.departure_date))}</option>)}
                      </select>
                    : s.transports.find((t) => t.id === x.transport_id)?.number ?? '–'}</td>
                  <td style={{ minWidth: 170 }}>{open
                    ? <select aria-label={tx("Bestemming voor zending {0}", x.sequence)} value={x.warehouse_id} onChange={(e) => run((db) => setShipmentWarehouse(db, x.id, e.target.value), tx("Bestemming aangepast"))}>
                        {s.warehouses.filter((w) => w.is_active && w.receives_goods).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </select>
                    : s.warehouses.find((w) => w.id === x.warehouse_id)?.name}</td>
                  <td className="small">{ls.map((l) => {
                    const pol = lines.find((p) => p.id === l.purchase_order_line_id)!
                    return <div key={l.id}>{l.qty} {tx("×")} {pname(pol.product_id)}{shipmentLineOpen(s, l.id) < l.qty && <span className="muted"> ({l.qty - shipmentLineOpen(s, l.id)} {tx("binnen)")}</span>}</div>
                  })}</td>
                  <td><ShipmentPill status={x.status} /></td>
                  <td className="num">{open && <a className="btn sm" href={`#ontvangst-${x.id}`}>{tx("Ontvangen")}</a>}</td>
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
        </>}><p style={{ margin: 0 }}>{tx("De zendingen vervallen. Verkooporders die hierop wachten, verschijnen weer bij \"Nog in te kopen\".")}</p></Modal>
      )}
    </>
  )
}

export function KindPill({ kind }: { kind: 'vulorder' | 'klantorder' | 'gemengd' }) {
  const map: Record<string, [string, Tone]> = { vulorder: [tx("Vulorder"), 'info'], klantorder: [tx("Voor verkooporder"), 'sell'], gemengd: [tx("Gemengd"), ''] }
  return <Pill tone={map[kind][1]}>{map[kind][0]}</Pill>
}

export function ShipmentPill({ status }: { status: string }) {
  const map: Record<string, [string, Tone]> = { expected: [tx("Verwacht"), 'info'], partial: [tx("Deels ontvangen"), 'warn'], received: [tx("Ontvangen"), 'good'], closed: [tx("Afgesloten"), ''] }
  const [l, t] = map[status]
  return <Pill tone={t}>{l}</Pill>
}

interface PoLine { key: number; product_id: string; qty: number; unit_cost: number; sales_order_line_id: string | null }
interface PoShip { key: number; expected_date: string; warehouse_id: string; carrier: string; pct: number; transport_id: string | null }
let k = 1

export function PurchaseForm({ transportId, orderId }: { transportId?: string; orderId?: string } = {}) {
  const { s, run } = useApp()
  const today = todayISO()
  const suppliers = s.suppliers.filter((x) => x.is_active)
  const receivers = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  // Vanuit een verkooporder: wat nog ingekocht moet worden, per leverancier één inkooporder.
  const fromOrder = orderId ? linesToPurchase(s).filter((l) => l.sales_order_id === orderId) : []
  const productOf = (id: string) => s.products.find((p) => p.id === id)
  const orderSupplier = fromOrder.map((l) => productOf(l.product_id)?.supplier_id).find(Boolean) ?? ''
  const [supplier, setSupplier] = useState(orderSupplier)
  const [orderDate, setOrderDate] = useState(today)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PoLine[]>(() => fromOrder
    .filter((l) => !orderSupplier || productOf(l.product_id)?.supplier_id === orderSupplier)
    .map((l) => ({ key: k++, product_id: l.product_id, qty: l.qty, unit_cost: productOf(l.product_id)?.purchase_price ?? 0, sales_order_line_id: l.id })))
  const lead = suppliers.find((x) => x.id === supplier)?.lead_time_days ?? 21
  const planned = s.transports.filter((t) => t.status === 'planned').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  // Standaard mee met de eerstvolgende vrachtwagen die nog moet vertrekken.
  const firstTransport = planned.find((t) => t.id === transportId) ?? planned.find((t) => t.departure_date >= today) ?? null
  const [ships, setShips] = useState<PoShip[]>([{ key: k++, expected_date: firstTransport?.arrival_date ?? addDays(today, 21), warehouse_id: receivers[0]?.id ?? '', carrier: '', pct: 100, transport_id: firstTransport?.id ?? null }])

  const waiting = linesToPurchase(s).filter((l) => !lines.some((x) => x.sales_order_line_id === l.id))
  const products = useMemo(() => s.products.filter((p) => p.is_active && (!supplier || p.supplier_id === supplier || !p.supplier_id)).map((p) => ({ value: p.id, label: p.name, sub: tx("{0}, inkoop {1}", p.sku, eur(p.purchase_price)), search: p.sku })), [s.products, supplier])

  const addWaiting = (lineId: string) => {
    const l = s.sales_order_lines.find((x) => x.id === lineId)!
    const p = s.products.find((x) => x.id === l.product_id)!
    if (!supplier && p.supplier_id) setSupplier(p.supplier_id)
    setLines((v) => [...v, { key: k++, product_id: p.id, qty: l.qty, unit_cost: p.purchase_price, sales_order_line_id: l.id }])
  }
  const patchLine = (key: number, patch: Partial<PoLine>) => setLines((v) => v.map((l) => l.key === key ? { ...l, ...patch } : l))
  const patchShip = (key: number, patch: Partial<PoShip>) => setShips((v) => v.map((l) => l.key === key ? { ...l, ...patch } : l))
  const applyPreset = (n: number) => {
    const wh = ships[0]?.warehouse_id ?? receivers[0]?.id ?? ''
    const base = n === 1 ? [100] : Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - Math.floor(100 / n) * (n - 1) : Math.floor(100 / n)))
    setShips(base.map((pct, i) => ({ key: k++, expected_date: addDays(orderDate, lead + i * 14), warehouse_id: wh, carrier: ships[0]?.carrier ?? '', pct, transport_id: i === 0 ? ships[0]?.transport_id ?? null : null })))
  }
  const total = round2(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0))
  const pctSum = ships.reduce((n, x) => n + x.pct, 0)

  const save = async () => {
    let id = ''
    const ok = await run(async (db) => {
      id = await createPurchaseOrder(db, { supplier_id: supplier, order_date: orderDate, supplier_reference: reference, notes, lines: lines.map(({ key: _k, ...l }) => l), shipments: ships.map(({ key: _k, ...x }) => x) })
    }, tx("Inkooporder aangemaakt"))
    if (ok) go(`inkoop-${id}`)
  }

  return (
    <>
      <Head title={tx("Nieuwe inkooporder")} back={{ href: '#inkoop', label: tx("Inkoop") }} />
      <div className="stack">
        <section className="panel">
          <h2>{tx("Inkooporder")}</h2>
          <div className="form-grid">
            <SelectField className="span-2" label={tx("Leverancier")} value={supplier} onChange={setSupplier} placeholder={tx("Kies een leverancier")} options={suppliers.map((x) => ({ value: x.id, label: `${x.name} (${x.country})` }))} />
            <TextField label={tx("Besteldatum")} type="date" value={orderDate} onChange={setOrderDate} />
            <TextField label={tx("Referentie leverancier")} value={reference} onChange={setReference} placeholder={tx("Ordernummer bij leverancier")} />
          </div>
        </section>

        {waiting.length > 0 && (
          <section className="panel">
            <h2>{tx("Nog in te kopen voor verkooporders")}</h2>
            <div className="actions">{waiting.map((l) => (
              <button key={l.id} className="btn sm" onClick={() => addWaiting(l.id)}>
                <Plus size={14} />{l.qty} {tx("×")} {l.description} ({s.sales_orders.find((o) => o.id === l.sales_order_id)?.number})
              </button>
            ))}</div>
          </section>
        )}

        <section className="panel">
          <div className="panel-head"><h2>{tx("Producten")}</h2><button className="btn sm" onClick={() => setLines((v) => [...v, { key: k++, product_id: '', qty: 1, unit_cost: 0, sales_order_line_id: null }])}><Plus size={14} />{tx("Regel toevoegen")}</button></div>
          {lines.length === 0 && <Empty>{tx("Voeg het eerste product toe.")}</Empty>}
          {lines.length > 0 && (
            <div className="table-wrap" style={{ minHeight: 120 }}><table>
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

        <section className="panel">
          <div className="panel-head">
            <h2>{tx("Transport en bestemming")}</h2>
            <div className="actions">
              {ships.length === 1 && <button className="btn sm" onClick={() => applyPreset(2)}>{tx("In delen laten komen")}</button>}
              {ships.length > 1 && <>
                <button className="btn sm" onClick={() => applyPreset(1)}>{tx("Alles ineens")}</button>
                <button className="btn sm" onClick={() => applyPreset(2)}>50 / 50</button>
                <button className="btn sm" onClick={() => applyPreset(3)}>{tx("In 3 delen")}</button>
                <button className="btn sm" onClick={() => setShips((v) => [...v, { key: k++, expected_date: addDays(orderDate, lead), warehouse_id: receivers[0]?.id ?? '', carrier: '', pct: 0, transport_id: null }])}><Plus size={14} />{tx("Zending")}</button>
              </>}
            </div>
          </div>
          <div className="stack">
            {ships.map((x, i) => (
              <div key={x.key} className="form-grid" style={{ alignItems: 'end' }}>
                <SelectField className="span-2" label={tx("Transport naar Spanje")} value={x.transport_id ?? ''} onChange={(v) => {
                  const t = planned.find((r) => r.id === v)
                  patchShip(x.key, { transport_id: t?.id ?? null, expected_date: t?.arrival_date ?? x.expected_date })
                }} options={[{ value: '', label: tx("Nog niet gekoppeld") }, ...planned.map((t) => ({ value: t.id, label: tx("{0}, vertrek {1}, aankomst {2}", t.number, fmtDate(t.departure_date), fmtDate(t.arrival_date)) }))]} />
                <SelectField label={tx("Bestemming")} value={x.warehouse_id} onChange={(v) => patchShip(x.key, { warehouse_id: v })} options={receivers.map((w) => ({ value: w.id, label: w.name }))} />
                {!x.transport_id && <TextField label={tx("Verwacht op")} type="date" value={x.expected_date} onChange={(v) => patchShip(x.key, { expected_date: v })} />}
                {ships.length > 1 && <>
                  <NumberField label={tx("Deel van de bestelling (%)")} value={x.pct} min={0} onChange={(v) => patchShip(x.key, { pct: v })} />
                  {lines.length > 0 && <div className="small muted span-2">{lines.filter((l) => l.product_id).map((l) => tx("{0} × {1}", splitQty(l.qty, ships.map((y) => y.pct || 0.0001))[i], s.products.find((p) => p.id === l.product_id)?.name)).join(', ')}</div>}
                  <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setShips((v) => v.filter((y) => y.key !== x.key))}>{tx("Zending verwijderen")}</button>
                </>}
              </div>
            ))}
            {Math.round(pctSum) !== 100 && <div className="note warn">{tx("De delen tellen op tot")} {pctSum}{tx("%. Dat moet 100% zijn.")}</div>}
          </div>
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
