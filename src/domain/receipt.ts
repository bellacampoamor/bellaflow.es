import type { Invoice, InvoiceLine, Language, Payment, Settings } from '../data/types'
import type { IssuerInfo } from './issuers'
import { spanishDescription } from './spanish'

/**
 * Afdrukformaat van de eenvoudige factuur van de kassa (besluit Rick 9 november 2026), onder Instellingen:
 * - 'a4': de eenvoudige factuur op A4 (standaard, zoals tot nu toe);
 * - 'bon80': een kassabon op een thermische bonprinter met rollen van 80 mm (bijv. Epson TM-m30III of TM-T20III).
 * Het geldt ook voor de creditfactuur van de kassa (factura rectificativa simplificada). Gewone facturen blijven A4;
 * de gemailde pdf blijft A4.
 */
export type SimplifiedPrint = 'a4' | 'bon80'
export const SIMPLIFIED_PRINTS: SimplifiedPrint[] = ['a4', 'bon80']
export const simplifiedPrint = (co: Partial<Settings> | undefined | null): SimplifiedPrint => (co?.print_invoice_simplified === 'bon80' ? 'bon80' : 'a4')

/** Teksten op de kassabon die niet al in INVOICE_TEXT staan. */
export const RECEIPT_TEXT: Record<Language, Record<string, string>> = {
  es: { vat_incl: 'IVA incluido', paid_with: 'Pagado con', pin: 'Tarjeta', contant: 'Efectivo', overboeking: 'Transferencia', online: 'Online', verrekening: 'Compensado', refunded_with: 'Devuelto con', thanks: 'Gracias por su compra', seller: 'Le atendió', customer: 'Cliente', ref: 'Ref.', test_title: 'Ticket de prueba', test_line: 'Prueba de impresora', test_note: 'No es una factura. Sin valor fiscal.' },
  nl: { vat_incl: 'Incl. IVA', paid_with: 'Betaald met', pin: 'Pin', contant: 'Contant', overboeking: 'Overboeking', online: 'Online', verrekening: 'Verrekend', refunded_with: 'Terugbetaald met', thanks: 'Bedankt voor uw aankoop', seller: 'Geholpen door', customer: 'Klant', ref: 'Art.nr.', test_title: 'Testbon', test_line: 'Test van de bonprinter', test_note: 'Geen factuur. Zonder fiscale waarde.' },
  en: { vat_incl: 'VAT included', paid_with: 'Paid by', pin: 'Card', contant: 'Cash', overboeking: 'Bank transfer', online: 'Online', verrekening: 'Settled', refunded_with: 'Refunded by', thanks: 'Thank you for your purchase', seller: 'Served by', customer: 'Customer', ref: 'Item no.', test_title: 'Test receipt', test_line: 'Printer test', test_note: 'Not an invoice. No tax value.' },
}

export interface ReceiptLineIn {
  article_number?: string | null; description: string
  /** Naam van het product en de Spaanse naam van de leverancier (HDB), als die er is. */
  product_name?: string | null; name_es?: string | null
  qty: number; unit_price: number; discount_pct: number; vat_rate: number; line_total: number
}
export interface ReceiptLineOut { description: string; code: string; detail: string; total: number; vat_rate: number }

/**
 * Regels op de bon: op 72 mm past geen tabel met zeven kolommen. Per artikel de omschrijving, eronder het
 * artikelnummer en daaronder "aantal x prijs" (met korting) met rechts het regeltotaal.
 * Op een Spaanse bon komt de omschrijving in het Spaans (besluit Rick 11 november 2026): de Spaanse naam van de
 * leverancier als die er is (HomeDecoBali), anders vertaald met de woordenlijst (spanish.ts).
 */
export function receiptLines(lines: ReceiptLineIn[], money: (n: number) => string, language: Language = 'es'): ReceiptLineOut[] {
  return lines.map((l) => ({
    description: language === 'es' ? spanishLine(l.description, l.product_name, l.name_es) : l.description,
    code: l.article_number ?? '',
    detail: `${l.qty} x ${money(l.unit_price)}${l.discount_pct ? ` -${l.discount_pct}%` : ''}`,
    total: l.line_total,
    vat_rate: l.vat_rate,
  }))
}

/**
 * Spaanse omschrijving van een regel. Met een Spaanse naam van de leverancier: die naam, plus wat er op de regel
 * achter de productnaam staat (bijv. gekozen eigenschappen). Zonder: de woordenlijst.
 */
export function spanishLine(description: string, productName?: string | null, nameEs?: string | null): string {
  const es = nameEs?.trim()
  if (!es) return spanishDescription(description)
  if (productName && description.startsWith(productName)) return es + description.slice(productName.length)
  return description === productName || !productName ? es : spanishDescription(description)
}

/** Kop van de bon: naam en CIF van het uitgevende bedrijf, zonder adres (besluit Rick 11 november 2026). */
export const receiptLegalLine = (i: Pick<IssuerInfo, 'name' | 'tax_id'>) => [i.name, i.tax_id ? `CIF: ${i.tax_id}` : ''].filter((x) => x && x.trim()).join(' · ')

/** Betaalwijzen op de bon, samengevoegd per wijze, zonder verrekening met een creditfactuur. */
export function receiptPayments(pays: Pick<Payment, 'method' | 'amount'>[]): { method: Payment['method']; amount: number }[] {
  const by = new Map<Payment['method'], number>()
  for (const p of pays) if (p.method !== 'verrekening') by.set(p.method, Math.round(((by.get(p.method) ?? 0) + p.amount) * 100) / 100)
  return [...by].filter(([, a]) => a !== 0).map(([method, amount]) => ({ method, amount }))
}

/**
 * Testbon (besluit Rick 18 november 2026): onderaan de Kassa een knop om de bonprinter te testen. Zelfde opmaak als
 * een echte kassabon (kop van het gekozen bedrijf, breedte, regels, totaal), maar zonder nummer uit een reeks, zonder
 * factuur, betaling of voorraadmutatie, met bedragen 0 en duidelijk "geen factuur". Er wordt niets opgeslagen.
 */
export function testReceipt(issuer: 'bella' | 'hdb', date: string, language: Language = 'es'): { inv: Invoice; lines: InvoiceLine[]; title: string; note: string } {
  const r = RECEIPT_TEXT[language]
  const inv: Invoice = {
    id: 'testbon', number: r.test_title.toUpperCase(), sales_order_id: '', customer_id: '', kind: 'volledig', invoice_date: date, due_date: date,
    base_amount: 0, vat_amount: 0, total: 0, deposit_settled: 0, language, simplified: true, issuer,
  }
  const lines: InvoiceLine[] = [
    { id: 'testbon-1', invoice_id: inv.id, delivery_line_id: null, article_number: '0000000000', description: r.test_line, qty: 1, unit_price: 0, discount_pct: 0, vat_rate: 21, line_total: 0 },
  ]
  return { inv, lines, title: r.test_title, note: r.test_note }
}
