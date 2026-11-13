// Kassaverkoop van HDB (Handmade Bali Treasures SL) als conceptorder (draft order) in de Shopify van HomeDecoBali
// (opdracht Rick 11 november 2026). Zuivere functies zonder Deno of browser, zodat de edge function hdb-shopify
// en de tests (vitest) dezelfde opbouw gebruiken.
//
// Wat erin gaat is wat tot nu toe met de hand in Shopify werd ingevoerd: de artikelen (gekoppeld aan de variant,
// zodat Shopify de voorraad bijhoudt), aantal, verkochte prijs, korting, de klant (als die bekend is) en een notitie
// met factuurnummer, verkooporder, verkoper en betaalwijze. Het ordernummer kent Shopify zelf toe.

export const SHOPIFY_API_VERSION = '2026-07'

export interface ShopifySaleLine {
  /** Eigen artikelnummer (HDB-ACC-...) of DIVERSEN. */
  article_number: string
  /** Artikelnummer van HDB (Shopify SKU), leeg als onbekend. */
  sku: string
  description: string
  qty: number
  /** Verkoopprijs per stuk incl. IVA, zoals aan de kassa. */
  unit_price: number
  discount_pct: number
  vat_rate: number
  /** Numerieke id of gid van de Shopify-variant; null = los artikel (custom line item) zonder voorraadkoppeling. */
  variant_id: string | null
}

export interface ShopifySaleCustomer {
  name: string; company: string; email: string; phone: string; tax_id: string
  address: string; postal_code: string; city: string; province: string; country: string
}

export interface ShopifySale {
  invoice_number: string
  invoice_date: string
  order_number: string
  salesperson: string
  /** Betaalwijzen met bedrag, zoals op de factuur geboekt. */
  payments: { method: string; amount: number }[]
  /** null = kassaverkoop zonder klantgegevens. */
  customer: ShopifySaleCustomer | null
  lines: ShopifySaleLine[]
  total: number
  currency?: string
}

const METHOD: Record<string, string> = { pin: 'Pin', contant: 'Contant', overboeking: 'Overboeking', online: 'Online', verrekening: 'Verrekening' }
export const methodLabel = (m: string) => METHOD[m] ?? m

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const eur = (n: number) => `€ ${money(n).replace('.', ',')}`

/** gid van een variant, ook als de id al een gid is. */
export const variantGid = (id: string) => (id.startsWith('gid://') ? id : `gid://shopify/ProductVariant/${id}`)

/** Landcode (ISO 3166-1 alpha-2) uit het land zoals het bij de klant staat. Onbekend = null (dan geen adres). */
export function countryCode(raw: string): string | null {
  const v = raw.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!v) return 'ES'
  if (/^[a-z]{2}$/.test(v)) return v.toUpperCase()
  const map: [RegExp, string][] = [
    [/^(espana|spanje|spain|spanien|espagne)$/, 'ES'], [/^(nederland|netherlands|the netherlands|holland|paises bajos|holanda)$/, 'NL'],
    [/^(belgie|belgium|belgica|belgique|belgien)$/, 'BE'], [/^(duitsland|germany|alemania|deutschland)$/, 'DE'],
    [/^(frankrijk|france|francia)$/, 'FR'], [/^(verenigd koninkrijk|united kingdom|uk|great britain|engeland|england|reino unido)$/, 'GB'],
    [/^(ierland|ireland|irlanda)$/, 'IE'], [/^(portugal)$/, 'PT'], [/^(italie|italy|italia)$/, 'IT'],
    [/^(zweden|sweden|suecia)$/, 'SE'], [/^(noorwegen|norway|noruega)$/, 'NO'], [/^(denemarken|denmark|dinamarca)$/, 'DK'],
    [/^(finland|finlandia)$/, 'FI'], [/^(zwitserland|switzerland|suiza)$/, 'CH'], [/^(oostenrijk|austria)$/, 'AT'],
    [/^(luxemburg|luxembourg|luxemburgo)$/, 'LU'], [/^(polen|poland|polonia)$/, 'PL'],
  ]
  return map.find(([re]) => re.test(v))?.[1] ?? null
}

