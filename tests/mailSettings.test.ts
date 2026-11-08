import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { EmailAttachment, Settings } from '../src/data/types'
import { seedDemo } from '../src/domain/demo'
import { settingsUpgrade } from '../src/domain/issuers'
import { MAIL_DEFAULTS, mailsAutomatically } from '../src/domain/mailSettings'
import { createDelivery, createOrder, lineFromProduct, mailSalesOrder, markReady, saveSettings, signDelivery } from '../src/domain/services'
import { toSeedSql } from '../scripts/seed-sql'

// Mailen per document onder Instellingen (besluit Rick 8 november 2026).
const TODAY = '2026-11-08'
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
let db: LocalDriver
let sent: EmailAttachment[]
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, TODAY)
  sent = []
  db.sendEmail = async (_id, a) => { sent.push(a); return 'sent' }
  await db.update('customers', db.data.customers[0].id, { email: 'klant@voorbeeld.test' })
})

const header = (customer_id: string) => ({
  customer_id, order_date: TODAY, channel: 'winkel' as const, salesperson_id: db.data.salespeople[0].id, customer_reference: '', order_type: 'bestelling' as const,
  fulfilment: 'bezorgen' as const, requested_date: null, promised_date: null, delivery_name: 'X', delivery_phone: '', delivery_address: 'Calle 1',
  delivery_postal_code: '', delivery_city: '', delivery_latitude: null, delivery_longitude: null, floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
})
const order = async (takeNow = false, opts = {}) => {
  const s = await loadSnapshot(db)
  const product = s.products.find((p) => p.sku === 'LIG-AL-WT')!
  return createOrder(db, { header: header(s.customers[0].id), lines: [lineFromProduct(product, { qty: 1, warehouse_id: s.warehouses[1].id, take_now: takeNow, unit_price: 121 })] }, opts)
}
const outbox = async () => (await loadSnapshot(db)).email_outbox
const set = (patch: Partial<Settings>) => saveSettings(db, patch)

describe('mailen per document', () => {
  it('heeft als standaard: facturen en getekende bon aan, verkooporder uit', () => {
    expect(MAIL_DEFAULTS).toEqual({ mail_sales_order: false, mail_invoice_simplified: true, mail_invoice: true, mail_signed_note: true })
    expect(mailsAutomatically({}, 'mail_invoice')).toBe(true)
    expect(mailsAutomatically({ mail_invoice: false }, 'mail_invoice')).toBe(false)
    expect(settingsUpgrade({ language_lists: 'nl' })).toMatchObject(MAIL_DEFAULTS)
    expect(settingsUpgrade({ ...MAIL_DEFAULTS, mail_invoice: false }).mail_invoice).toBeUndefined()
  })

  it('mailt de verkooporder alleen als dat aan staat, als pdf met prijzen', async () => {
    await order()
    expect((await outbox()).filter((m) => m.kind === 'verkooporder')).toHaveLength(0)
    await set({ mail_sales_order: true })
    const id = await order()
    const mail = (await outbox()).find((m) => m.kind === 'verkooporder' && m.sales_order_id === id)!
    expect(mail).toMatchObject({ to_email: 'klant@voorbeeld.test', bcc_email: 'winkel@voorbeeld.test', status: 'sent' })
    const o = (await loadSnapshot(db)).sales_orders.find((x) => x.id === id)!
    expect(sent[0].name).toContain(o.number)
    expect((await PDFDocument.load(Buffer.from(sent[0].base64, 'base64'))).getPageCount()).toBe(1)
    // Opnieuw mailen werkt dezelfde regel bij.
    expect(await mailSalesOrder(db, id, 'ander@voorbeeld.test')).toBe('sent')
    expect((await outbox()).filter((m) => m.kind === 'verkooporder' && m.sales_order_id === id)).toHaveLength(1)
  })

  it('mailt geen verkooporder bij afrekenen aan de kassa, wel de factuur', async () => {
    await set({ mail_sales_order: true })
    await order(true, { invoiceNow: true, invoiceEmail: 'klant@voorbeeld.test', invoiceDate: TODAY })
    expect((await outbox()).map((m) => m.kind)).toEqual(['factuur'])
  })

  it('mailt de factuur en de eenvoudige factuur niet als die uit staan', async () => {
    await set({ mail_invoice: false })
    await order(true, { invoiceNow: true, invoiceEmail: 'klant@voorbeeld.test', invoiceDate: TODAY })
    expect(await outbox()).toHaveLength(0)
    await order(true, { invoiceNow: true, invoiceEmail: 'klant@voorbeeld.test', invoiceDate: TODAY, simplified: true })
    expect(await outbox()).toHaveLength(1)
    await set({ mail_invoice_simplified: false })
    await order(true, { invoiceNow: true, invoiceEmail: 'klant@voorbeeld.test', invoiceDate: TODAY, simplified: true })
    expect(await outbox()).toHaveLength(1)
    // Een factuur wordt wel gemaakt.
    expect((await loadSnapshot(db)).invoices.length).toBeGreaterThanOrEqual(3)
  })

  it('mailt de getekende afleverbon niet als die uit staat; de levering wordt wel afgemeld', async () => {
    await set({ mail_signed_note: false })
    const id = await order()
    const line = (await loadSnapshot(db)).sales_order_lines.find((l) => l.sales_order_id === id)!
    const d = await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: TODAY, carrier: '', notes: '', lines: [{ sales_order_line_id: line.id, qty: 1 }] })
    await markReady(db, d, { approved_by: 'Magazijn', date: TODAY })
    expect(await signDelivery(db, d, { signature: PNG, signed_by: 'Klant', date: TODAY })).toBe('off')
    expect((await loadSnapshot(db)).deliveries.find((x) => x.id === d)!.status).toBe('delivered')
    expect(await outbox()).toHaveLength(0)
  })

  it('past in de database, ook een gemailde verkooporder', async () => {
    await set({ mail_sales_order: true, mail_invoice: false })
    await order()
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated; create role anon; create role service_role;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    expect((await pg.query<{ n: number }>("select count(*)::int as n from email_outbox where kind = 'verkooporder' and sales_order_id is not null")).rows[0].n).toBe(1)
    expect((await pg.query<{ v: boolean }>('select mail_invoice as v from settings')).rows[0].v).toBe(false)
    await expect(pg.exec("insert into email_outbox (kind, to_email, bcc_email, subject, body_text, status, error) values ('verkooporder', '', '', '', '', 'pending', '')")).rejects.toThrow()
  }, 60000)
})
