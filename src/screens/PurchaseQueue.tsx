import { useEffect, useState } from 'react'
import { ArrowRight, Check as CheckIcon, FileText } from 'lucide-react'
import { articleNo, inboundWarehouse, linesToPurchase, round2, todayISO } from '../domain/calc'
import { convertPurchaseProformas, syncPurchaseProformas } from '../domain/services'
import { tx } from '../i18n'
import { go, useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, Modal, pickRow, Sku, TextField } from '../ui/kit'

type Snap = ReturnType<typeof useApp>['s']

/** Klopt de stand van de proforma-inkooporders met wat de verkooporders nog nodig hebben? */
export function proformasInSync(s: Snap) {
  const proforma = new Set(s.purchase_orders.filter((p) => p.status === 'proforma').map((p) => p.id))
  const onProforma = new Map<string, number>()
  for (const l of s.purchase_order_lines) if (proforma.has(l.purchase_order_id) && l.sales_order_line_id) onProforma.set(l.sales_order_line_id, (onProforma.get(l.sales_order_line_id) ?? 0) + l.qty)
  const need = linesToPurchase(s).filter((l) => s.products.find((p) => p.id === l.product_id)?.supplier_id)
  return need.length === onProforma.size && need.every((l) => onProforma.get(l.id) === l.qty)
}

/** Verkooporderregels op bestelling waarvan het artikel geen leverancier heeft: die kunnen niet op een proforma. */
export const linesWithoutSupplier = (s: Snap) => linesToPurchase(s).filter((l) => !s.products.find((p) => p.id === l.product_id)?.supplier_id)

export const purchaseValue = (s: Snap, poId: string) => round2(s.purchase_order_lines.filter((l) => l.purchase_order_id === poId).reduce((n, l) => n + l.qty * l.unit_cost, 0))

/** Verkooporders waar de regels van een inkooporder voor zijn. */
export function salesOrdersOf(s: Snap, poId: string) {
  const ids = new Set(s.purchase_order_lines.filter((l) => l.purchase_order_id === poId && l.sales_order_line_id).map((l) => s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.sales_order_id))
  return s.sales_orders.filter((o) => ids.has(o.id)).sort((a, b) => a.number.localeCompare(b.number))
}

/**
 * Proforma-inkooporders: elke verkooporder met artikelen die niet op voorraad zijn, krijgt vanzelf per leverancier een proforma.
 * Selecteer er een of meer en zet ze om; per leverancier ontstaat één definitieve inkooporder.
 */
