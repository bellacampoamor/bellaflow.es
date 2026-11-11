// Eigen artikelnummers, elementen en zoeken over alle catalogi. Testartikelen zijn verzonnen.
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot, newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { CatalogArticle, Supplier } from '../src/data/types'
import { ARTICLE_CATEGORIES, ARTICLE_NUMBER, ArticleStore, categoryFor, priceWithSurcharge, formatArticleNumber, suggestSupplierCode } from '../src/domain/articles'
import { seedDemo } from '../src/domain/demo'
import {
  createOrder, saveSupplierSurcharge, importShowroom, importShowroomDetails, importSupplierFile, productForArticle, saveSupplier, syncCatalogArticles,
} from '../src/domain/services'
import { toSeedSql } from '../scripts/seed-sql'

const TODAY = '2026-11-07'
const LOL = 'Life Outdoor Living International B.V.'
const SHOWROOM_HEAD = 'supplier_name,supplier_sku,name,ean,series,categories,price,currency,available_date,available_text,image_url,product_url,scraped_at'
const row = (sup: string, sku: string, name: string, cat: string, price: number) => `${sup},${sku},${name},,Testserie,${cat},${price},EUR,,,,,2026-11-06T17:00:00Z`
const details = (sku: string, elements: string[]) => `${LOL},${sku},"[]","${JSON.stringify(elements).replace(/"/g, '""')}",2026-11-06T17:00:00Z`
const DETAIL_HEAD = 'supplier_name,supplier_sku,specifications,elements,scraped_at'

let db: LocalDriver
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY) })

async function addSupplier(name: string, code: string | null = null) {
  const id = newId()
  await db.insert('suppliers', [{ id, name, vat_number: '', contact_name: '', email: '', phone: '', address: '', postal_code: '', city: '', country: 'Nederland', lead_time_days: 14, payment_terms: '', notes: '', is_active: true, code } satisfies Supplier])
  return id
}

describe('artikelnummer', () => {
  it('heeft de opbouw leverancier-categorie-tien cijfers', () => {
    expect(formatArticleNumber('LOL', 'LOU', 1)).toBe('LOL-LOU-0000000001')
    expect(formatArticleNumber('HAC', 'TAF', 1234567890)).toBe('HAC-TAF-1234567890')
    expect(ARTICLE_NUMBER.test('LOL-LOU-0000000001')).toBe(true)
    expect(() => formatArticleNumber('LO', 'LOU', 1)).toThrow()
    expect(() => formatArticleNumber('LOL', 'LOU', 10_000_000_000)).toThrow()
  })
  it('stelt een afkorting voor de leverancier voor', () => {
    expect(suggestSupplierCode(LOL)).toBe('LOL')
    expect(suggestSupplierCode('Coöperatieve Inkoopvereniging Ha-Co U.A.')).toBe('HAC')
    expect(suggestSupplierCode('Hartman', ['HAR'])).toMatch(/^H[A-Z]{2}$/)
    expect(suggestSupplierCode('Hartman', ['HAR'])).not.toBe('HAR')
  })
  it('kiest de categorie uit de leverancier, dan de naam, dan het artikel waar het element van is', () => {
    expect(categoryFor(['Loungesets'], 'Bank')).toBe('LOU')
    expect(categoryFor(['Beschermhoezen en onderhoudsmiddelen'], 'Hoes loungeset')).toBe('HOE')
    expect(categoryFor(['Tuinkussens'], 'Loungekussen')).toBe('KUS')
    expect(categoryFor(['Voetenbanken en poefs'], 'x')).toBe('POF')
    expect(categoryFor([], 'Proxima vloerlamp deel 2 van 3 voet')).toBe('VER')
    expect(categoryFor([], 'Onderdeel X12', 'LOU')).toBe('LOU')
    expect(categoryFor([], 'Onderdeel X12')).toBe('OVR')
  })
})

