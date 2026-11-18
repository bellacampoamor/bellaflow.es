// Kassaverkopen van HDB als conceptorder in de Shopify van HomeDecoBali (opdracht Rick 11 november 2026).
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { CatalogArticle } from '../src/data/types'
import { seedDemo } from '../src/domain/demo'
import type { PosLine } from '../src/domain/pos'
import { createCreditInvoice, importShowroom, posCheckout, pushToShopify, saveSettings, sendSaleToShopify, syncCatalogArticles } from '../src/domain/services'
import { goesToShopify, paidCashOnly, shopifyAdminUrl, shopifyBacklog, shopifyCompletes, shopifyOrderOf, shopifySendingOn, shopifyStockOnly } from '../src/domain/shopify'
import { countryCode, draftOrderInput, invoiceTag, splitName, type ShopifySale } from '../supabase/functions/_shared/shopifyDraft'
import { alreadyRefunded, refundInput, refundNote, returnLocation } from '../supabase/functions/_shared/shopifyRefund'
import { adjustInput, stockPlan, stockReference } from '../supabase/functions/_shared/shopifyStock'

const TODAY = '2026-11-11'
const LOL = 'Life Outdoor Living International B.V.'
const HEAD = 'supplier_name,supplier_sku,name,ean,series,categories,price,currency,available_date,available_text,image_url,product_url,scraped_at'
const SHOWROOM = [HEAD, `${LOL},K-TAF,Kassatafel Mara,8719000000099,Testserie,Tuintafels,187.4,EUR,,,,,2026-11-06T17:00:00Z`].join('\n')

const sale = (p: Partial<ShopifySale> = {}): ShopifySale => ({
  invoice_number: 'FS-HDB-2026-0007', invoice_date: '2026-11-11', order_number: 'VO-2026-0042', salesperson: 'Sanne (voorbeeld)',
  payments: [{ method: 'pin', amount: 248 }], customer: null, total: 248,
  lines: [
    { article_number: 'HDB-ACC-0000010058', sku: 'BA26020002', description: 'Mand Wayag', qty: 2, unit_price: 99, discount_pct: 10, vat_rate: 21, variant_id: '55511640441158' },
    { article_number: 'DIVERSEN', sku: '', description: 'Kussenhoes, eigen omschrijving', qty: 1, unit_price: 69.8, discount_pct: 0, vat_rate: 21, variant_id: null },
  ],
  ...p,
})

