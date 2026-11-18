// Kassaverkoop van HDB in de Shopify van HomeDecoBali (opdracht Rick 11 november 2026).
// Elke eenvoudige factuur van HDB komt in de wachtrij hdb_shopify_orders; de edge function hdb-shopify maakt er een
// conceptorder van en zet die (standaard) meteen om naar een bestelling als betaald, met het ordernummer van Shopify.
// Op Afgehandeld zetten doet HDB zelf in Shopify, als laatste controle.
import type { HdbShopifyOrder, Invoice, Payment, Settings, ShopifyKind, ShopifyPushStatus, Snapshot } from '../data/types'
import { isCredit } from './credit'

/**
 * Gaat deze factuur naar Shopify? Eenvoudige facturen (kassa) van HDB, en sinds 17 november 2026 (opdracht Rick) ook hun
 * creditfacturen: een retour of credit wordt in Shopify een terugbetaling (refund) op de bestelling van de kassabon,
 * met de artikelen terug in voorraad.
 */
export const goesToShopify = (inv: Pick<Invoice, 'simplified' | 'issuer' | 'kind' | 'credit_of'>) =>
  !!inv.simplified && inv.issuer === 'hdb'

/** Volledig contant betaald (verrekeningen tellen niet mee)? */
export function paidCashOnly(payments: Pick<Payment, 'invoice_id' | 'method'>[], invoiceId: string) {
  const own = payments.filter((p) => p.invoice_id === invoiceId && p.method !== 'verrekening')
  return own.length > 0 && own.every((p) => p.method === 'contant')
}

/**
 * Soort rij in de wachtrij (besluit Rick 18 november 2026: contant aan de kassa geen bestelling en geen betaling in Shopify,
 * alleen de voorraad afboeken):
 * - verkoop: kassabon met pin, wordt een bestelling in Shopify.
 * - voorraad: kassabon volledig contant betaald, alleen de voorraad in Shopify gaat omlaag.
 * - retour: creditfactuur op een kassabon die als bestelling in Shopify staat, wordt een refund op die bestelling.
 * - voorraad_retour: creditfactuur op een contante kassabon (geen bestelling in Shopify), alleen de voorraad gaat omhoog.
 */
export function shopifyKindOf(s: Pick<Snapshot, 'payments' | 'hdb_shopify_orders'>, inv: Pick<Invoice, 'id' | 'kind' | 'credit_of'>): ShopifyKind {
  if (!isCredit(inv)) return paidCashOnly(s.payments, inv.id) ? 'voorraad' : 'verkoop'
  const sale = inv.credit_of ? shopifyOrderOf(s, inv.credit_of) : undefined
  // Een oudere contante kassabon die al als bestelling in Shopify staat, krijgt gewoon een refund op die bestelling.
  if (sale) return sale.kind === 'voorraad' ? 'voorraad_retour' : 'retour'
  return inv.credit_of && paidCashOnly(s.payments, inv.credit_of) ? 'voorraad_retour' : 'retour'
}

/** Alleen voorraad in Shopify (contante kassabon of retour daarop), geen bestelling. */
export const shopifyStockOnly = (r: Pick<HdbShopifyOrder, 'kind'>) => r.kind === 'voorraad' || r.kind === 'voorraad_retour'

/** Versturen naar Shopify aan of uit (opdracht Rick 13 november 2026, voor de testperiode). Standaard aan. */
export const shopifySendingOn = (co: Pick<Settings, 'hdb_shopify_enabled'> | undefined | null) => co?.hdb_shopify_enabled !== false

/** Standaard aan: de conceptorder wordt meteen een bestelling met het ordernummer van Shopify. */
export const shopifyCompletes = (co: Pick<Settings, 'hdb_shopify_complete'> | undefined | null) => co?.hdb_shopify_complete !== false

export const shopifyOrderOf = (s: Pick<Snapshot, 'hdb_shopify_orders'>, invoiceId: string): HdbShopifyOrder | undefined =>
  (s.hdb_shopify_orders ?? []).find((r) => r.invoice_id === invoiceId)

/** Wat nog niet in Shopify staat: wacht, is mislukt of blijft hangen. */
export const shopifyBacklog = (s: Pick<Snapshot, 'hdb_shopify_orders'>) =>
  (s.hdb_shopify_orders ?? []).filter((r) => r.status === 'wachtrij' || r.status === 'mislukt' || r.status === 'bezig')

/** Het nummer om te tonen: het ordernummer van Shopify, anders de conceptorder. Bij een retour: de bestelling waarop terugbetaald is. */
export const shopifyNumber = (r: Pick<HdbShopifyOrder, 'shopify_order_name' | 'shopify_draft_name'>) => r.shopify_order_name || r.shopify_draft_name

/** Schermtekst (Nederlandse sleutel voor tx) en toon per status. */
export const SHOPIFY_STATE: Record<ShopifyPushStatus, [string, 'good' | 'info' | 'warn' | 'bad']> = {
  wachtrij: ['Wacht op Shopify', 'warn'],
  bezig: ['Wordt in Shopify gezet', 'info'],
  aangemaakt: ['In Shopify', 'good'],
  mislukt: ['Shopify mislukt', 'bad'],
  demo: ['Testversie: niet naar Shopify', 'info'],
}

/** Shopify-pagina van de bestelling of conceptorder in de admin, als het domein van de winkel bekend is. */
export function shopifyAdminUrl(r: Pick<HdbShopifyOrder, 'shopify_order_id' | 'shopify_draft_id'>, storeHandle: string) {
  const handle = storeHandle.trim().replace(/\.myshopify\.com$/, '')
  if (!handle) return ''
  const num = (gid: string) => gid.split('/').pop() ?? ''
  if (r.shopify_order_id) return `https://admin.shopify.com/store/${handle}/orders/${num(r.shopify_order_id)}`
  if (r.shopify_draft_id) return `https://admin.shopify.com/store/${handle}/draft_orders/${num(r.shopify_draft_id)}`
  return ''
}
