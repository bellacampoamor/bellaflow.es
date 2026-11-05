import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { PDFDocument } from 'pdf-lib'
import type { EmailAttachment } from '../src/data/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { TABLES } from '../src/data/types'
import { archiveRows, openLinesOnTransport, linePurchaseStatus, linesToPurchase, documentLanguage, flowCounts, freeAt, transportLoad, invoiceBalance, onHandMap, orderStage, orderTab, reservedMap, stockKey, vatBreakdown , invoiceReport, periodRange, invoiceQrUrl, hasTaxId } from '../src/domain/calc'
import { renameOldSuppliers, restoreSettings, restoreSuppliers, seedDemo } from '../src/domain/demo'
import {
  createDelivery, createInvoice, createOrder, createPurchaseOrder, invoiceProformas, lineFromProduct, markDelivered, assignShipmentsToTransport, cancelTransport, convertLinesToPurchaseOrders, createTransport, markReady, receiveGoods, rescheduleDelivery, rescheduleOrder, saveRouteOrder, saveSettings, mailSignedNote, setPurchaseLabel, signDelivery, splitLinesForStock, setDeliveryInTransit, setTransportStatus, updateTransport, transferStock,
} from '../src/domain/services'
import { estimateMatrix, parseRouterTable } from '../src/data/geo'
import { dropIndex, googleMapsRouteUrl, moveItem, optimizeRoute, tourCost } from '../src/domain/route'
import { es } from '../src/i18n.es'
import { en } from '../src/i18n.en'
import { toSeedSql } from '../scripts/seed-sql'

const TODAY = '2026-11-04'
let db: LocalDriver
let sellerId = ''
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY); sellerId = db.data.salespeople[0].id })

const header = (customer_id: string, over = {}) => ({
  customer_id, order_date: TODAY, channel: 'winkel' as const, salesperson_id: sellerId, customer_reference: '', order_type: 'bestelling' as const,
  fulfilment: 'bezorgen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1',
  delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '', ...over,
})

const deliver = async (id: string) => {
  await markReady(db, id, { approved_by: 'Magazijn', date: TODAY })
  await markDelivered(db, id, { date: TODAY, signed_by: 'Klant', signed_note_received: true })
}

describe('rekenen', () => {
  it('haalt IVA uit een prijs inclusief', () => {
    expect(vatBreakdown([{ total: 121, vat_rate: 21 }])).toMatchObject({ base: 100, vat: 21, total: 121 })
  })
})