describe('catalogusartikelen', () => {
  const SHOWROOM = [SHOWROOM_HEAD,
    row(LOL, 'T-SET', 'Testloungeset Mara', 'Loungesets', 2499),
    row(LOL, 'T-HOEK', 'Mara hoekelement', '', 899),
    row(LOL, 'T-MID', 'Mara middenelement', '', 699),
    row(LOL, 'T-KUS', 'Mara sierkussen', 'Tuinkussens', 49),
  ].join('\n')

  it('geeft elk artikel en element een uniek eigen nummer en legt de elementen vast', async () => {
    await importShowroom(db, SHOWROOM)
    await importShowroomDetails(db, [DETAIL_HEAD, details('T-SET', ['T-HOEK', 'T-MID', 'T-KUS'])].join('\n'))
    const r = await syncCatalogArticles(db, `${TODAY}T08:00:00Z`)
    expect(r.added).toBe(4)
    const lol = db.data.suppliers.find((x) => x.name === LOL)!
    const [set] = await db.findArticles({ supplierId: lol.id, skus: ['T-SET'] })
    expect(set.article_number).toMatch(/^LOL-LOU-\d{10}$/)
    // Het hoekelement heeft geen categorie bij de leverancier, maar de naam is herkenbaar; elementen zonder beide volgen de set.
    const all = await db.findArticles({ supplierId: lol.id, skus: ['T-HOEK', 'T-MID', 'T-KUS'] })
    expect(all.map((a) => a.article_number.slice(0, 7))).toEqual(['LOL-LOU', 'LOL-LOU', 'LOL-KUS'])
    expect(new Set([set, ...all].map((a) => a.article_number.slice(-10))).size).toBe(4)
    const els = await db.articleElements(set.id)
    expect(els.map((a) => a.supplier_sku)).toEqual(['T-HOEK', 'T-MID', 'T-KUS'])
    expect((await db.articleParents(els[0].id)).map((a) => a.id)).toEqual([set.id])
  })

  it('houdt nummers en elementen vast als de leverancier zijn lijst wijzigt', async () => {
    await importShowroom(db, SHOWROOM)
    await importShowroomDetails(db, [DETAIL_HEAD, details('T-SET', ['T-HOEK', 'T-MID', 'T-KUS'])].join('\n'))
    await syncCatalogArticles(db)
    const before = new Map(db.articles.articles.map((a) => [a.supplier_sku, a.article_number]))
    const setId = db.articles.articles.find((a) => a.supplier_sku === 'T-SET')!.id

    // Nieuwe export: andere naam en prijs, het sierkussen staat niet meer onder Elementen, er komt een element bij.
    await importShowroom(db, [SHOWROOM_HEAD, row(LOL, 'T-SET', 'Testloungeset Mara II', 'Tuinkussens', 2599), row(LOL, 'T-POEF', 'Mara poef', '', 199)].join('\n'))
    await importShowroomDetails(db, [DETAIL_HEAD, details('T-SET', ['T-HOEK', 'T-POEF'])].join('\n'))
    const r = await syncCatalogArticles(db)
    expect(r.added).toBe(1)
    const after = new Map(db.articles.articles.map((a) => [a.supplier_sku, a]))
    for (const [sku, nr] of before) expect(after.get(sku)!.article_number).toBe(nr)
    // De categorie in het nummer wijzigt niet, de naam en prijs volgen de leverancier.
    expect(after.get('T-SET')!.article_number).toMatch(/^LOL-LOU-/)
    expect(after.get('T-SET')!.name).toBe('Testloungeset Mara II')
    expect(after.get('T-SET')!.price).toBe(2599)
    expect(Number(after.get('T-POEF')!.article_number.slice(-10))).toBe(Math.max(...[...before.values()].map((n) => Number(n.slice(-10)))) + 1)
    const els = (await db.articleElements(setId)).map((a) => a.supplier_sku)
    expect(els).toHaveLength(4)
    expect(els).toEqual(expect.arrayContaining(['T-HOEK', 'T-MID', 'T-KUS', 'T-POEF']))
  })

  it('wijzigt een toegekend nummer nooit', async () => {
    await importShowroom(db, SHOWROOM)
    await syncCatalogArticles(db)
    const a = db.articles.articles[0]
    expect(() => db.articles.save([{ ...a, article_number: 'LOL-LOU-9999999999' }], [])).toThrow()
  })

  it('geeft een leverancier zonder afkorting er een en weigert dubbele afkortingen', async () => {
    const id = await addSupplier('Hartman Outdoor Products B.V.')
    await importShowroom(db, [SHOWROOM_HEAD, row('Hartman Outdoor Products B.V.', 'H-1', 'Hartman tuinstoel', 'Tuinstoelen', 129)].join('\n'))
    const r = await syncCatalogArticles(db)
    expect(r.codes).toEqual([{ id, code: 'HOP' }])
    const [a] = await db.findArticles({ supplierId: id, skus: ['H-1'] })
    expect(a.article_number).toMatch(/^HOP-STO-\d{10}$/)
    const sup = db.data.suppliers.find((x) => x.id === id)!
    await expect(saveSupplier(db, { ...sup, code: 'LOL' })).rejects.toThrow(/al in gebruik/)
    await expect(saveSupplier(db, { ...sup, code: 'H1' })).rejects.toThrow(/drie letters/)
    await saveSupplier(db, { ...sup, code: 'hrt' })
    expect(db.data.suppliers.find((x) => x.id === id)!.code).toBe('HRT')
  })

  it('zoekt over alle leveranciers tegelijk of alleen de gekozen', async () => {
    const other = await addSupplier('Hartman Outdoor Products B.V.', 'HRT')
    await importShowroom(db, SHOWROOM)
    await importShowroom(db, [SHOWROOM_HEAD, row('Hartman Outdoor Products B.V.', 'H-MARA', 'Hartman Mara tuinstoel', 'Tuinstoelen', 129)].join('\n'))
    await syncCatalogArticles(db)
    const lol = db.data.suppliers.find((x) => x.name === LOL)!
    expect((await db.searchArticles({ q: 'mara' })).length).toBe(5)
    expect((await db.searchArticles({ q: 'mara', supplierIds: [other] })).map((a) => a.supplier_sku)).toEqual(['H-MARA'])
    expect((await db.searchArticles({ q: 'mara', supplierIds: [lol.id] })).length).toBe(4)
    expect((await db.searchArticles({ q: 'mara kussen' })).map((a) => a.supplier_sku)).toEqual(['T-KUS'])
    expect((await db.searchArticles({ q: 't-hoek' }))[0].supplier_sku).toBe('T-HOEK')
    const own = db.articles.articles.find((a) => a.supplier_sku === 'T-MID')!.article_number
    expect((await db.searchArticles({ q: own.toLowerCase() })).map((a) => a.supplier_sku)).toEqual(['T-MID'])
    // Exacte treffer op artikelnummer staat bovenaan.
    expect((await db.searchArticles({ q: 'T-SET' }))[0]).toMatchObject({ supplier_sku: 'T-SET', element_count: 0 })
  })

  it('maakt bij een verkooporder het product onder Instellingen met het eigen artikelnummer, één keer', async () => {
    await importShowroom(db, SHOWROOM)
    await syncCatalogArticles(db)
    const [hit] = await db.searchArticles({ q: 'T-KUS' })
    const pid = await productForArticle(db, hit)
    expect(await productForArticle(db, hit)).toBe(pid)
    const p = db.data.products.find((x) => x.id === pid)!
    expect(p).toMatchObject({ sku: hit.article_number, catalog_article_number: hit.article_number, sale_price: 49, supplier_id: hit.supplier_id })
    const id = await createOrder(db, { header: {
      customer_id: db.data.customers[0].id, order_date: TODAY, channel: 'winkel', salesperson_id: db.data.salespeople[0].id, customer_reference: '', order_type: 'bestelling',
      fulfilment: 'bezorgen', requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1', delivery_postal_code: '', delivery_city: '',
      delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
    }, lines: [{ product_id: pid, description: p.name, options: '', qty: 2, unit_price: 49, discount_pct: 0, vat_rate: 21, source: 'bestelling', warehouse_id: null, take_now: false }] })
    expect(db.data.sales_order_lines.filter((l) => l.sales_order_id === id).map((l) => l.product_id)).toEqual([pid])
  })

  it('maakt het product pas als de verkooporder klopt', async () => {
    await importShowroom(db, SHOWROOM)
    await syncCatalogArticles(db)
    const [article] = await db.searchArticles({ q: 'T-MID' })
    const line = { product_id: '', article, description: article.name, options: '', qty: 1, unit_price: 699, discount_pct: 0, vat_rate: 21, source: 'bestelling' as const, warehouse_id: null, take_now: false }
    const header = {
      customer_id: db.data.customers[0].id, order_date: TODAY, channel: 'winkel' as const, salesperson_id: '', customer_reference: '', order_type: 'bestelling' as const,
      fulfilment: 'bezorgen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1', delivery_postal_code: '', delivery_city: '',
      delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
    }
    const count = () => db.data.products.filter((p) => p.catalog_article_number === article.article_number).length
    await expect(createOrder(db, { header, lines: [line] })).rejects.toThrow(/verkoper/)
    expect(count()).toBe(0)
    const id = await createOrder(db, { header: { ...header, salesperson_id: db.data.salespeople[0].id }, lines: [line] })
    expect(count()).toBe(1)
    const [saved] = db.data.sales_order_lines.filter((l) => l.sales_order_id === id)
    expect(saved).not.toHaveProperty('article')
    expect(db.data.products.find((p) => p.id === saved.product_id)!.sku).toBe(article.article_number)
  })

  it('inlezen via de knop werkt de artikelnummers direct bij', async () => {
    const r = await importSupplierFile(db, SHOWROOM)
    expect(r.articles.added).toBe(4)
  })
})