describe('Shopify: opbouw van de conceptorder', () => {
  it('koppelt artikelen aan de variant met de prijs en korting van de kassa', () => {
    const input = draftOrderInput(sale()) as { lineItems: Record<string, unknown>[] }
    expect(input.lineItems[0]).toEqual({
      variantId: 'gid://shopify/ProductVariant/55511640441158', quantity: 2, priceOverride: { amount: '99.00', currencyCode: 'EUR' },
      appliedDiscount: { valueType: 'PERCENTAGE', value: 10, title: 'Korting kassa', description: '10% korting aan de kassa' },
    })
  })

  it('zet DIVERSEN als los artikel met eigen omschrijving en prijs, zonder verzending', () => {
    const input = draftOrderInput(sale()) as { lineItems: Record<string, unknown>[] }
    expect(input.lineItems[1]).toMatchObject({ title: 'Kussenhoes, eigen omschrijving', quantity: 1, originalUnitPriceWithCurrency: { amount: '69.80', currencyCode: 'EUR' }, sku: '', taxable: true, requiresShipping: false })
    expect(input.lineItems[1]).not.toHaveProperty('variantId')
  })

  it('legt factuur, verkooporder, verkoper en betaalwijze vast in notitie, tags en extra velden', () => {
    const input = draftOrderInput(sale({ payments: [{ method: 'pin', amount: 200 }, { method: 'contant', amount: 48 }] })) as Record<string, unknown>
    expect(input.note).toContain('Factuur: FS-HDB-2026-0007 van 11-11-2026')
    expect(input.note).toContain('Verkooporder: VO-2026-0042')
    expect(input.note).toContain('Verkoper: Sanne (voorbeeld)')
    expect(input.note).toContain('Betaald: Pin € 200,00, Contant € 48,00')
    expect(input.tags).toEqual(['Bella Flow', 'Kassa Bella Campoamor', invoiceTag('FS-HDB-2026-0007'), 'Pin', 'Contant'])
    expect(input.customAttributes).toContainEqual({ key: 'Factuur', value: 'FS-HDB-2026-0007' })
    expect(input.customAttributes).toContainEqual({ key: 'Betaalwijze', value: 'Pin, Contant' })
    expect(input.presentmentCurrencyCode).toBe('EUR')
  })

  it('zonder klantgegevens (kassaverkoop) geen klant, adres of e-mail', () => {
    const input = draftOrderInput(sale()) as Record<string, unknown>
    expect(input).not.toHaveProperty('email')
    expect(input).not.toHaveProperty('billingAddress')
  })

  it('met klant: e-mail, telefoon en adres; NIE alleen in de notitie', () => {
    const input = draftOrderInput(sale({ customer: { name: 'Ana María López', company: '', email: ' ana@example.com ', phone: '+34 600 000 000', tax_id: 'X0000000T', address: 'Calle Falsa 1', postal_code: '03189', city: 'Orihuela Costa', province: 'Alicante', country: 'España' } })) as Record<string, unknown>
    expect(input.email).toBe('ana@example.com')
    expect(input.billingAddress).toMatchObject({ firstName: 'Ana María', lastName: 'López', address1: 'Calle Falsa 1', zip: '03189', city: 'Orihuela Costa', countryCode: 'ES' })
    expect(input.shippingAddress).toEqual(input.billingAddress)
    expect(input.note).toContain('NIF / NIE / paspoort: X0000000T')
  })

  it('landcode uit het land van de klant; onbekend land geeft geen adres', () => {
    expect(countryCode('Nederland')).toBe('NL')
    expect(countryCode('België')).toBe('BE')
    expect(countryCode('')).toBe('ES')
    expect(countryCode('Atlantis')).toBeNull()
    const input = draftOrderInput(sale({ customer: { name: 'X', company: '', email: '', phone: '', tax_id: '', address: 'Weg 1', postal_code: '1', city: 'Y', province: '', country: 'Atlantis' } })) as Record<string, unknown>
    expect(input).not.toHaveProperty('billingAddress')
    expect(splitName('Cher')).toEqual({ firstName: '', lastName: 'Cher' })
  })
})

