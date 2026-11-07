import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, FileText, PackageCheck, Plus, Trash2, Truck } from 'lucide-react'
import { defaultReceiptWarehouse, flowCounts, isSpanishSupplier, inboundWarehouse, linesToPurchase, round2, shipmentDestination, shipmentIsOpen, todayISO } from '../domain/calc'
import { assignShipmentsToTransport, cancelPurchaseOrder, createPurchaseOrder, markReceivedInNl, setPurchaseLabel, syncPurchaseProformas } from '../domain/services'
import { followRank, inOrdersTab } from '../domain/orderFlow'
import { PURCHASE_PHASE_LABEL, PURCHASE_PHASES, PURCHASE_TABS, purchaseActiveIn, purchaseFlow, purchasesHref, type PurchasePhaseKey, type PurchaseTab } from '../domain/purchaseFlow'
import { FlowTrack, MiniTrack, NextStep, PhaseCell, PURCHASE_DEFS, PURCHASE_PHASE_ICON, phaseText } from '../ui/OrderFlowTrack'
import type { PurchaseLabel } from '../data/types'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { AreaField, Combo, Empty, eur, fmtDate, Head, Modal, Pill, SelectField, Sku, Tabs, TextField, type Tone } from '../ui/kit'
import { ConvertProformaModal, linesWithoutSupplier, proformasInSync, purchaseValue, salesOrdersOf } from './PurchaseQueue'

type Snap = ReturnType<typeof useApp>['s']

type PurchaseFilter = PurchaseTab

/**
 * Inkooporders als flow van links naar rechts (besluit Rick 7 november 2026), net als Verkooporders:
 * Proforma → Inkooporder → Ontvangen in NL → Transport → Ontvangst in Spanje → Aflevering.
 * Proforma's staan er ook in; omzetten gaat per proforma (per verkooporder), niet gebundeld.
 */
