import type { CatalogArticle, EmailStatus, Language, PurchaseOrder, PurchaseOrderDispatch, Snapshot, Supplier } from '../data/types'
import { round2 } from './calc'
import { tradeName } from './issuers'

/**
 * Inkooporders per dag als JSON naar de leverancier (besluit Rick 7 november 2026).
 * Eén bestand per leverancier per dag. Bevat bewust geen klantgegevens, net als de afgedrukte inkooporder.
 */
export const PURCHASE_JSON_FORMAT = 'bellaflow.purchase_orders'
export const PURCHASE_JSON_VERSION = 1

/** Inkooporders die verstuurd of afgedrukt kunnen worden: definitief (geen proforma, niet geannuleerd). */
export const isSendable = (po: PurchaseOrder) => po.status === 'open'

/** Definitieve inkooporders met deze besteldatum, per leverancier en nummer. */
export function purchaseOrdersOfDay(s: Snapshot, date: string) {
  const name = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? ''
  return s.purchase_orders.filter((po) => isSendable(po) && po.order_date === date)
    .sort((a, b) => name(a.supplier_id).localeCompare(name(b.supplier_id)) || a.number.localeCompare(b.number))
}

/** Verzendingen van een inkooporder, nieuwste eerst, met de status van de mail. */
export function dispatchesOf(s: Snapshot, purchaseOrderId: string) {
  return (s.purchase_order_dispatches ?? []).filter((d) => d.purchase_order_id === purchaseOrderId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((d) => ({ ...d, status: dispatchStatus(s, d), error: s.email_outbox.find((m) => m.id === d.email_id)?.error ?? '' }))
}
export const dispatchStatus = (s: Snapshot, d: PurchaseOrderDispatch): EmailStatus => s.email_outbox.find((m) => m.id === d.email_id)?.status ?? 'failed'

/** Is deze inkooporder ooit echt (of in de testversie) verstuurd? Mislukt en zonder adres tellen niet. */
export const isDispatched = (s: Snapshot, purchaseOrderId: string) => dispatchesOf(s, purchaseOrderId).some((d) => d.status === 'sent' || d.status === 'pending' || d.status === 'demo')

const slug = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase()
export const purchaseJsonFileName = (supplier: Supplier | undefined, date: string) => `inkooporders-${slug(supplier?.code || supplier?.name || 'leverancier')}-${date}.json`

/**
 * Bouwt het JSON-bestand voor één leverancier. `articles` geeft per eigen artikelnummer het catalogusartikel,
 * voor het artikelnummer van de leverancier en de EAN; zonder catalogusartikel blijven die leeg.
 */
export function purchaseOrdersJson(s: Snapshot, ids: string[], date: string, articles: Map<string, CatalogArticle> = new Map(), generatedAt = new Date().toISOString()) {
  const pos = ids.map((id) => s.purchase_orders.find((p) => p.id === id)).filter((p): p is PurchaseOrder => !!p)
  const supplierIds = [...new Set(pos.map((p) => p.supplier_id))]
  if (supplierIds.length !== 1) throw new Error('Eén JSON-bestand is voor één leverancier.')
  const sup = s.suppliers.find((x) => x.id === supplierIds[0])
  const co = s.settings[0]
  return {
    format: PURCHASE_JSON_FORMAT,
    version: PURCHASE_JSON_VERSION,
    generated_at: generatedAt,
    date,
    currency: 'EUR',
    buyer: { name: co?.company_name ?? '', trade_name: tradeName(co), tax_id: co?.tax_id ?? '', address: co?.address ?? '', postal_code: co?.postal_code ?? '', city: co?.city ?? '', province: co?.province ?? '', country: 'ES', email: co?.email ?? '', phone: co?.phone ?? '' },
    supplier: { name: sup?.name ?? '', code: sup?.code ?? '', vat_number: sup?.vat_number ?? '', email: sup?.email ?? '' },
    purchase_orders: pos.map((po) => {
      const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === po.id).map((l, i) => {
        const p = s.products.find((x) => x.id === l.product_id)
        const a = p?.sku ? articles.get(p.sku) : undefined
        return {
          line_no: i + 1,
          article_number: p?.sku ?? '',
          supplier_article_number: a?.supplier_sku ?? '',
          ean: a?.ean ?? '',
          description: p?.name ?? '',
          options: s.sales_order_lines.find((x) => x.id === l.sales_order_line_id)?.options ?? '',
          qty: l.qty,
          unit_price: l.unit_cost,
          line_total: round2(l.qty * l.unit_cost),
        }
      })
      return {
        number: po.number,
        order_date: po.order_date,
        supplier_reference: po.supplier_reference,
        notes: po.notes,
        lines,
        total_excl_vat: round2(lines.reduce((n, l) => n + l.line_total, 0)),
      }
    }),
  }
}

/** UTF-8 naar base64, voor de bijlage van de mail. */
export function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export const PURCHASE_MAIL: Record<Language, { subject: (date: string, c: string) => string; body: (supplier: string, list: string, c: string) => string }> = {
  es: { subject: (d, c) => `Pedidos de compra ${d}, ${c}`, body: (sup, list, c) => `Estimados ${sup}:\n\nAdjuntamos nuestros pedidos de compra en formato JSON:\n${list}\n\nUn saludo,\n\n${c}` },
  nl: { subject: (d, c) => `Inkooporders ${d}, ${c}`, body: (sup, list, c) => `Beste ${sup},\n\nHierbij onze inkooporders als JSON-bestand:\n${list}\n\nMet vriendelijke groet,\n\n${c}` },
  en: { subject: (d, c) => `Purchase orders ${d}, ${c}`, body: (sup, list, c) => `Dear ${sup},\n\nPlease find attached our purchase orders as a JSON file:\n${list}\n\nKind regards,\n\n${c}` },
}