describe('Shopify: kassa en wachtrij', () => {
  let db: LocalDriver
  let table: CatalogArticle
  let seller = ''
  beforeEach(async () => {
    db = new LocalDriver(false)
    await seedDemo(db, TODAY)
    await importShowroom(db, SHOWROOM)
    await syncCatalogArticles(db)
    table = (await db.searchArticles({ q: 'K-TAF' }))[0]
    seller = db.data.salespeople[0].id
  })
  // Een bon van HDB mag alleen HDB-artikelen bevatten (besluit Rick 16 november 2026): dan hetzelfde artikel als HDB-artikel.
  const line = (issuer: 'bella' | 'hdb'): PosLine => {
    const a: CatalogArticle = issuer === 'hdb' ? { ...table, source: 'hdb' } : table
    return { key: newId(), code: a.article_number, article: a, description: a.name, qty: 1, unit_price: 187.4, discount_pct: 0, vat_rate: 21 }
  }
  const checkout = (issuer: 'bella' | 'hdb', method: 'pin' | 'contant' = 'pin') => posCheckout(db, { salesperson_id: seller, customer_id: null, date: TODAY, lines: [line(issuer)], payment: { method, reference: '' }, issuer })

  // Besluit Rick 18 november 2026: contant aan de kassa geen bestelling en geen betaling in Shopify, alleen voorraad afboeken.
  it('contant afgerekend: in de wachtrij als voorraad (geen bestelling); pin blijft een bestelling', async () => {
    const cash = await checkout('hdb', 'contant')
    const row = shopifyOrderOf(db.data, cash.invoiceId)!
    expect(row.kind).toBe('voorraad')
    expect(shopifyStockOnly(row)).toBe(true)
    const card = await checkout('hdb', 'pin')
    expect(shopifyOrderOf(db.data, card.invoiceId)!.kind).toBe('verkoop')
    expect(paidCashOnly([{ invoice_id: 'a', method: 'contant' }, { invoice_id: 'a', method: 'pin' }], 'a')).toBe(false)
    expect(paidCashOnly([{ invoice_id: 'a', method: 'contant' }, { invoice_id: 'a', method: 'verrekening' }], 'a')).toBe(true)
    expect(paidCashOnly([], 'a')).toBe(false)
  })

  it('retour op een contante kassabon: voorraad_retour (voorraad terug), geen refund', async () => {
    const r = await checkout('hdb', 'contant')
    const sale = db.data.invoices.find((i) => i.id === r.invoiceId)!
    const line = db.data.invoice_lines.find((l) => l.invoice_id === sale.id)!
    const shop = db.data.warehouses.find((w) => w.kind === 'winkel')!
    const id = await createCreditInvoice(db, { invoice_id: sale.id, date: TODAY, reason: 'Retour', lines: [{ invoice_line_id: line.id, qty: 1, return_warehouse_id: shop.id }], refund: { method: 'contant', reference: '' } })
    expect(shopifyOrderOf(db.data, id)!.kind).toBe('voorraad_retour')
  })

  it('een kassaverkoop van HDB komt één keer in de wachtrij; in de browserversie als testversie', async () => {
    const r = await checkout('hdb')
    expect(r.shopify).toBe('demo')
    const row = shopifyOrderOf(db.data, r.invoiceId)!
    expect(row).toMatchObject({ status: 'demo', complete_order: true, shopify_order_name: '' })
    await sendSaleToShopify(db, r.invoiceId)
    expect(db.data.hdb_shopify_orders.filter((x) => x.invoice_id === r.invoiceId)).toHaveLength(1)
  })

  it('een kassaverkoop van Bella gaat niet naar Shopify', async () => {
    const r = await checkout('bella')
    expect(r.shopify).toBeNull()
    expect(db.data.hdb_shopify_orders).toHaveLength(0)
    await expect(sendSaleToShopify(db, r.invoiceId)).rejects.toThrow(/Alleen kassaverkopen van HDB/)
  })

  it('volgt de instelling: conceptorder laten staan', async () => {
    await saveSettings(db, { hdb_shopify_complete: false })
    expect(shopifyCompletes(db.data.settings[0])).toBe(false)
    const r = await checkout('hdb')
    expect(shopifyOrderOf(db.data, r.invoiceId)!.complete_order).toBe(false)
  })

  it('lukt versturen niet, dan blijft de verkoop staan en is hij mislukt met de melding', async () => {
    db.pushShopifyOrders = async () => { throw new Error('Functie niet bereikbaar') }
    const r = await checkout('hdb')
    expect(r.shopify).toBe('mislukt')
    expect(db.data.invoices.some((i) => i.id === r.invoiceId)).toBe(true)
    expect(shopifyOrderOf(db.data, r.invoiceId)).toMatchObject({ status: 'mislukt', error: 'Functie niet bereikbaar' })
    expect(shopifyBacklog(db.data)).toHaveLength(1)
    // Opnieuw versturen: de opslag zet hem in Shopify (zoals de edge function doet).
    db.pushShopifyOrders = async (ids) => {
      for (const r2 of db.data.hdb_shopify_orders) if (!ids.length || ids.includes(r2.id)) Object.assign(r2, { status: 'aangemaakt', error: '', shopify_draft_name: '#D12', shopify_order_name: '#1188', shopify_order_id: 'gid://shopify/Order/6012345678' })
      return 'sent'
    }
    expect(await pushToShopify(db)).toBe('aangemaakt')
    expect(shopifyBacklog(db.data)).toHaveLength(0)
    const row = shopifyOrderOf(db.data, r.invoiceId)!
    expect(shopifyAdminUrl(row, 'homedecobali.myshopify.com')).toBe('https://admin.shopify.com/store/homedecobali/orders/6012345678')
  })

  it('versturen uit (testperiode): niets naar Shopify; weer aan, dan per factuur alsnog', async () => {
    let pushed = 0
    db.pushShopifyOrders = async () => { pushed++; return 'sent' }
    await saveSettings(db, { hdb_shopify_enabled: false })
    expect(shopifySendingOn(db.data.settings[0])).toBe(false)
    const r = await checkout('hdb')
    expect(r.shopify).toBe('uit')
    expect(db.data.hdb_shopify_orders).toHaveLength(0)
    expect(pushed).toBe(0)
    await expect(sendSaleToShopify(db, r.invoiceId)).rejects.toThrow(/staat uit/)
    await expect(pushToShopify(db)).rejects.toThrow(/staat uit/)
    await saveSettings(db, { hdb_shopify_enabled: true })
    await sendSaleToShopify(db, r.invoiceId)
    expect(shopifyOrderOf(db.data, r.invoiceId)).toBeDefined()
    expect(pushed).toBe(1)
  })

  it('creditfacturen van HDB gaan als retour naar Shopify (opdracht Rick 17 november 2026)', () => {
    expect(goesToShopify({ simplified: true, issuer: 'hdb', kind: 'volledig', credit_of: null })).toBe(true)
    expect(goesToShopify({ simplified: true, issuer: 'hdb', kind: 'creditfactuur', credit_of: 'x' })).toBe(true)
    expect(goesToShopify({ simplified: true, issuer: 'bella', kind: 'creditfactuur', credit_of: 'x' })).toBe(false)
    expect(goesToShopify({ simplified: false, issuer: 'bella', kind: 'volledig', credit_of: null })).toBe(false)
  })

  it('retour van een kassabon van HDB: creditfactuur, voorraad terug en in de wachtrij als retour voor Shopify', async () => {
    let pushed: string[][] = []
    db.pushShopifyOrders = async (ids) => { pushed.push(ids); return 'sent' }
    const r = await checkout('hdb')
    const sale = db.data.invoices.find((i) => i.id === r.invoiceId)!
    const line = db.data.invoice_lines.find((l) => l.invoice_id === sale.id)!
    const shop = db.data.warehouses.find((w) => w.kind === 'winkel')!
    pushed = []
    const id = await createCreditInvoice(db, { invoice_id: sale.id, date: TODAY, reason: 'Retour', lines: [{ invoice_line_id: line.id, qty: 1, return_warehouse_id: shop.id }], refund: { method: 'pin', reference: '' } })
    const row = shopifyOrderOf(db.data, id)!
    expect(row.kind).toBe('retour')
    expect(pushed).toEqual([[row.id]])
    expect(db.data.stock_movements.some((m) => m.kind === 'retour' && m.ref_id === db.data.invoices.find((i) => i.id === id)!.number)).toBe(true)
  })
})