export function PurchaseProformas({ onDone }: { onDone: () => void }) {
  const { s, run } = useApp()
  const today = todayISO()
  const inSync = proformasInSync(s)
  useEffect(() => { if (!inSync) void run((db) => syncPurchaseProformas(db)) }, [inSync, run])
  const proformas = s.purchase_orders.filter((p) => p.status === 'proforma')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [filterSupplier, setFilterSupplier] = useState('')
  const [onlyToday, setOnlyToday] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const supplierName = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? ''
  const missing = linesWithoutSupplier(s)

  const shown = proformas
    .filter((p) => (!filterSupplier || p.supplier_id === filterSupplier) && (!onlyToday || p.order_date === today))
    .sort((a, b) => supplierName(a.supplier_id).localeCompare(supplierName(b.supplier_id)) || a.number.localeCompare(b.number))
  const chosen = proformas.filter((p) => selected.has(p.id))
  const shownIds = shown.map((p) => p.id)
  const allShown = shownIds.length > 0 && shownIds.every((id) => selected.has(id))
  const toggle = (ids: string[], on: boolean) => setSelected((v) => {
    const next = new Set(v)
    for (const id of ids) { if (on) next.add(id); else next.delete(id) }
    return next
  })
  const toggleOpen = (id: string) => setOpen((v) => { const next = new Set(v); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const supplierCount = new Set(chosen.map((p) => p.supplier_id)).size
  const usedSuppliers = s.suppliers.filter((x) => proformas.some((p) => p.supplier_id === x.id)).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>{tx("Proforma-inkooporders")}</h2>
          <div className="small muted">{tx("Een verkooporder met artikelen die niet op voorraad zijn, maakt vanzelf per leverancier een proforma. Klik op een regel om die te selecteren en zet de selectie om naar inkooporders: per leverancier één inkooporder.")}</div>
        </div>
        <div className="btn-row" style={{ alignItems: 'center' }}>
          <select style={{ width: 'auto', minHeight: 32 }} aria-label={tx("Filter op leverancier")} value={filterSupplier} onChange={(e) => setFilterSupplier(e.target.value)}>
            <option value="">{tx("Alle leveranciers")}</option>
            {usedSuppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyToday} onChange={(e) => setOnlyToday(e.target.checked)} />{tx("Alleen van vandaag")}</label>
          <button className="btn sm" onClick={() => toggle(shownIds, !allShown)}>{allShown ? tx("Niets selecteren") : tx("Alles selecteren")}</button>
        </div>
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
      {shown.length === 0 && <Empty>{proformas.length ? tx("Geen proforma's met dit filter.") : tx("Alles is ingekocht. Een nieuwe verkooporder met artikelen op bestelling maakt hier vanzelf een proforma.")}</Empty>}
      {shown.length > 0 && <div className="table-wrap"><table className="queue">
        <thead><tr><th style={{ width: 44 }} aria-label={tx("Open of dicht")}></th><th>{tx("Proforma")}</th><th>{tx("Leverancier")}</th><th>{tx("Verkooporder")}</th><th>{tx("Datum")}</th><th className="num">{tx("Regels")}</th><th className="num">{tx("Waarde")}</th><th style={{ width: 34 }} aria-label={tx("Geselecteerd")}></th></tr></thead>
        {shown.map((po) => {
          const on = selected.has(po.id)
          const isOpen = open.has(po.id)
          const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id)
          const orders = salesOrdersOf(s, po.id)
          return (
            <tbody key={po.id}>
              <tr {...pickRow(on, () => toggle([po.id], !on), 'queue-head')}>
                <td><button type="button" className={`tri${isOpen ? ' open' : ''}`} aria-expanded={isOpen} aria-label={isOpen ? tx("{0} dichtklappen", po.number) : tx("{0} openklappen", po.number)} onClick={(e) => { e.stopPropagation(); toggleOpen(po.id) }}><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M1 3h10L6 10z" fill="currentColor" /></svg></button></td>
                <td><a className="rowlink" href={`#inkoop-${po.id}`} onClick={(e) => e.stopPropagation()}>{po.number}</a></td>
                <td>{supplierName(po.supplier_id)}</td>
                <td>{orders.map((o) => {
                  const c = s.customers.find((x) => x.id === o.customer_id)
                  return <div key={o.id}><a className="rowlink" href={`#orders-${o.id}`} onClick={(e) => e.stopPropagation()}>{o.number}</a> <span className="muted small">{c?.company || c?.name}</span></div>
                })}</td>
                <td>{fmtDate(po.order_date)}</td>
                <td className="num">{lines.length}</td>
                <td className="num">{eur(purchaseValue(s, po.id))}</td>
                <td>{on && <CheckIcon size={16} />}</td>
              </tr>
              {isOpen && lines.map((l) => (
                <tr key={l.id} {...pickRow(on, () => toggle([po.id], !on))}>
                  <td></td>
                  <td colSpan={4} className="strong">{s.products.find((p) => p.id === l.product_id)?.name}<Sku code={articleNo(s, l.product_id)} />{(() => { const o = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.options; return o ? <div className="muted small">{o}</div> : null })()}</td>
                  <td className="num muted">{l.qty} {tx("×")} {eur(l.unit_cost)}</td>
                  <td className="num">{eur(round2(l.qty * l.unit_cost))}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          )
        })}
      </table></div>}
      {proformas.length > 0 && (
        <div className="queue-bar">
          <span>{chosen.length ? tx("{0} proforma's geselecteerd, voor {1} leverancier(s)", chosen.length, supplierCount) : tx("Nog niets geselecteerd")}</span>
          <button className="btn primary" disabled={!chosen.length} onClick={() => setConfirm(true)}>{tx("Omzetten naar inkooporder")}<ArrowRight size={16} /></button>
        </div>
      )}
      {confirm && <ConvertProformaModal ids={chosen.map((p) => p.id)} onClose={() => setConfirm(false)} onDone={(ids) => {
        setSelected(new Set()); setConfirm(false)
        if (ids.length === 1) go(`inkoop-${ids[0]}`); else onDone()
      }} />}
    </section>
  )
}

/** Bevestigen van het omzetten, met besteldatum en (bij één leverancier) de referentie van de leverancier. */
export function ConvertProformaModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (ids: string[]) => void }) {
  const { s, run } = useApp()
  const [date, setDate] = useState(todayISO())
  const [reference, setReference] = useState('')
  const chosen = s.purchase_orders.filter((p) => ids.includes(p.id))
  const perSupplier = [...new Set(chosen.map((p) => p.supplier_id))].map((id) => {
    const group = chosen.filter((p) => p.supplier_id === id)
    return { id, name: s.suppliers.find((x) => x.id === id)?.name, group, value: round2(group.reduce((n, p) => n + purchaseValue(s, p.id), 0)) }
  })
  const save = async () => {
    let made: string[] = []
    const ok = await run(async (db) => { made = await convertPurchaseProformas(db, { ids, order_date: date, supplier_reference: perSupplier.length === 1 ? reference : '' }) },
      perSupplier.length === 1 ? tx("Inkooporder aangemaakt") : tx("{0} inkooporders aangemaakt", perSupplier.length))
    if (ok) onDone(made)
  }
  return (
    <Modal wide title={tx("Omzetten naar inkooporder")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={save}>{perSupplier.length === 1 ? tx("Inkooporder aanmaken") : tx("{0} inkooporders aanmaken", perSupplier.length)}</button>
    </>}>
      <div className="table-wrap flush convert-list"><table>
        <thead><tr><th>{tx("Leverancier")}</th><th>{tx("Proforma")}</th><th className="num">{tx("Waarde")}</th></tr></thead>
        <tbody>{perSupplier.map((x) => (
          <tr key={x.id}>
            <td className="strong">{x.name}</td>
            <td>{x.group.map((p) => <div key={p.id}><FileText size={12} /> {p.number} <span className="muted small">{salesOrdersOf(s, p.id).map((o) => o.number).join(', ')}</span></div>)}</td>
            <td className="num strong">{eur(x.value)}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="form-grid">
        <div className="field"><span className="lbl">{tx("Bestemming")}</span><div style={{ minHeight: 38, display: 'flex', alignItems: 'center' }}>{inboundWarehouse(s.warehouses)?.name}</div></div>
        <TextField label={tx("Besteldatum")} type="date" value={date} onChange={setDate} />
        {perSupplier.length === 1 && <TextField label={tx("Referentie leverancier")} value={reference} onChange={setReference} placeholder={tx("Ordernummer bij leverancier")} />}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tx("Per leverancier ontstaat één inkooporder met een definitief nummer. Koppel de regels aan een transport in stap 2 zodra de transportlijst bekend is.")}</p>
    </Modal>
  )
}