describe('toeslag per leverancier', () => {
  it('verhoogt de prijs van de leverancier, afgerond op centen', () => {
    expect(priceWithSurcharge(100, { price_surcharge_pct: 12.5 })).toBe(112.5)
    expect(priceWithSurcharge(49.99, { price_surcharge_pct: 15 })).toBe(57.49)
    expect(priceWithSurcharge(100, {})).toBe(100)
    expect(priceWithSurcharge(null, { price_surcharge_pct: 10 })).toBeNull()
  })
  it('zit in de verkoopprijs van een nieuw product uit de catalogus', async () => {
    await importShowroom(db, [SHOWROOM_HEAD, row(LOL, 'T-STOEL', 'Teststoel', 'Tuinstoelen', 200)].join('\n'))
    await syncCatalogArticles(db)
    const lol = db.data.suppliers.find((x) => x.name === LOL)!
    await saveSupplierSurcharge(db, lol.id, 18)
    const [a] = await db.searchArticles({ q: 'T-STOEL' })
    const pid = await productForArticle(db, a)
    expect(db.data.products.find((x) => x.id === pid)!.sale_price).toBe(236)
    // Een bestaand product houdt zijn verkoopprijs als de toeslag later wijzigt.
    await saveSupplierSurcharge(db, lol.id, 25)
    await productForArticle(db, a)
    expect(db.data.products.find((x) => x.id === pid)!.sale_price).toBe(236)
    await expect(saveSupplierSurcharge(db, lol.id, -1)).rejects.toThrow(/tussen 0 en 500/)
  })
})

