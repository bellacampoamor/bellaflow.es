// Kassaverkopen van HDB als conceptorder in de Shopify van HomeDecoBali (opdracht Rick 11 november 2026).
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { CatalogArticle } from '../src/data/types'
import { seedDemo } from '../src/domain/demo'
import type { PosLine } from '../src/domain/pos'
import { importShowroom, posCheckout, pushToShopify, saveSettings, sendSaleToShopify, syncCatalogArticles } from '../src/domain/services'
import { goesToShopify, shopifyAdminUrl, shopifyBacklog, shopifyCompletes, shopifyOrderOf } from '../src/domain/shopify'
import { countryCode, draftOrderInput, invoiceTag, splitName, type ShopifySale } from '../supabase/functions/_shared/shopifyDraft'

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
  const line = (): PosLine => ({ key: newId(), code: table.article_number, article: table, description: table.name, qty: 1, unit_price: 187.4, discount_pct: 0, vat_rate: 21 })
  const checkout = (issuer: 'bella' | 'hdb') => posCheckout(db, { salesperson_id: seller, customer_id: null, date: TODAY, lines: [line()], payment: { method: 'pin', reference: '' }, issuer })

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

  it('creditfacturen gaan niet naar Shopify', () => {
    expect(goesToShopify({ simplified: true, issuer: 'hdb', kind: 'volledig', credit_of: null })).toBe(true)
    expect(goesToShopify({ simplified: true, issuer: 'hdb', kind: 'creditfactuur', credit_of: 'x' })).toBe(false)
    expect(goesToShopify({ simplified: false, issuer: 'bella', kind: 'volledig', credit_of: null })).toBe(false)
  })
})
