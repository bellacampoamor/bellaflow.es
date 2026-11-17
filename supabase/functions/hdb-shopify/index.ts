// Zet kassaverkopen van HDB (facturas simplificadas FS-HDB) als conceptorder in de Shopify van HomeDecoBali
// (opdracht Rick 11 november 2026). Het ordernummer kent Shopify toe; HDB zet de bestelling zelf op Afgehandeld
// als laatste controle. Werkt de wachtrij hdb_shopify_orders af: { ids: [...] } of { pending: true }.
//
// Instellen (Supabase > Edge Functions > Secrets), niets hiervan in de code of de repo:
//   SHOPIFY_HDB_SHOP           het myshopify-domein, bijv. homedecobali.myshopify.com
//   en ofwel SHOPIFY_HDB_TOKEN  (Admin API-token van een bestaande custom app, shpat_...)
//   ofwel SHOPIFY_HDB_CLIENT_ID + SHOPIFY_HDB_CLIENT_SECRET (app uit het Dev Dashboard, client credentials grant)
// Rechten van de app: write_draft_orders, read_products, en voor retouren (sinds 17 november 2026) write_orders en read_locations.
//
// Retour: een creditfactuur op een kassabon van HDB (rij met kind 'retour') wordt een refund op de bestelling van die
// kassabon: artikelen terug in voorraad als ze in Bella Flow retour kwamen, geld terug via de betaling van de bestelling.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  DRAFT_ORDER_BY_TAG, DRAFT_ORDER_COMPLETE, DRAFT_ORDER_CREATE, SHOPIFY_API_VERSION, draftOrderInput, invoiceTag, userErrorText,
  type ShopifySale, type ShopifySaleLine,
} from '../_shared/shopifyDraft.ts'
import {
  ORDER_FOR_REFUND, REFUND_CREATE, alreadyRefunded, refundInput, refundNote,
  type CreditLineForShopify, type ShopifyOrderLine, type ShopifyTransaction,
} from '../_shared/shopifyRefund.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const POS_CUSTOMER_NOTE = 'Vaste klant voor kassaverkopen zonder klantgegevens (Bella Flow).'
/** Een rij die langer dan dit op 'bezig' staat, is blijven hangen en mag opnieuw. */
const STALE_MS = 5 * 60 * 1000

class ShopifyError extends Error {}

