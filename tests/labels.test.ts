import { describe, expect, it } from 'vitest'
import {
  adjustPrice, CODE128_PATTERNS, code128Modules, code128Values, DEFAULT_PRINTER, dymoJob, labelBasePrice, labelToRaster,
  parseLabelCommand, shortLabelName, singularQuery,
} from '../src/domain/labels'
import type { CatalogArticle, Product, Supplier } from '../src/data/types'

describe('etiketten: opdracht lezen', () => {
  it('leest categorie, percentage en afronding', () => {
    const c = parseLabelCommand('print alle tafels +10% afronden ,95')
    expect(c.query).toBe('tafels')
    expect(c.rule).toEqual({ pct: 10, rounding: '95' })
    expect(c.codes).toEqual([])
  })
  it('leest eigen artikelnummers, artikelnummers van de leverancier, EAN en aantal', () => {
    const c = parseLabelCommand('print etiketten voor LOL-TSE-0000000012 en 4-4071-B, 8719128567890 2x')
    expect(c.codes).toEqual(['LOL-TSE-0000000012', '4-4071-B', '8719128567890'])
    expect(c.qty).toBe(2)
    expect(c.query).toBe('')
  })
  it('herkent korting, hele euro’s en een testetiket', () => {
    expect(parseLabelCommand('serie Lisboa -15% afronden heel').rule).toEqual({ pct: -15, rounding: '00' })
    expect(parseLabelCommand('serie Lisboa -15%').query).toBe('Lisboa')
    expect(parseLabelCommand('testetiket').test).toBe(true)
    expect(parseLabelCommand('todas mesas +5% redondear ,99').rule).toEqual({ pct: 5, rounding: '99' })
  })
  it('zoekt in enkelvoud', () => {
    expect(singularQuery('tafels stoelen kussens')).toBe('tafel stoel kussen')
  })
})

describe('etiketten: prijs', () => {
  it('verhoogt en rondt naar boven af op ,95', () => {
    const rule = { pct: 10, rounding: '95' as const }
    expect(adjustPrice(149, rule)).toBe(163.95)
    expect(adjustPrice(224, rule)).toBe(246.95)
    expect(adjustPrice(1299, rule)).toBe(1428.95)
    expect(adjustPrice(99.96, { pct: 0, rounding: '95' })).toBe(100.95)
    expect(adjustPrice(100, { pct: 0, rounding: null })).toBe(100)
    expect(adjustPrice(100.2, { pct: 0, rounding: '00' })).toBe(101)
  })
  it('neemt de prijs van het product als het al eens verkocht is, anders de prijs van de leverancier met toeslag', () => {
    const a = { article_number: 'LOL-TSE-0000000001', supplier_id: 's1', price: 100 } as CatalogArticle
    const sup = [{ id: 's1', price_surcharge_pct: 20 } as Supplier]
    expect(labelBasePrice(a, [], sup)).toBe(120)
    expect(labelBasePrice(a, [{ catalog_article_number: 'LOL-TSE-0000000001', sale_price: 135 } as Product], sup)).toBe(135)
  })
  it('maakt een korte naam in hoofdletters zonder merknaam', () => {
    expect(shortLabelName('Life Outdoor Living Lisboa loungeset 4-delig (antraciet)', 'Life Outdoor Living International B.V.')).toBe('LISBOA LOUNGESET 4-DELIG')
    expect(shortLabelName('a'.repeat(30) + ' ' + 'b'.repeat(30)).length).toBeLessThanOrEqual(40)
  })
})

/** Leest de modules terug, als controle op het coderen. */
function decode(modules: boolean[]) {
  const widths: number[] = []
  let run = 1
  for (let i = 1; i <= modules.length; i++) {
    if (i < modules.length && modules[i] === modules[i - 1]) run++
    else { widths.push(run); run = 1 }
  }
  const values: number[] = []
  for (let i = 0; i < widths.length;) {
    const stop = widths.slice(i, i + 7).join('')
    if (stop === CODE128_PATTERNS[106]) { values.push(106); break }
    values.push(CODE128_PATTERNS.indexOf(widths.slice(i, i + 6).join('')))
    i += 6
  }
  return values
}

describe('etiketten: Code 128', () => {
  it('heeft 107 unieke patronen van 11 modules, stop 13', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    CODE128_PATTERNS.forEach((p, i) => expect([...p].reduce((n, d) => n + Number(d), 0), String(i)).toBe(i === 106 ? 13 : 11))
  })
  it('codeert een eigen artikelnummer compact, met kloppende controle', () => {
    const v = code128Values('LOL-TSE-0000000012')
    expect(v[0]).toBe(104) // start B
    expect(v).toContain(99) // overstap naar cijferset C
    const data = v.slice(0, -2)
    expect(v[v.length - 2]).toBe(data.reduce((s, x, k) => s + x * (k === 0 ? 1 : k), 0) % 103)
    const m = code128Modules('LOL-TSE-0000000012')
    expect(m.length).toBe(v.length * 11 + 2)
    expect(decode(m)).toEqual(v)
    // Terug naar tekst
    let set = 'B', out = ''
    for (const x of v.slice(1, -2)) {
      if (x === 99) { set = 'C'; continue }
      if (x === 100) { set = 'B'; continue }
      out += set === 'C' ? String(x).padStart(2, '0') : String.fromCharCode(x + 32)
    }
    expect(out).toBe('LOL-TSE-0000000012')
  })
  it('weigert tekens buiten ASCII', () => {
    expect(() => code128Values('ÄBC')).toThrow()
  })
})

describe('etiketten: DYMO-raster', () => {
  it('maakt per kolom één rasterregel over de breedte van de kop', () => {
    // 3 breed, 9 hoog; alleen linksboven zwart
    const bits = new Uint8Array(27); bits[0] = 1
    const r = labelToRaster(bits, 3, 9, { rotate180: false, mirror: false })
    expect(r.bytesPerLine).toBe(2)
    expect(r.lines).toHaveLength(3)
    expect([...r.lines[0]]).toEqual([0, 0x80]) // y = 0 komt op de laatste stip
    const turned = labelToRaster(bits, 3, 9, { rotate180: true, mirror: false })
    expect([...turned.lines[2]]).toEqual([0x80, 0])
  })
  it('bouwt een opdracht met regellengte, rasterregels en doorvoer', () => {
    const r = labelToRaster(new Uint8Array(16), 2, 8, { rotate180: false, mirror: false })
    const job = dymoJob([r, r], DEFAULT_PRINTER)
    expect([...job.slice(0, 2)]).toEqual([0x1b, 0x40])
    expect(job.filter((b, i) => b === 0x45 && job[i - 1] === 0x1b)).toHaveLength(2)
    expect(job.filter((b) => b === 0x16)).toHaveLength(4)
  })
})