describe('van inkoop tot factuur', () => {
  it('doorloopt de hele keten met splitsing over magazijnen en twee deelleveringen', async () => {
    let s = await loadSnapshot(db)
    const [shop, north, south] = s.warehouses
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const customer = s.customers[0]
    const stockAt = async (w: string) => onHandMap(await loadSnapshot(db)).get(stockKey(product.id, w)) ?? 0
    const beforeNorth = await stockAt(north.id), beforeSouth = await stockAt(south.id)

    // Klant bestelt 10 stuks op bestelling, met 500 vooruit.
    const orderId = await createOrder(db, {
      header: header(customer.id),
      lines: [lineFromProduct(product, { qty: 10, source: 'bestelling', unit_price: 121 })],
      deposit: { amount: 500, method: 'pin', reference: '' },
    })
    s = await loadSnapshot(db)
    const line = s.sales_order_lines.find((l) => l.sales_order_id === orderId)!
    expect(orderStage(s, s.sales_orders.find((o) => o.id === orderId)!)).toBe('wacht_op_goederen')

    // Inkoop 50/50.
    const poId = await createPurchaseOrder(db, {
      supplier_id: s.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '', warehouse_id: north.id,
      lines: [{ product_id: product.id, qty: 10, unit_cost: 100, sales_order_line_id: line.id }],
    })
    s = await loadSnapshot(db)
    const shipments = s.inbound_shipments.filter((x) => x.purchase_order_id === poId)
    expect(shipments).toHaveLength(1)
    const sl1 = s.inbound_shipment_lines.find((l) => l.shipment_id === shipments[0].id)!

    // Te veel ontvangen wordt geweigerd en laat niets achter.
    await expect(receiveGoods(db, { received_date: TODAY, delivery_note: '', received_by: '', notes: '', rows: [{ shipment_line_id: sl1.id, warehouse_id: north.id, qty_received: 11, qty_damaged: 0, location_bin: '' }] })).rejects.toThrow(/nog 10 open/)

    // Eerste zending verdeeld over twee magazijnen, één beschadigd blijft open.
    await receiveGoods(db, {
      received_date: TODAY, delivery_note: 'PB1', received_by: '', notes: '',
      rows: [
        { shipment_line_id: sl1.id, warehouse_id: north.id, qty_received: 3, qty_damaged: 1, location_bin: '' },
        { shipment_line_id: sl1.id, warehouse_id: south.id, qty_received: 1, qty_damaged: 0, location_bin: '' },
      ],
    })
    expect(await stockAt(north.id)).toBe(beforeNorth + 3)
    expect(await stockAt(south.id)).toBe(beforeSouth + 1)
    s = await loadSnapshot(db)
    expect(s.inbound_shipments.find((x) => x.id === shipments[0].id)!.status).toBe('partial')
    expect(s.sales_order_lines.find((l) => l.id === line.id)!.warehouse_id).toBe(north.id)
    expect(reservedMap(s).get(stockKey(product.id, north.id))).toBeGreaterThanOrEqual(10)

    // Deellevering 1: 3 stuks, wordt 363 op de factuur, deposit dekt alles.
    const d1 = await createDelivery(db, { sales_order_id: orderId, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 3 }] })
    await deliver(d1)
    expect(await stockAt(north.id)).toBe(beforeNorth)
    s = await loadSnapshot(db)
    // Afmelden maakt alleen een proforma; de factuur ontstaat pas bij Factureren.
    expect(s.invoices.filter((i) => i.sales_order_id === orderId)).toHaveLength(0)
    expect(s.deliveries.find((x) => x.id === d1)!.proforma_number).toMatch(/^PF-2026-/)
    await invoiceProformas(db, { delivery_ids: [d1], invoice_date: TODAY })
    s = await loadSnapshot(db)
    const inv1 = s.invoices.find((i) => i.sales_order_id === orderId)!
    expect(inv1).toMatchObject({ kind: 'deelfactuur', total: 363, base_amount: 300, vat_amount: 63, deposit_settled: 363 })
    expect(invoiceBalance(s, inv1)).toBe(0)

    // Dezelfde levering nogmaals factureren kan niet.
    await expect(createInvoice(db, { sales_order_id: orderId, delivery_ids: [d1], invoice_date: TODAY, settle_deposit: true })).rejects.toThrow(/al gefactureerd/)

    // Terugdateren kan niet.
    await expect(createInvoice(db, { sales_order_id: orderId, delivery_ids: [d1], invoice_date: '2026-01-01', settle_deposit: true })).rejects.toThrow(/mag niet voor/)

    // Meer plannen dan er open staat kan niet.
    await expect(createDelivery(db, { sales_order_id: orderId, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 8 }] })).rejects.toThrow(/nog 7 open/)

    // Rest leveren: voorraad moet er zijn, dus eerst overboeken en de tweede zending ontvangen.
    s = await loadSnapshot(db)
    await receiveGoods(db, { received_date: TODAY, delivery_note: 'PB2', received_by: '', notes: '', rows: [{ shipment_line_id: sl1.id, warehouse_id: north.id, qty_received: 6, qty_damaged: 0, location_bin: '' }] })
    await transferStock(db, { product_id: product.id, from_id: south.id, to_id: north.id, qty: 1, note: '', date: TODAY })
    const d2 = await createDelivery(db, { sales_order_id: orderId, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 7 }] })
    await deliver(d2)
    await invoiceProformas(db, { delivery_ids: [d2], invoice_date: TODAY })
    s = await loadSnapshot(db)
    const inv2 = s.invoices.filter((i) => i.sales_order_id === orderId).find((i) => i.id !== inv1.id)!
    expect(inv2).toMatchObject({ kind: 'eindfactuur', total: 847, deposit_settled: 137 })
    expect(invoiceBalance(s, inv2)).toBe(710)
    expect(orderStage(s, s.sales_orders.find((o) => o.id === orderId)!)).toBe('gefactureerd')
    expect(shop).toBeTruthy()
  })

  it('weigert levering als de voorraad niet op die locatie ligt', async () => {
    const s = await loadSnapshot(db)
    const [shop] = s.warehouses
    const product = s.products.find((p) => p.sku === 'TAF-EK-240')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: shop.id })] })
    const after = await loadSnapshot(db)
    const line = after.sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
    await expect(deliver(d)).rejects.toThrow(/Boek eerst voorraad/)
  })

  it('factureert een hele levering niet vanzelf bij handmatige instelling', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 2, warehouse_id: s.warehouses[1].id })] })
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 2 }] })
    await deliver(d)
    expect((await loadSnapshot(db)).invoices.filter((i) => i.sales_order_id === id)).toHaveLength(0)
  })

  it('maakt per aangevinkte proforma één factuur en weigert een lege keuze', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const make = async () => {
      const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })
      const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
      const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
      await deliver(d)
      return d
    }
    const [a, b] = [await make(), await make()]
    const count = (await loadSnapshot(db)).invoices.length
    await expect(invoiceProformas(db, { delivery_ids: [], invoice_date: TODAY })).rejects.toThrow(/proforma/)
    await invoiceProformas(db, { delivery_ids: [a, b], invoice_date: TODAY })
    expect((await loadSnapshot(db)).invoices.length).toBe(count + 2)
  })

  it('voorbeeldgegevens hebben geen negatieve voorraad en werk in elke stap', async () => {
    const s = await loadSnapshot(db)
    for (const v of onHandMap(s).values()) expect(v).toBeGreaterThanOrEqual(0)
    const c = flowCounts(s, TODAY)
    for (const key of ['inkoop', 'inkomend', 'ontvangst', 'orders', 'levering', 'facturatie'] as const) expect(c[key], key).toBeGreaterThan(0)
  })
})

describe('afgeleverde levering', () => {
  it('kan niet meer onderweg of verschoven worden', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
    await deliver(d)
    await expect(setDeliveryInTransit(db, d)).rejects.toThrow()
    await expect(rescheduleDelivery(db, d, { new_date: '2026-12-01', reason: '', customer_notified: false })).rejects.toThrow()
  })
})