describe('echte catalogi van Life Outdoor Living', () => {
  it('alle 9.391 artikelen en elementen van de showroom krijgen een uniek nummer', async () => {
    await importShowroom(db, readFileSync('public/assets/catalogus/supplier_showroom_items.csv', 'utf8'))
    await importShowroomDetails(db, readFileSync('public/assets/catalogus/supplier_showroom_details.csv', 'utf8'))
    const t0 = performance.now()
    const r = await syncCatalogArticles(db)
    const ms = performance.now() - t0
    const arts = db.articles.articles
    const skus = new Set(db.data.supplier_showroom_items.map((x) => x.supplier_sku.toLowerCase()))
    expect(arts.length).toBe(skus.size)
    expect(r.added).toBe(skus.size)
    expect(new Set(arts.map((a) => a.article_number)).size).toBe(arts.length)
    expect(arts.every((a) => ARTICLE_NUMBER.test(a.article_number) && a.article_number.startsWith('LOL-'))).toBe(true)
    expect(r.links).toBeGreaterThan(20000)
    // Een tweede keer bijwerken voegt niets toe en wijzigt niets.
    expect(await syncCatalogArticles(db)).toMatchObject({ added: 0, updated: 0, links: 0 })
    const byCat = new Map<string, number>()
    for (const a of arts) byCat.set(a.category_code, (byCat.get(a.category_code) ?? 0) + 1)
    console.info(`bijwerken: ${Math.round(ms)} ms, ${arts.length} artikelen, ${r.links} koppelingen, categorieën:`, Object.fromEntries([...byCat].sort((a, b) => b[1] - a[1])))
  }, 120000)

  it('zoeken in het geheugen blijft snel bij 250.000 artikelen van tien leveranciers', () => {
    const store = new ArticleStore()
    const sup = Array.from({ length: 10 }, () => newId())
    const words = ['lounge', 'tafel', 'stoel', 'kussen', 'parasol', 'bank', 'poef', 'hoes', 'teak', 'aluminium', 'antraciet', 'zand', 'wit', 'zwart', 'rond', 'ovaal']
    const rows: CatalogArticle[] = Array.from({ length: 250_000 }, (_, i) => ({
      id: `a${i}`, article_number: formatArticleNumber('ABC', 'LOU', i + 1), supplier_id: sup[i % 10], supplier_sku: `SKU-${i}`, ean: String(8700000000000 + i),
      name: `${words[i % 16]} ${words[(i * 7) % 16]} ${words[(i * 13) % 16]} model ${i % 997}`, category_code: 'LOU', series: `S${i % 400}`, price: 100, currency: 'EUR',
      image_url: '', source: 'showroom', active: true, created_at: TODAY,
    }))
    store.save(rows, [])
    const time = (q: Parameters<ArticleStore['search']>[0]) => { const t = performance.now(); const n = store.search(q).length; return { ms: performance.now() - t, n } }
    const all = time({ q: 'tafel hoes' }), one = time({ q: 'tafel hoes', supplierIds: [sup[1]] }), sku = time({ q: 'SKU-123456' })
    console.log(`250.000 artikelen in het geheugen: alle catalogi ${all.ms.toFixed(0)} ms, één catalogus ${one.ms.toFixed(0)} ms, artikelnummer ${sku.ms.toFixed(0)} ms`)
    expect(all.n).toBeGreaterThan(0)
    expect(all.ms).toBeLessThan(1000)
  })
})

