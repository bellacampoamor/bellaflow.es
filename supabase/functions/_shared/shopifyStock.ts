// Contant afgerekend aan de kassa van HDB: geen bestelling en geen betaling in Shopify, alleen de voorraad
// (besluit Rick 18 november 2026). Een contante kassabon boekt de voorraad in Shopify af; een retour op zo'n kassabon
// boekt hem weer bij, als het artikel in Bella Flow retour in voorraad kwam. Zuivere functies zonder Deno of browser,
// zodat de edge function hdb-shopify en de tests dezelfde opbouw gebruiken.

export interface StockLine {
  /** Eigen artikelnummer (HDB-ACC-...) of DIVERSEN. */
  article_number: string
  /** Variant in Shopify (numeriek of gid); null = geen koppeling, dan geen voorraad in Shopify. */
  variant_id: string | null
  /** Aantal (positief). */
  qty: number
}

export interface StockPlan {
  /** Per variant het verschil: negatief bij verkoop, positief bij retour. */
  deltas: { variantId: string; delta: number }[]
  /** Artikelen zonder koppeling aan Shopify (DIVERSEN niet meegeteld). */
  unlinked: string[]
}

const variantGid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`)

/** Telt de regels per variant op. sign -1 = afboeken (verkoop), +1 = bijboeken (retour). */
export function stockPlan(lines: StockLine[], sign: 1 | -1): StockPlan {
  const per = new Map<string, number>()
  const unlinked: string[] = []
  for (const l of lines) {
    if (l.qty <= 0) continue
    if (!l.variant_id) { if (l.article_number && l.article_number !== 'DIVERSEN' && !unlinked.includes(l.article_number)) unlinked.push(l.article_number); continue }
    const id = variantGid(l.variant_id)
    per.set(id, (per.get(id) ?? 0) + l.qty)
  }
  return { deltas: [...per].map(([variantId, qty]) => ({ variantId, delta: sign * qty })), unlinked }
}

/** Herkenbaar in de voorraadgeschiedenis van Shopify: het nummer van de kassabon of creditfactuur. */
export const stockReference = (invoiceNumber: string) => `bellaflow://factuur/${encodeURIComponent(invoiceNumber)}`

/**
 * Invoer voor inventoryAdjustQuantities op de beschikbare voorraad van de locatie. Bij verkoop reden 'correction', bij retour
 * 'restock'. changeFromQuantity null: Bella Flow kent de stand in Shopify niet en boekt alleen het verschil (verplicht veld
 * sinds API 2026-04).
 */
export function adjustInput(p: { deltas: { inventoryItemId: string; delta: number }[]; locationId: string; sign: 1 | -1; reference: string }) {
  return {
    name: 'available',
    reason: p.sign < 0 ? 'correction' : 'restock',
    referenceDocumentUri: p.reference,
    changes: p.deltas.filter((d) => d.delta !== 0).map((d) => ({ inventoryItemId: d.inventoryItemId, locationId: p.locationId, delta: d.delta, changeFromQuantity: null })),
  }
}

export const VARIANT_INVENTORY = `query variantInventory($ids: [ID!]!) {
  nodes(ids: $ids) { ... on ProductVariant { id inventoryItem { id tracked } } }
  locations(first: 10) { nodes { id name isActive } }
}`

/** Sinds API 2026-04 verplicht met een idempotency key: zo boekt opnieuw versturen nooit dubbel af. */
export const INVENTORY_ADJUST = `mutation inventoryAdjust($input: InventoryAdjustQuantitiesInput!, $key: String!) {
  inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { id } userErrors { field message } }
}`