describe('archief', () => {
  it('toont per levering wat compleet is en wat nog gefactureerd moet worden', async () => {
    let s = await loadSnapshot(db)
    const lucia = s.sales_orders.find((o) => o.number === 'VO-2026-0002')!
    expect(archiveRows(s).find((r) => r.order.id === lucia.id)).toMatchObject({ complete: false, invoice: null })
    expect(archiveRows(s).find((r) => r.order.number === 'VO-2026-0003')).toMatchObject({ complete: false })
    const row = archiveRows(s).find((r) => r.order.id === lucia.id)!
    const [inv] = await invoiceProformas(db, { delivery_ids: [row.delivery.id], invoice_date: TODAY })
    s = await loadSnapshot(db)
    const done = archiveRows(s).find((r) => r.order.id === lucia.id)!
    expect(done.complete).toBe(true)
    expect(done.invoice?.id).toBe(inv)
  })
})

describe('digitale afleverbon', () => {
  it('slaat de handtekening op en meldt de levering af met een proforma', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await expect(signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })).rejects.toThrow(/klaargezet/)
    await markReady(db, d, { approved_by: 'Magazijn', date: TODAY })
    await expect(signDelivery(db, d, { signature: '', signed_by: 'Klant', date: TODAY })).rejects.toThrow(/tekenen/)
    await expect(signDelivery(db, d, { signature: png, signed_by: ' ', date: TODAY })).rejects.toThrow(/ondertekend/)
    await signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })
    const after = (await loadSnapshot(db)).deliveries.find((x) => x.id === d)!
    expect(after).toMatchObject({ status: 'delivered', signature_data: png, signed_by: 'Klant', signed_note_received: true })
    expect(after.proforma_number).toBeTruthy()
    await expect(signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })).rejects.toThrow(/al afgerond/)
  })
})

describe('mail van de getekende afleverbon', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const signed = async (email: string) => {
    const s = await loadSnapshot(db)
    await db.update('customers', s.customers[0].id, { email })
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
    await markReady(db, d, { approved_by: 'Magazijn', date: TODAY })
    return d
  }
  it('stuurt naar de klant met een bcc naar de winkel', async () => {
    const sent: EmailAttachment[] = []
    db.sendEmail = async (_id, a) => { sent.push(a); return 'sent' }
    const d = await signed('klant@voorbeeld.test')
    expect(await signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })).toBe('sent')
    const mail = (await loadSnapshot(db)).email_outbox.find((m) => m.delivery_id === d)!
    expect(mail).toMatchObject({ to_email: 'klant@voorbeeld.test', bcc_email: 'winkel@voorbeeld.test', status: 'sent' })
    const pdf = await PDFDocument.load(Buffer.from(sent[0].base64, 'base64'))
    expect(pdf.getPageCount()).toBe(1)
  })
  it('verstuurt in de voorbeeldomgeving niets', async () => {
    const d = await signed('klant@voorbeeld.test')
    expect(await signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })).toBe('demo')
  })
  it('meldt een ontbrekend adres en houdt de levering afgemeld', async () => {
    const d = await signed('')
    expect(await signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })).toBe('no_recipient')
    expect((await loadSnapshot(db)).deliveries.find((x) => x.id === d)!.status).toBe('delivered')
  })
  it('kan een mislukte mail opnieuw versturen', async () => {
    db.sendEmail = async () => { throw new Error('storing') }
    const d = await signed('klant@voorbeeld.test')
    expect(await signDelivery(db, d, { signature: png, signed_by: 'Klant', date: TODAY })).toBe('failed')
    expect((await loadSnapshot(db)).deliveries.find((x) => x.id === d)!.status).toBe('delivered')
    db.sendEmail = async () => 'sent'
    expect(await mailSignedNote(db, d)).toBe('sent')
    expect((await loadSnapshot(db)).email_outbox.filter((m) => m.delivery_id === d)).toHaveLength(1)
  })
})

describe('artikelnummer', () => {
  it('gaat vast mee op de factuurregel', async () => {
    const s = await loadSnapshot(db)
    const lines = s.invoice_lines.filter((l) => l.delivery_line_id)
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l.article_number).toMatch(/\S/)
  })
})

describe('herstellen van voorbeeldgegevens', () => {
  it('houdt bedrijfsgegevens en instellingen vast', async () => {
    await db.update('settings', 'default', { address: 'Calle Echt 1', tax_id: 'B12345678', delivery_note_mode: 'digitaal' })
    const [saved] = await db.list('settings')
    const fresh = new LocalDriver(false)
    await seedDemo(fresh, TODAY)
    await restoreSettings(fresh, saved)
    expect((await fresh.list('settings'))[0]).toMatchObject({ address: 'Calle Echt 1', tax_id: 'B12345678', delivery_note_mode: 'digitaal' })
  })
})