describe('database', () => {
  const migrated = async () => {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    return pg
  }
  it('de categorieën in de database zijn gelijk aan die in de app', async () => {
    const pg = await migrated()
    const rows = (await pg.query<{ code: string; pattern: string | null }>('select code, pattern from article_categories order by priority')).rows
    expect(rows.map((r) => r.code)).toEqual([...ARTICLE_CATEGORIES.map((c) => c.code), 'OVR'])
    rows.slice(0, -1).forEach((r, i) => expect(r.pattern!.replace(/\\[mM]/g, '\\b')).toBe(ARTICLE_CATEGORIES[i].match.source))
  }, 60000)

  it('de nachtelijke sync nummert in de database zoals de app', async () => {
    await importShowroom(db, [SHOWROOM_HEAD,
      row(LOL, 'T-SET', 'Testloungeset Mara', 'Loungesets', 2499), row(LOL, 'T-HOEK', 'Mara hoekelement', '', 899),
      row(LOL, 'T-X', 'Onderdeel X12', '', 9), row(LOL, 'T-KUS', 'Mara sierkussen', 'Tuinkussens', 49), row(LOL, 'T-LAMP', 'Proxima vloerlamp met LED', '', 199),
    ].join('\n'))
    await importShowroomDetails(db, [DETAIL_HEAD, details('T-SET', ['T-HOEK', 'T-X', 'T-KUS'])].join('\n'))
    const pg = await migrated()
    const sync = async () => (await pg.query<{ r: Record<string, number> }>(`select sync_catalog_articles_showroom($1) as r`, [LOL])).rows[0].r
    expect(await sync()).toEqual({ new: 5, changed: 0, deactivated: 0, links: 3 })
    const arts = (await pg.query<{ supplier_sku: string; article_number: string }>('select supplier_sku, article_number from catalog_articles order by supplier_sku')).rows
    const cat = Object.fromEntries(arts.map((a) => [a.supplier_sku, a.article_number.slice(0, 7)]))
    // Zelfde categorieën als in de app: T-X volgt de set, de lamp wordt herkend aan de naam.
    expect(cat).toEqual({ 'T-HOEK': 'LOL-LOU', 'T-KUS': 'LOL-KUS', 'T-LAMP': 'LOL-VER', 'T-SET': 'LOL-LOU', 'T-X': 'LOL-LOU' })
    await syncCatalogArticles(db)
    for (const a of db.articles.articles) expect(a.article_number.slice(0, 7)).toBe(cat[a.supplier_sku])
    expect(new Set(arts.map((a) => a.article_number)).size).toBe(5)
    // Nog een keer: niets nieuw. Naam gewijzigd en element weg bij de leverancier: nummer en koppeling blijven.
    expect(await sync()).toEqual({ new: 0, changed: 0, deactivated: 0, links: 0 })
    await pg.query(`update supplier_showroom_items set name = 'Mara hoekelement links' where supplier_sku = 'T-HOEK'`)
    await pg.query(`update supplier_showroom_details set elements = '["T-HOEK"]' where supplier_sku = 'T-SET'`)
    await pg.query(`delete from supplier_showroom_items where supplier_sku = 'T-LAMP'`)
    expect(await sync()).toEqual({ new: 0, changed: 1, deactivated: 1, links: 0 })
    expect((await pg.query('select * from catalog_article_elements')).rows).toHaveLength(3)
    const after = (await pg.query<{ supplier_sku: string; article_number: string; active: boolean }>('select supplier_sku, article_number, active from catalog_articles order by supplier_sku')).rows
    expect(after.map((a) => a.article_number)).toEqual(arts.map((a) => a.article_number))
    expect(after.find((a) => a.supplier_sku === 'T-LAMP')!.active).toBe(false)
  }, 60000)
  it('zoekt en nummert in Postgres zoals de app', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const sup = db.data.suppliers.find((x) => x.name === LOL)!
    const first = (await pg.query<{ n: number }>('select reserve_article_numbers(3)::int as n')).rows[0].n
    expect(first).toBe(1)
    expect((await pg.query<{ n: number }>('select reserve_article_numbers(2)::int as n')).rows[0].n).toBe(4)
    const ins = (sku: string, name: string, n: number, cat = 'LOU') => pg.query(
      `insert into catalog_articles (id, article_number, supplier_id, supplier_sku, name, category_code, source) values (gen_random_uuid(), $1, $2, $3, $4, $5, 'showroom') returning id`,
      [formatArticleNumber('LOL', cat, n), sup.id, sku, name, cat])
    const set = (await ins('T-SET', 'Testloungeset Mara', 1)).rows[0] as { id: string }
    const el = (await ins('T-KUS', 'Mara sierkussen', 2, 'KUS')).rows[0] as { id: string }
    await ins('T-TAF', 'Tafel Rio', 3, 'TAF')
    await pg.query('insert into catalog_article_elements (parent_id, element_id, position) values ($1, $2, 1)', [set.id, el.id])
    const hits = await pg.query<{ supplier_sku: string; element_count: number }>(`select supplier_sku, element_count from search_catalog_articles('mara', null, 30)`)
    expect(hits.rows.map((r) => r.supplier_sku).sort()).toEqual(['T-KUS', 'T-SET'])
    expect(hits.rows.find((r) => r.supplier_sku === 'T-SET')!.element_count).toBe(1)
    expect((await pg.query(`select * from search_catalog_articles('mara kussen', null, 30)`)).rows).toHaveLength(1)
    expect((await pg.query(`select * from search_catalog_articles('lol-taf-0000000003', null, 30)`)).rows).toHaveLength(1)
    expect((await pg.query(`select * from search_catalog_articles('mara', array[gen_random_uuid()], 30)`)).rows).toHaveLength(0)
    expect((await pg.query(`select * from search_catalog_articles('100%', null, 30)`)).rows).toHaveLength(0)
    await expect(pg.query(`update catalog_articles set article_number = 'LOL-LOU-0000000099' where id = $1`, [set.id])).rejects.toThrow(/wijzigen niet/)
    await expect(ins('T-X', 'Fout', 1)).rejects.toThrow()
    await expect(pg.query(`insert into catalog_articles (article_number, supplier_id, supplier_sku, name, category_code, source) values ('LOL-LOU-12', $1, 'Y', 'Y', 'LOU', 'showroom')`, [sup.id])).rejects.toThrow()
    await expect(pg.query(`update suppliers set code = 'lo1' where id = $1`, [sup.id])).rejects.toThrow()
  }, 60000)

  it('de nachtelijke sync leest elke gewijzigde productpagina, en een andere beschikbaarheid telt niet als wijziging', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated; create role anon; create role service_role;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const call = async (sql: string, ...args: unknown[]) => (await pg.query<{ r: Record<string, unknown> }>(sql, args)).rows[0].r
    const row = (sku: string, name: string, date: string) => ({ supplier_sku: sku, name, ean: '', series: '', categories: 'Tuinstoelen', price: 100, available_date: date, available_text: date, image_url: '', product_url: `https://voorbeeld.test/${sku}`, source_hash: `${name}|${date}`, content_hash: name })
    const items = (rows: unknown[]) => call('select sync_supplier_showroom_items($1, $2::jsonb) as r', LOL, JSON.stringify(rows))
    const skus = Array.from({ length: 6 }, (_, i) => `S${i}`)
    await items(skus.map((k) => row(k, `Stoel ${k}`, '2026-11-07')))
    const todo = async (limit: number, max = 3000) => (await pg.query<{ supplier_sku: string; reason: string }>('select * from showroom_details_todo($1, $2, $3)', [LOL, limit, max])).rows
    // Alles nieuw: alles komt mee, ongeacht de rondgang.
    expect((await todo(1)).map((r) => r.reason)).toEqual(Array(6).fill('nieuw'))
    await call('select sync_supplier_showroom_details($1, $2::jsonb) as r', LOL, JSON.stringify(skus.map((k) => ({ supplier_sku: k, specifications: [], elements: [], source_hash: k }))))
    expect(await todo(0)).toEqual([])
    // Volgende nacht: alle beschikbaarheidsdata anders, bij twee artikelen ook de naam.
    await new Promise((r) => setTimeout(r, 5))
    await items(skus.map((k, i) => row(k, i < 2 ? `Stoel ${k} nieuw` : `Stoel ${k}`, '2026-11-20')))
    const t = await todo(1)
    expect(t.filter((r) => r.reason === 'gewijzigd').map((r) => r.supplier_sku)).toEqual(['S0', 'S1'])
    expect(t.filter((r) => r.reason === 'ronde')).toHaveLength(1)
    expect(await todo(10, 3)).toHaveLength(3)
    // Eigen artikelnummers aan het eind van de sync, alleen uit de showroom (de webshoptabel bestaat niet meer).
    expect(await call('select sync_catalog_articles($1) as r', LOL)).toMatchObject({ new: 6, total: 6 })
    expect((await pg.query(`select to_regclass('supplier_catalog_items') as t`)).rows[0]).toEqual({ t: null })
    expect(await call('select sync_catalog_articles($1) as r', LOL)).toMatchObject({ new: 0, total: 6 })
    await pg.query(`update suppliers set code = null where name = $1`, [LOL])
    await expect(call('select sync_catalog_articles($1) as r', LOL)).rejects.toThrow(/afkorting/)
  }, 60000)

  it('de index maakt zoeken in 250.000 artikelen snel', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const sup = db.data.suppliers[0].id
    await pg.query(`insert into catalog_articles (article_number, supplier_id, supplier_sku, ean, name, category_code, series, source)
      select 'ABC-LOU-' || lpad(i::text, 10, '0'), $1, 'SKU-' || i, (8700000000000 + i)::text,
        (array['lounge','tafel','stoel','kussen','parasol','bank','poef','hoes','teak','aluminium','antraciet','zand','wit','zwart','rond','ovaal'])[1 + i % 16] || ' ' ||
        (array['lounge','tafel','stoel','kussen','parasol','bank','poef','hoes','teak','aluminium','antraciet','zand','wit','zwart','rond','ovaal'])[1 + (i * 7) % 16] || ' model ' || (i % 997),
        'LOU', 'S' || (i % 400), 'showroom'
      from generate_series(1, 250000) i`, [sup])
    await pg.exec('analyze catalog_articles')
    const time = async (q: string) => { const t = performance.now(); const r = await pg.query(`select * from search_catalog_articles($1, null, 30)`, [q]); return { ms: performance.now() - t, n: r.rows.length } }
    await time('warm')
    const sku = await time('SKU-123456'), name = await time('tafel hoes model 12'), num = await time('ABC-LOU-0000123456')
    const plan = await pg.query<{ 'QUERY PLAN': string }>(`explain select * from catalog_articles where search_text like '%sku-123456%'`)
    console.log(`Postgres (PGlite), 250.000 artikelen: artikelnummer leverancier ${sku.ms.toFixed(0)} ms, naam ${name.ms.toFixed(0)} ms, eigen nummer ${num.ms.toFixed(0)} ms`)
    expect(plan.rows.map((r) => r['QUERY PLAN']).join(' ')).toMatch(/catalog_articles_search/)
    expect(sku.n).toBeGreaterThan(0)
    expect(num.n).toBe(1)
  }, 300000)
})

