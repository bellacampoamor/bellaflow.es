// Kassaverkoop van HDB in de Shopify van HomeDecoBali (opdracht Rick 11 november 2026).
// Elke eenvoudige factuur van HDB komt in de wachtrij hdb_shopify_orders; de edge function hdb-shopify maakt er een
// conceptorder van en zet die (standaard) meteen om naar een bestelling als betaald, met het ordernummer van Shopify.
// Op Afgehandeld zetten doet HDB zelf in Shopify, als laatste controle.
import type { HdbShopifyOrder, Invoice, Settings, ShopifyPushStatus, Snapshot } from '../data/types'
import { isCredit } from './credit'

/** Gaat deze factuur naar Shopify? Alleen eenvoudige facturen (kassa) van HDB, geen creditfacturen. */
export const goesToShopify = (inv: Pick<Invoice, 'simplified' | 'issuer' | 'kind' | 'credit_of'>) =>
  !!inv.simplified && inv.issuer === 'hdb' && !isCredit(inv)

/** Versturen naar Shopify aan of uit (opdracht Rick 13 november 2026, voor de testperiode). Standaard aan. */
export const shopifySendingOn = (co: Pick<Settings, 'hdb_shopify_enabled'> | undefined | null) => co?.hdb_shopify_enabled !== false

/** Standaard aan: de conceptorder wordt meteen een bestelling met het ordernummer van Shopify. */
export const shopifyCompletes = (co: Pick<Settings, 'hdb_shopify_complete'> | undefined | null) => co?.hdb_shopify_complete !== false

export const shopifyOrderOf = (s: Pick<Snapshot, 'hdb_shopify_orders'>, invoiceId: string): HdbShopifyOrder | undefined =>
  (s.hdb_shopify_orders ?? []).find((r) => r.invoice_id === invoiceId)

/** Wat nog niet in Shopify staat: wacht, is mislukt of blijft hangen. */
export const shopifyBacklog = (s: Pick<Snapshot, 'hdb_shopify_orders'>) =>
  (s.hdb_shopify_orders ?? []).filter((r) => r.status === 'wachtrij' || r.status === 'mislukt' || r.status === 'bezig')

/** Het nummer om te tonen: het ordernummer van Shopify, anders de conceptorder. */
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
