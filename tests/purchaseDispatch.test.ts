import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { dispatchesOf, isDispatched, PURCHASE_JSON_FORMAT, purchaseJsonFileName, purchaseOrdersOfDay } from '../src/domain/purchaseExport'
import { purchaseJsonFiles, sendPurchaseOrders } from '../src/domain/services'
import { toSeedSql } from '../scripts/seed-sql'

const TODAY = '2026-11-04'
let db: LocalDriver
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY) })

/** Een dag met definitieve inkooporders, bij voorkeur van twee leveranciers. */
async function dayWithOrders() {
  const s = await loadSnapshot(db)
  const days = [...new Set(s.purchase_orders.filter((p) => p.status === 'open').map((p) => p.order_date))]
  const day = days.sort((a, b) => new Set(purchaseOrdersOfDay(s, b).map((p) => p.supplier_id)).size - new Set(purchaseOrdersOfDay(s, a).map((p) => p.supplier_id)).size)[0]
  const pos = purchaseOrdersOfDay(s, day)
  expect(pos.length).toBeGreaterThan(0)
  return { s, day, pos }
}

describe('inkooporders afdrukken en versturen', () => {
  it('per dag alleen definitieve inkooporders, geen proforma of geannuleerde', async () => {
    const s = await loadSnapshot(db)
    for (const day of new Set(s.purchase_orders.map((p) => p.order_date))) {
      for (const po of purchaseOrdersOfDay(s, day)) { expect(po.status).toBe('open'); expect(po.order_date).toBe(day) }
    }
  })

  it('JSON per leverancier met regels en zonder klantgegevens', async () => {
    const { s, day, pos } = await dayWithOrders()
    const files = await purchaseJsonFiles(db, day, pos.map((p) => p.id))
    expect(files.length).toBe(new Set(pos.map((p) => p.supplier_id)).size)
    for (const f of files) {
      const j = JSON.parse(f.json)
      expect(j).toMatchObject({ format: PURCHASE_JSON_FORMAT, version: 1, date: day, currency: 'EUR' })
      expect(f.fileName).toBe(purchaseJsonFileName(s.suppliers.find((x) => x.id === f.supplierId), day))
      expect(j.purchase_orders.map((p: { number: string }) => p.number)).toEqual(f.ids.map((id) => s.purchase_orders.find((p) => p.id === id)!.number))
      for (const p of j.purchase_orders) {
        const lines = s.purchase_order_lines.filter((l) => l.purchase_order_id === s.purchase_orders.find((x) => x.number === p.number)!.id)
        expect(p.lines).toHaveLength(lines.length)
        expect(p.total_excl_vat).toBeCloseTo(lines.reduce((n, l) => n + l.qty * l.unit_cost, 0), 2)
      }
      for (const c of s.customers) { if (c.name) expect(f.json).not.toContain(c.name); if (c.email) expect(f.json).not.toContain(c.email) }
    }
  })

  it('versturen mailt per leverancier één JSON en logt dat op elke inkooporder', async () => {
    const { s, day, pos } = await dayWithOrders()
    const to = Object.fromEntries([...new Set(pos.map((p) => p.supplier_id))].map((sid) => [sid, `inkoop-${sid.slice(0, 4)}@voorbeeld.test`]))
    const results = await sendPurchaseOrders(db, { date: day, ids: pos.map((p) => p.id), to })
    expect(results.every((r) => r.status === 'demo')).toBe(true)
    const after = await loadSnapshot(db)
    const mails = after.email_outbox.filter((m) => m.kind === 'inkooporders')
    expect(mails).toHaveLength(Object.keys(to).length)
    for (const po of pos) {
      const log = dispatchesOf(after, po.id)
      expect(log).toHaveLength(1)
      expect(log[0]).toMatchObject({ channel: 'json_mail', dispatch_date: day, to_email: to[po.supplier_id], status: 'demo', file_name: purchaseJsonFileName(s.suppliers.find((x) => x.id === po.supplier_id), day) })
      expect(isDispatched(after, po.id)).toBe(true)
    }
    // Opnieuw versturen komt als nieuwe regel in het log.
    await sendPurchaseOrders(db, { date: day, ids: [pos[0].id], to })
    expect(dispatchesOf(await loadSnapshot(db), pos[0].id)).toHaveLength(2)
  })

  it('zonder adres wordt niets verstuurd, maar wel gelogd; een ongeldig adres weigert alles', async () => {
    const { day, pos } = await dayWithOrders()
    const po = pos[0]
    await expect(sendPurchaseOrders(db, { date: day, ids: [po.id], to: { [po.supplier_id]: 'geen-adres' } })).rejects.toThrow()
    expect((await loadSnapshot(db)).purchase_order_dispatches).toHaveLength(0)
    const [r] = await sendPurchaseOrders(db, { date: day, ids: [po.id], to: { [po.supplier_id]: '' } })
    expect(r.status).toBe('no_recipient')
    const after = await loadSnapshot(db)
    expect(dispatchesOf(after, po.id)).toMatchObject([{ status: 'no_recipient', to_email: '' }])
    expect(isDispatched(after, po.id)).toBe(false)
  })

  it('een proforma-inkooporder kan niet worden verstuurd', async () => {
    const s = await loadSnapshot(db)
    const po = s.purchase_orders.find((p) => p.status === 'open')!
    await db.update('purchase_orders', po.id, { status: 'proforma' })
    await expect(sendPurchaseOrders(db, { date: po.order_date, ids: [po.id] })).rejects.toThrow(/geen definitieve inkooporder/)
  })

  it('de database accepteert de mail en het log (migratie)', async () => {
    const { day, pos } = await dayWithOrders()
    await sendPurchaseOrders(db, { date: day, ids: pos.map((p) => p.id), to: Object.fromEntries(pos.map((p) => [p.supplier_id, 'inkoop@voorbeeld.test'])) })
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const n = (await pg.query<{ n: number }>('select count(*)::int as n from purchase_order_dispatches')).rows[0].n
    expect(n).toBe(pos.length)
    await expect(pg.exec("insert into email_outbox (id, kind, to_email, bcc_email, subject, body_text, status, error) values (gen_random_uuid(), 'factuur', '', '', '', '', 'pending', '')")).rejects.toThrow(/email_outbox_kind_check/)
  })
})