async function shopifyToken(shop: string): Promise<string> {
  const token = Deno.env.get('SHOPIFY_HDB_TOKEN')
  if (token) return token
  const id = Deno.env.get('SHOPIFY_HDB_CLIENT_ID'), secret = Deno.env.get('SHOPIFY_HDB_CLIENT_SECRET')
  if (!id || !secret) throw new ShopifyError('De Shopify-koppeling van HDB is nog niet ingesteld (SHOPIFY_HDB_TOKEN of SHOPIFY_HDB_CLIENT_ID en SHOPIFY_HDB_CLIENT_SECRET).')
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  if (!res.ok) throw new ShopifyError(`Shopify gaf geen toegang (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).access_token as string
}

function graphql(shop: string, token: string) {
  return async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables }),
    })
    const text = await res.text()
    if (!res.ok) throw new ShopifyError(`Shopify ${res.status}: ${text.slice(0, 300)}`)
    const body = JSON.parse(text)
    if (body.errors?.length) throw new ShopifyError(`Shopify: ${body.errors.map((e: { message: string }) => e.message).join('; ')}`)
    return body.data as T
  }
}

/** Alles wat Shopify nodig heeft, uit de database. */
async function loadSale(db: SupabaseClient, invoiceId: string): Promise<ShopifySale> {
  const { data: inv, error } = await db.from('invoices').select('*').eq('id', invoiceId).single()
  if (error || !inv) throw new Error('Factuur niet gevonden.')
  if (inv.issuer !== 'hdb' || !inv.simplified) throw new Error('Alleen eenvoudige facturen van HDB gaan naar Shopify.')
  const [{ data: lines }, { data: order }, { data: customer }, { data: pays }] = await Promise.all([
    db.from('invoice_lines').select('*').eq('invoice_id', invoiceId),
    db.from('sales_orders').select('number, salesperson_id').eq('id', inv.sales_order_id).single(),
    db.from('customers').select('*').eq('id', inv.customer_id).single(),
    db.from('payments').select('method, amount').eq('invoice_id', invoiceId),
  ])
  const { data: seller } = order?.salesperson_id ? await db.from('salespeople').select('name').eq('id', order.salesperson_id).single() : { data: null }

  // Eigen artikelnummer -> artikelnummer van HDB -> variant in Shopify (uit de catalogus-sync van HDB).
  const numbers = [...new Set((lines ?? []).map((l) => l.article_number).filter(Boolean))]
  const { data: arts } = numbers.length ? await db.from('catalog_articles').select('article_number, supplier_sku').in('article_number', numbers) : { data: [] }
  const skuOf = new Map((arts ?? []).map((a) => [a.article_number as string, a.supplier_sku as string]))
  const skus = [...new Set([...skuOf.values()].filter(Boolean))]
  const { data: items } = skus.length ? await db.from('supplier_hdb_items').select('supplier_sku, variant_id, active').in('supplier_sku', skus) : { data: [] }
  const variantOf = new Map<string, string>()
  for (const it of (items ?? []).sort((a, b) => Number(b.active) - Number(a.active))) if (it.variant_id && !variantOf.has(it.supplier_sku)) variantOf.set(it.supplier_sku, String(it.variant_id))

  const saleLines: ShopifySaleLine[] = (lines ?? []).map((l) => {
    const sku = skuOf.get(l.article_number) ?? ''
    return {
      article_number: l.article_number, sku, description: l.description, qty: Number(l.qty), unit_price: Number(l.unit_price),
      discount_pct: Number(l.discount_pct), vat_rate: Number(l.vat_rate), variant_id: sku ? variantOf.get(sku) ?? null : null,
    }
  })
  const c = customer && customer.notes !== POS_CUSTOMER_NOTE ? customer : null
  return {
    invoice_number: inv.number, invoice_date: inv.invoice_date, order_number: order?.number ?? '', salesperson: seller?.name ?? '',
    payments: (pays ?? []).map((p) => ({ method: p.method, amount: Number(p.amount) })), total: Number(inv.total), lines: saleLines,
    customer: c ? {
      name: c.name ?? '', company: c.company ?? '', email: c.email ?? '', phone: c.phone ?? '', tax_id: c.tax_id ?? '',
      address: c.address ?? '', postal_code: c.postal_code ?? '', city: c.city ?? '', province: c.province ?? '', country: c.country ?? '',
    } : null,
  }
}

type Refund = { id: string; note: string | null }

/** Creditfactuur op een kassabon van HDB als refund in Shopify. Geeft de velden om de rij bij te werken. */
async function pushRefund(db: SupabaseClient, row: Record<string, string>, call: ReturnType<typeof graphql>) {
  const { data: credit, error } = await db.from('invoices').select('*').eq('id', row.invoice_id).single()
  if (error || !credit) throw new Error('Creditfactuur niet gevonden.')
  if (!credit.credit_of) throw new Error('Dit is geen creditfactuur.')
  const [{ data: original }, { data: sale }] = await Promise.all([
    db.from('invoices').select('id, number').eq('id', credit.credit_of).single(),
    db.from('hdb_shopify_orders').select('*').eq('invoice_id', credit.credit_of).maybeSingle(),
  ])
  if (!original) throw new Error('De kassabon van deze creditfactuur is niet gevonden.')
  if (!sale?.shopify_order_id) {
    throw new ShopifyError(`De kassabon ${original.number} staat nog niet als bestelling in Shopify${sale?.shopify_draft_name ? ` (alleen conceptorder ${sale.shopify_draft_name})` : ''}. Verstuur die eerst, daarna deze retour opnieuw.`)
  }

  // Regels: creditregel -> regel van de kassabon -> eigen artikelnummer -> variant in Shopify. Retour in voorraad volgt de
  // voorraadmutatie Retour met het nummer van de creditfactuur.
  const [{ data: lines }, { data: moves }] = await Promise.all([
    db.from('invoice_lines').select('*').eq('invoice_id', credit.id),
    db.from('stock_movements').select('product_id, qty').eq('ref_id', credit.number).eq('kind', 'retour'),
  ])
  const pids = [...new Set((moves ?? []).map((m) => m.product_id as string))]
  const { data: prods } = pids.length ? await db.from('products').select('id, sku').in('id', pids) : { data: [] }
  const returned = new Map<string, number>()
  for (const m of moves ?? []) {
    const sku = (prods ?? []).find((p) => p.id === m.product_id)?.sku
    if (sku) returned.set(sku, (returned.get(sku) ?? 0) + Number(m.qty))
  }
  const numbers = [...new Set((lines ?? []).map((l) => l.article_number).filter(Boolean))]
  const { data: arts } = numbers.length ? await db.from('catalog_articles').select('article_number, supplier_sku').in('article_number', numbers) : { data: [] }
  const skuOf = new Map((arts ?? []).map((a) => [a.article_number as string, a.supplier_sku as string]))
  const skus = [...new Set([...skuOf.values()].filter(Boolean))]
  const { data: items } = skus.length ? await db.from('supplier_hdb_items').select('supplier_sku, variant_id, active').in('supplier_sku', skus) : { data: [] }
  const variantOf = new Map<string, string>()
  for (const it of (items ?? []).sort((a, b) => Number(b.active) - Number(a.active))) if (it.variant_id && !variantOf.has(it.supplier_sku)) variantOf.set(it.supplier_sku, String(it.variant_id))
  const creditLines: CreditLineForShopify[] = (lines ?? []).filter((l) => l.credits_line_id).map((l) => {
    const qty = Math.abs(Number(l.qty))
    const back = returned.get(l.article_number) ?? 0
    if (back > 0) returned.set(l.article_number, back - Math.min(back, qty))
    const sku = skuOf.get(l.article_number) ?? ''
    return { article_number: l.article_number, variant_id: sku ? variantOf.get(sku) ?? null : null, qty, restock: back > 0 }
  })

  const o = await call<{ order: { id: string; name: string; lineItems: { nodes: ShopifyOrderLine[] }; transactions: ShopifyTransaction[]; refunds: Refund[] } | null; locations: { nodes: { id: string }[] } }>(ORDER_FOR_REFUND, { id: sale.shopify_order_id })
  if (!o.order) throw new ShopifyError(`Bestelling ${sale.shopify_order_name} niet gevonden in Shopify.`)
  const base = { shopify_order_id: o.order.id, shopify_order_name: o.order.name }
  const done = alreadyRefunded(o.order.refunds, credit.number)
  if (done) return { ...base, shopify_refund_id: done.id, error: '' }

  const plan = refundInput({
    orderId: o.order.id, locationId: o.locations.nodes[0]?.id ?? null, note: refundNote(credit.number, original.number, credit.credit_reason ?? ''),
    amount: Math.abs(Number(credit.total)), lines: creditLines, orderLines: o.order.lineItems.nodes, transactions: o.order.transactions,
  })
  const r = await call<{ refundCreate: { refund: { id: string } | null; userErrors: { field: string[]; message: string }[] } }>(REFUND_CREATE, { input: plan.input })
  if (!r.refundCreate.refund) throw new ShopifyError(`Terugbetaling niet aangemaakt in Shopify: ${userErrorText(r.refundCreate.userErrors)}`)
  const notes = plan.unmatched.length ? `Niet gekoppeld aan een artikel van de bestelling (alleen bedrag terug, voorraad in Shopify niet bijgewerkt): ${plan.unmatched.join(', ')}` : ''
  return { ...base, shopify_refund_id: r.refundCreate.refund.id, error: notes }
}

type Draft = { id: string; name: string; status?: string; order: { id: string; name: string } | null }

async function push(db: SupabaseClient, rowId: string, call: ReturnType<typeof graphql>) {
  // Vastpakken: alleen wat wacht, mislukt is of is blijven hangen. Zo maakt een dubbele klik geen tweede conceptorder.
  const { data: row } = await db.from('hdb_shopify_orders').select('*').eq('id', rowId).single()
  if (!row) throw new Error('Niet gevonden in de wachtrij.')
  if (row.status === 'aangemaakt') return row
  if (row.status === 'bezig' && row.claimed_at && Date.now() - Date.parse(row.claimed_at) < STALE_MS) return row
  const { data: claimed } = await db.from('hdb_shopify_orders')
    .update({ status: 'bezig', claimed_at: new Date().toISOString(), attempts: (row.attempts ?? 0) + 1, error: '' })
    .eq('id', rowId).eq('status', row.status).select('*').maybeSingle()
  if (!claimed) return row

  if (row.kind === 'retour') {
    try {
      const r = await pushRefund(db, row, call)
      const done = { status: 'aangemaakt', sent_at: new Date().toISOString(), ...r }
      await db.from('hdb_shopify_orders').update(done).eq('id', rowId)
      return { ...row, ...done }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      await db.from('hdb_shopify_orders').update({ status: 'mislukt', error }).eq('id', rowId)
      return { ...row, status: 'mislukt', error }
    }
  }

  const notes: string[] = []
  try {
    const sale = await loadSale(db, row.invoice_id)
    let draft: Draft | null = row.shopify_draft_id ? { id: row.shopify_draft_id, name: row.shopify_draft_name, order: row.shopify_order_id ? { id: row.shopify_order_id, name: row.shopify_order_name } : null } : null
    if (!draft) {
      // Bestaat er in Shopify al een conceptorder met deze factuur (bijv. antwoord kwam niet aan)? Dan die gebruiken.
      const found = await call<{ draftOrders: { nodes: Draft[] } }>(DRAFT_ORDER_BY_TAG, { q: `tag:"${invoiceTag(sale.invoice_number)}"` })
      draft = found.draftOrders.nodes[0] ?? null
    }
    if (!draft) {
      const r = await call<{ draftOrderCreate: { draftOrder: Draft | null; userErrors: { field: string[]; message: string }[] } }>(DRAFT_ORDER_CREATE, { input: draftOrderInput(sale) })
      if (!r.draftOrderCreate.draftOrder) throw new ShopifyError(`Conceptorder niet aangemaakt: ${userErrorText(r.draftOrderCreate.userErrors)}`)
      draft = { ...r.draftOrderCreate.draftOrder, order: null }
    }
    await db.from('hdb_shopify_orders').update({ shopify_draft_id: draft.id, shopify_draft_name: draft.name }).eq('id', rowId)

    if (row.complete_order && !draft.order) {
      // Omzetten naar een bestelling, als betaald: Shopify geeft het volgende ordernummer. Afhandelen doet HDB zelf.
      // Lukt omzetten niet (bijv. te weinig voorraad in Shopify), dan blijft de conceptorder staan en zet HDB hem zelf om.
      // De kassaverkoop wordt nooit opgehouden door een voorraadverschil (besluit Rick 11 november 2026).
      let reason = ''
      try {
        const r = await call<{ draftOrderComplete: { draftOrder: Draft | null; userErrors: { field: string[]; message: string }[] } }>(DRAFT_ORDER_COMPLETE, { id: draft.id })
        const order = r.draftOrderComplete.draftOrder?.order
        if (order) draft.order = order
        else reason = userErrorText(r.draftOrderComplete.userErrors) || 'onbekende reden'
      } catch (e) { reason = e instanceof Error ? e.message : String(e) }
      if (reason) notes.push(`Conceptorder ${draft.name} staat in Shopify, maar omzetten naar een bestelling lukte niet (${reason}). Zet hem in Shopify zelf om.`)
    }
    const unlinked = sale.lines.filter((l) => !l.variant_id && l.article_number !== 'DIVERSEN').map((l) => l.article_number)
    if (unlinked.length) notes.push(`Zonder koppeling aan een Shopify-artikel (los artikel, geen voorraad bijgewerkt): ${unlinked.join(', ')}`)
    const done = {
      status: 'aangemaakt', shopify_order_id: draft.order?.id ?? '', shopify_order_name: draft.order?.name ?? '', sent_at: new Date().toISOString(),
      error: notes.join(' '),
    }
    await db.from('hdb_shopify_orders').update(done).eq('id', rowId)
    return { ...row, ...done, shopify_draft_id: draft.id, shopify_draft_name: draft.name }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.from('hdb_shopify_orders').update({ status: 'mislukt', error }).eq('id', rowId)
    return { ...row, status: 'mislukt', error }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  // Alleen een teamlid (actieve medewerker met login) mag dit starten; daarna werkt de functie met de servicesleutel.
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } })
  const { data: user } = await asUser.auth.getUser()
  if (!user?.user) return reply(401, { error: 'Niet ingelogd.' })
  const { data: member } = await asUser.rpc('is_team_member')
  if (!member) return reply(403, { error: 'Geen medewerker met toegang.' })

  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({}))
  let ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []
  if (body.pending) {
    const { data } = await db.from('hdb_shopify_orders').select('id').in('status', ['wachtrij', 'mislukt', 'bezig']).order('created_at').limit(25)
    ids = [...new Set([...ids, ...(data ?? []).map((r) => r.id as string)])]
  }
  if (!ids.length) return reply(200, { results: [] })

  const shop = Deno.env.get('SHOPIFY_HDB_SHOP')
  let call: ReturnType<typeof graphql>
  try {
    if (!shop) throw new ShopifyError('De Shopify-koppeling van HDB is nog niet ingesteld (SHOPIFY_HDB_SHOP).')
    call = graphql(shop, await shopifyToken(shop))
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.from('hdb_shopify_orders').update({ status: 'mislukt', error }).in('id', ids).neq('status', 'aangemaakt')
    return reply(200, { results: ids.map((id) => ({ id, status: 'mislukt', error })) })
  }
  const results = []
  // Na elkaar, in volgorde van de kassa: zo krijgen de bestellingen in Shopify de nummers in dezelfde volgorde.
  for (const id of ids) {
    const r = await push(db, id, call)
    results.push({ id, status: r.status, order: r.shopify_order_name, draft: r.shopify_draft_name, error: r.error })
  }
  return reply(200, { results })
})
