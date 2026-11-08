import type { Language } from '../data/types'

// Vaste teksten van de afleverbon, in de taal van het document.
export const NOTE_TEXT: Record<Language, Record<string, string>> = {
  es: { title: 'Albarán de entrega', date: 'Fecha de entrega', order: 'Pedido', ref: 'Su referencia', to: 'Entregar a', bill: 'Cliente', tel: 'Tel.', part: 'Entrega parcial', of: 'de', code: 'Referencia', prod: 'Producto', opts: 'Acabado', pkg: 'Bultos', qty: 'Cant.', from: 'Almacén', notes: 'Observaciones', floor: 'Planta', lift: 'Ascensor', assembly: 'Montaje', remove: 'Retirar muebles antiguos', yes: 'sí', no: 'no', confirm: 'El cliente declara haber recibido los productos indicados en buen estado.', remarks: 'Observaciones en la recepción', name: 'Nombre', sign: 'Firma del cliente', when: 'Fecha y hora', stop: 'Parada' },
  nl: { title: 'Afleverbon', date: 'Leverdatum', order: 'Order', ref: 'Uw referentie', to: 'Afleveren bij', bill: 'Klant', tel: 'Tel.', part: 'Deellevering', of: 'van', code: 'Artikelnummer', prod: 'Product', opts: 'Uitvoering', pkg: 'Colli', qty: 'Aantal', from: 'Magazijn', notes: 'Instructies', floor: 'Verdieping', lift: 'Lift', assembly: 'Montage', remove: 'Oude meubels meenemen', yes: 'ja', no: 'nee', confirm: 'De klant verklaart de genoemde producten in goede staat te hebben ontvangen.', remarks: 'Opmerkingen bij ontvangst', name: 'Naam', sign: 'Handtekening klant', when: 'Datum en tijd', stop: 'Stop' },
  en: { title: 'Delivery note', date: 'Delivery date', order: 'Order', ref: 'Your reference', to: 'Deliver to', bill: 'Customer', tel: 'Tel.', part: 'Part delivery', of: 'of', code: 'Item no.', prod: 'Product', opts: 'Finish', pkg: 'Packages', qty: 'Qty', from: 'Warehouse', notes: 'Instructions', floor: 'Floor', lift: 'Lift', assembly: 'Assembly', remove: 'Remove old furniture', yes: 'yes', no: 'no', confirm: 'The customer confirms receipt of the listed products in good condition.', remarks: 'Remarks on receipt', name: 'Name', sign: 'Customer signature', when: 'Date and time', stop: 'Stop' },
}

// Vermelding onderaan elk afgedrukt document, in de taal van het document.
export const DOC_MARK: Record<Language, string> = {
  es: 'Este documento ha sido generado con Bella Flow.',
  nl: 'Dit document is opgesteld met Bella Flow.',
  en: 'This document was prepared with Bella Flow.',
}

// Vaste teksten van de factuur, in de taal van het document (scherm en pdf).
export const INVOICE_TEXT: Record<Language, Record<string, string>> = {
  es: { title: 'Factura', code: 'Referencia', deelfactuur: 'Factura parcial', eindfactuur: 'Factura final', volledig: 'Factura', simplified: 'Factura simplificada', date: 'Fecha', due: 'Vencimiento', order: 'Pedido', to: 'Facturar a', desc: 'Descripción', qty: 'Cant.', price: 'Precio', disc: 'Dto.', total: 'Total', base: 'Base imponible', vat: 'IVA', deposit: 'Anticipo aplicado', paid: 'Pagado', due_amt: 'Importe a pagar', pay: 'Pago por transferencia a', tax: 'NIF', creditfactuur: 'Factura rectificativa', simplified_credit: 'Factura rectificativa simplificada', corrects: 'Rectifica la factura', of_date: 'de fecha', reason: 'Motivo', settled: 'Compensado con la factura', settled_credit: 'Compensado con la rectificativa', refunded: 'Devuelto', to_refund: 'Importe a devolver' },
  nl: { title: 'Factuur', code: 'Artikelnummer', deelfactuur: 'Deelfactuur', eindfactuur: 'Eindfactuur', volledig: 'Factuur', simplified: 'Vereenvoudigde factuur', date: 'Datum', due: 'Vervaldatum', order: 'Order', to: 'Factuur aan', desc: 'Omschrijving', qty: 'Aantal', price: 'Prijs', disc: 'Korting', total: 'Totaal', base: 'Grondslag', vat: 'IVA', deposit: 'Vooruitbetaling verrekend', paid: 'Betaald', due_amt: 'Te betalen', pay: 'Betaling per overboeking op', tax: 'NIF', creditfactuur: 'Creditfactuur', simplified_credit: 'Vereenvoudigde creditfactuur', corrects: 'Correctie op factuur', of_date: 'van', reason: 'Reden', settled: 'Verrekend met factuur', settled_credit: 'Verrekend met creditfactuur', refunded: 'Terugbetaald', to_refund: 'Terug te betalen' },
  en: { title: 'Invoice', code: 'Item no.', deelfactuur: 'Partial invoice', eindfactuur: 'Final invoice', volledig: 'Invoice', simplified: 'Simplified invoice', date: 'Date', due: 'Due date', order: 'Order', to: 'Bill to', desc: 'Description', qty: 'Qty', price: 'Price', disc: 'Disc.', total: 'Total', base: 'Tax base', vat: 'IVA', deposit: 'Advance applied', paid: 'Paid', due_amt: 'Amount due', pay: 'Pay by bank transfer to', tax: 'Tax ID', creditfactuur: 'Credit note', simplified_credit: 'Simplified credit note', corrects: 'Corrects invoice', of_date: 'dated', reason: 'Reason', settled: 'Offset against invoice', settled_credit: 'Offset against credit note', refunded: 'Refunded', to_refund: 'Amount to refund' },
}

/** Titel op de factuur: factura simplificada (kassa) of de soort factuur. */
export const invoiceTitle = (t: Record<string, string>, inv: { kind: string; simplified?: boolean }) =>
  inv.kind === 'creditfactuur' ? (inv.simplified ? t.simplified_credit : t.creditfactuur) : inv.simplified ? t.simplified : t[inv.kind]

// Mail bij een factuur, in de taal van de klant.
export const INVOICE_MAIL: Record<Language, { subject: (n: string, c: string) => string; body: (name: string, n: string, c: string) => string }> = {
  es: { subject: (n, c) => `Factura ${n}, ${c}`, body: (name, n, c) => `Estimado/a ${name}:\n\nAdjuntamos la factura ${n}.\n\nGracias por su compra.\n\n${c}` },
  nl: { subject: (n, c) => `Factuur ${n}, ${c}`, body: (name, n, c) => `Beste ${name},\n\nHierbij ontvangt u factuur ${n}.\n\nBedankt voor uw aankoop.\n\n${c}` },
  en: { subject: (n, c) => `Invoice ${n}, ${c}`, body: (name, n, c) => `Dear ${name},\n\nPlease find attached invoice ${n}.\n\nThank you for your purchase.\n\n${c}` },
}