export function Purchases({ tab = 'opvolgen', phase: initialPhase = null }: { tab?: PurchaseTab; phase?: PurchasePhaseKey | null } = {}) {
  const { s, run } = useApp()
  const today = todayISO()
  const inSync = proformasInSync(s)
  useEffect(() => { if (!inSync) void run((db) => syncPurchaseProformas(db)) }, [inSync, run])
  const [filter, setFilterState] = useState<PurchaseFilter>(tab)
  const [phase, setPhaseState] = useState<PurchasePhaseKey | null>(initialPhase)
  const [labelFilter, setLabelFilter] = useState<PurchaseLabel | ''>('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [q, setQ] = useState('')
  const remember = (f: PurchaseFilter, p: PurchasePhaseKey | null) => history.replaceState(null, '', purchasesHref(f, p ?? undefined))
  const setFilter = (f: PurchaseFilter) => { setFilterState(f); setPhaseState(null); remember(f, null) }
  const setPhase = (p: PurchasePhaseKey | null) => { setPhaseState(p); remember(filter, p) }
  const missing = linesWithoutSupplier(s)
  const rows = useMemo(() => s.purchase_orders.map((po) => ({ po, flow: purchaseFlow(s, po, today), orders: salesOrdersOf(s, po.id) }))
    .sort((a, b) => followRank(a.flow.follow) - followRank(b.flow.follow) || b.po.order_date.localeCompare(a.po.order_date) || b.po.number.localeCompare(a.po.number)), [s, today])
  const t = q.trim().toLowerCase()
  const supplierName = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? ''
  const matches = (r: typeof rows[number]) => (!supplierFilter || r.po.supplier_id === supplierFilter) && (!labelFilter || (r.po.label ?? 'magazijn') === labelFilter)
    && (!t || `${r.po.number} ${r.po.supplier_reference} ${supplierName(r.po.supplier_id)} ${r.orders.map((o) => o.number).join(' ')}`.toLowerCase().includes(t))
  const inTab = rows.filter((r) => inOrdersTab(filter, r.flow.follow) && matches(r))
  const shown = inTab.filter((r) => !phase || purchaseActiveIn(r.flow, phase))
  const late = rows.filter((r) => r.flow.follow === 'te_laat' && matches(r)).length
  const counts = flowCounts(s)
  const usedSuppliers = s.suppliers.filter((x) => s.purchase_orders.some((po) => po.supplier_id === x.id)).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <>
      <Head title={tx("Inkooporders")} sub={tx("Elke inkooporder loopt van links naar rechts door de flow, van proforma tot aflevering aan de klant. Koperkleur vraagt actie, rood is te laat, blauw loopt, groen is klaar.")}>
        <a className="btn" href="#inkomend"><Truck size={16} />{tx("Gepland transport")}{counts.inkomend > 0 && <span className="btn-n bad">{tx("{0} te laat", counts.inkomend)}</span>}</a>
        <a className="btn" href="#ontvangst"><PackageCheck size={16} />{tx("Ontvangst")}{counts.ontvangst > 0 && <span className="btn-n">{tx("{0} binnen 7 dagen", counts.ontvangst)}</span>}</a>
        <a className="btn primary" href="#inkoop-nieuw"><Plus size={16} />{tx("Nieuwe inkooporder")}</a>
      </Head>
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-end' }}>
          <Tabs<PurchaseFilter> value={filter} onChange={setFilter} tabs={PURCHASE_TABS.map((f) => ({ value: f, label: { opvolgen: tx("Opvolgen"), loopt: tx("Loopt"), afgerond: tx("Afgerond"), alle: tx("Alles") }[f], n: rows.filter((r) => inOrdersTab(f, r.flow.follow) && matches(r)).length }))} />
          <input style={{ maxWidth: 260, marginBottom: 14 }} aria-label={tx("Inkooporders zoeken")} placeholder={tx("Zoek op nummer, leverancier of verkooporder")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="panel-head" style={{ marginTop: -6 }}>
          <div className="chips" role="group" aria-label={tx("Filter op label")}>
            {([['', tx("Alle labels")], ['verkoop', tx("Verkoop")], ['magazijn', tx("Magazijn")], ['showroom', tx("Showroom")]] as [PurchaseLabel | '', string][]).map(([value, text]) => (
              <button key={value || 'alle'} type="button" className={`chip${labelFilter === value ? ' on' : ''}`} aria-pressed={labelFilter === value} onClick={() => setLabelFilter(value)}>{text}</button>
            ))}
          </div>
          <select style={{ width: 'auto', maxWidth: 'min(340px, 100%)' }} aria-label={tx("Filter op leverancier")} value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}>
            <option value="">{tx("Alle leveranciers")}</option>
            {usedSuppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        {missing.length > 0 && (
          <div className="note warn" style={{ marginBottom: 12 }}>
            <strong>{tx("Geen leverancier bij het artikel, dus geen proforma:")}</strong>{' '}
            {missing.map((l, i) => {
              const o = s.sales_orders.find((x) => x.id === l.sales_order_id)
              return <span key={l.id}>{i > 0 && ', '}<a className="rowlink" href={`#orders-${l.sales_order_id}`}>{o?.number}</a> {l.description}</span>
            })}. <a href="#beheer">{tx("Vul de leverancier in onder Beheer.")}</a>
          </div>
        )}
        <p className="small muted" style={{ marginTop: 0 }}>
          {{ opvolgen: tx("Inkooporders waar iemand iets moet doen: proforma omzetten, op een transport zetten of inboeken. Wat te laat is staat bovenaan."), loopt: tx("Inkooporders die op schema lopen: bij de leverancier, onderweg, of ontvangen en verder in de verkooporder."), afgerond: tx("Ontvangen en, bij een verkooporder, geleverd aan de klant."), alle: tx("Alle inkooporders en proforma's, ook geannuleerde.") }[filter]}
          {filter === 'opvolgen' && late > 0 && <> <strong style={{ color: 'var(--bad)' }}>{tx("{0} te laat.", late)}</strong></>}
        </p>
        {inTab.length === 0 && <Empty>{filter === 'opvolgen' ? tx("Niets op te volgen. Alles loopt.") : tx("Geen inkooporders in dit overzicht.")}</Empty>}
        {inTab.length > 0 && <div className="table-wrap sticky-flow"><table className="flow-table">
          <thead><tr>
            <th aria-label="PDF" /><th>{tx("Inkooporder")}</th>
            {PURCHASE_PHASES.map((k, i) => {
              const Icon = PURCHASE_PHASE_ICON[k]
              const n = inTab.filter((r) => purchaseActiveIn(r.flow, k)).length
              return (
                <th key={k} className={`ph-head${phase === k ? ' on' : ''}`}>
                  <button type="button" onClick={() => setPhase(phase === k ? null : k)} aria-pressed={phase === k} title={phase === k ? tx("Filter op deze fase opheffen") : tx("Alleen inkooporders in deze fase")}>
                    <span className="ph-head-n"><Icon size={14} />{i + 1}</span>
                    <span className="ph-head-l">{tx(PURCHASE_PHASE_LABEL[k])}</span>
                    <span className="ph-head-c">{n > 0 ? n : ''}</span>
                  </button>
                </th>
              )
            })}
            <th>{tx("Volgende stap")}</th>
          </tr></thead>
          <tbody>{shown.map(({ po, flow, orders }) => {
            const cur = (flow.phases.find((p) => p.state !== 'done' && p.state !== 'skip') ?? flow.phases[5]).key
            return (
              <tr key={po.id} className={`click fl-${flow.follow}${po.status === 'proforma' ? ' is-proforma' : ''}`} onClick={() => go(`inkoop-${po.id}`)}>
                <td><a className="pdf-ic" href={`#inkoop-print-${po.id}`} title={tx("Inkooporder {0} afdrukken als PDF", po.number)} aria-label={tx("Inkooporder {0} afdrukken als PDF", po.number)} onClick={(e) => e.stopPropagation()}><FileText size={18} /><span>PDF</span></a></td>
                <td className="fl-who">
                  <a className="rowlink" href={`#inkoop-${po.id}`}>{po.number}</a> <LabelPill label={po.label} />
                  <div>{supplierName(po.supplier_id)}</div>
                  <div className="muted small">{fmtDate(po.order_date)}, {eur(purchaseValue(s, po.id))}{orders.map((o) => <span key={o.id}>, <a href={`#orders-${o.id}`} onClick={(e) => e.stopPropagation()}>{o.number}</a></span>)}{po.status === 'cancelled' && <> <Pill>{tx("Geannuleerd")}</Pill></>}</div>
                  <MiniTrack flow={flow} />
                </td>
                {flow.phases.map((p) => <td key={p.key} className="ph-td"><PhaseCell phase={p} defs={PURCHASE_DEFS} current={p.key === cur && flow.follow !== 'afgerond'} /></td>)}
                <td className="fl-next"><NextStep flow={flow} defs={PURCHASE_DEFS} /></td>
              </tr>
            )
          })}</tbody>
        </table></div>}
        {inTab.length > 0 && shown.length === 0 && <Empty>{tx("Geen inkooporders in deze fase.")}</Empty>}
        {phase && <p className="small muted">{tx("Gefilterd op fase {0}.", tx(PURCHASE_PHASE_LABEL[phase]))} <button type="button" className="btn sm" onClick={() => setPhase(null)}>{tx("Toon alle fasen")}</button></p>}
      </section>
    </>
  )
}

const LABELS: Record<PurchaseLabel, [string, Tone]> = { showroom: ['Showroom', 'info'], magazijn: ['Magazijn', ''], verkoop: ['Verkoop', 'sell'] }
// Testgegevens uit een oudere versie hebben nog geen label.
export const LabelPill = ({ label = 'magazijn' }: { label?: PurchaseLabel }) => <Pill tone={LABELS[label][1]}>{tx(LABELS[label][0])}</Pill>

export function PurchaseDetail({ id, convert: convertNow = false }: { id: string; convert?: boolean }) {
  const { s, run } = useApp()
  const [confirm, setConfirm] = useState(false)
  // Vanaf de verkooporder ("Inkooporder maken") opent het omzetten direct.
  const [convert, setConvert] = useState(convertNow && s.purchase_orders.find((p) => p.id === id)?.status === 'proforma')
  const po = s.purchase_orders.find((p) => p.id === id)
  if (!po) return <div className="panel">{tx("Inkooporder niet gevonden.")} <a href="#inkoop">{tx("Terug naar inkoop")}</a>.</div>
  const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === id)
  const planned = s.transports.filter((t) => t.status === 'planned').sort((a, b) => a.departure_date.localeCompare(b.departure_date))
  const shipmentOf = (lineId: string) => s.inbound_shipments.find((x) => s.inbound_shipment_lines.some((l) => l.shipment_id === x.id && l.purchase_order_line_id === lineId))
  const supplier = s.suppliers.find((x) => x.id === po.supplier_id)
  const forSale = lines.some((l) => l.sales_order_line_id)
  const isProforma = po.status === 'proforma'
  const flow = purchaseFlow(s, po)
  const today = todayISO()
  const domestic = isSpanishSupplier(supplier)
  const hasReceipts = lines.some((l) => s.goods_receipt_lines.some((r) => r.shipment_line_id === s.inbound_shipment_lines.find((x) => x.purchase_order_line_id === l.id)?.id))
  return (
    <>
      <Head title={<>{po.number} {isProforma && <Pill tone="warn">{tx("Proforma")}</Pill>} {forSale && <LabelPill label="verkoop" />}</>} sub={isProforma ? tx("{0}, ontstaan op {1}", supplier?.name, fmtDate(po.order_date)) : tx("{0}, besteld op {1}{2}", supplier?.name, fmtDate(po.order_date), po.supplier_reference ? tx(", referentie {0}", po.supplier_reference) : '')} back={{ href: '#inkoop', label: tx("Inkooporders") }}>
        {isProforma && <button className="btn primary" onClick={() => setConvert(true)}>{tx("Omzetten naar inkooporder")}<ArrowRight size={16} /></button>}
        {!forSale && <select style={{ width: 'auto' }} aria-label={tx("Label")} value={po.label ?? 'magazijn'} onChange={(e) => run((db) => setPurchaseLabel(db, id, e.target.value as PurchaseLabel), tx("Label aangepast"))}>
          <option value="showroom">{tx("Showroom")}</option>
          <option value="magazijn">{tx("Magazijn")}</option>
        </select>}
        {po.status === 'open' && !hasReceipts && <button className="btn danger" onClick={() => setConfirm(true)}>{tx("Inkooporder annuleren")}</button>}
      </Head>
      <div className="stack">
        <section className="panel">
          <FlowTrack flow={flow} defs={PURCHASE_DEFS} />
          {flow.next && flow.follow !== 'geannuleerd' && !isProforma && (
            <div className={`flow-next fl-${flow.follow}`}>
              <div>
                <span className="lbl">{flow.follow === 'wacht' ? tx("Loopt, nu geen actie") : flow.follow === 'te_laat' ? tx("Te laat, eerst doen") : tx("Volgende stap")}</span>
                <strong>{tx(PURCHASE_PHASE_LABEL[flow.next.key])}: {phaseText(flow.next)}</strong>
              </div>
              {flow.next.href && flow.follow !== 'wacht' && <a className="btn primary" href={flow.next.href}>{tx("Naar {0}", tx(PURCHASE_PHASE_LABEL[flow.next.key]).toLowerCase())}</a>}
            </div>
          )}
          {flow.follow === 'afgerond' && <div className="flow-next fl-afgerond"><strong>{tx("Afgerond: ontvangen en, bij een verkooporder, geleverd aan de klant.")}</strong></div>}
        </section>
        {isProforma && (
          <div className="note proforma">
            <div>
              <strong>{tx("Proforma, nog geen inkooporder")}</strong>
              <div>{tx("{0} is vanzelf ontstaan uit de verkooporder, voor wat niet op voorraad is. Het nummer is tijdelijk. Wijzigt de verkooporder, dan wijzigt deze proforma mee. Zet hem om naar een inkooporder om te bestellen; dan krijgt hij een definitief nummer en kan hij op een transport.", po.number)}</div>
            </div>
          </div>
        )}
        <section className="panel">
          <h2>{isProforma ? tx("Producten") : tx("Bestelde producten")}</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>{tx("Product")}</th><th>{tx("Voor")}</th><th className="num">{tx("Aantal")}</th><th className="num">{tx("Inkoopprijs")}</th><th className="num">{tx("Totaal")}</th><th style={{ minWidth: 150 }}>{tx("In Nederland")}</th><th style={{ minWidth: 190 }}>{tx("Transport")}</th><th>{tx("Verwacht")}</th><th style={{ minWidth: 170 }}>{tx("Locatie")}</th></tr></thead>
            <tbody>{lines.map((l) => {
              const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)
              const so = sol && s.sales_orders.find((o) => o.id === sol.sales_order_id)
              const x = shipmentOf(l.id)
              const t = x && s.transports.find((r) => r.id === x.transport_id)
              const open = !!x && shipmentIsOpen(x) && po.status === 'open'
              return (
                <tr key={l.id}>
                  <td className="strong">{s.products.find((p) => p.id === l.product_id)?.name}<Sku code={s.products.find((p) => p.id === l.product_id)?.sku} />{sol?.options && <div className="muted small" style={{ fontWeight: 400 }}>{sol.options}</div>}</td>
                  <td>{so ? <a className="rowlink" href={`#orders-${so.id}`}>{so.number}</a> : <span className="muted">{tx("Voorraad")}</span>}</td>
                  <td className="num">{l.qty}</td><td className="num">{eur(l.unit_cost)}</td><td className="num">{eur(l.qty * l.unit_cost)}</td>
                  <td>{!x || po.status !== 'open' ? <span className="muted">–</span>
                    : domestic ? <span className="muted small">{tx("Leverancier in Spanje")}</span>
                    : x.nl_received_at ? <>{fmtDate(x.nl_received_at)}{open && !x.transport_id && <div><button className="btn sm" style={{ marginTop: 4 }} onClick={() => run((db) => markReceivedInNl(db, [x.id], null), tx("Ontvangst in NL ongedaan gemaakt"))}>{tx("Ongedaan maken")}</button></div>}</>
                    : open ? <><span className={x.original_date < today ? 'small' : 'muted small'} style={x.original_date < today ? { color: 'var(--bad)' } : undefined}>{tx("Verwacht {0}", fmtDate(x.original_date))}</span><div><button className="btn sm primary" style={{ marginTop: 4 }} onClick={() => run((db) => markReceivedInNl(db, [x.id], today), tx("Ontvangen in NL"))}>{tx("Ontvangen in NL")}</button></div></>
                    : <span className="muted">–</span>}</td>
                  <td>{domestic ? <span className="muted small">{x && open ? tx("Eigen vervoer leverancier, verwacht {0}", fmtDate(x.original_date)) : tx("Eigen vervoer leverancier")}</span> : x && open && x.nl_received_at && (!t || t.status === 'planned')
                    ? <select aria-label={tx("Transport voor {0}", s.products.find((p) => p.id === l.product_id)?.name)} value={x.transport_id ?? ''} onChange={(e) => run((db) => assignShipmentsToTransport(db, [x.id], e.target.value || null), tx("Transport aangepast"))}>
                        <option value="">{tx("Nog niet ingepland")}</option>
                        {planned.map((r) => <option key={r.id} value={r.id}>{tx("{0}, vertrek {1}", r.number, fmtDate(r.departure_date))}</option>)}
                      </select>
                    : t?.number ?? '–'}</td>
                  <td>{x && t ? fmtDate(x.expected_date) : <span className="muted">–</span>}</td>
                  <td>{x ? <>{shipmentDestination(s, x)}{x.status === 'received' ? <> <Pill tone="good">{tx("Ontvangen")}</Pill></> : <div className="muted small">{tx("Voorstel, te kiezen bij inboeken")}</div>}</> : defaultReceiptWarehouse(s.warehouses, po.label)?.name}</td>
                </tr>
              )
            })}</tbody>
          </table></div>
        </section>
        {po.notes && <section className="panel"><h2>{tx("Notitie")}</h2><p style={{ margin: 0 }}>{po.notes}</p></section>}
      </div>
      {convert && <ConvertProformaModal ids={[id]} onClose={() => setConvert(false)} onDone={(ids) => { setConvert(false); if (ids[0]) go(`inkoop-${ids[0]}`) }} />}
      {confirm && (
        <Modal title={tx("{0} annuleren?", po.number)} onClose={() => setConfirm(false)} footer={<>
          <button className="btn" onClick={() => setConfirm(false)}>{tx("Terug")}</button>
          <button className="btn danger" onClick={async () => { await run((db) => cancelPurchaseOrder(db, id), tx("Inkooporder geannuleerd")); setConfirm(false) }}>{tx("Inkooporder annuleren")}</button>
        </>}><p style={{ margin: 0 }}>{tx("De regels vervallen. Wat verkooporders hiervan nodig hebben, komt terug op een proforma-inkooporder.")}</p></Modal>
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
  // Rechtstreeks bij de leverancier, of uit hoofde van een verkooporder: wat daarvan nog niet is ingekocht.
  const need = linesToPurchase(s)
  const supplierOf = (productId: string) => productOf(productId)?.supplier_id ?? ''
  const fits = (productId: string, sup: string) => !sup || !supplierOf(productId) || supplierOf(productId) === sup
  const openFor = (oid: string, sup: string) => need.filter((l) => l.sales_order_id === oid && fits(l.product_id, sup) && !lines.some((x) => x.sales_order_line_id === l.id))
  const orderChoices = s.sales_orders.filter((o) => o.status === 'open' && openFor(o.id, supplier).length > 0).sort((a, b) => b.number.localeCompare(a.number))
  const addFromOrder = (oid: string) => {
    const sup = supplier || need.filter((l) => l.sales_order_id === oid).map((l) => supplierOf(l.product_id)).find(Boolean) || ''
    if (!supplier && sup) setSupplier(sup)
    setLines((v) => [...v, ...openFor(oid, sup).map((l) => ({ key: k++, product_id: l.product_id, qty: l.qty, unit_cost: productOf(l.product_id)?.purchase_price ?? 0, sales_order_line_id: l.id }))])
  }
  const changeSupplier = (sup: string) => {
    setSupplier(sup)
    // Regels van een verkooporder horen bij de leverancier van het artikel.
    setLines((v) => v.filter((l) => !l.sales_order_line_id || fits(l.product_id, sup)))
  }
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
            <SelectField className="span-2" label={tx("Leverancier")} value={supplier} onChange={changeSupplier} placeholder={tx("Kies een leverancier")} options={suppliers.map((x) => ({ value: x.id, label: `${x.name} (${x.country})` }))} />
            <TextField label={tx("Besteldatum")} type="date" value={orderDate} onChange={setOrderDate} />
            <TextField label={tx("Referentie leverancier")} value={reference} onChange={setReference} placeholder={tx("Ordernummer bij leverancier")} />
            {isSale
              ? <div className="field"><span className="lbl">{tx("Label")}</span><div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }}><LabelPill label="verkoop" /></div></div>
              : <SelectField label={tx("Label")} value={label} onChange={setLabel} options={[{ value: 'magazijn', label: tx("Magazijn") }, { value: 'showroom', label: tx("Showroom") }]} />}
            <div className="field span-2"><span className="lbl">{tx("Locatie bij ontvangst")}</span><div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }}>{tx("{0}, te wijzigen bij inboeken", defaultReceiptWarehouse(s.warehouses, isSale ? 'verkoop' : label)?.name ?? '')}</div></div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>{tx("Producten")}</h2><div className="btn-row" style={{ alignItems: 'center' }}>
            <select style={{ width: 'auto', minHeight: 32, maxWidth: 360 }} aria-label={tx("Regels uit verkooporder")} value="" disabled={!orderChoices.length} onChange={(e) => { if (e.target.value) addFromOrder(e.target.value) }}>
              <option value="">{orderChoices.length ? tx("Regels uit verkooporder…") : tx("Geen verkooporder met artikelen op bestelling")}</option>
              {orderChoices.map((o) => {
                const c = s.customers.find((x) => x.id === o.customer_id)
                const n = openFor(o.id, supplier).length
                return <option key={o.id} value={o.id}>{tx("{0}, {1} ({2})", o.number, c?.company || c?.name || '–', n === 1 ? tx("1 regel") : tx("{0} regels", n))}</option>
              })}
            </select>
            <button className="btn sm" onClick={() => setLines((v) => [...v, { key: k++, product_id: '', qty: 1, unit_cost: 0, sales_order_line_id: null }])}><Plus size={14} />{tx("Regel toevoegen")}</button>
          </div></div>
          {lines.length === 0 && <Empty>{tx("Voeg het eerste product toe, of neem de regels over uit een verkooporder.")}</Empty>}
          {isSale && <p className="small muted" style={{ marginTop: 0 }}>{tx("Regels uit een verkooporder gaan bij het aanmaken van de proforma-inkooporder af.")}</p>}
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
