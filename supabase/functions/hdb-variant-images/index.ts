// Foto per variant voor de HomeDecoBali-catalogus (melding Rick 16 november 2026).
// De Partner Catalog API geeft per variant geen foto, waardoor alle varianten van een product (bijv. Deco sticks 2026,
// 12 models) dezelfde eerste productfoto kregen. Deze functie leest de foto van elke variant uit de Shopify van
// HomeDecoBali en zet die via apply_hdb_variant_images vast in supplier_hdb_items en catalog_articles.
//
// Aangeroepen door n8n (BellaFlow: HomeDecoBali catalogus sync) na elke sync, met dezelfde Supabase-sleutel als de
// sync zelf. De functie schrijft met de sleutel van de aanroeper: apply_hdb_variant_images mag alleen service_role.
// Shopify-toegang: dezelfde secrets als hdb-shopify (SHOPIFY_HDB_SHOP + token of client id/secret), recht read_products.
import { createClient } from 'npm:@supabase/supabase-js@2'

/** Zelfde versie als SHOPIFY_API_VERSION in _shared/shopifyDraft.ts. */
const SHOPIFY_API_VERSION = '2026-07'

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const VARIANT_MEDIA = `query ($after: String) {
  productVariants(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id media(first: 1) { nodes { preview { image { url } } } } }
  }
}`

async function shopifyToken(shop: string): Promise<string> {
  const token = Deno.env.get('SHOPIFY_HDB_TOKEN')
  if (token) return token
  const id = Deno.env.get('SHOPIFY_HDB_CLIENT_ID'), secret = Deno.env.get('SHOPIFY_HDB_CLIENT_SECRET')
  if (!id || !secret) throw new Error('De Shopify-koppeling van HDB is nog niet ingesteld.')
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  })
  if (!res.ok) throw new Error(`Shopify gaf geen toegang (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return (await res.json()).access_token as string
}

type Page = { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; media: { nodes: { preview: { image: { url: string } | null } | null }[] } }[] } }

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? ''
  const key = req.headers.get('apikey') ?? auth.replace(/^Bearer\s+/i, '')
  if (!key) return reply(401, { error: 'Geen sleutel.' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, key, {
    global: { headers: auth ? { Authorization: auth } : {} }, auth: { persistSession: false, autoRefreshToken: false },
  })
  // Rechtencheck vooraf (lege lijst verandert niets): alleen de sync-sleutel mag dit.
  const check = await db.rpc('apply_hdb_variant_images', { p_images: [] })
  if (check.error) return reply(403, { error: `Geen toegang: ${check.error.message}` })

  try {
    const shop = Deno.env.get('SHOPIFY_HDB_SHOP')
    if (!shop) throw new Error('SHOPIFY_HDB_SHOP ontbreekt.')
    const token = await shopifyToken(shop)
    const images: { variant_id: string; url: string }[] = []
    let after: string | null = null
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query: VARIANT_MEDIA, variables: { after } }),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`Shopify ${res.status}: ${text.slice(0, 300)}`)
      const body = JSON.parse(text) as { data?: Page; errors?: { message: string }[] }
      if (body.errors?.length || !body.data) throw new Error(`Shopify: ${(body.errors ?? []).map((e) => e.message).join('; ') || 'leeg antwoord'}`)
      for (const v of body.data.productVariants.nodes) {
        images.push({ variant_id: v.id.split('/').pop()!, url: v.media.nodes[0]?.preview?.image?.url ?? '' })
      }
      if (!body.data.productVariants.pageInfo.hasNextPage) break
      after = body.data.productVariants.pageInfo.endCursor
    }
    const { data, error } = await db.rpc('apply_hdb_variant_images', { p_images: images })
    if (error) throw new Error(error.message)
    return reply(200, { variants: images.length, withImage: images.filter((x) => x.url).length, result: data })
  } catch (e) {
    return reply(500, { error: e instanceof Error ? e.message : String(e) })
  }
})