describe('meerdere tabbladen', () => {
  it('overschrijft een getekende levering niet met een oude stand', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    try {
      const a = new LocalDriver()
      await seedDemo(a, TODAY)
      const b = new LocalDriver()
      const [d] = await a.list('deliveries')
      await a.update('deliveries', d.id, { signature_data: 'getekend' })
      await b.update('settings', 'default', { address: 'Ander tabblad' })
      const fresh = new LocalDriver()
      expect((await fresh.list('deliveries')).find((x) => x.id === d.id)!.signature_data).toBe('getekend')
      expect((await fresh.list('settings'))[0].address).toBe('Ander tabblad')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('doorzetten zonder leverancier op het artikel', () => {
  it('weigert en verwijst naar Beheer', async () => {
    const s = await loadSnapshot(db)
    const [line] = linesToPurchase(s)
    await db.update('products', line.product_id, { supplier_id: null })
    await expect(convertLinesToPurchaseOrders(db, { lines: [{ sales_order_line_id: line.id }], order_date: TODAY })).rejects.toThrow(/geen leverancier/)
  })
})

describe('taal van documenten', () => {
  it('volgt de keuze onder Beheer en anders de klant', () => {
    expect(documentLanguage('klant', 'es')).toBe('es')
    expect(documentLanguage(undefined, 'nl')).toBe('nl')
    expect(documentLanguage('en', 'es')).toBe('en')
  })
})

describe('rijvolgorde slepen', () => {
  it('bepaalt de nieuwe plek en behoudt de andere volgorde', () => {
    const mids = [100, 200, 300, 400]
    expect(dropIndex(mids, 0, 250)).toBe(1)
    expect(dropIndex(mids, 0, 450)).toBe(3)
    expect(dropIndex(mids, 3, 50)).toBe(0)
    expect(dropIndex(mids, 2, 310)).toBe(2)
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('tabbladen verkooporders', () => {
  it('deelt in op nog te leveren, ingepland en afgeleverd', async () => {
    let s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 2, warehouse_id: s.warehouses[1].id })] })
    const tab = async () => { s = await loadSnapshot(db); return orderTab(s, s.sales_orders.find((o) => o.id === id)!) }
    expect(await tab()).toBe('te_leveren')
    s = await loadSnapshot(db)
    const line = s.sales_order_lines.find((l) => l.sales_order_id === id)!
    const plan = (qty: number) => createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty }] })
    const first = await plan(1)
    expect(await tab()).toBe('te_leveren')
    await deliver(first)
    expect(await tab()).toBe('te_leveren')
    const rest = await plan(1)
    expect(await tab()).toBe('ingepland')
    await deliver(rest)
    expect(await tab()).toBe('afgeleverd')
  })
})

describe('afleverbon', () => {
  const plannedDelivery = async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    return createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
  }
  it('vraagt om klaarzetten, akkoord en handtekening', async () => {
    const d = await plannedDelivery()
    await expect(markDelivered(db, d, { date: TODAY, signed_by: 'X' })).rejects.toThrow(/eerst klaar/)
    await expect(setDeliveryInTransit(db, d)).rejects.toThrow(/eerst klaar/)
    await expect(markReady(db, d, { approved_by: ' ', date: TODAY })).rejects.toThrow(/akkoord/)
    await markReady(db, d, { approved_by: 'Jan', date: TODAY })
    await setDeliveryInTransit(db, d)
    await expect(markDelivered(db, d, { date: TODAY, signed_by: '' })).rejects.toThrow(/ondertekend/)
    await markDelivered(db, d, { date: TODAY, signed_by: 'Klant', signed_note_received: true })
    const row = (await loadSnapshot(db)).deliveries.find((x) => x.id === d)!
    expect(row).toMatchObject({ status: 'delivered', approved_by: 'Jan', signed_by: 'Klant', signed_note_received: true })
  })
  it('verschuiven haalt de levering uit de rijvolgorde', async () => {
    const d = await plannedDelivery()
    await saveRouteOrder(db, [d])
    await rescheduleDelivery(db, d, { new_date: '2026-12-01', reason: '', customer_notified: false })
    expect((await loadSnapshot(db)).deliveries.find((x) => x.id === d)!.route_position).toBeNull()
  })
})

