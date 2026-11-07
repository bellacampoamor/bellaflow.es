import { useState } from 'react'
import { FileText } from 'lucide-react'
import { linesToPurchase, round2, todayISO } from '../domain/calc'
import { convertPurchaseProformas } from '../domain/services'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { eur, Modal, TextField } from '../ui/kit'

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

/** Omzetten van één proforma-inkooporder (één verkooporder, één leverancier) naar een inkooporder, met besteldatum en referentie. */
export function ConvertProformaModal({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (ids: string[]) => void }) {
  const { s, run } = useApp()
  const [date, setDate] = useState(todayISO())
  const [reference, setReference] = useState('')
  const chosen = s.purchase_orders.filter((p) => ids.includes(p.id))
  const save = async () => {
    let made: string[] = []
    const ok = await run(async (db) => { made = await convertPurchaseProformas(db, { ids, order_date: date, supplier_reference: chosen.length === 1 ? reference : '' }) },
      chosen.length === 1 ? tx("Inkooporder aangemaakt") : tx("{0} inkooporders aangemaakt", chosen.length))
    if (ok) onDone(made)
  }
  return (
    <Modal wide title={tx("Omzetten naar inkooporder")} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>{tx("Annuleren")}</button>
      <button className="btn primary" onClick={save}>{tx("Inkooporder aanmaken")}</button>
    </>}>
      <div className="table-wrap flush convert-list"><table>
        <thead><tr><th>{tx("Proforma")}</th><th>{tx("Leverancier")}</th><th>{tx("Verkooporder")}</th><th className="num">{tx("Waarde")}</th></tr></thead>
        <tbody>{chosen.map((p) => (
          <tr key={p.id}>
            <td className="strong"><FileText size={12} /> {p.number}</td>
            <td>{s.suppliers.find((x) => x.id === p.supplier_id)?.name}</td>
            <td>{salesOrdersOf(s, p.id).map((o) => { const c = s.customers.find((x) => x.id === o.customer_id); return <div key={o.id}>{o.number} <span className="muted small">{c?.company || c?.name}</span></div> })}</td>
            <td className="num strong">{eur(purchaseValue(s, p.id))}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="form-grid">
        <TextField label={tx("Besteldatum")} type="date" value={date} onChange={setDate} />
        {chosen.length === 1 && <TextField label={tx("Referentie leverancier")} value={reference} onChange={setReference} placeholder={tx("Ordernummer bij leverancier")} />}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tx("Elke proforma wordt een eigen inkooporder voor deze verkooporder. Zodra de leverancier hem in Nederland klaar heeft, registreer je Ontvangen in NL; daarna kan hij op een transport.")}</p>
    </Modal>
  )
}