/** Voornaam en achternaam: het laatste woord is de achternaam (Shopify vraagt ze apart). */
export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { firstName: '', lastName: parts[0] ?? '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

/** Tag met het factuurnummer: hiermee is een conceptorder in Shopify terug te vinden en dubbel aanmaken te voorkomen. */
export const invoiceTag = (invoiceNumber: string) => `Bella Flow ${invoiceNumber}`

/** De invoer voor draftOrderCreate (GraphQL Admin API). */
export function draftOrderInput(sale: ShopifySale) {
  const currencyCode = sale.currency ?? 'EUR'
  const lineItems = sale.lines.map((l) => {
    const discount = l.discount_pct > 0
      ? { appliedDiscount: { valueType: 'PERCENTAGE', value: Math.round(l.discount_pct * 100) / 100, title: 'Korting kassa', description: `${l.discount_pct}% korting aan de kassa` } }
      : {}
    if (l.variant_id) {
      // Gekoppeld aan de variant: Shopify houdt de voorraad bij. De prijs is de prijs aan de kassa, ook als die afwijkt.
      return { variantId: variantGid(l.variant_id), quantity: l.qty, priceOverride: { amount: money(l.unit_price), currencyCode }, ...discount }
    }
    // Los artikel (DIVERSEN of een artikel dat in Shopify niet gevonden is): titel, prijs en SKU zoals op de factuur.
    return {
      title: l.description || l.article_number, quantity: l.qty, originalUnitPriceWithCurrency: { amount: money(l.unit_price), currencyCode },
      sku: l.sku || (l.article_number === 'DIVERSEN' ? '' : l.article_number), taxable: l.vat_rate > 0, requiresShipping: false, ...discount,
    }
  })

  const pays = sale.payments.filter((p) => p.amount !== 0)
  const methods = [...new Set(pays.map((p) => methodLabel(p.method)))]
  const c = sale.customer
  const hasOrder = !!sale.order_number && sale.order_number !== sale.invoice_number
  const note = [
    'Kassaverkoop Bella Campoamor (Bella Flow)',
    `Factuur: ${sale.invoice_number} van ${sale.invoice_date.slice(0, 10).split('-').reverse().join('-')}`,
    // Kassaverkoop: geen verkooporder (besluit Rick 13 november 2026); oude verkopen hadden er nog een.
    hasOrder ? `Verkooporder: ${sale.order_number}` : '',
    sale.salesperson ? `Verkoper: ${sale.salesperson}` : '',
    pays.length ? `Betaald: ${pays.map((p) => `${methodLabel(p.method)} ${eur(p.amount)}`).join(', ')}` : '',
    `Totaal: ${eur(sale.total)}`,
    c?.tax_id ? `NIF / NIE / paspoort: ${c.tax_id}` : '',
  ].filter(Boolean).join('\n')

  const customAttributes = [
    { key: 'Factuur', value: sale.invoice_number },
    ...(hasOrder ? [{ key: 'Verkooporder', value: sale.order_number }] : []),
    ...(sale.salesperson ? [{ key: 'Verkoper', value: sale.salesperson }] : []),
    ...(methods.length ? [{ key: 'Betaalwijze', value: methods.join(', ') }] : []),
  ]
  const tags = ['Bella Flow', 'Kassa Bella Campoamor', invoiceTag(sale.invoice_number), ...methods]

  const input: Record<string, unknown> = { lineItems, note, tags, customAttributes, presentmentCurrencyCode: currencyCode }
  if (c) {
    if (c.email.trim()) input.email = c.email.trim()
    if (c.phone.trim()) input.phone = c.phone.trim()
    const cc = countryCode(c.country)
    if (cc && (c.address.trim() || c.city.trim())) {
      const address = {
        ...splitName(c.name), company: c.company, address1: c.address, zip: c.postal_code, city: c.city, countryCode: cc,
        ...(c.phone.trim() ? { phone: c.phone.trim() } : {}),
      }
      input.billingAddress = address
      input.shippingAddress = address
    }
  }
  return input
}

/** Foutmeldingen van Shopify (userErrors) als één regel tekst. */
export function userErrorText(errors: { field?: string[] | null; message: string }[] | null | undefined) {
  return (errors ?? []).map((e) => (e.field?.length ? `${e.field.join('.')}: ${e.message}` : e.message)).join('; ')
}

export const DRAFT_ORDER_CREATE = `mutation draftOrderCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) { draftOrder { id name } userErrors { field message } }
}`
export const DRAFT_ORDER_COMPLETE = `mutation draftOrderComplete($id: ID!) {
  draftOrderComplete(id: $id) { draftOrder { id name status order { id name } } userErrors { field message } }
}`
export const DRAFT_ORDER_BY_TAG = `query draftOrderByTag($q: String!) {
  draftOrders(first: 1, query: $q) { nodes { id name status order { id name } } }
}`
