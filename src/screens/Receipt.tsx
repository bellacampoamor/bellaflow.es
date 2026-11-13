import type { Customer, Invoice, InvoiceLine, Language, Payment, Product } from '../data/types'
import type { IssuerInfo } from '../domain/issuers'
import { imageSrc } from '../domain/issuers'
import { receiptLegalLine, receiptLines, receiptPayments, RECEIPT_TEXT } from '../domain/receipt'
import { brandFile, eur, fmtDate } from '../ui/kit'

/**
 * Kassabon van 80 mm (besluit Rick 9 november 2026): de eenvoudige factuur (of de rectificativa simplificada)
 * op een thermische bonprinter. Bedrukbare breedte 72 mm, zwart op wit, lengte volgt de inhoud.
 * Bevat wat een factura simplificada moet hebben: nummer en reeks, datum, naam en CIF van het uitgevende bedrijf,
 * omschrijving, IVA-tarief met "IVA incluido" en het totaal; boven € 1.000 ook de klant.
 * 11 november 2026 (Rick): geen adres van het bedrijf op de bon; omschrijving in het Spaans (Spaanse naam van HDB, anders de woordenlijst); artikelnummer op een eigen regel.
 */
export function ReceiptPaper(p: {
  language: Language; t: Record<string, string>; title: string; inv: Invoice; issuer: IssuerInfo; base: string
  lines: InvoiceLine[]; articleOf: (l: InvoiceLine) => string; productOf: (articleNumber: string) => Product | undefined; rates: { rate: number; vat: number }[]
  customer: Customer | null; seller: string; original: Invoice | null; pays: Payment[]; balance: number; credit: boolean
}) {
  const r = RECEIPT_TEXT[p.language]
  const { t, inv, issuer } = p
  const rows = receiptLines(p.lines.map((l) => {
    const code = l.article_number || p.articleOf(l)
    const product = code ? p.productOf(code) : undefined
    return { ...l, article_number: code, product_name: product?.name, name_es: product?.name_es }
  }), eur, p.language)
  const payments = receiptPayments(p.pays)
  // Geen vaste paginamaat: de printer bepaalt het papier (kies in het stuurprogramma de rol van 80 mm, bv. 80(72.1) x 3276 mm).
  // Met een vaste maat ging Chrome de bon schalen en verticaal centreren op het gekozen vel, zodat de bon even lang werd als dat vel.
  return (
    <div className="receipt">
      <div className="receipt-head">
        {issuer.logo ? <img className="receipt-logo" src={imageSrc(issuer.logo, p.base)} alt={issuer.name} /> : <div className="receipt-name">{issuer.name}</div>}
        <div>{receiptLegalLine(issuer)}</div>
        {(issuer.phone || issuer.email) && <div>{[issuer.phone, issuer.email].filter(Boolean).join(' · ')}</div>}
      </div>
      <div className="receipt-rule" />
      <div className="receipt-title">{p.title}</div>
      <div className="receipt-kv"><span>{inv.number}</span><span>{fmtDate(inv.invoice_date)}</span></div>
      {p.seller && <div className="receipt-kv"><span>{r.seller}</span><span>{p.seller}</span></div>}
      {p.original && <div className="receipt-note">{t.corrects} {p.original.number} {t.of_date} {fmtDate(p.original.invoice_date)}. {t.reason}: {inv.credit_reason}</div>}
      {p.customer && <div className="receipt-note">
        <strong>{r.customer}: {p.customer.company || p.customer.name}</strong><br />
        {[p.customer.address, `${p.customer.postal_code} ${p.customer.city}`.trim(), p.customer.country].filter(Boolean).join(', ')}
        {p.customer.tax_id && <><br />{t.tax}: {p.customer.tax_id}</>}
      </div>}
      <div className="receipt-rule" />
      {rows.map((l, n) => (
        <div className="receipt-line" key={n}>
          <div className="receipt-desc">{l.description}</div>
          {l.code && <div className="small">{r.ref} {l.code}</div>}
          <div className="receipt-kv small"><span>{l.detail}</span><span>{eur(l.total)}</span></div>
        </div>
      ))}
      <div className="receipt-rule" />
      <div className="receipt-kv"><span>{t.base}</span><span>{eur(inv.base_amount)}</span></div>
      {p.rates.map((x) => <div className="receipt-kv" key={x.rate}><span>{t.vat} {x.rate}%</span><span>{eur(x.vat)}</span></div>)}
      <div className="receipt-kv receipt-total"><span>{t.total}</span><span>{eur(inv.total)}</span></div>
      <div className="receipt-center small">{r.vat_incl}</div>
      {payments.length > 0 && <>
        <div className="receipt-rule" />
        {payments.map((x) => <div className="receipt-kv" key={x.method}><span>{p.credit ? r.refunded_with : r.paid_with} {r[x.method]}</span><span>{eur(Math.abs(x.amount))}</span></div>)}
      </>}
      {Math.abs(p.balance) >= 0.005 && <div className="receipt-kv strong"><span>{p.credit ? t.to_refund : t.due_amt}</span><span>{eur(Math.abs(p.balance))}</span></div>}
      <div className="receipt-rule" />
      {!p.credit && <div className="receipt-center">{r.thanks}</div>}
      <div className="receipt-credit"><img src={brandFile('bellaflow-beeldmerk-small.png')} alt="Bella Flow" /><span>bellaflow.es</span></div>
    </div>
  )
}
