// HA-CO: foto's en modellen uit de webwinkel (haco.nu) naast het bestelportaal (MOS). Testgegevens zijn verzonnen.
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { describe, expect, it } from 'vitest'
import { articlePhotos } from '../src/domain/articles'

const HACO = 'Coöperatieve Inkoopvereniging Ha-Co U.A.'

describe("foto's van een catalogusartikel", () => {
  it('eerst image_url, dan de rest, zonder dubbele of lege', () => {
    expect(articlePhotos({ image_url: 'a.jpg', images: ['a.jpg', '', 'b.jpg', 'b.jpg', 'c.jpg'] })).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(articlePhotos({ image_url: '', images: ['b.jpg'] })).toEqual(['b.jpg'])
    expect(articlePhotos({ image_url: 'a.jpg' })).toEqual(['a.jpg'])
    expect(articlePhotos({ image_url: '', images: null })).toEqual([])
  })
})

describe('HA-CO webwinkel in de database', () => {
  async function migrated() {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.query(`insert into suppliers (name, code) values ($1, 'HAC')`, [HACO])
    // Bestelportaal: een los artikel zonder foto, een artikel met foto en een verzamelartikel.
    const mos = [
      { supplier_sku: '0099001', name: 'Teststoel Lina', categories: 'Stoelen', price: 120, documents: [] },
      { supplier_sku: '0099002', name: 'Testkast Rob', categories: 'Kasten', price: 300, documents: [{ name: 'rob.jpg', url: 'https://mos.test/uploads/Product/rob.jpg' }, { name: 'maat.pdf', url: 'https://mos.test/uploads/Product/maat.pdf' }] },
      { supplier_sku: '0099003', name: 'Testfabriek serie', categories: 'Diversen', price: 0, documents: [] },
    ]
    for (const m of mos) {
      await pg.query(`insert into supplier_haco_items (supplier_name, supplier_sku, name, categories, price, documents, manufacturer_name, stock_type)
        values ($1, $2, $3, $4, $5, $6, 'Testfabriek', 'C')`, [HACO, m.supplier_sku, m.name, m.categories, m.price, JSON.stringify(m.documents)])
    }
    return pg
  }
  const page = (key: string, base: string, prefix: string, title: string, images: string[]) =>
    ({ url_key: key, url: `https://shop.test/${key}`, base_sku: base, prefix, title, images, lastmod: '2026-11-01T03:00:00+00:00' })
  const SITEMAP = [
    page('0099001-teststoel-lina', '0099001', '', 'Teststoel Lina', ['https://shop.test/l1.jpg', 'https://shop.test/l2.jpg']),
    page('0099002-testkast-rob', '0099002', '', 'Testkast Rob', ['https://shop.test/r1.jpg']),
    page('c0099003-11-20-nachtkastje-test', '0099003', 'c', 'Nachtkastje Test', ['https://shop.test/n1.jpg']),
    page('c0099003-12-20-wandrek-test', '0099003', 'c', 'Wandrek Test', ['https://shop.test/w1.jpg', 'https://shop.test/w2.jpg']),
  ]

  it('geeft foto\'s aan artikelen en maakt van elk model van een verzamelartikel een eigen artikel', async () => {
    const pg = await migrated()
    const call = async (fn: string, ...args: unknown[]) =>
      (await pg.query<{ r: Record<string, unknown> }>(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)).rows[0].r

    expect(await call('claim_supplier_haco_web_sync', HACO, 100)).toEqual({ action: 'sitemap' })
    // Een te korte sitemap maakt niets leeg.
    await expect(call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'sitemap', rows: SITEMAP }))).rejects.toThrow(/maar 4/)
    expect(await call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'sitemap', min_expected: 4, rows: SITEMAP })))
      .toMatchObject({ kind: 'sitemap', total: 4, new: 4 })

    // Alleen de pagina's van modellen worden gelezen, voor het webwinkelnummer.
    const claim = await call('claim_supplier_haco_web_sync', HACO, 100) as { action: string; urls: { url_key: string }[] }
    expect(claim.action).toBe('pages')
    expect(claim.urls.map((u) => u.url_key).sort()).toEqual(['c0099003-11-20-nachtkastje-test', 'c0099003-12-20-wandrek-test'])
    expect(await call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'pages', rows: [
      { url_key: 'c0099003-11-20-nachtkastje-test', web_sku: 'c0099003-11-20', web_name: 'Nachtkastje Test', web_price: 89.95 },
      { url_key: 'c0099003-12-20-wandrek-test', error: 'HTTP 500' },
    ] }))).toMatchObject({ read: 1, failed: 1 })
    // Een mislukte pagina wordt die dag niet opnieuw geprobeerd: door naar de catalogus.
    expect(await call('claim_supplier_haco_web_sync', HACO, 100)).toEqual({ action: 'catalog' })
    expect(await call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'catalog' })))
      .toMatchObject({ catalog: { new: 4, models: 1, with_photo: 4 }, pages_failed: 1 })
    expect(await call('claim_supplier_haco_web_sync', HACO, 100)).toMatchObject({ action: 'done' })

    const arts = Object.fromEntries((await pg.query<{ id: string; supplier_sku: string; name: string; image_url: string; images: string[]; category_code: string; series: string; price: string; variant_of: string | null }>(
      'select id, supplier_sku, name, image_url, images, category_code, series, price, variant_of from catalog_articles order by supplier_sku')).rows.map((a) => [a.supplier_sku, a]))
    // Los artikel zonder foto in MOS: de foto's van de webwinkel.
    expect(arts['0099001'].images).toEqual(['https://shop.test/l1.jpg', 'https://shop.test/l2.jpg'])
    expect(arts['0099001'].image_url).toBe('https://shop.test/l1.jpg')
    // Foto uit MOS gaat voor, de pdf telt niet mee, de webwinkel komt erachter.
    expect(arts['0099002'].images).toEqual(['https://mos.test/uploads/Product/rob.jpg', 'https://shop.test/r1.jpg'])
    expect(arts['0099002'].image_url).toBe('https://mos.test/uploads/Product/rob.jpg')
    // Het verzamelartikel krijgt geen foto's van een model, alleen in de lijst de eerste foto van zijn eerste variant.
    expect(arts['0099003'].images).toEqual([])
    expect(arts['0099003'].image_url).toBe('https://shop.test/n1.jpg')
    // Het model wordt een eigen artikel met het webwinkelnummer, als variant van het verzamelartikel.
    expect(arts['C0099003-11-20'].variant_of).toBe(arts['0099003'].id)
    expect(arts['0099001'].variant_of).toBeNull()
    expect(arts['C0099003-11-20']).toMatchObject({ name: 'Nachtkastje Test', series: 'Testfabriek', image_url: 'https://shop.test/n1.jpg' })
    // Prijs uit het verzamelartikel in MOS (nu 0, zoals de andere commissieartikelen), niet de webwinkelprijs.
    expect(Number(arts['C0099003-11-20'].price)).toBe(0)
    // Een model zonder gelezen pagina komt er (nog) niet in.
    expect(arts['C0099003-12-20']).toBeUndefined()

    // Zoeken: een variant noemt zijn verzamelartikel, een verzamelartikel telt zijn varianten.
    const search = async (q: string) => (await pg.query<{ supplier_sku: string; variant_count: number; parent_name: string | null }>(
      'select supplier_sku, variant_count, parent_name from search_catalog_articles($1)', [q])).rows
    expect(await search('nachtkastje test')).toEqual([{ supplier_sku: 'C0099003-11-20', variant_count: 0, parent_name: 'Testfabriek serie' }])
    expect((await search('testfabriek serie')).find((r) => r.supplier_sku === '0099003')).toMatchObject({ variant_count: 1, parent_name: null })
  }, 60000)

  it('zet een model inactief als het uit de webwinkel verdwijnt', async () => {
    const pg = await migrated()
    const call = (fn: string, ...args: unknown[]) => pg.query(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)
    await call('claim_supplier_haco_web_sync', HACO, 100)
    await call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'sitemap', min_expected: 1, rows: SITEMAP }))
    await call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'pages', rows: [
      { url_key: 'c0099003-11-20-nachtkastje-test', web_sku: 'C0099003-11-20', web_name: 'Nachtkastje Test' },
      { url_key: 'c0099003-12-20-wandrek-test', web_sku: 'C0099003-12-20', web_name: 'Wandrek Test' },
    ] }))
    await call('sync_catalog_articles_haco', HACO)
    const active = async () => (await pg.query<{ supplier_sku: string }>(`select supplier_sku from catalog_articles where active and supplier_sku like 'C%' order by 1`)).rows.map((r) => r.supplier_sku)
    expect(await active()).toEqual(['C0099003-11-20', 'C0099003-12-20'])
    await call('apply_supplier_haco_web_sync', HACO, JSON.stringify({ kind: 'sitemap', min_expected: 1, rows: SITEMAP.filter((p) => !p.url_key.includes('wandrek')) }))
    await call('sync_catalog_articles_haco', HACO)
    // Met nog één modelpagina is het geen verzameling meer: de pagina hoort weer bij het verzamelartikel zelf.
    expect(await active()).toEqual([])
    const base = (await pg.query<{ images: string[] }>(`select images from catalog_articles where supplier_sku = '0099003'`)).rows[0]
    expect(base.images).toEqual(['https://shop.test/n1.jpg'])
    expect((await pg.query(`select 1 from catalog_articles where variant_of is not null`)).rows).toEqual([])
  }, 60000)

  it('bundelt artikelen met dezelfde naam vóór " | " tot één serie met uitvoeringen', async () => {
    const pg = await migrated()
    for (const [sku, name, docs] of [
      ['0099011', 'Testbank Rio | 2 zits', []],
      ['0099012', 'Testbank Rio | Element | Hoek', [{ name: 'hoek.jpg', url: 'https://mos.test/uploads/Product/hoek.jpg' }]],
      ['0099013', 'Testkast Solo | Wit', []],
      // Andere schrijfwijze van dezelfde serie: met punt en zonder " | ".
      ['0099014', 'Testbank Rio. 3 zits bank', []],
      // Begint met de serienaam, maar een langere naam: geen lid.
      ['0099015', 'Testbank Riolo 2 zits', []],
    ] as const) {
      await pg.query(`insert into supplier_haco_items (supplier_name, supplier_sku, name, categories, price, documents, manufacturer_name, stock_type)
        values ($1, $2, $3, 'Bankstellen', 100, $4, 'Testfabriek', 'V')`, [HACO, sku, name, JSON.stringify(docs)])
    }
    const r = (await pg.query<{ r: Record<string, number> }>('select sync_catalog_articles_haco($1) as r', [HACO])).rows[0].r
    expect(r).toMatchObject({ series: 1, in_series: 3 })
    const rows = (await pg.query<{ id: string; supplier_sku: string; name: string; price: string | null; image_url: string; variant_of: string | null }>(
      'select id, supplier_sku, name, price, image_url, variant_of from catalog_articles order by supplier_sku')).rows
    const by = Object.fromEntries(rows.map((a) => [a.supplier_sku, a]))
    // Het serie-artikel: naam vóór " | ", geen prijs, foto van de eerste uitvoering met foto.
    expect(by['SERIE Testbank Rio']).toMatchObject({ name: 'Testbank Rio', price: null, image_url: 'https://mos.test/uploads/Product/hoek.jpg' })
    expect(by['0099011'].variant_of).toBe(by['SERIE Testbank Rio'].id)
    expect(by['0099012'].variant_of).toBe(by['SERIE Testbank Rio'].id)
    expect(by['0099014'].variant_of).toBe(by['SERIE Testbank Rio'].id)
    expect(by['0099015'].variant_of).toBeNull()
    // Eén artikel met een " | " is geen serie.
    expect(by['0099013'].variant_of).toBeNull()
    expect(by['SERIE Testkast Solo']).toBeUndefined()
  }, 60000)
})
