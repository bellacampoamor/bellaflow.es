import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Snapshot } from '../data/types'
import { documentLanguage } from './calc'
import { NOTE_TEXT } from './noteText'

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const INK = rgb(0.08, 0.23, 0.3)
const MUTED = rgb(0.36, 0.44, 0.49)

/** De standaardlettertypen kennen alleen West-Europese tekens; de rest mag de pdf niet laten mislukken. */
const safe = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, (c) => c.normalize('NFD').replace(/[^\x20-\x7e]/g, '') || '?')

const wrap = (text: string, font: PDFFont, size: number, width: number) => {
  const out: string[] = []
  let line = ''
  for (const word of safe(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > width && line) { out.push(line); line = word } else line = next
  }
  if (line) out.push(line)
  return out
}

const ymd = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('-') : '')

/** Bouwt de getekende afleverbon als pdf en geeft die terug als base64. */
export async function signedNotePdf(s: Snapshot, deliveryId: string) {
  const d = s.deliveries.find((x) => x.id === deliveryId)!
  const o = s.sales_orders.find((x) => x.id === d.sales_order_id)!
  const c = s.customers.find((x) => x.id === o.customer_id)!
  const co = s.settings[0]
  const t = NOTE_TEXT[documentLanguage(co?.language_delivery_note, c.language)]
  const doc = await PDFDocument.create()
  doc.setTitle(`${t.title} ${d.number}`)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  let page: PDFPage = doc.addPage(A4)
  let y = A4[1] - MARGIN
  const width = A4[0] - MARGIN * 2
  const room = (need: number) => { if (y - need < MARGIN) { page = doc.addPage(A4); y = A4[1] - MARGIN } }
  const put = (text: string, opts: { font?: PDFFont; size?: number; color?: typeof INK; x?: number; width?: number } = {}) => {
    const font = opts.font ?? regular, size = opts.size ?? 10.5
    for (const l of wrap(text, font, size, opts.width ?? width)) {
      room(size + 5)
      page.drawText(l, { x: opts.x ?? MARGIN, y: y - size, size, font, color: opts.color ?? INK })
      y -= size + 4.5
    }
  }
  put(co?.company_name ?? '', { font: bold, size: 15 })
  put([co?.address, `${co?.postal_code ?? ''} ${co?.city ?? ''}`.trim(), co?.phone, co?.email].filter(Boolean).join(', '), { size: 9, color: MUTED })
  y -= 14
  put(t.title, { font: bold, size: 19 })
  put(d.number, { font: bold, size: 12 })
  put(`${t.date}: ${ymd(d.delivered_at ?? d.planned_date)}`, { color: MUTED })
  put(`${t.order}: ${o.number}${o.customer_reference ? `, ${t.ref}: ${o.customer_reference}` : ''}`, { color: MUTED })
  y -= 12
  put(t.to, { size: 9, color: MUTED })
  put(o.delivery_name || c.company || c.name, { font: bold })
  put([o.delivery_address, `${o.delivery_postal_code} ${o.delivery_city}`.trim()].filter(Boolean).join(', '))
  y -= 8
  put(t.bill, { size: 9, color: MUTED })
  put(c.company || c.name, { font: bold })
  if (c.company && c.name && c.name !== c.company) put(c.name)
  y -= 14
  put(`${t.qty}  /  ${t.prod}`, { size: 9, color: MUTED })
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + width, y }, thickness: 0.8, color: INK })
  y -= 6
  for (const l of s.delivery_lines.filter((x) => x.delivery_id === d.id)) {
    const sol = s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)!
    const sku = s.products.find((p) => p.id === sol.product_id)?.sku
    put(`${l.qty} x  ${sku ? `${sku}  ` : ''}${sol.description}${sol.options ? ` (${sol.options})` : ''}`)
  }
  y -= 14
  put(t.confirm, { font: bold })
  y -= 8
  put(t.sign, { size: 9, color: MUTED })
  if (d.signature_data) {
    const png = await doc.embedPng(d.signature_data)
    const scale = Math.min(260 / png.width, 110 / png.height)
    const w = png.width * scale, h = png.height * scale
    room(h + 8)
    page.drawImage(png, { x: MARGIN, y: y - h, width: w, height: h })
    y -= h + 8
  }
  put(`${t.name}: ${d.signed_by}`)
  if (d.signed_at) put(`${t.when}: ${ymd(d.signed_at)} ${d.signed_at.slice(11, 16)} UTC`, { color: MUTED })
  return { name: `${t.title} ${d.number}.pdf`, base64: await doc.saveAsBase64() }
}
