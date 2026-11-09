import type { Language, Payment, Settings } from '../data/types'

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
  es: { vat_incl: 'IVA incluido', paid_with: 'Pagado con', pin: 'Tarjeta', contant: 'Efectivo', overboeking: 'Transferencia', online: 'Online', verrekening: 'Compensado', refunded_with: 'Devuelto con', thanks: 'Gracias por su compra', seller: 'Le atendió', customer: 'Cliente' },
  nl: { vat_incl: 'Incl. IVA', paid_with: 'Betaald met', pin: 'Pin', contant: 'Contant', overboeking: 'Overboeking', online: 'Online', verrekening: 'Verrekend', refunded_with: 'Terugbetaald met', thanks: 'Bedankt voor uw aankoop', seller: 'Geholpen door', customer: 'Klant' },
  en: { vat_incl: 'VAT included', paid_with: 'Paid by', pin: 'Card', contant: 'Cash', overboeking: 'Bank transfer', online: 'Online', verrekening: 'Settled', refunded_with: 'Refunded by', thanks: 'Thank you for your purchase', seller: 'Served by', customer: 'Customer' },
}

export interface ReceiptLineIn { article_number?: string | null; description: string; qty: number; unit_price: number; discount_pct: number; vat_rate: number; line_total: number }
export interface ReceiptLineOut { description: string; code: string; detail: string; total: number; vat_rate: number }

/**
 * Regels op de bon: op 72 mm past geen tabel met zeven kolommen. Per artikel de omschrijving op de eerste regel,
 * eronder artikelnummer en "aantal x prijs" (met korting), rechts het regeltotaal.
 */
export function receiptLines(lines: ReceiptLineIn[], money: (n: number) => string): ReceiptLineOut[] {
  return lines.map((l) => ({
    description: l.description,
    code: l.article_number ?? '',
    detail: `${l.qty} x ${money(l.unit_price)}${l.discount_pct ? ` -${l.discount_pct}%` : ''}`,
    total: l.line_total,
    vat_rate: l.vat_rate,
  }))
}

/** Betaalwijzen op de bon, samengevoegd per wijze, zonder verrekening met een creditfactuur. */
export function receiptPayments(pays: Pick<Payment, 'method' | 'amount'>[]): { method: Payment['method']; amount: number }[] {
  const by = new Map<Payment['method'], number>()
  for (const p of pays) if (p.method !== 'verrekening') by.set(p.method, Math.round(((by.get(p.method) ?? 0) + p.amount) * 100) / 100)
  return [...by].filter(([, a]) => a !== 0).map(([method, amount]) => ({ method, amount }))
}
