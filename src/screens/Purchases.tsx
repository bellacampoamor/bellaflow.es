import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { addDays, linesToPurchase, round2, shipmentLineOpen, todayISO } from '../domain/calc'
import { cancelPurchaseOrder, createPurchaseOrder, splitQty } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { Combo, Empty, eur, fmtDate, Head, Modal, NumberField, Pill, SelectField, TextField, AreaField, type Tone } from '../ui/kit'

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
      <Head title="Inkoop" sub="Bestellingen bij je leveranciers, met de zendingen waarin ze binnenkomen.">
        <a className="btn primary" href="#inkoop-nieuw"><Plus size={16} />Nieuwe inkooporder</a>
      </Head>
      <div className="stack">
        {waiting.length > 0 && (
          <section className="panel">
            <div className="panel-head"><h2>Nog in te kopen voor klantorders</h2><a className="btn sm" href="#inkoop-nieuw">Neem over in inkooporder</a></div>
            <div className="table-wrap"><table>
              <thead><tr><th>Order</th><th>Klant</th><th>Product</th><th>Uitvoering</th><th className="num">Aantal</th></tr></thead>
              <tbody>{waiting.map((l) => {
                const o = s.sales_orders.find((x) => x.id === l.sales_order_id)!
                return <tr key={l.id}><td><a className="rowlink" href={`#orders-${o.id}`}>{o.number}</a></td><td>{s.customers.find((c) => c.id === o.customer_id)?.name}</td><td>{l.description}</td><td className="muted">{l.options || '–'}</td><td className="num">{l.qty}</td></tr>
              })}</tbody>
            </table></div>
          </section>
        )}
        <section className="panel">
          <h2>Inkooporders</h2>
          {rows.length === 0 && <Empty>Nog geen inkooporders. Maak de eerste met de knop rechtsboven.</Empty>}
          <div className="table-wrap"><table>
            <thead><tr><th>Nummer</th><th>Leverancier</th><th>Besteld</th><th>Referentie</th><th>Zendingen</th><th className="num">Ontvangen</th><th className="num">Waarde</th><th>Status</th></tr></thead>
            <tbody>{rows.map((po) => {
              const { ordered, received, shipments } = poProgress(s, po.id)
              const value = round2(s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).reduce((n, l) => n + l.qty * l.unit_cost, 0))
              const closed = shipments.every((x) => x.status === 'received' || x.status === 'closed')
              const [label, tone]: [string, Tone] = po.status === 'cancelled' ? ['Geannuleerd', ''] : closed ? ['Afgerond', 'good'] : received > 0 ? ['Deels ontvangen', 'warn'] : ['Besteld', 'info']
              return (
                <tr key={po.id} className="click" onClick={() => go(`inkoop-${po.id}`)}>
                  <td><a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a></td>
                  <td>{s.suppliers.find((x) => x.id === po.supplier_id)?.name}</td>
                  <td>{fmtDate(po.order_date)}</td><td className="muted">{po.supplier_reference || '–'}</td>
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
  if (!po) return <div className="panel">Inkooporder niet gevonden. <a href="#inkoop">Terug naar inkoop</a>.</div>
  const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === id)
  const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === id).sort((a, b) => a.sequence - b.sequence)
  const pname = (pid: string) => s.products.find((p) => p.id === pid)?.name
  const supplier = s.suppliers.find((x) => x.id === po.supplier_id)
  const hasReceipts = s.goods_receipts.some((r) => shipments.some((x) => x.id === r.shipment_id))
  return (
    <>
      <Head title={po.number} sub={`${supplier?.name}, besteld op ${fmtDate(po.order_date)}${po.supplier_reference ? `, referentie ${po.supplier_reference}` : ''}`} back={{ href: '#inkoop', label: 'Inkoop' }}>
        {po.status === 'open' && !hasReceipts && <button className="btn danger" onClick={() => setConfirm(true)}>Inkooporder annuleren</button>}
      </Head>
      <div className="stack">
        <section className="panel">
          <h2>Bestelde producten</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Product</th><th>Voor order</th><th className="num">Aantal</th><th className="num">Inkoopprijs</th><th className="num">Totaal</th></tr></thead>
            <tbody>{lines.map((l) => {
              const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)
              const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
              return <tr key={l.id}><td>{pname(l.product_id)}</td><td>{so ? <a className="rowlink" href={`#orders-${so.id}`}>{so.number}</a> : <span className="muted">Voorraad</span>}</td><td className="num">{l.qty}</td><td className="num">{eur(l.unit_cost)}</td><td className="num">{eur(l.qty * l.unit_cost)}</td></tr>
            })}</tbody>
          </table></div>
        </section>
        <section className="panel">
          <h2>Zendingen</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>Zending</th><th>Verwacht</th><th>Losplek</th><th>Inhoud</th><th>Status</th><th></th></tr></thead>
            <tbody>{shipments.map((x) => {
              const ls = s.inbound_shipment_lines.filter((l) => l.shipment_id === x.id)
              const open = x.status === 'expected' || x.status === 'partial'
              return (
                <tr key={x.id}>
                  <td>Zending {x.sequence}</td>
                  <td>{fmtDate(x.expected_date)}{x.expected_date !== x.original_date && <div className="muted small">was {fmtDate(x.original_date)}</div>}</td>
                  <td>{s.warehouses.find((w) => w.id === x.warehouse_id)?.name}</td>
                  <td className="small">{ls.map((l) => {
                    const pol = lines.find((p) => p.id === l.purchase_order_line_id)!
                    return <div key={l.id}>{l.qty} × {pname(pol.product_id)}{shipmentLineOpen(s, l.id) < l.qty && <span className="muted"> ({l.qty - shipmentLineOpen(s, l.id)} binnen)</span>}</div>
                  })}</td>
                  <td><ShipmentPill status={x.status} /></td>
                  <td className="num">{open && <a className="btn sm" href={`#ontvangst-${x.id}`}>Ontvangen</a>}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
        </section>
        {po.notes && <section className="panel"><h2>Notitie</h2><p style={{ margin: 0 }}>{po.notes}</p></section>}
      </div>
      {confirm && (
        <Modal title={`${po.number} annuleren?`} onClose={() => setConfirm(false)} footer={<>
          <button className="btn" onClick={() => setConfirm(false)}>Terug</button>
          <button className="btn danger" onClick={async () => { await run((db) => cancelPurchaseOrder(db, id), 'Inkooporder geannuleerd'); setConfirm(false) }}>Inkooporder annuleren</button>
        </>}><p style={{ margin: 0 }}>De zendingen vervallen. Klantorders die hierop wachten, verschijnen weer bij "Nog in te kopen".</p></Modal>
      )}
    </>
  )
}

export function ShipmentPill({ status }: { status: string }) {
  const map: Record<string, [string, Tone]> = { expected: ['Verwacht', 'info'], partial: ['Deels ontvangen', 'warn'], received: ['Ontvangen', 'good'], closed: ['Afgesloten', ''] }
  const [l, t] = map[status]
  return <Pill tone={t}>{l}</Pill>
}

interface PoLine { key: number; product_id: string; qty: number; unit_cost: number; sales_order_line_id: string | null }
interface PoShip { key: number; expected_date: string; warehouse_id: string; carrier: string; pct: number }
let k = 1

export function PurchaseForm() {
  const { s, run } = useApp()
  const today = todayISO()
  const suppliers = s.suppliers.filter((x) => x.is_active)
  const receivers = s.warehouses.filter((w) => w.is_active && w.receives_goods)
  const [supplier, setSupplier] = useState('')
  const [orderDate, setOrderDate] = useState(today)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<PoLine[]>([])
  const lead = suppliers.find((x) => x.id === supplier)?.lead_time_days ?? 21
  const [ships, setShips] = useState<PoShip[]>([{ key: k++, expected_date: addDays(today, 21), warehouse_id: receivers[0]?.id ?? '', carrier: '', pct: 100 }])

  const waiting = linesToPurchase(s).filter((l) => !lines.some((x) => x.sales_order_line_id === l.id))
  const products = useMemo(() => s.products.filter((p) => p.is_active && (!supplier || p.supplier_id === supplier || !p.supplier_id)).map((p) => ({ value: p.id, label: p.name, sub: `${p.sku}, inkoop ${eur(p.purchase_price)}`, search: p.sku })), [s.products, supplier])

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
    setShips(base.map((pct, i) => ({ key: k++, expected_date: addDays(orderDate, lead + i * 14), warehouse_id: wh, carrier: ships[0]?.carrier ?? '', pct })))
  }
  const total = round2(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0))
  const pctSum = ships.reduce((n, x) => n + x.pct, 0)

  const save = async () => {
    let id = ''
    const ok = await run(async (db) => {
      id = await createPurchaseOrder(db, { supplier_id: supplier, order_date: orderDate, supplier_reference: reference, notes, lines: lines.map(({ key: _k, ...l }) => l), shipments: ships.map(({ key: _k, ...x }) => x) })
    }, 'Inkooporder aangemaakt')
    if (ok) go(`inkoop-${id}`)
  }

  return (
    <>
      <Head title="Nieuwe inkooporder" back={{ href: '#inkoop', label: 'Inkoop' }} />
      <div className="stack">
        <section className="panel">
          <h2>Bestelling</h2>
          <div className="form-grid">
            <SelectField className="span-2" label="Leverancier" value={supplier} onChange={setSupplier} placeholder="Kies een leverancier" options={suppliers.map((x) => ({ value: x.id, label: `${x.name} (${x.country})` }))} />
            <TextField label="Besteldatum" type="date" value={orderDate} onChange={setOrderDate} />
            <TextField label="Referentie leverancier" value={reference} onChange={setReference} placeholder="Ordernummer bij leverancier" />
          </div>
        </section>

        {waiting.length > 0 && (
          <section className="panel">
            <h2>Nog in te kopen voor klantorders</h2>
            <div className="actions">{waiting.map((l) => (
              <button key={l.id} className="btn sm" onClick={() => addWaiting(l.id)}>
                <Plus size={14} />{l.qty} × {l.description} ({s.sales_orders.find((o) => o.id === l.sales_order_id)?.number})
              </button>
            ))}</div>
          </section>
        )}

        <section className="panel">
          <div className="panel-head"><h2>Producten</h2><button className="btn sm" onClick={() => setLines((v) => [...v, { key: k++, product_id: '', qty: 1, unit_cost: 0, sales_order_line_id: null }])}><Plus size={14} />Regel toevoegen</button></div>
          {lines.length === 0 && <Empty>Voeg het eerste product toe.</Empty>}
          {lines.length > 0 && (
            <div className="table-wrap" style={{ minHeight: 120 }}><table>
              <thead><tr><th style={{ minWidth: 260 }}>Product</th><th>Voor order</th><th className="num">Aantal</th><th className="num">Inkoopprijs</th><th className="num">Totaal</th><th></th></tr></thead>
              <tbody>{lines.map((l) => {
                const so = l.sales_order_line_id && s.sales_orders.find((o) => o.id === s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.sales_order_id)
                return (
                  <tr key={l.key}>
                    <td><Combo value={l.product_id} options={products} placeholder="Zoek op naam of artikelnummer" onChange={(v) => patchLine(l.key, { product_id: v, unit_cost: s.products.find((p) => p.id === v)?.purchase_price ?? 0 })} /></td>
                    <td className="muted">{so ? so.number : 'Voorraad'}</td>
                    <td className="num"><input className="qty" aria-label="Aantal" type="number" min={1} value={l.qty} onChange={(e) => patchLine(l.key, { qty: Number(e.target.value) })} /></td>
                    <td className="num"><input className="price" aria-label="Inkoopprijs" type="number" step="0.01" min={0} value={l.unit_cost} onChange={(e) => patchLine(l.key, { unit_cost: Number(e.target.value) })} /></td>
                    <td className="num">{eur(l.qty * l.unit_cost)}</td>
                    <td><button className="btn icon" aria-label="Regel verwijderen" onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button></td>
                  </tr>
                )
              })}</tbody>
              <tfoot><tr><td colSpan={4}>Totaal exclusief IVA</td><td className="num">{eur(total)}</td><td></td></tr></tfoot>
            </table></div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Zendingen</h2>
            <div className="actions">
              <button className="btn sm" onClick={() => applyPreset(1)}>Alles ineens</button>
              <button className="btn sm" onClick={() => applyPreset(2)}>50 / 50</button>
              <button className="btn sm" onClick={() => applyPreset(3)}>In 3 delen</button>
              <button className="btn sm" onClick={() => setShips((v) => [...v, { key: k++, expected_date: addDays(orderDate, lead), warehouse_id: receivers[0]?.id ?? '', carrier: '', pct: 0 }])}><Plus size={14} />Zending</button>
            </div>
          </div>
          <div className="stack">
            {ships.map((x, i) => (
              <div key={x.key} className="form-grid" style={{ alignItems: 'end' }}>
                <TextField label={`Zending ${i + 1}: verwacht op`} type="date" value={x.expected_date} onChange={(v) => patchShip(x.key, { expected_date: v })} />
                <SelectField label="Komt binnen op" value={x.warehouse_id} onChange={(v) => patchShip(x.key, { warehouse_id: v })} options={receivers.map((w) => ({ value: w.id, label: w.name }))} />
                <TextField label="Vervoerder" value={x.carrier} onChange={(v) => patchShip(x.key, { carrier: v })} />
                <NumberField label="Deel van de bestelling (%)" value={x.pct} min={0} onChange={(v) => patchShip(x.key, { pct: v })} />
                {lines.length > 0 && <div className="small muted span-2">{lines.filter((l) => l.product_id).map((l) => `${splitQty(l.qty, ships.map((y) => y.pct || 0.0001))[i]} × ${s.products.find((p) => p.id === l.product_id)?.name}`).join(', ')}</div>}
                {ships.length > 1 && <button className="btn sm" style={{ justifySelf: 'start' }} onClick={() => setShips((v) => v.filter((y) => y.key !== x.key))}>Zending verwijderen</button>}
              </div>
            ))}
            {Math.round(pctSum) !== 100 && <div className="note warn">De delen tellen op tot {pctSum}%. Dat moet 100% zijn.</div>}
          </div>
        </section>

        <section className="panel"><AreaField label="Notitie" value={notes} onChange={setNotes} /></section>
        <div className="sticky-save">
          <a className="btn" href="#inkoop">Annuleren</a>
          <button className="btn primary" onClick={save}>Inkooporder aanmaken</button>
        </div>
      </div>
    </>
  )
}
