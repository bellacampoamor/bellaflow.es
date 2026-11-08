import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot, newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { cashCount, countedTotal, kassaDay, openingFloat } from '../src/domain/cashClosing'
import { closeCashDay, posCheckout } from '../src/domain/services'
import { DUMMY_SKU, type PosLine } from '../src/domain/pos'
import { toSeedSql } from '../scripts/seed-sql'

const DAY = '2026-11-08'
const NEXT = '2026-11-09'
let db: LocalDriver
let seller = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, DAY)
  seller = db.data.salespeople.find((p) => p.is_active)!.id
})

const dummy = (price: number): PosLine => ({ key: newId(), dummy: true, code: DUMMY_SKU, description: 'Kussen', qty: 1, unit_price: price, discount_pct: 0, vat_rate: 21 })
const sell = (price: number, method: 'pin' | 'contant', issuer: 'bella' | 'hdb' = 'bella', date = DAY) =>
  posCheckout(db, { salesperson_id: seller, customer_id: null, date, lines: [dummy(price)], payment: { method, reference: '' }, issuer })

describe('Dagafsluiting en kasopmaak', () => {
  it('telt per bedrijf apart: contant, pin en de eenvoudige facturen van de dag', async () => {
    await sell(50, 'contant')
    await sell(30.5, 'pin')
    await sell(20, 'contant', 'hdb')
    const s = await loadSnapshot(db)
    const bella = kassaDay(s, 'bella', DAY)
    expect(bella.count).toBe(2)
    expect(bella.cash).toBeCloseTo(50)
    expect(bella.card).toBeCloseTo(30.5)
    expect(bella.total).toBeCloseTo(80.5)
    expect(bella.first.startsWith('FS-BELLA')).toBe(true)
    const hdb = kassaDay(s, 'hdb', DAY)
    expect(hdb.count).toBe(1)
    expect(hdb.cash).toBeCloseTo(20)
    expect(hdb.card).toBe(0)
  })

  it('rekent verwacht, geteld, verschil en wisselgeld', () => {
    expect(countedTotal({ '50': 2, '0.2': 3, '0.01': 1 })).toBeCloseTo(100.61)
    const r = cashCount({ opening: 100, cash: 50, counted: 149.5, deposited: 100, card: 30, cardTerminal: 30 })
    expect(r.expected).toBe(150)
    expect(r.difference).toBe(-0.5)
    expect(r.kept).toBe(49.5)
    expect(r.cardDifference).toBe(0)
  })

  it('sluit de dag af, en het wisselgeld wordt het beginsaldo van de volgende dag', async () => {
    await sell(50, 'contant')
    await closeCashDay(db, { issuer: 'bella', date: DAY, salesperson_id: seller, counts: { '50': 1, '20': 5 }, deposited: 0, card_terminal: null, note: 'Wisselgeld 100 erbij gelegd', today: DAY })
    let s = await loadSnapshot(db)
    const c = s.cash_closings[0]
    expect(c.expected_cash).toBe(50)
    expect(c.counted_cash).toBe(150)
    expect(c.difference).toBe(100)
    expect(c.kept_in_drawer).toBe(150)
    expect(openingFloat(s, 'bella', NEXT)).toBe(150)
    expect(openingFloat(s, 'hdb', NEXT)).toBe(0)
    // Volgende dag: 150 beginsaldo + 30 contant = 180; alles klopt, 100 afgestort.
    await sell(30, 'contant', 'bella', NEXT)
    await closeCashDay(db, { issuer: 'bella', date: NEXT, salesperson_id: seller, counts: { '100': 1, '50': 1, '20': 1, '10': 1 }, deposited: 100, card_terminal: 0, note: '', today: NEXT })
    s = await loadSnapshot(db)
    const d = s.cash_closings.find((x) => x.business_date === NEXT)!
    expect(d.opening_float).toBe(150)
    expect(d.difference).toBe(0)
    expect(d.kept_in_drawer).toBe(80)
  })

  it('weigert: dubbel afsluiten, een verschil zonder toelichting, meer afstorten dan geteld, toekomst, een eerdere dag na een latere', async () => {
    await sell(50, 'contant')
    const base = { issuer: 'bella' as const, date: DAY, salesperson_id: seller, card_terminal: null, today: DAY }
    await expect(closeCashDay(db, { ...base, counts: { '20': 2 }, deposited: 0, note: '' })).rejects.toThrow(/verschil/)
    await expect(closeCashDay(db, { ...base, counts: { '50': 1 }, deposited: 60, note: '' })).rejects.toThrow(/afstorten/)
    await expect(closeCashDay(db, { ...base, counts: { '50': 1 }, deposited: 0, note: '', salesperson_id: '' })).rejects.toThrow(/opgemaakt/)
    await expect(closeCashDay(db, { ...base, date: NEXT, counts: {}, deposited: 0, note: '' })).rejects.toThrow(/toekomst/)
    await expect(closeCashDay(db, { ...base, counts: { '50': 1 }, deposited: 0, card_terminal: 10, note: '' })).rejects.toThrow(/verschil/)
    expect(db.data.cash_closings).toHaveLength(0)
    await closeCashDay(db, { ...base, counts: { '50': 1 }, deposited: 0, note: '' })
    await expect(closeCashDay(db, { ...base, counts: { '50': 1 }, deposited: 0, note: '' })).rejects.toThrow(/al afgesloten/)
    await expect(closeCashDay(db, { ...base, date: '2026-11-07', counts: {}, deposited: 0, note: '' })).rejects.toThrow(/latere dag/)
    // HDB staat er los van.
    await closeCashDay(db, { ...base, issuer: 'hdb', counts: {}, deposited: 0, note: '' })
    expect(db.data.cash_closings).toHaveLength(2)
  })

  it('de database accepteert de afsluiting en bewaakt de regels (migratie)', async () => {
    await sell(50, 'contant')
    await closeCashDay(db, { issuer: 'bella', date: DAY, salesperson_id: seller, counts: { '50': 1 }, deposited: 0, card_terminal: null, note: '', today: DAY })
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated;')
    await pg.exec(readdirSync('supabase/migrations').sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(toSeedSql(await loadSnapshot(db)))
    const row = (await pg.query<{ n: number; counted: string }>('select count(*)::int as n, max(counted_cash)::text as counted from cash_closings')).rows[0]
    expect(row.n).toBe(1)
    expect(Number(row.counted)).toBe(50)
    // Tweede afsluiting voor dezelfde dag en hetzelfde bedrijf, en een verschil zonder toelichting: geweigerd.
    await expect(pg.exec(`insert into cash_closings (issuer, business_date, salesperson_id) values ('bella', '${DAY}', '${seller}')`)).rejects.toThrow(/unique|duplicate/i)
    await expect(pg.exec(`insert into cash_closings (issuer, business_date, salesperson_id, difference) values ('hdb', '${DAY}', '${seller}', 5)`)).rejects.toThrow(/check/i)
  }, 60_000)
})
