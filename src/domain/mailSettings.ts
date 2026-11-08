import type { Settings } from '../data/types'

/** De documenten die Bella Flow automatisch aan de klant kan mailen; per document aan of uit onder Instellingen. */
export type MailDoc = 'mail_sales_order' | 'mail_invoice_simplified' | 'mail_invoice' | 'mail_signed_note'
export const MAIL_DOCS: MailDoc[] = ['mail_sales_order', 'mail_invoice_simplified', 'mail_invoice', 'mail_signed_note']

/** Standaard: zoals het tot nu toe werkte. Facturen en de getekende bon gaan mee, de verkooporder (nieuw) niet. */
export const MAIL_DEFAULTS: Record<MailDoc, boolean> = { mail_sales_order: false, mail_invoice_simplified: true, mail_invoice: true, mail_signed_note: true }

/** Mailt Bella Flow dit document automatisch? Met de hand mailen vanaf het document kan altijd. */
export const mailsAutomatically = (co: Partial<Settings> | undefined | null, doc: MailDoc) => co?.[doc] ?? MAIL_DEFAULTS[doc]
