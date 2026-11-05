import type { Language } from '../data/types'
import { articleNo, depositPaid, documentLanguage, lineTotal, orderLines, orderTotal, vatBreakdown } from '../domain/calc'
import { useApp, useAutoPrint } from '../ui/app-context'
import { eur, fmtDate, Head } from '../ui/kit'
import { tx } from '../i18n'

const T: Record<Language, Record<string, string>> = {
  es: { title: 'Pedido de venta', date: 'Fecha', ref: 'Su referencia', seller: 'Vendedor', wanted: 'Fecha deseada', promised: 'Fecha prevista', bill: 'Cliente', to: 'Entregar a', tel: 'Tel.', tax: 'NIF', code: 'Referencia', prod: 'Producto', opts: 'Acabado', qty: 'Cant.', price: 'Precio', disc: 'Dto.', vat: 'IVA', total: 'Total', base: 'Base imponible', paid: 'Anticipo pagado', open: 'Pendiente de pago', pickup: 'Recogida por el cliente', notes: 'Observaciones' },
  nl: { title: 'Verkooporder', date: 'Datum', ref: 'Uw referentie', seller: 'Verkoper', wanted: 'Gewenste datum', promised: 'Verwachte datum', bill: 'Klant', to: 'Afleveren bij', tel: 'Tel.', tax: 'NIF', code: 'Artikelnummer', prod: 'Product', opts: 'Uitvoering', qty: 'Aantal', price: 'Prijs', disc: 'Korting', vat: 'IVA', total: 'Totaal', base: 'Grondslag', paid: 'Vooruitbetaald', open: 'Nog te betalen', pickup: 'Klant haalt op', notes: 'Opmerkingen' },
  en: { title: 'Sales order', date: 'Date', ref: 'Your reference', seller: 'Salesperson', wanted: 'Requested date', promised: 'Expected date', bill: 'Customer', to: 'Deliver to', tel: 'Tel.', tax: 'Tax ID', code: 'Item no.', prod: 'Product', opts: 'Finish', qty: 'Qty', price: 'Price', disc: 'Disc.', vat: 'IVA', total: 'Total', base: 'Tax base', paid: 'Advance paid', open: 'Amount due', pickup: 'Customer collects', notes: 'Notes' },
}

/** Afdrukbare verkooporder. Dit is geen factuur. */
export function SalesOrderDocument({ id }: { id: string }) {
  const { s } = useApp()
  const o = s.sales_orders.find((x) => x.id === id)
  useAutoPrint(true, !!o, 'orders')
  if (!o) return <div className="panel">{tx("Verkooporder niet gevonden.")} <a href="#orders">{tx("Verkooporders")}</a>.</div>
  const c = s.customers.find((x) => x.id === o.customer_id)!
  const co = s.settings[0]
  const t = T[documentLanguage(co.language_sales_order, c.language)]
  const lines = orderLines(s, id)
  const b = vatBreakdown(lines.map((l) => ({ total: lineTotal(l), vat_rate: l.vat_rate })))
  const total = orderTotal(s, id)
  const paid = depositPaid(s, id)
  const seller = s.salespeople.find((x) => x.id === o.salesperson_id)?.name
  return (
    <>
      <Head title={o.number} back={{ href: '#orders', label: tx("Verkooporders") }} />
      <div className="paper">
        <div className="paper-top">
          <div>
            <h2 style={{ fontSize: '1.3rem' }}>{co.company_name}</h2>
            <div className="small muted">{[co.address, `${co.postal_code} ${co.city}`.trim(), co.province, co.phone, co.email].filter(Boolean).join(', ')}<br />{t.tax}: {co.tax_id}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <h1 style={{ fontSize: '1.45rem' }}>{t.title}</h1>
            <div className="strong">{o.number}</div>
            <div className="small muted">
              {t.date}: {fmtDate(o.order_date)}
              {o.customer_reference && <><br />{t.ref}: {o.customer_reference}</>}
              {seller && <><br />{t.seller}: {seller}</>}
              {o.requested_date && <><br />{t.wanted}: {fmtDate(o.requested_date)}</>}
              {o.promised_date && <><br />{t.promised}: {fmtDate(o.promised_date)}</>}
            </div>
          </div>
        </div>
        <div className="note-meta">
          <div>
            <div className="small muted">{t.bill}</div>
            <div className="strong">{c.company || c.name}</div>
            <div className="small">{c.address}<br />{c.postal_code} {c.city}{c.tax_id && <><br />{t.tax}: {c.tax_id}</>}</div>
          </div>
          <div>
            <div className="small muted">{t.to}</div>
            {o.fulfilment === 'meenemen' ? <div className="strong">{t.pickup}</div> : <>
              <div className="strong">{o.delivery_name || c.company || c.name}</div>
              <div className="small">{o.delivery_address}<br />{o.delivery_postal_code} {o.delivery_city}{o.delivery_phone && <><br />{t.tel} {o.delivery_phone}</>}</div>
            </>}
          </div>
        </div>
        <div className="table-wrap flush"><table>
          <thead><tr><th>{t.code}</th><th>{t.prod}</th><th className="num">{t.qty}</th><th className="num">{t.price}</th><th className="num">{t.disc}</th><th className="num">{t.vat}</th><th className="num">{t.total}</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}>
              <td>{articleNo(s, l.product_id)}</td>
              <td className="strong">{l.description}{l.options && <div className="small muted" style={{ fontWeight: 400 }}>{t.opts}: {l.options}</div>}</td>
              <td className="num">{l.qty}</td><td className="num">{eur(l.unit_price)}</td><td className="num">{l.discount_pct ? `${l.discount_pct}%` : ''}</td><td className="num">{l.vat_rate}%</td><td className="num">{eur(lineTotal(l))}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div className="totals" style={{ marginTop: 18 }}>
          <div><span>{t.base}</span><span>{eur(b.base)}</span></div>
          {b.rates.map((r) => <div key={r.rate}><span>{t.vat} {r.rate}%</span><span>{eur(r.vat)}</span></div>)}
          <div className="strong"><span>{t.total}</span><span>{eur(total)}</span></div>
          {paid > 0 && <div><span>{t.paid}</span><span>−{eur(paid)}</span></div>}
          <div className="grand"><span>{t.open}</span><span>{eur(Math.max(0, total - paid))}</span></div>
        </div>
        {o.notes && <p className="small" style={{ marginTop: 18, marginBottom: 0 }}>{t.notes}: {o.notes}</p>}
      </div>
    </>
  )
}