describe('Shopify: retour als terugbetaling (refund)', () => {
  const orderLines = [
    { id: 'L1', variant: { id: 'gid://shopify/ProductVariant/111' }, quantity: 2, refundableQuantity: 2, unfulfilledQuantity: 2 },
    { id: 'L2', variant: { id: 'gid://shopify/ProductVariant/222' }, quantity: 1, refundableQuantity: 1, unfulfilledQuantity: 0 },
  ]
  const transactions = [{ id: 'T1', kind: 'SALE', status: 'SUCCESS', gateway: 'manual', amountSet: { presentmentMoney: { amount: '300.00', currencyCode: 'EUR' } } }]
  const base = { orderId: 'gid://shopify/Order/9', locationId: 'gid://shopify/Location/1', note: refundNote('CRE-FS-HDB-2026-0001', 'FS-HDB-2026-0003', 'Retour'), transactions, orderLines }

  it('artikel terug in voorraad: nog niet afgehandeld = CANCEL, afgehandeld = RETURN, geld terug via de betaling', () => {
    const { input, unmatched } = refundInput({ ...base, amount: 250, lines: [
      { article_number: 'HDB-ACC-1', variant_id: '111', qty: 1, restock: true },
      { article_number: 'HDB-ACC-2', variant_id: '222', qty: 1, restock: true },
    ] })
    expect(unmatched).toEqual([])
    expect(input.refundLineItems).toEqual([
      { lineItemId: 'L1', quantity: 1, restockType: 'CANCEL', locationId: 'gid://shopify/Location/1' },
      { lineItemId: 'L2', quantity: 1, restockType: 'RETURN', locationId: 'gid://shopify/Location/1' },
    ])
    expect(input.transactions).toEqual([{ orderId: 'gid://shopify/Order/9', parentId: 'T1', gateway: 'manual', kind: 'REFUND', amount: '250.00' }])
    expect(input.notify).toBe(false)
  })

  it('geen retour in voorraad: NO_RESTOCK; los artikel alleen bedrag; nooit meer terug dan betaald', () => {
    const { input, unmatched } = refundInput({ ...base, amount: 999, lines: [
      { article_number: 'HDB-ACC-1', variant_id: '111', qty: 2, restock: false },
      { article_number: 'HDB-ACC-9', variant_id: null, qty: 1, restock: false },
      { article_number: 'DIVERSEN', variant_id: null, qty: 1, restock: false },
    ] })
    expect(input.refundLineItems).toEqual([{ lineItemId: 'L1', quantity: 2, restockType: 'NO_RESTOCK' }])
    expect(unmatched).toEqual(['HDB-ACC-9'])
    expect((input.transactions as { amount: string }[])[0].amount).toBe('300.00')
  })

  it('voorraad en retour altijd op Centraal magazijn, niet op de locatie Campoamor (besluit Rick 18 november 2026)', () => {
    expect(returnLocation([{ id: 'B', name: 'Bella Outdoor & Furniture - Campoamor', isActive: true }, { id: 'A', name: 'Centraal magazijn', isActive: true }])).toBe('A')
    expect(returnLocation([{ id: 'A', name: 'Centraal magazijn', isActive: false }, { id: 'B', name: 'Bella Outdoor & Furniture - Campoamor', isActive: true }])).toBe('B')
    expect(returnLocation([])).toBeNull()
  })

  it('herkent een refund die al in Shopify staat aan het nummer van de creditfactuur', () => {
    const refunds = [{ id: 'R1', note: refundNote('CRE-FS-HDB-2026-0001', 'FS-HDB-2026-0003', '') }]
    expect(alreadyRefunded(refunds, 'CRE-FS-HDB-2026-0001')?.id).toBe('R1')
    expect(alreadyRefunded(refunds, 'CRE-FS-HDB-2026-0002')).toBeNull()
  })
})