describe('transport en labels', () => {
  const setup = async () => {
    const s = await loadSnapshot(db)
    const [showroom, campoamor] = s.warehouses
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const transport = await createTransport(db, { departure_date: '2026-11-10', arrival_date: '2026-11-13', carrier: 'X', reference: '', capacity_m3: 10, notes: '' })
    const po = await createPurchaseOrder(db, {
      supplier_id: s.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '',
      lines: [{ product_id: product.id, qty: 5, unit_cost: 100, sales_order_line_id: null }],
      warehouse_id: campoamor.id, transport_id: transport,
    })
    const shipment = (await loadSnapshot(db)).inbound_shipments.find((x) => x.purchase_order_id === po)!
    return { po, product, showroom, campoamor, transport, shipment }
  }
  it('neemt de aankomstdatum over en telt de lading', async () => {
    const { shipment, transport, product, po } = await setup()
    expect(shipment.expected_date).toBe('2026-11-13')
    const s = await loadSnapshot(db)
    expect(s.purchase_orders.find((p) => p.id === po)!.label).toBe('magazijn')
    expect(transportLoad(s, transport).m3).toBeCloseTo(5 * product.volume_m3, 1)
  })
  it('schuift zendingen mee met het transport en blokkeert na vertrek', async () => {
    const { shipment, transport } = await setup()
    await updateTransport(db, transport, { departure_date: '2026-11-12', arrival_date: '2026-11-16', carrier: 'X', reference: '', capacity_m3: 10, notes: '' })
    expect((await loadSnapshot(db)).inbound_shipments.find((x) => x.id === shipment.id)!.expected_date).toBe('2026-11-16')
    await setTransportStatus(db, transport, 'departed')
    await expect(assignShipmentsToTransport(db, [shipment.id], null)).rejects.toThrow(/al vertrokken/)
    await expect(cancelTransport(db, transport)).rejects.toThrow(/al vertrokken/)
  })
  it('zonder keuze komt alle inkoop binnen op Magazijn Campoamor, ook de ontvangst', async () => {
    const s = await loadSnapshot(db)
    const campoamor = s.warehouses.find((w) => w.is_route_origin)!
    expect(campoamor.name).toBe('Magazijn Campoamor')
    const product = s.products[0]
    const id = await createPurchaseOrder(db, { supplier_id: s.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '', label: 'showroom', lines: [{ product_id: product.id, qty: 2, unit_cost: 1, sales_order_line_id: null }] })
    const after = await loadSnapshot(db)
    const shipment = after.inbound_shipments.find((x) => x.purchase_order_id === id)!
    expect(shipment.warehouse_id).toBe(campoamor.id)
    const line = after.inbound_shipment_lines.find((l) => l.shipment_id === shipment.id)!
    await receiveGoods(db, { received_date: TODAY, delivery_note: '', received_by: '', notes: '', rows: [{ shipment_line_id: line.id, qty_received: 2, qty_damaged: 0, location_bin: '' }] })
    const moves = (await loadSnapshot(db)).stock_movements.filter((m) => m.kind === 'ontvangst' && m.product_id === product.id && m.moved_at === TODAY)
    expect(moves[moves.length - 1].warehouse_id).toBe(campoamor.id)
  })
  it('annuleren koppelt zendingen los', async () => {
    const { shipment, transport } = await setup()
    await cancelTransport(db, transport)
    expect((await loadSnapshot(db)).inbound_shipments.find((x) => x.id === shipment.id)!.transport_id).toBeNull()
  })
  it('alleen vrije voorraad verhuist naar de showroom', async () => {
    const s = await loadSnapshot(db)
    const [showroom, campoamor] = s.warehouses
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const free = freeAt(s, product.id, campoamor.id)
    const hand = onHandMap(s).get(stockKey(product.id, campoamor.id))!
    expect(free).toBeLessThan(hand)
    await expect(transferStock(db, { product_id: product.id, from_id: campoamor.id, to_id: showroom.id, qty: free + 1, note: '', date: TODAY })).rejects.toThrow(/gereserveerd/)
    await transferStock(db, { product_id: product.id, from_id: campoamor.id, to_id: showroom.id, qty: free, note: '', date: TODAY })
    expect(freeAt(await loadSnapshot(db), product.id, campoamor.id)).toBe(0)
  })
})

describe('verkoop stuurt inkoop', () => {
  it('splitst wat niet vrij is, houdt de rest in te kopen bij en maakt een deellevering mogelijk', async () => {
    let s = await loadSnapshot(db)
    const campoamor = s.warehouses[1]
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const free = freeAt(s, product.id, campoamor.id)
    const input = [lineFromProduct(product, { qty: free + 4, warehouse_id: campoamor.id })]
    const split = splitLinesForStock(s, input)
    expect(split.map((l) => [l.qty, l.source, l.warehouse_id])).toEqual([[free, 'voorraad', campoamor.id], [4, 'bestelling', null]])
    expect(splitLinesForStock(s, [lineFromProduct(product, { qty: 2, warehouse_id: s.warehouses[0].id })])[0]).toMatchObject({ source: 'bestelling', qty: 2 })
    const orderId = await createOrder(db, { header: header(s.customers[0].id), lines: split })
    s = await loadSnapshot(db)
    expect(orderStage(s, s.sales_orders.find((o) => o.id === orderId)!)).toBe('te_plannen')
    expect(freeAt(s, product.id, campoamor.id)).toBe(0)
    const line = s.sales_order_lines.find((l) => l.sales_order_id === orderId && l.source === 'bestelling')!
    // Deels ingekocht: de rest blijft op de lijst.
    await createPurchaseOrder(db, { supplier_id: s.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '', lines: [{ product_id: product.id, qty: 3, unit_cost: 1, sales_order_line_id: line.id }], warehouse_id: campoamor.id })
    s = await loadSnapshot(db)
    expect(linesToPurchase(s).find((l) => l.id === line.id)!.qty).toBe(1)
    expect(linePurchaseStatus(s, line.id)).toMatchObject({ purchased: 3, received: 0 })
  })
})

describe('meenemen per regel', () => {
  it('geeft een regel direct mee, zet dat deel klaar als proforma en houdt de rest open', async () => {
    const s = await loadSnapshot(db)
    const campoamor = s.warehouses[1]
    const taken = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const later = s.products.find((p) => p.sku === 'KST-EK-180')!
    const before = onHandMap(s).get(stockKey(taken.id, campoamor.id))!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [
      lineFromProduct(taken, { qty: 2, warehouse_id: campoamor.id, take_now: true, unit_price: 121 }),
      lineFromProduct(later, { qty: 1, source: 'bestelling' }),
    ] })
    const after = await loadSnapshot(db)
    const order = after.sales_orders.find((o) => o.id === id)!
    expect(order.order_type).toBe('bestelling')
    expect(onHandMap(after).get(stockKey(taken.id, campoamor.id))).toBe(before - 2)
    expect(after.invoices.filter((i) => i.sales_order_id === id)).toHaveLength(0)
    const taken1 = after.deliveries.find((d) => d.sales_order_id === id)!
    expect(taken1.proforma_number).toBeTruthy()
    await invoiceProformas(db, { delivery_ids: [taken1.id], invoice_date: TODAY })
    expect((await loadSnapshot(db)).invoices.filter((i) => i.sales_order_id === id)).toMatchObject([{ kind: 'deelfactuur', total: 242 }])
    expect(orderStage(after, order)).toBe('deels_geleverd')
    expect(linesToPurchase(after).some((l) => l.sales_order_id === id && l.product_id === later.id)).toBe(true)
  })
  it('weigert meenemen als er niet genoeg vrij is', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    await expect(createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 99, warehouse_id: s.warehouses[1].id, take_now: true })] })).rejects.toThrow(/om mee te nemen/)
  })
})

