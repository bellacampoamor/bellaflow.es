import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { addDays, deliveryIsOpen, invoiceBalance } from '../src/domain/calc'
import { seedDemo } from '../src/domain/demo'
import { overview } from '../src/domain/overview'

const TODAY = '2026-11-04'
let db: LocalDriver
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, TODAY) })

describe('Overzicht', () => {
  it('zet wat te laat is vooraan en toont alleen acties met een aantal', async () => {
    const s = await loadSnapshot(db)
    const o = overview(s, TODAY)
    expect(o.actions.every((a) => a.n > 0)).toBe(true)
    const firstNormal = o.actions.findIndex((a) => !a.urgent)
    if (firstNormal >= 0) expect(o.actions.slice(firstNormal).some((a) => a.urgent)).toBe(false)
  })

  it('groepeert leveringen: alles van vóór vandaag als één groep te laat, daarna per dag voor 7 dagen', async () => {
    const s = await loadSnapshot(db)
    const later = addDays(TODAY, 3)
    const o = overview(s, later)
    const open = s.deliveries.filter(deliveryIsOpen)
    const late = open.filter((d) => d.planned_date < later)
    if (late.length) {
      expect(o.delivery.days[0].late).toBe(true)
      expect(o.delivery.days[0].deliveries).toHaveLength(late.length)
      expect(o.actions.find((a) => a.key === 'lev-laat')?.n).toBe(late.length)
    }
    for (const d of o.delivery.days.filter((x) => !x.late)) {
      expect(d.date >= later && d.date <= addDays(later, 6)).toBe(true)
      expect(d.deliveries.every((x) => x.planned_date === d.date)).toBe(true)
    }
    const shown = o.delivery.days.reduce((n, d) => n + d.deliveries.length, 0)
    expect(shown + o.delivery.later).toBe(open.length)
  })

  it('telt geld: open op facturen, vervallen en gefactureerd deze maand', async () => {
    const s = await loadSnapshot(db)
    const o = overview(s, TODAY)
    const open = s.invoices.reduce((n, i) => n + Math.max(0, invoiceBalance(s, i)), 0)
    expect(o.money.receivable).toBeCloseTo(open, 2)
    expect(o.money.overdue).toBeLessThanOrEqual(o.money.receivable)
    const month = s.invoices.filter((i) => i.invoice_date.startsWith(TODAY.slice(0, 7)) && i.invoice_date <= TODAY)
    expect(o.money.invoicesMonth).toBe(month.length)
  })

  it('vat proforma-inkooporders samen per leverancier', async () => {
    const s = await loadSnapshot(db)
    const o = overview(s, TODAY)
    const pro = s.purchase_orders.filter((p) => p.status === 'proforma')
    expect(o.purchase.proformaBySupplier.reduce((n, x) => n + x.proformas, 0)).toBe(pro.length)
    expect(new Set(o.purchase.proformaBySupplier.map((x) => x.supplierId)).size).toBe(o.purchase.proformaBySupplier.length)
  })
})
