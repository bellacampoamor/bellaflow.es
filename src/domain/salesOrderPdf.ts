import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Snapshot } from '../data/types'
import { articleNo, depositPaid, documentLanguage, lineTotal, orderLines, orderTotal, vatBreakdown } from './calc'
import { DOC_MARK, SALES_ORDER_TEXT } from './noteText'
import { tradeName } from './issuers'
import { A4, drawDocMark, INK, MARGIN, MUTED, safe, wrap, ymd } from './signedNotePdf'

/** Bouwt de verkooporder als pdf (zelfde inhoud als de afgedrukte verkooporder, met prijzen) en geeft die terug als base64. */
export async function salesOrderPdf(s: Snapshot, orderId: string) {
  const o = s.sales_orders.find((x) => x.id === orderId)!
  const c = s.customers.find((x) => x.id === o.customer_id)
  const co = s.settings[0]
  const language = documentLanguage(co?.language_sales_order, c?.language ?? 'es')
  const t = SALES_ORDER_TEXT[language]
  // Bedragen altijd in Nederlandse opmaak (€ 1.460,00), net als op de factuur.
  const money = (n: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
  const lines = orderLines(s, orderId)
  const b = vatBreakdown(lines.map((l) => ({ total: lineTotal(l), vat_rate: l.vat_rate })))
  const total = orderTotal(s, orderId)
  const paid = depositPaid(s, orderId)
  const seller = s.salespeople.find((x) => x.id === o.salesperson_id)?.name

  const doc = await PDFDocument.create()
  const title = o.status === 'proforma' ? t.proforma : t.title
  doc.setTitle(`${title} ${o.number}`)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = doc.addPage(A4)
  const width = A4[0] - MARGIN * 2
  let y = A4[1] - MARGIN
  const BOTTOM = MARGIN + 20 // ruimte voor het Bella Flow-merkje
  const room = (need: number) => { if (y - need < BOTTOM) { page = doc.addPage(A4); y = A4[1] - MARGIN } }
  const put = (text: string, opts: { font?: PDFFont; size?: number; color?: typeof INK; x?: number; width?: number } = {}) => {
    const font = opts.font ?? regular, size = opts.size ?? 10.5
    for (const l of wrap(text, font, size, opts.width ?? width)) {
      room(size + 5)
      page.drawText(l, { x: opts.x ?? MARGIN, y: y - size, size, font, color: opts.color ?? INK })
      y -= size + 4.5
    }
  }
  const right = (text: string, xRight: number, opts: { font?: PDFFont; size?: number; color?: typeof INK } = {}) => {
    const font = opts.font ?? regular, size = opts.size ?? 9.5, v = safe(text)
    page.drawText(v, { x: xRight - font.widthOfTextAtSize(v, size), y: y - size, size, font, color: opts.color ?? INK })
  }

  put(tradeName(co), { font: bold, size: 15 })
  put([co?.address, `${co?.postal_code ?? ''} ${co?.city ?? ''}`.trim(), co?.province, co?.phone, co?.email].filter(Boolean).join(', '), { size: 9, color: MUTED })
  if (co?.tax_id) put(`${t.tax}: ${co.tax_id}`, { size: 9, color: MUTED })
  y -= 14
  put(title, { font: bold, size: 19 })
  put(o.number, { font: bold, size: 12 })
  put(`${t.date}: ${ymd(o.order_date)}`, { color: MUTED })
  if (o.customer_reference) put(`${t.ref}: ${o.customer_reference}`, { color: MUTED })
  if (seller) put(`${t.seller}: ${seller}`, { color: MUTED })
  if (o.requested_date) put(`${t.wanted}: ${ymd(o.requested_date)}`, { color: MUTED })
  if (o.promised_date) put(`${t.promised}: ${ymd(o.promised_date)}`, { color: MUTED })
  y -= 12
  put(t.bill, { size: 9, color: MUTED })
  if (c) {
    put(c.company || c.name, { font: bold })
    put([c.address, `${c.postal_code} ${c.city}`.trim()].filter(Boolean).join(', '))
    if (c.tax_id) put(`${t.tax}: ${c.tax_id}`)
  } else put('-', { font: bold })
  y -= 8
  put(t.to, { size: 9, color: MUTED })
  if (o.fulfilment === 'meenemen') put(t.pickup, { font: bold })
  else {
    put(o.delivery_name || c?.company || c?.name || '', { font: bold })
    put([o.delivery_address, `${o.delivery_postal_code} ${o.delivery_city}`.trim(), o.delivery_phone ? `${t.tel} ${o.delivery_phone}` : ''].filter(Boolean).join(', '))
  }
  y -= 14

  // Kolommen: artikelnummer, product, aantal, prijs, korting, IVA, totaal.
  const X = { code: MARGIN, prod: MARGIN + 92, qty: MARGIN + width - 205, price: MARGIN + width - 140, disc: MARGIN + width - 92, vat: MARGIN + width - 58, total: MARGIN + width }
  const head = () => {
    room(30)
    page.drawText(safe(t.code), { x: X.code, y: y - 9, size: 8.5, font: bold, color: MUTED })
    page.drawText(safe(t.prod), { x: X.prod, y: y - 9, size: 8.5, font: bold, color: MUTED })
    right(t.qty, X.qty, { font: bold, size: 8.5, color: MUTED }); right(t.price, X.price, { font: bold, size: 8.5, color: MUTED })
    right(t.disc, X.disc, { font: bold, size: 8.5, color: MUTED }); right(t.vat, X.vat, { font: bold, size: 8.5, color: MUTED }); right(t.total, X.total, { font: bold, size: 8.5, color: MUTED })
    y -= 14
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.8, color: INK })
    y -= 6
  }
  head()
  for (const l of lines) {
    const desc = wrap(l.description, bold, 9.5, X.qty - X.prod - 40)
    const opts = l.options ? wrap(`${t.opts}: ${l.options}`, regular, 8.5, X.qty - X.prod - 40) : []
    const need = desc.length * 13 + opts.length * 12 + 6
    if (y - need < BOTTOM) { page = doc.addPage(A4); y = A4[1] - MARGIN; head() }
    page.drawText(safe(articleNo(s, l.product_id)), { x: X.code, y: y - 9.5, size: 8.5, font: regular, color: INK })
    right(String(l.qty), X.qty); right(money(l.unit_price), X.price); right(l.discount_pct ? `${l.discount_pct}%` : '', X.disc)
    right(`${l.vat_rate}%`, X.vat); right(money(lineTotal(l)), X.total)
    for (const d of desc) { page.drawText(d, { x: X.prod, y: y - 9.5, size: 9.5, font: bold, color: INK }); y -= 13 }
    for (const d of opts) { page.drawText(d, { x: X.prod, y: y - 8.5, size: 8.5, font: regular, color: MUTED }); y -= 12 }
    y -= 6
  }
  y -= 8
  const sum = (label: string, value: string, strong = false) => {
    room(16)
    page.drawText(safe(label), { x: MARGIN + width - 220, y: y - 10, size: 10, font: strong ? bold : regular, color: INK })
    right(value, X.total, { font: strong ? bold : regular, size: 10 })
    y -= 16
  }
  sum(t.base, money(b.base))
  for (const r of b.rates) sum(`${t.vat} ${r.rate}%`, money(r.vat))
  sum(t.total, money(total), true)
  if (paid > 0) sum(t.paid, `-${money(paid)}`)
  sum(t.open, money(Math.max(0, total - paid)), true)
  if (o.notes) { y -= 10; put(`${t.notes}: ${o.notes}`, { size: 9 }) }
  await drawDocMark(doc, regular, safe(DOC_MARK[language]))
  return { name: `${title} ${o.number}.pdf`, base64: await doc.saveAsBase64() }
}