describe('doorzetten naar inkoop', () => {
  it('maakt per leverancier één inkooporder, gekoppeld aan de regels en het transport', async () => {
    const s = await loadSnapshot(db)
    const queue = linesToPurchase(s)
    const suppliersIn = new Set(queue.map((l) => s.products.find((p) => p.id === l.product_id)!.supplier_id))
    expect(suppliersIn.size).toBeGreaterThan(1)
    const transport = s.transports.find((t) => t.status === 'planned')!
    const ids = await convertLinesToPurchaseOrders(db, {
      lines: queue.map((l) => ({ sales_order_line_id: l.id })),
      order_date: TODAY,
    })
    expect(ids).toHaveLength(suppliersIn.size)
    const after = await loadSnapshot(db)
    expect(linesToPurchase(after)).toHaveLength(0)
    for (const l of queue) expect(linePurchaseStatus(after, l.id).purchased).toBe(l.qty)
    // Elke regel eigen rij, nog zonder transport. Na koppelen volgt de verwachte datum uit het transport.
    const rows = after.inbound_shipments.filter((x) => ids.includes(x.purchase_order_id))
    expect(rows).toHaveLength(queue.length)
    expect(rows.every((x) => x.transport_id === null)).toBe(true)
    await assignShipmentsToTransport(db, [rows[0].id], transport.id)
    const linked = await loadSnapshot(db)
    expect(linked.inbound_shipments.find((x) => x.id === rows[0].id)).toMatchObject({ transport_id: transport.id, expected_date: transport.arrival_date })
    expect(linked.inbound_shipments.find((x) => x.id === rows[1].id)!.transport_id).toBeNull()
    await expect(convertLinesToPurchaseOrders(db, { lines: [{ sales_order_line_id: queue[0].id }], order_date: TODAY })).rejects.toThrow(/al ingekocht/)
  })
})

describe('label van een inkooporder', () => {
  it('volgt de keuze, en regels voor een klant maken het verkoop', async () => {
    const s = await loadSnapshot(db)
    const base = { supplier_id: s.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '', warehouse_id: s.warehouses[1].id }
    const line = { product_id: s.products[0].id, qty: 1, unit_cost: 1, sales_order_line_id: null }
    const a = await createPurchaseOrder(db, { ...base, label: 'showroom', lines: [line] })
    const b = await createPurchaseOrder(db, { ...base, lines: [line] })
    const c = await createPurchaseOrder(db, { ...base, label: 'magazijn', lines: [{ ...line, sales_order_line_id: s.sales_order_lines[0].id }] })
    const after = await loadSnapshot(db)
    const label = (id: string) => after.purchase_orders.find((p) => p.id === id)!.label
    expect([label(a), label(b), label(c)]).toEqual(['showroom', 'magazijn', 'verkoop'])
    await setPurchaseLabel(db, a, 'magazijn')
    expect((await loadSnapshot(db)).purchase_orders.find((p) => p.id === a)!.label).toBe('magazijn')
    await expect(setPurchaseLabel(db, c, 'showroom')).rejects.toThrow(/houdt het label/)
    await expect(setPurchaseLabel(db, a, 'verkoop')).rejects.toThrow(/hoort bij/)
  })
})

describe('ontvangst per transport', () => {
  it('boekt regels van meerdere inkooporders in en rondt het transport af', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const transport = await createTransport(db, { departure_date: TODAY, arrival_date: TODAY, carrier: '', reference: '', capacity_m3: 10, notes: '' })
    for (const sup of s.suppliers) await createPurchaseOrder(db, { supplier_id: sup.id, order_date: TODAY, supplier_reference: '', notes: '', warehouse_id: s.warehouses[1].id, transport_id: transport, lines: [{ product_id: product.id, qty: 1, unit_cost: 1, sales_order_line_id: null }] })
    const mid = await loadSnapshot(db)
    const open = openLinesOnTransport(mid, transport)
    expect(open).toHaveLength(s.suppliers.length)
    await receiveGoods(db, { transport_id: transport, received_date: TODAY, delivery_note: '', received_by: '', notes: '', rows: open.map((l) => ({ shipment_line_id: l.id, warehouse_id: s.warehouses[1].id, qty_received: 1, qty_damaged: 0, location_bin: '' })) })
    const end = await loadSnapshot(db)
    expect(end.goods_receipts.filter((r) => r.transport_id === transport)).toHaveLength(1)
    expect(end.transports.find((t) => t.id === transport)!.status).toBe('arrived')
  })
})