describe('Catalogi uit de database (leveranciers met een koppeling, zoals HomeDecoBali)', () => {
  const art = (i: number, supplier_id: string, name: string, category_code: string, active = true): CatalogArticle => ({
    id: `c${i}`, article_number: formatArticleNumber('TST', category_code, i), supplier_id, supplier_sku: `T-${i}`, ean: '', name, category_code,
    series: '', price: 10 + i, currency: 'EUR', image_url: '', source: 'webshop', active, created_at: TODAY,
  })
  it('toont alleen actieve artikelen van de gekozen leverancier, op naam, per pagina, met categorieën', () => {
    const store = new ArticleStore()
    store.save([
      art(1, 'hdb', 'Rieten mand 40 cm', 'ACC'), art(2, 'hdb', 'Bamboe lamp', 'VER'), art(3, 'hdb', 'Rieten mand 36 cm', 'ACC'),
      art(4, 'hdb', 'Pre-order mand', 'ACC', false), art(5, 'hac', 'Rieten stoel', 'STO'),
    ], [])
    const page = store.list({ supplierId: 'hdb', offset: 0, limit: 2, withCategories: true })
    expect(page.total).toBe(3)
    expect(page.rows.map((r) => r.name)).toEqual(['Bamboe lamp', 'Rieten mand 36 cm'])
    expect(page.categories).toEqual([{ code: 'ACC', n: 2 }, { code: 'VER', n: 1 }])
    expect(store.list({ supplierId: 'hdb', offset: 2, limit: 2 }).rows.map((r) => r.name)).toEqual(['Rieten mand 40 cm'])
    expect(store.list({ supplierId: 'hdb', q: 'rieten 40', offset: 0, limit: 50 }).rows.map((r) => r.supplier_sku)).toEqual(['T-1'])
    expect(store.list({ supplierId: 'hdb', category: 'VER', offset: 0, limit: 50 }).total).toBe(1)
    expect(store.list({ supplierId: 'hdb', q: 'stoel', offset: 0, limit: 50 }).total).toBe(0)
  })
})
