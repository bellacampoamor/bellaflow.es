import { describe, expect, it } from 'vitest'
import { isTransient, originFor } from '../src/ui/nav'
import { routeLabel } from '../src/ui/routeLabel'
import type { Snapshot } from '../src/data/types'

// Terug naar waar je vandaan kwam (besluit Rick 8 november 2026).
describe('terugknop: herkomst', () => {
  it('onthoudt het vorige scherm als herkomst', () => {
    expect(originFor('rapportage-kassa', 'facturatie-abc', {})).toEqual({ from: 'rapportage-kassa', direct: true })
  })
  it('formulieren en afdrukschermen tellen niet als herkomst', () => {
    // Verkooporders → Nieuwe verkooporder → opslaan → verkooporder: Terug gaat naar de lijst.
    const form = originFor('orders-lijst-alles', 'orders-nieuw', {})
    expect(originFor('orders-nieuw', 'orders-123', form)).toEqual({ from: 'orders-lijst-alles', direct: false })
    expect(isTransient('facturatie-print-abc')).toBe(true)
    expect(isTransient('facturatie-abc')).toBe(false)
  })
  it('geen herkomst als die naar het scherm zelf zou wijzen', () => {
    const form = originFor('orders-123', 'orders-wijzig-123', {})
    expect(originFor('orders-wijzig-123', 'orders-123', form)).toEqual({})
  })
})

describe('terugknop: naam van het scherm', () => {
  const s = { invoices: [{ id: 'i1', number: 'FS-BELLA-2026-0001' }], sales_orders: [{ id: 'o1', number: 'VO-2026-0016' }] } as unknown as Snapshot
  it('noemt het scherm of het document', () => {
    expect(routeLabel('rapportage-kassa', s)).toBe('Factuuroverzicht kassa')
    expect(routeLabel('archief', s)).toBe('Archief')
    expect(routeLabel('facturatie-i1', s)).toBe('FS-BELLA-2026-0001')
    expect(routeLabel('orders-o1', s)).toBe('VO-2026-0016')
    expect(routeLabel('orders-lijst-alles', s)).toBe('Verkooporders')
  })
})
