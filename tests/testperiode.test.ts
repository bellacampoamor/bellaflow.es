// Testperiode (opdracht Rick 13 november 2026): tot Bella Flow live gaat kan alles wat tijdens het testen ontstond
// gewist worden, ook de voorraadmutaties en de producten (de voorraad is daarna echt leeg); elke reeks begint weer
// bij 0001. Live zetten sluit dat af.
import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot, newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { DUMMY_SKU, POS_CUSTOMER_NOTE, type PosLine } from '../src/domain/pos'
import { goLive, posCheckout, saveSettings, wipeTestData } from '../src/domain/services'
import { toSeedSql } from '../scripts/seed-sql'

const TODAY = '2026-11-13'
let db: LocalDriver
let seller = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, TODAY)
  seller = db.data.salespeople[0].id
})

const line = (): PosLine => ({ key: newId(), code: DUMMY_SKU, dummy: true, description: 'Kussen (verzonnen)', qty: 1, unit_price: 10, discount_pct: 0, vat_rate: 21 })
const sell = (issuer: 'bella' | 'hdb' = 'hdb') =>
  posCheckout(db, { salesperson_id: seller, customer_id: null, date: TODAY, lines: [line()], payment: { method: 'pin', reference: '' }, issuer })

describe('Testperiode', () => {
  it('wist alle documenten, voorraadmutaties en producten; daarna begint elke reeks weer bij 0001', async () => {
    await sell(); await sell(); await sell('bella')
    expect(db.data.stock_movements.length).toBeGreaterThan(0)
    await expect(wipeTestData(db, { confirm: 'wis', by: 'Voorbeeldbeheerder', customers: false })).rejects.toThrow(/WISSEN/)
    await expect(wipeTestData(db, { confirm: 'WISSEN', by: ' ', customers: false })).rejects.toThrow(/wie/)
    const customers = db.data.customers.length
    const n = await wipeTestData(db, { confirm: 'wissen', by: 'Voorbeeldbeheerder', customers: false })
    expect(n.facturen).toBeGreaterThan(0)
    for (const t of ['sales_orders', 'invoices', 'payments', 'deliveries', 'purchase_orders', 'transports', 'goods_receipts', 'stock_movements', 'products', 'number_series', 'cash_closings'] as const) {
      expect(db.data[t]).toHaveLength(0)
    }
    expect(db.data.customers).toHaveLength(customers)
    expect(db.data.settings[0].test_wiped_by).toBe('Voorbeeldbeheerder')
    expect((await sell()).invoiceNumber).toBe('FS-HDB-2026-0001')
  })

  it('klanten wissen is een keuze; de vaste klant Kassaverkoop blijft', async () => {
    await sell()
    await wipeTestData(db, { confirm: 'WISSEN', by: 'Voorbeeldbeheerder', customers: true })
    expect(db.data.customers.every((c) => c.notes === POS_CUSTOMER_NOTE)).toBe(true)
  })

  it('na live zetten kan wissen niet meer; Opslaan verandert live niet', async () => {
    await expect(goLive(db, { confirm: 'live?', date: TODAY })).rejects.toThrow(/LIVE/)
    await saveSettings(db, { live_since: '2026-01-01' })
    expect(db.data.settings[0].live_since ?? null).toBeNull()
    await goLive(db, { confirm: 'LIVE', date: TODAY })
    expect(db.data.settings[0].live_since).toBe(TODAY)
    await sell()
    await expect(wipeTestData(db, { confirm: 'WISSEN', by: 'Voorbeeldbeheerder', customers: false })).rejects.toThrow(/live/)
    await expect(goLive(db, { confirm: 'LIVE', date: TODAY })).rejects.toThrow(/al live/)
    expect(db.data.invoices.length).toBeGreaterThan(0)
  })

  it('de database wist met de functie ook facturen en zet de factuurbeveiliging weer aan (migratie)', async () => {
    await sell(); await sell('bella')
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const count = async (t: string) => (await pg.query<{ n: number }>(`select count(*)::int as n from ${t}`)).rows[0].n
    expect(await count('invoices')).toBeGreaterThan(0)
    // Zonder de functie blijft een factuur onwijzigbaar.
    await expect(pg.exec('delete from invoices')).rejects.toThrow(/gewijzigd of verwijderd/)
    const r = (await pg.query<{ v: Record<string, number> }>(`select public.wipe_test_data('Voorbeeldbeheerder', false) as v`)).rows[0].v
    expect(r.facturen).toBeGreaterThan(0)
    for (const t of ['invoices', 'sales_orders', 'payments', 'stock_movements', 'products', 'number_series', 'deliveries']) expect(await count(t)).toBe(0)
    expect((await pg.query<{ e: string }>(`select tgenabled::text as e from pg_trigger where tgname = 'invoices_guard'`)).rows[0].e).toBe('O')
    // Live: de functie weigert.
    await pg.exec(`update settings set live_since = '${TODAY}'`)
    await expect(pg.query(`select public.wipe_test_data('Voorbeeldbeheerder', false)`)).rejects.toThrow(/live/)
  }, 60_000)
})
