// Retour of credit aan de kassa van HDB als terugbetaling (refund) in de Shopify van HomeDecoBali
// (opdracht Rick 17 november 2026): "dat dat ook via de API wordt teruggekoppeld in Shopify". Zuivere functies zonder
// Deno of browser, zodat de edge function hdb-shopify en de tests dezelfde opbouw gebruiken.
//
// De creditfactuur (CRE-FS-HDB / FRS-HDB) verwijst naar de kassabon; die staat als bestelling in Shopify. Daarop komt één
// refund: per artikel het aantal, terug in voorraad als het in Bella Flow retour in voorraad kwam, en het bedrag terug
// via dezelfde betaling (de kassa betaalt terug zoals er betaald is, pin of contant).

export interface CreditLineForShopify {
  /** Eigen artikelnummer van de regel (HDB-ACC-...) of DIVERSEN; bedrag zonder artikel = leeg. */
  article_number: string
  /** Variant in Shopify (numeriek of gid); null = los artikel of bedrag zonder artikel. */
  variant_id: string | null
  /** Aantal dat gecrediteerd wordt (positief). */
  qty: number
  /** Kwam het artikel in Bella Flow retour in voorraad? Dan ook in Shopify terug in voorraad. */
  restock: boolean
}

export interface ShopifyOrderLine {
  id: string
  variant: { id: string } | null
  quantity: number
  refundableQuantity: number
  unfulfilledQuantity: number
}

export interface ShopifyTransaction {
  id: string; kind: string; status: string; gateway: string
  amountSet?: { presentmentMoney?: { amount: string; currencyCode: string } }
}

export interface RefundPlan {
  input: Record<string, unknown>
  /** Regels die niet aan een regel van de bestelling te koppelen waren (dan alleen het bedrag terug). */
  unmatched: string[]
}

const gidOf = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`)
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/** Tekst bij de refund in Shopify; met het nummer van de creditfactuur, zodat dubbel terugbetalen te voorkomen is. */
export const refundNote = (creditNumber: string, originalNumber: string, reason: string) =>
  `Bella Flow ${creditNumber}: retour/credit op ${originalNumber}${reason ? `. Reden: ${reason}` : ''}`

/** Staat er al een refund van deze creditfactuur op de bestelling? */
export const alreadyRefunded = (refunds: { id: string; note: string | null }[], creditNumber: string) =>
  refunds.find((r) => (r.note ?? '').startsWith(`Bella Flow ${creditNumber}:`)) ?? null

/**
 * Bouwt de invoer voor refundCreate. Per creditregel de regel van de bestelling met dezelfde variant. Afgehandeld (fulfilled):
 * RETURN naar de locatie; nog niet afgehandeld: CANCEL (Shopify staat RETURN dan niet toe). Geen retour in voorraad: NO_RESTOCK.
 * Het bedrag gaat terug via de betaling van de bestelling (parent), tot ten hoogste wat er betaald is.
 */
export function refundInput(p: {
  orderId: string; locationId: string | null; note: string; amount: number
  lines: CreditLineForShopify[]; orderLines: ShopifyOrderLine[]; transactions: ShopifyTransaction[]
}): RefundPlan {
  const left = new Map(p.orderLines.map((l) => [l.id, { refundable: l.refundableQuantity, unfulfilled: l.unfulfilledQuantity }]))
  const refundLineItems: Record<string, unknown>[] = []
  const unmatched: string[] = []
  for (const c of p.lines) {
    if (!c.variant_id || c.qty <= 0) { if (c.article_number && c.article_number !== 'DIVERSEN') unmatched.push(c.article_number); continue }
    let need = c.qty
    for (const ol of p.orderLines.filter((l) => l.variant?.id === gidOf(c.variant_id!))) {
      const st = left.get(ol.id)!
      const take = Math.min(need, st.refundable)
      if (take <= 0) continue
      // Eerst wat nog niet is afgehandeld (CANCEL), dan wat al is afgehandeld (RETURN).
      const cancel = Math.min(take, st.unfulfilled)
      const ret = take - cancel
      const loc = p.locationId ? { locationId: p.locationId } : {}
      if (cancel > 0) refundLineItems.push({ lineItemId: ol.id, quantity: cancel, restockType: c.restock ? 'CANCEL' : 'NO_RESTOCK', ...(c.restock ? loc : {}) })
      if (ret > 0) refundLineItems.push({ lineItemId: ol.id, quantity: ret, restockType: c.restock && p.locationId ? 'RETURN' : 'NO_RESTOCK', ...(c.restock ? loc : {}) })
      st.refundable -= take; st.unfulfilled -= cancel; need -= take
      if (need <= 0) break
    }
    if (need > 0) unmatched.push(c.article_number)
  }

  const paid = p.transactions.filter((t) => (t.kind === 'SALE' || t.kind === 'CAPTURE') && t.status === 'SUCCESS')
  const refunded = p.transactions.filter((t) => t.kind === 'REFUND' && t.status === 'SUCCESS')
  const amt = (t: ShopifyTransaction) => Number(t.amountSet?.presentmentMoney?.amount ?? 0)
  const room = paid.reduce((n, t) => n + amt(t), 0) - refunded.reduce((n, t) => n + amt(t), 0)
  const amount = Math.max(0, Math.min(p.amount, room))
  const parent = paid[0]
  const transactions = parent && amount > 0.004
    ? [{ orderId: p.orderId, parentId: parent.id, gateway: parent.gateway, kind: 'REFUND', amount: money(amount) }]
    : []

  return { input: { orderId: p.orderId, note: p.note, notify: false, refundLineItems, transactions }, unmatched }
}

export const ORDER_FOR_REFUND = `query orderForRefund($id: ID!) {
  order(id: $id) {
    id name
    lineItems(first: 100) { nodes { id quantity refundableQuantity unfulfilledQuantity variant { id } } }
    transactions(first: 20) { id kind status gateway amountSet { presentmentMoney { amount currencyCode } } }
    refunds(first: 50) { id note }
  }
  locations(first: 10) { nodes { id name isActive } }
}`

/** Locatie voor de retour in Shopify: de winkel in Campoamor (daar verkoopt en neemt de kassa terug), anders de eerste actieve. */
export function returnLocation(nodes: { id: string; name: string; isActive?: boolean }[]) {
  const active = nodes.filter((l) => l.isActive !== false)
  return (active.find((l) => /campoamor/i.test(l.name)) ?? active[0])?.id ?? null
}

export const REFUND_CREATE = `mutation refundCreate($input: RefundInput!) {
  refundCreate(input: $input) { refund { id } userErrors { field message } }
}`
