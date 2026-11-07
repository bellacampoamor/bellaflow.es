import type { Language } from '../data/types'
import { articleNo, round2 } from '../domain/calc'
import { useApp, useAutoPrint } from '../ui/app-context'
import { eur, fmtDate, Head, DocPaper } from '../ui/kit'
import { tx } from '../i18n'

const T: Record<Language, Record<string, string>> = {
  es: { title: 'Pedido de compra', proforma: 'Proforma pedido de compra', date: 'Fecha', ref: 'Su referencia', supplier: 'Proveedor', tax: 'NIF', code: 'Referencia', prod: 'Producto', opts: 'Acabado', qty: 'Cant.', price: 'Precio', total: 'Total', grand: 'Total sin IVA', notes: 'Observaciones' },
  nl: { title: 'Inkooporder', proforma: 'Proforma-inkooporder', date: 'Datum', ref: 'Uw referentie', supplier: 'Leverancier', tax: 'Btw-nummer', code: 'Artikelnummer', prod: 'Product', opts: 'Uitvoering', qty: 'Aantal', price: 'Prijs', total: 'Totaal', grand: 'Totaal excl. btw', notes: 'Opmerkingen' },
  en: { title: 'Purchase order', proforma: 'Proforma purchase order', date: 'Date', ref: 'Your reference', supplier: 'Supplier', tax: 'VAT no.', code: 'Item no.', prod: 'Product', opts: 'Finish', qty: 'Qty', price: 'Price', total: 'Total', grand: 'Total excl. VAT', notes: 'Notes' },
}

/** Afdrukbare inkooporder voor de leverancier. Bevat bewust geen klantgegevens. */
export function PurchaseOrderDocument({ id }: { id: string }) {
  const { s } = useApp()
  const po = s.purchase_orders.find((x) => x.id === id)
  useAutoPrint(true, !!po, "inkoop")
  if (!po) return <div className="panel">{tx("Inkooporder niet gevonden.")} <a href="#inkoop">{tx("Inkooporders")}</a>.</div>
  return (
    <>
      <Head title={po.number} back={{ href: "#inkoop", label: tx("Inkooporders") }} />
      <PurchaseOrderPaper id={id} />
    </>
  )
}

/** Meerdere inkooporders in één afdruk, elke inkooporder op een eigen pagina. */
export function PurchaseOrdersDocument({ ids, back }: { ids: string[]; back: string }) {
  const { s } = useApp()
  const found = ids.filter((id) => s.purchase_orders.some((x) => x.id === id))
  useAutoPrint(true, found.length > 0, back)
  if (!found.length) return <div className="panel">{tx("Inkooporder niet gevonden.")} <a href="#inkoop">{tx("Inkooporders")}</a>.</div>
  return (
    <>
      <Head title={found.length === 1 ? tx("1 inkooporder") : tx("{0} inkooporders", found.length)} back={{ href: `#${back}`, label: tx("Terug") }} />
      <div className="paper-stack">{found.map((id) => <PurchaseOrderPaper key={id} id={id} />)}</div>
    </>
  )
}

export function PurchaseOrderPaper({ id }: { id: string }) {
  const { s } = useApp()
  const po = s.purchase_orders.find((x) => x.id === id)!
  const sup = s.suppliers.find((x) => x.id === po.supplier_id)
  const co = s.settings[0]
  const language = co.language_purchase_order ?? 'nl'
  const t = T[language]
  const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === id)
  const total = round2(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0))
  return (
      <DocPaper language={language}>
        <div className="paper-top">
          <div>
            <h2 style={{ fontSize: '1.3rem' }}>{co.company_name}</h2>
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}<br />{t.tax}: {co.tax_id}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: '1.45rem' }}>{po.status === 'proforma' ? t.proforma : t.title}</h1>
            <div className="strong">{po.number}</div>
            <div className="small muted">{t.date}: {fmtDate(po.order_date)}{po.supplier_reference && <><br />{t.ref}: {po.supplier_reference}</>}</div>
          </div>
        </div>
        <div style={{ marginBottom: 22 }}>
          <div className="small muted">{t.supplier}</div>
          <div className="strong">{sup?.name}</div>
          <div className="small">{sup?.address}{sup?.address && <br />}{[sup?.postal_code, sup?.city].filter(Boolean).join(' ')}{sup?.vat_number && <><br />{t.tax}: {sup.vat_number}</>}</div>
        </div>
        <div className="table-wrap flush"><table>
          <thead><tr><th>{t.code}</th><th>{t.prod}</th><th className="num">{t.qty}</th><th className="num">{t.price}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>{lines.map((l) => {
            const options = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.options
            return (
              <tr key={l.id}>
                <td>{articleNo(s, l.product_id)}</td>
                <td className="strong">{s.products.find((p) => p.id === l.product_id)?.name}{options && <div className="small muted" style={{ fontWeight: 400 }}>{t.opts}: {options}</div>}</td>
                <td className="num">{l.qty}</td><td className="num">{eur(l.unit_cost)}</td><td className="num">{eur(round2(l.qty * l.unit_cost))}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
        <div className="totals" style={{ marginTop: 18 }}><div className="grand"><span>{t.grand}</span><span>{eur(total)}</span></div></div>
        {po.notes && <p className="small" style={{ marginTop: 18, marginBottom: 0 }}>{t.notes}: {po.notes}</p>}
      </DocPaper>
  )
}
