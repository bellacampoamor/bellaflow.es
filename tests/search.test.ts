import { beforeAll, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { Snapshot } from '../src/data/types'
import { seedDemo } from '../src/domain/demo'
import { fieldScore, fold, globalSearch, groupHits } from '../src/domain/search'
import { scrollTarget } from '../src/ui/nav'

let s: Snapshot
beforeAll(async () => {
  const db = new LocalDriver(false)
  await seedDemo(db, '2026-11-08')
  s = await loadSnapshot(db)
})

describe('Zoeken in alles', () => {
  it('vindt een verkooporder op nummer, ook zonder streepjes, als beste treffer', () => {
    const o = s.sales_orders.find((x) => x.status === 'open')!
    expect(globalSearch(s, o.number)[0]).toMatchObject({ kind: 'verkooporder', id: o.id, href: `orders-${o.id}` })
    expect(globalSearch(s, o.number.replace(/-/g, '').toLowerCase()).some((h) => h.id === o.id)).toBe(true)
  })
  it('vindt klanten op naam en telefoon, en de verkooporders en facturen van die klant', () => {
    const c = s.customers.find((x) => s.invoices.some((i) => i.customer_id === x.id) && x.name.length > 4)!
    const hits = globalSearch(s, c.name)
    expect(hits.some((h) => h.kind === 'klant' && h.id === c.id && h.href === `instellingen-klant-${c.id}`)).toBe(true)
    expect(hits.some((h) => h.kind === 'factuur')).toBe(true)
    expect(hits.some((h) => h.kind === 'verkooporder')).toBe(true)
    if (c.phone) expect(globalSearch(s, c.phone).some((h) => h.kind === 'klant' && h.id === c.id)).toBe(true)
  })
  it('vindt inkooporders op leverancier, en alle woorden moeten passen', () => {
    const p = s.purchase_orders[0]
    const sup = s.suppliers.find((x) => x.id === p.supplier_id)!
    expect(globalSearch(s, sup.name.split(' ')[0]).some((h) => h.kind === 'inkooporder' && h.id === p.id)).toBe(true)
    expect(globalSearch(s, `${sup.name.split(' ')[0]} xyzqq`)).toEqual([])
  })
  it('accenten en hoofdletters maken niet uit; minder dan twee tekens zoekt niet', () => {
    expect(fold('  Almoradí ')).toBe('almoradi')
    expect(fieldScore('Magazijn Almoradí', 'almoradi')).toBe(40)
    expect(fieldScore('VO-2026-0016', 'vo-2026-0016')).toBe(100)
    expect(globalSearch(s, 'v')).toEqual([])
  })
  it('groepeert per soort, de groep met de beste treffer eerst', () => {
    const inv = s.invoices[0]
    const groups = groupHits(globalSearch(s, inv.number))
    expect(groups[0].kind).toBe('factuur')
    expect(new Set(groups.map((g) => g.kind)).size).toBe(groups.length)
  })
})

describe('Scrollpositie bij Terug', () => {
  it('gaat terug naar de bewaarde plek, een nieuw scherm begint bovenaan', () => {
    expect(scrollTarget({ from: 'orders', scroll: 1840 })).toBe(1840)
    expect(scrollTarget({ from: 'orders' })).toBe(0)
    expect(scrollTarget(null)).toBe(0)
  })
})