describe('leverdatum bij deellevering', () => {
  it('schuift alleen wat nog geleverd moet worden', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    const id = await createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 2, warehouse_id: s.warehouses[1].id })] })
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const plan = (qty: number) => createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty }] })
    const first = await plan(1), second = await plan(1)
    await deliver(first)
    await rescheduleOrder(db, id, { new_date: '2026-12-20', reason: '', customer_notified: false })
    let after = await loadSnapshot(db)
    expect(after.deliveries.find((d) => d.id === first)).toMatchObject({ planned_date: TODAY, delivered_at: TODAY })
    expect(after.deliveries.find((d) => d.id === second)!.planned_date).toBe('2026-12-20')
    await expect(rescheduleDelivery(db, first, { new_date: '2026-12-25', reason: '', customer_notified: false })).rejects.toThrow(/geleverde levering/)
    await deliver(second)
    await expect(rescheduleOrder(db, id, { new_date: '2026-12-31', reason: '', customer_notified: false })).rejects.toThrow(/al geleverd/)
    after = await loadSnapshot(db)
    expect(after.sales_orders.find((o) => o.id === id)!.promised_date).toBe('2026-12-20')
  })
})

describe('verkoper', () => {
  it('is verplicht op een verkooporder', async () => {
    const s = await loadSnapshot(db)
    const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
    await expect(createOrder(db, { header: header(s.customers[0].id, { salesperson_id: '' }), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id })] })).rejects.toThrow(/verkoper/)
  })
})

describe('leveranciers', () => {
  it('blijven bewaard bij herstellen en oude namen worden omgezet', async () => {
    const before = await loadSnapshot(db)
    expect(before.suppliers.map((x) => x.name)).toContain('Life Outdoor Living International B.V.')
    const edited = before.suppliers.map((x) => ({ ...x, email: 'inkoop@voorbeeld.test' }))
    const extra = { ...edited[0], id: 'x', name: 'Derde leverancier' }
    db.clear(); await seedDemo(db, TODAY)
    await restoreSuppliers(db, [...edited, extra])
    const after = await loadSnapshot(db)
    expect(after.suppliers).toHaveLength(3)
    expect(after.suppliers.every((x) => x.email === 'inkoop@voorbeeld.test')).toBe(true)
    await db.update('suppliers', after.suppliers[0].id, { name: 'Noorderzon Outdoor', city: 'Zwolle' })
    await renameOldSuppliers(db)
    expect((await loadSnapshot(db)).suppliers[0]).toMatchObject({ name: 'Life Outdoor Living International B.V.', city: '' })
  })
})

describe('nummering', () => {
  it('gebruikt het ingestelde voorvoegsel, en de teller loopt door', async () => {
    const before = await loadSnapshot(db)
    const count = before.number_series.find((x) => x.id === 'IO-2026')!.last_number
    await saveSettings(db, { prefix_purchase: 'BELLA' })
    const id = await createPurchaseOrder(db, { supplier_id: before.suppliers[0].id, order_date: TODAY, supplier_reference: '', notes: '', lines: [{ product_id: before.products[0].id, qty: 1, unit_cost: 1, sales_order_line_id: null }], warehouse_id: before.warehouses[0].id })
    const after = await loadSnapshot(db)
    expect(after.purchase_orders.find((p) => p.id === id)!.number).toBe(`BELLA-2026-${String(count + 1).padStart(4, '0')}`)
    await expect(saveSettings(db, { prefix_invoice: 'F 1' })).rejects.toThrow(/voorvoegsel/)
  })
})

describe('route', () => {
  it('vindt de kortste ronde', () => {
    const line = [0, 3, 1, 2].map((x) => [0, 3, 1, 2].map((y) => Math.abs(x - y)))
    const order = optimizeRoute(line)
    expect(tourCost(line, order)).toBe(6)
    expect([...order].sort()).toEqual([1, 2, 3])
  })
  it('heuristiek bij veel stops levert elke stop één keer en is niet slechter dan de invoervolgorde', () => {
    const pts = Array.from({ length: 13 }, (_, i) => ({ latitude: 37.8 + ((i * 7) % 13) / 50, longitude: -0.8 + ((i * 5) % 13) / 50 }))
    const m = estimateMatrix(pts).km
    const order = optimizeRoute(m)
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(tourCost(m, order)).toBeLessThan(tourCost(m, Array.from({ length: 12 }, (_, i) => i + 1)))
  })
  it('asymmetrische rijtijden tellen in de goede richting', () => {
    const m = [[0, 1, 9], [9, 0, 1], [1, 9, 0]]
    expect(optimizeRoute(m)).toEqual([1, 2])
  })
  it('leest de routeservice en weigert onbereikbare punten', () => {
    expect(parseRouterTable({ code: 'Ok', durations: [[0, 120]], distances: [[0, 2000]] })).toMatchObject({ source: 'weg', minutes: [[0, 2]], km: [[0, 2]] })
    expect(parseRouterTable({ code: 'Ok', durations: [[0, null]], distances: [[0, 1]] })).toBeNull()
    expect(parseRouterTable({ code: 'NoRoute' })).toBeNull()
  })
  it('zet alle stops en de terugweg in de kaartlink', () => {
    const url = decodeURIComponent(googleMapsRouteUrl({ latitude: 1, longitude: 2 }, [{ latitude: 3, longitude: 4 }, { latitude: 5, longitude: 6 }]).replace(/\+/g, ' '))
    expect(url).toContain('origin=1,2'); expect(url).toContain('destination=1,2'); expect(url).toContain('waypoints=3,4|5,6')
  })
})

