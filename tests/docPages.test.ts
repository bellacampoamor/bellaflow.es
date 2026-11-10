import { describe, expect, it } from 'vitest'
import { pageLabel, paginateRows, type PageLayout } from '../src/domain/docPages'

// Besluit Rick (9 november 2026): vervolgblad met subtotaal en transport, "Pagina x van y",
// totalen alleen op het laatste blad en nooit zonder regel.
const layout = (rows: number[], over: Partial<PageLayout> = {}): PageLayout =>
  ({ rows, first: 500, next: 700, carry: 20, brought: 20, totals: 120, ...over })
const fits = (l: PageLayout, pages: ReturnType<typeof paginateRows>) => pages.every((p, i) => {
  const rows = l.rows.slice(p.start, p.end).reduce((a, b) => a + b, 0)
  const avail = i === 0 ? l.first : l.next - l.brought
  return rows + (p.carry === null ? l.totals : l.carry) <= avail
})

describe('Factuur over meerdere A4-bladen', () => {
  it('past alles op één blad, dan één blad zonder subtotaal', () => {
    const l = layout(Array(10).fill(30))
    const pages = paginateRows(l, Array(10).fill(10))
    expect(pages).toEqual([{ start: 0, end: 10, brought: 0, carry: null }])
  })

  it('zonder regels één blad', () => {
    expect(paginateRows(layout([]), [])).toEqual([{ start: 0, end: 0, brought: 0, carry: null }])
  })

  it('meerdere bladen: subtotaal onderaan, hetzelfde bedrag als transport bovenaan het volgende blad', () => {
    const l = layout(Array(40).fill(30))
    const pages = paginateRows(l, Array(40).fill(12.5))
    expect(pages.length).toBe(3)
    expect(pages.map((p) => [p.start, p.end])).toEqual([[0, 16], [16, 38], [38, 40]])
    expect(pages[0]).toMatchObject({ brought: 0, carry: 200 })
    expect(pages[1]).toMatchObject({ brought: 200, carry: 475 })
    expect(pages[2]).toMatchObject({ brought: 475, carry: null })
    // Elke regel staat precies één keer op een blad.
    expect(pages.flatMap((p) => Array.from({ length: p.end - p.start }, (_, k) => p.start + k))).toEqual(Array.from({ length: 40 }, (_, k) => k))
    expect(fits(l, pages)).toBe(true)
  })

  it('geen blad loopt over, ook met verschillende regelhoogtes', () => {
    const rows = Array.from({ length: 90 }, (_, k) => 18 + ((k * 7) % 5) * 9)
    const l = layout(rows)
    expect(fits(l, paginateRows(l, rows.map(() => 1)))).toBe(true)
  })

  it('de totalen staan nooit alleen: de laatste regel gaat mee naar het laatste blad', () => {
    // 16 regels passen met het subtotaal, maar niet met de totalen.
    const l = layout(Array(16).fill(30))
    const pages = paginateRows(l, Array(16).fill(1))
    expect(pages.length).toBe(2)
    expect(pages[1].end - pages[1].start).toBeGreaterThanOrEqual(1)
    expect(pages[1].carry).toBeNull()
  })

  it('subtotalen worden op centen afgerond', () => {
    const pages = paginateRows(layout(Array(30).fill(30)), Array(30).fill(0.1))
    expect(pages[0].carry).toBe(1.6)
    expect(pages[1].brought).toBe(1.6)
  })

  it('een te hoge regel blijft niet hangen', () => {
    const pages = paginateRows(layout([30, 900, 30]), [1, 1, 1])
    expect(pages[pages.length - 1].end).toBe(3)
    expect(pages.length).toBeLessThan(6)
  })

  it('paginanummer in de taal van het document', () => {
    expect(pageLabel('nl', 1, 3)).toBe('Pagina 1 van 3')
    expect(pageLabel('es', 2, 3)).toBe('Página 2 de 3')
    expect(pageLabel('en', 3, 3)).toBe('Page 3 of 3')
  })
})
