// Jaarafsluiting (opdracht Rick 13 november 2026): het jaar in elk nummer is het open boekjaar; pas de handmatige
// afsluiting laat alle reeksen weer bij 0001 beginnen. De laatste nummers liggen vast en terugdraaien kan zolang het
// nieuwe jaar nog geen nummer heeft uitgegeven.
import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { DUMMY_SKU, type PosLine } from '../src/domain/pos'
import { closeYear, posCheckout, rollbackYearClosing, saveSettings } from '../src/domain/services'
import { closeBlocker, lastNumbers, numberYear, openYear } from '../src/domain/yearClosing'

let db: LocalDriver
let seller = ''
beforeEach(async () => {
  db = new LocalDriver(false)
  await seedDemo(db, '2026-11-13')
  seller = db.data.salespeople[0].id
})

const line = (): PosLine => ({ key: newId(), code: DUMMY_SKU, dummy: true, description: 'Kussen (verzonnen)', qty: 1, unit_price: 10, discount_pct: 0, vat_rate: 21 })
const sell = (date: string, issuer: 'bella' | 'hdb' = 'hdb') =>
  posCheckout(db, { salesperson_id: seller, customer_id: null, date, lines: [line()], payment: { method: 'pin', reference: '' }, issuer })
const close = (today: string, extra: Partial<Parameters<typeof closeYear>[1]> = {}) =>
  closeYear(db, { year: 2026, confirm: '2026', closed_by: 'Voorbeeldbeheerder', today, ...extra })

describe('Jaarafsluiting', () => {
  it('het nummer volgt het open boekjaar, niet de datum', async () => {
    expect(db.data.settings[0].fiscal_year).toBe(2026)
    const r = await sell('2027-01-05')
    expect(r.invoiceNumber).toBe('FS-HDB-2026-0001')
    expect(numberYear({ fiscal_year: null }, 2027)).toBe(2027)
    expect(openYear({ fiscal_year: undefined }, '2026-03-01')).toBe(2026)
  })

  it('afsluiten kan pas vanaf 1 januari van het volgende jaar, en met het jaar ingetypt', async () => {
    expect(closeBlocker(2026, '2026-12-31')).not.toBeNull()
    expect(closeBlocker(2026, '2027-01-01')).toBeNull()
    await expect(close('2026-12-31')).rejects.toThrow(/loopt nog/)
    await expect(close('2027-01-02', { confirm: '2025' })).rejects.toThrow(/Typ 2026/)
    await expect(close('2027-01-02', { closed_by: ' ' })).rejects.toThrow(/wie/)
    await expect(close('2027-01-02', { year: 2025 })).rejects.toThrow(/open boekjaar is 2026/)
    expect(db.data.settings[0].fiscal_year).toBe(2026)
  })

  it('na afsluiten begint elke reeks weer bij 0001 en liggen de laatste nummers vast', async () => {
    await sell('2026-12-30'); await sell('2026-12-31'); await sell('2026-12-31', 'bella')
    const closing = await close('2027-01-02')
    expect(db.data.settings[0].fiscal_year).toBe(2027)
    const fsh = closing.last_numbers.find((n) => n.series === 'FSH')!
    expect(fsh).toMatchObject({ last_number: 2, last_document: 'FS-HDB-2026-0002' })
    expect(closing.last_numbers.find((n) => n.series === 'FS')!.last_document).toBe('FS-BELLA-2026-0001')
    expect(db.data.year_closings).toHaveLength(1)
    expect((await sell('2027-01-03')).invoiceNumber).toBe('FS-HDB-2027-0001')
    expect((await sell('2027-01-03', 'bella')).invoiceNumber).toBe('FS-BELLA-2027-0001')
    // De tellers van 2026 blijven bestaan.
    expect(lastNumbers(db.data.number_series, 2026, db.data.settings[0]).find((n) => n.series === 'FSH')!.last_number).toBe(2)
    await expect(close('2027-01-04')).rejects.toThrow(/open boekjaar is 2027/)
  })

  it('terugdraaien: boekjaar weer open en de nummers lopen door; niet meer als het nieuwe jaar al nummers heeft', async () => {
    await sell('2026-12-30')
    const closing = await close('2027-01-02')
    await expect(rollbackYearClosing(db, { id: closing.id, by: '' })).rejects.toThrow(/wie/)
    await rollbackYearClosing(db, { id: closing.id, by: 'Voorbeeldbeheerder' })
    expect(db.data.settings[0].fiscal_year).toBe(2026)
    expect(db.data.year_closings[0].rolled_back_at).not.toBeNull()
    expect((await sell('2027-01-03')).invoiceNumber).toBe('FS-HDB-2026-0002')

    const again = await close('2027-01-04')
    expect(again.last_numbers.find((n) => n.series === 'FSH')!.last_document).toBe('FS-HDB-2026-0002')
    await sell('2027-01-05')
    await expect(rollbackYearClosing(db, { id: again.id, by: 'Voorbeeldbeheerder' })).rejects.toThrow(/al nummers uitgegeven/)
    expect(db.data.settings[0].fiscal_year).toBe(2027)
  })

  it('Opslaan onder Instellingen wijzigt het boekjaar nooit', async () => {
    await saveSettings(db, { fiscal_year: 2030, company_name: 'Bella Outdoor and Furnishing' })
    expect(db.data.settings[0].fiscal_year).toBe(2026)
  })
})