describe('factuur-QR', () => {
  it('bevat NIF, nummer, datum en totaal in het voorgeschreven formaat', () => {
    expect(invoiceQrUrl({ nif: ' b12345678 ', number: 'F-2026&1', date: '2026-11-05', total: 1234.5 }, true))
      .toBe('https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQRNoVerifactu?nif=B12345678&numserie=F-2026%261&fecha=05-11-2026&importe=1234.50')
    expect(invoiceQrUrl({ nif: 'B12345678', number: 'F-1', date: '2026-01-02', total: 10 }, false)).toContain('https://prewww2.aeat.es/')
  })
  it('herkent een ontbrekend CIF', () => {
    expect(hasTaxId('(CIF invullen in Beheer)')).toBe(false)
    expect(hasTaxId('B12345678')).toBe(true)
  })
})

describe('rapportage', () => {
  it('rekent de periodes uit', () => {
    expect(periodRange('maand', '2026-11-05')).toEqual({ from: '2026-11-01', to: '2026-11-05' })
    expect(periodRange('kwartaal', '2026-11-05')).toEqual({ from: '2026-08-05', to: '2026-11-05' })
    expect(periodRange('kwartaal', '2026-05-31')).toEqual({ from: '2026-02-28', to: '2026-05-31' })
    expect(periodRange('kwartaal', '2026-01-15')).toEqual({ from: '2025-10-15', to: '2026-01-15' })
    expect(periodRange('jaar', '2026-11-05')).toEqual({ from: '2026-01-01', to: '2026-11-05' })
    expect(periodRange('vrij', '2026-11-05', '2026-03-01', '2026-03-31')).toEqual({ from: '2026-03-01', to: '2026-03-31' })
  })
  it('factuuroverzicht filtert op factuurdatum, sorteert op nummer en telt op', async () => {
    const s = await loadSnapshot(db)
    expect(s.invoices.length).toBeGreaterThan(0)
    const dates = s.invoices.map((i) => i.invoice_date.slice(0, 10)).sort()
    const all = invoiceReport(s, '', '')
    expect(all.rows.length).toBe(s.invoices.length)
    expect(all.total).toBe(s.invoices.reduce((n, i) => Math.round((n + i.total) * 100) / 100, 0))
    expect(all.rows.map((r) => r.invoice.number)).toEqual([...s.invoices.map((i) => i.number)].sort())
    const oneDay = invoiceReport(s, dates[0], dates[0])
    expect(oneDay.rows.every((r) => r.invoice.invoice_date.slice(0, 10) === dates[0])).toBe(true)
    expect(invoiceReport(s, '1999-01-01', '1999-12-31')).toMatchObject({ rows: [], base: 0, vat: 0, total: 0 })
    expect(all.base + all.vat).toBeCloseTo(all.total, 2)
  })
})

describe('vertalingen', () => {
  it('het Spaans heeft dezelfde teksten en plaatshouders als het Engels', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort())
    const holes = (t: string) => [...new Set(t.match(/\{\d+\}/g) ?? [])].sort()
    for (const key of Object.keys(es)) expect(holes(es[key]), key).toEqual(holes(key))
  })
  it('heeft een Engelse tekst voor elke schermtekst', () => {
    const files = ['App.tsx', 'main.tsx', 'ui/kit.tsx', 'ui/app-context.tsx', 'domain/services.ts', ...readdirSync('src/screens').map((f) => `screens/${f}`)]
    const missing = files.flatMap((f) => [...readFileSync(`src/${f}`, 'utf8').matchAll(/\btx\(("(?:[^"\\\\]|\\\\.)*")/g)].map((m) => JSON.parse(m[1]) as string)).filter((k) => !(k in en))
    expect(missing).toEqual([])
  })
})

describe('database', () => {
  it('migratie en voorbeeldgegevens passen op Postgres, en de regels gelden daar ook', async () => {
    const pg = new PGlite()
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))

    const snap = await loadSnapshot(db)
    for (const t of TABLES) {
      const r = await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)
      expect(r.rows[0].n, t).toBe(snap[t].length)
    }
    // v_stock komt overeen met wat de app berekent.
    const view = await pg.query<{ product_id: string; warehouse_id: string; on_hand: number; reserved: number }>('select * from v_stock')
    const hand = onHandMap(snap), res = reservedMap(snap)
    for (const r of view.rows) {
      expect(r.on_hand).toBe(hand.get(stockKey(r.product_id, r.warehouse_id)) ?? 0)
      expect(r.reserved).toBe(res.get(stockKey(r.product_id, r.warehouse_id)) ?? 0)
    }
    // Nummering loopt door op de bestaande reeks.
    const series = snap.number_series.find((x) => x.id === 'F-2026')!
    const n = await pg.query<{ next_number: string }>(`select next_number('F', 2026)`)
    expect(n.rows[0].next_number).toBe(`F-2026-${String(series.last_number + 1).padStart(4, '0')}`)
    // Factuur wijzigen en terugdateren worden door de database geweigerd.
    await expect(pg.exec(`update invoices set total = 1`)).rejects.toThrow(/niet worden gewijzigd/)
    const inv = snap.invoices[0]
    await expect(pg.query(`insert into invoices (number, sales_order_id, customer_id, kind, invoice_date, due_date, base_amount, vat_amount, total) values ('X', $1, $2, 'volledig', '2000-01-01', '2000-01-01', 0, 0, 0)`, [inv.sales_order_id, inv.customer_id])).rejects.toThrow(/ligt voor/)
  })
})