describe('Shopify: contant alleen voorraad', () => {
  it('telt per variant op, boekt af bij verkoop en bij bij retour; DIVERSEN en losse artikelen niet', () => {
    const lines = [
      { article_number: 'HDB-ACC-1', variant_id: '111', qty: 2 },
      { article_number: 'HDB-ACC-1', variant_id: 'gid://shopify/ProductVariant/111', qty: 1 },
      { article_number: 'HDB-ACC-9', variant_id: null, qty: 1 },
      { article_number: 'DIVERSEN', variant_id: null, qty: 1 },
    ]
    expect(stockPlan(lines, -1)).toEqual({ deltas: [{ variantId: 'gid://shopify/ProductVariant/111', delta: -3 }], unlinked: ['HDB-ACC-9'] })
    expect(stockPlan(lines, 1).deltas).toEqual([{ variantId: 'gid://shopify/ProductVariant/111', delta: 3 }])
  })

  it('past de beschikbare voorraad van de locatie aan, zonder vergelijking met de stand in Shopify', () => {
    const input = adjustInput({ deltas: [{ inventoryItemId: 'gid://shopify/InventoryItem/5', delta: -2 }], locationId: 'gid://shopify/Location/1', sign: -1, reference: stockReference('FS-HDB-2026-0007') })
    expect(input).toEqual({
      name: 'available', reason: 'correction', referenceDocumentUri: 'bellaflow://factuur/FS-HDB-2026-0007',
      changes: [{ inventoryItemId: 'gid://shopify/InventoryItem/5', locationId: 'gid://shopify/Location/1', delta: -2, changeFromQuantity: null }],
    })
    expect(adjustInput({ deltas: [], locationId: 'L', sign: 1, reference: 'x' }).reason).toBe('restock')
  })
})
