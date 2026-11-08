import { PDFDocument, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import qrcode from 'qrcode-generator'
import type { Snapshot } from '../data/types'
import { articleNo, documentLanguage, invoiceBalance, invoiceQrUrl, IS_PRODUCTION, vatBreakdown } from './calc'
import { INVOICE_TEXT, invoiceTitle } from './noteText'
import { POS_CUSTOMER_NOTE } from './pos'
import { imageSrc, issuerInfo, issuerOf, legalLine } from './issuers'
import { A4, INK, MARGIN, MUTED, safe, wrap, ymd } from './signedNotePdf'

const CREDIT = 'bellaflow.es'
const QR_SIZE = 85.04 // 30 mm, de kleinste toegestane maat (Orden HAC/1177/2024, art. 21)

/** Logo of beeldmerk uit Beheer in de pdf: een upload (data-URL) of een standaardbestand. Lukt het niet, dan zonder afbeelding. */
async function loadImage(doc: PDFDocument, src: string): Promise<PDFImage | null> {
  if (!src) return null
  try {
    let bytes: Uint8Array
    if (src.startsWith('data:')) {
      const bin = atob(src.slice(src.indexOf(',') + 1))
      bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
    } else {
      const res = await fetch(imageSrc(src, import.meta.env.BASE_URL))
      if (!res.ok) return null
      bytes = new Uint8Array(await res.arrayBuffer())
    }
    return bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch { return null }
}

/** Bouwt de factuur als pdf (zelfde inhoud als de afgedrukte factuur; de gewone factuur met de QR van 30 x 30 mm) en geeft die terug als base64. */
export async function invoicePdf(s: Snapshot, invoiceId: string) {
  const inv = s.invoices.find((x) => x.id === invoiceId)!
  const o = s.sales_orders.find((x) => x.id === inv.sales_order_id)!
  const c = s.customers.find((x) => x.id === inv.customer_id)!
  const co = s.settings[0]
  // Eenvoudige factuur (kassa): eigen afdruktaal en het uitgevende bedrijf (Bella of HDB).
  const language = documentLanguage(inv.simplified ? co?.language_invoice_simplified ?? 'es' : co?.language_invoice, inv.language)
  const issuer = inv.simplified ? issuerInfo(co, issuerOf(inv)) : null
  const nif = issuer ? issuer.tax_id : co?.tax_id ?? ''
  const t = INVOICE_TEXT[language]
  // Bedragen altijd in Nederlandse opmaak (€ 1.460,00), ook op een Spaanse of Engelse factuur.
  const money = (n: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n || 0)
  const lines = s.invoice_lines.filter((l) => l.invoice_id === inv.id)
  const paid = s.payments.filter((p) => p.invoice_id === inv.id).reduce((n, p) => n + p.amount, 0)
  const b = vatBreakdown(lines.map((l) => ({ total: l.line_total, vat_rate: l.vat_rate })))

  const doc = await PDFDocument.create()
  doc.setTitle(`${invoiceTitle(t, inv)} ${inv.number}`)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = doc.addPage(A4)
  const width = A4[0] - MARGIN * 2
  let y = A4[1] - MARGIN
  // Ruimte onderaan voor de voet: QR (gewone factuur), beeldmerk met juridische gegevens en bellaflow.es.
  const foot = inv.simplified ? 70 : QR_SIZE + 40
  const room = (need: number) => { if (y - need < MARGIN + foot) { page = doc.addPage(A4); y = A4[1] - MARGIN } }
  const text = (s0: string, x: number, yy: number, o0: { font?: PDFFont; size?: number; color?: typeof INK; right?: boolean } = {}) => {
    const font = o0.font ?? regular, size = o0.size ?? 9, str = safe(s0)
    page.drawText(str, { x: o0.right ? x - font.widthOfTextAtSize(str, size) : x, y: yy, size, font, color: o0.color ?? INK })
  }
  const block = (s0: string, x: number, w: number, o0: { font?: PDFFont; size?: number; color?: typeof INK } = {}) => {
    const size = o0.size ?? 9
    for (const l of wrap(s0, o0.font ?? regular, size, w)) { text(l, x, y - size, o0); y -= size + 4 }
  }

  // Kop: bedrijf links, QR in het midden, titel rechts.
  const top = y
  const logo = issuer ? await loadImage(doc, issuer.logo) : null
  const footIssuer = issuer ?? issuerInfo(co, 'bella')
  const mark = await loadImage(doc, footIssuer.mark)
  const credit = await loadImage(doc, 'assets/brand/bellaflow-beeldmerk-small.png')
  if (issuer) {
    if (logo) {
      const h = Math.min(52, (logo.height / logo.width) * 180), w = (logo.width / logo.height) * h
      page.drawImage(logo, { x: MARGIN, y: y - h, width: w, height: h })
      y -= h + 6
    } else block(issuer.name, MARGIN, 200, { font: bold, size: 14 })
    if (issuer.phone || issuer.email) block([issuer.phone, issuer.email].filter(Boolean).join(', '), MARGIN, 200, { color: MUTED, size: 8.5 })
  } else {
    // Gewone factuur van Bella: logo linksboven, daaronder adres en CIF.
    const bellaLogo = await loadImage(doc, issuerInfo(co, 'bella').logo)
    if (bellaLogo) {
      const h = Math.min(52, (bellaLogo.height / bellaLogo.width) * 180), w = (bellaLogo.width / bellaLogo.height) * h
      page.drawImage(bellaLogo, { x: MARGIN, y: y - h, width: w, height: h })
      y -= h + 6
    } else block(co?.company_name ?? '', MARGIN, 200, { font: bold, size: 14 })
    block([co?.address, `${co?.postal_code ?? ''} ${co?.city ?? ''}`.trim(), co?.province, co?.phone, co?.email].filter(Boolean).join(', '), MARGIN, 200, { color: MUTED, size: 8.5 })
    block(`${t.tax}: ${co?.tax_id ?? ''}`, MARGIN, 200, { color: MUTED, size: 8.5 })
  }
  const leftEnd = y


  const right = MARGIN + width
  text(invoiceTitle(t, inv), right, top - 18, { font: bold, size: 18, right: true })
  text(inv.number, right, top - 34, { font: bold, size: 11, right: true })
  text(`${t.date}: ${ymd(inv.invoice_date)}`, right, top - 48, { color: MUTED, right: true })
  if (!inv.simplified) text(`${t.due}: ${ymd(inv.due_date)}`, right, top - 60, { color: MUTED, right: true })
  text(`${t.order}: ${o.number}${o.customer_reference ? ` (${o.customer_reference})` : ''}`, right, top - 72, { color: MUTED, right: true })
  y = Math.min(leftEnd, top - 80) - 22

  // Klant (niet bij een kassaverkoop zonder klantgegevens)
  if (c.notes !== POS_CUSTOMER_NOTE) {
    block(t.to, MARGIN, width, { color: MUTED, size: 8.5 })
    block(c.company || c.name, MARGIN, width, { font: bold, size: 10 })
    if (c.address) block(c.address, MARGIN, width)
    block(`${c.postal_code ?? ''} ${c.city ?? ''}${c.country ? `, ${c.country}` : ''}`.trim(), MARGIN, width)
    if (c.tax_id) block(`${t.tax}: ${c.tax_id}`, MARGIN, width)
    y -= 16
  }

  // Regels
  const col = { code: MARGIN, desc: MARGIN + 92, qty: MARGIN + 318, price: MARGIN + 378, disc: MARGIN + 418, vat: MARGIN + 450, total: right }
  const head = () => {
    room(30)
    for (const [k, label, r] of [['code', t.code, false], ['desc', t.desc, false], ['qty', t.qty, true], ['price', t.price, true], ['disc', t.disc, true], ['vat', t.vat, true], ['total', t.total, true]] as const) {
      text(label, col[k], y - 8, { size: 8, color: MUTED, right: r })
    }
    y -= 13
    page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.8, color: INK })
    y -= 4
  }
  head()
  for (const l of lines) {
    const code = l.article_number || articleNo(s, s.sales_order_lines.find((x) => x.id === s.delivery_lines.find((d) => d.id === l.delivery_line_id)?.sales_order_line_id)?.product_id)
    const desc = wrap(l.description, regular, 8.5, col.qty - 40 - col.desc)
    const codeLines = wrap(code, regular, 8, col.desc - col.code - 6)
    const h = Math.max(desc.length, codeLines.length) * 11 + 4
    if (y - h < MARGIN + foot) { page = doc.addPage(A4); y = A4[1] - MARGIN; head() }
    const yy = y - 9
    codeLines.forEach((s0, i) => text(s0, col.code, yy - i * 11, { size: 8 }))
    desc.forEach((s0, i) => text(s0, col.desc, yy - i * 11, { size: 8.5 }))
    text(String(l.qty), col.qty, yy, { size: 8.5, right: true })
    text(money(l.unit_price), col.price, yy, { size: 8.5, right: true })
    text(l.discount_pct ? `${l.discount_pct}%` : '', col.disc, yy, { size: 8.5, right: true })
    text(`${l.vat_rate}%`, col.vat, yy, { size: 8.5, right: true })
    text(money(l.line_total), col.total, yy, { size: 8.5, right: true })
    y -= h
    page.drawLine({ start: { x: MARGIN, y: y + 1 }, end: { x: right, y: y + 1 }, thickness: 0.3, color: MUTED })
  }
  y -= 14

  // Totalen
  const rows: [string, string, boolean][] = [[t.base, money(inv.base_amount), false]]
  for (const r of b.rates) rows.push([`${t.vat} ${r.rate}%`, money(r.vat), false])
  rows.push([t.total, money(inv.total), true])
  if (inv.deposit_settled > 0) rows.push([t.deposit, `-${money(inv.deposit_settled)}`, false])
  if (paid > 0) rows.push([t.paid, `-${money(paid)}`, false])
  rows.push([t.due_amt, money(invoiceBalance(s, inv)), true])
  room(rows.length * 15 + 10)
  for (const [label, value, strong] of rows) {
    text(label, right - 200, y - 10, { font: strong ? bold : regular, size: strong ? 10 : 9 })
    text(value, right, y - 10, { font: strong ? bold : regular, size: strong ? 10 : 9, right: true })
    y -= 15
  }
  y -= 18
  room(30)
  if (!inv.simplified) block(`${t.pay}: ${co?.iban ?? ''}`, MARGIN, width, { color: MUTED, size: 8.5 })
  if (co?.invoice_footer && issuer?.key !== 'hdb') block(co.invoice_footer, MARGIN, width, { color: MUTED, size: 8.5 })

  // Voet op elke pagina (besluit Rick 8 november 2026): linksonder de QR van 30 x 30 mm (alleen gewone factuur),
  // midden het beeldmerk met de juridische gegevens van het uitgevende bedrijf, rechtsonder Bella Flow met bellaflow.es.
  // De zin "opgesteld met Bella Flow" staat niet meer op facturen.
  const qr = inv.simplified ? null : qrcode(0, 'M')
  if (qr) { qr.addData(invoiceQrUrl({ nif, number: inv.number, date: inv.invoice_date, total: inv.total }, IS_PRODUCTION), 'Byte'); qr.make() }
  {
    const lines0 = wrap(safe(legalLine(footIssuer)), regular, 7.5, width - 2 * (QR_SIZE + 12)) // ruimte links (QR) en rechts (bellaflow.es)
    for (const pg of doc.getPages()) {
      if (qr) {
        const n = qr.getModuleCount(), cell = QR_SIZE / n, qx = MARGIN, qy = 18
        pg.drawText('QR tributario:', { x: qx, y: qy + QR_SIZE + 6, size: 7, font: regular, color: MUTED })
        for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
          if (qr.isDark(r, k)) pg.drawRectangle({ x: qx + k * cell, y: qy + (n - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color: INK })
        }
      }
      let yy = 18 + (lines0.length - 1) * 9
      lines0.forEach((l) => { pg.drawText(l, { x: (A4[0] - regular.widthOfTextAtSize(l, 7.5)) / 2, y: yy, size: 7.5, font: regular, color: MUTED }); yy -= 9 })
      if (mark) {
        const h = 26, w = (mark.width / mark.height) * h
        pg.drawImage(mark, { x: (A4[0] - w) / 2, y: 30 + (lines0.length - 1) * 9, width: w, height: h })
      }
      // Helemaal rechtsonder: klein Bella Flow-beeldmerk met bellaflow.es (besluit Rick 8 november 2026).
      const cw = regular.widthOfTextAtSize(CREDIT, 6.5), cx = A4[0] - MARGIN - cw
      pg.drawText(CREDIT, { x: cx, y: 18, size: 6.5, font: regular, color: MUTED })
      if (credit) { const h = 9, w = (credit.width / credit.height) * h; pg.drawImage(credit, { x: cx - w - 3, y: 16.5, width: w, height: h }) }
    }
  }
  return { name: `${invoiceTitle(t, inv)} ${inv.number}.pdf`, base64: await doc.saveAsBase64() }
}
