// Prijsetiketten voor de DYMO LabelWriter 450 Turbo (etiket 30321, 89 x 36 mm).
// Hier staat alleen rekenwerk: opdracht lezen, verkorte naam, prijsaanpassing en de Code 128-streepjescode.
// Tekenen en versturen naar de printer zitten in src/ui/labelPrint.ts.
import type { CatalogArticle, Product, Supplier } from '../data/types'
import { priceWithSurcharge } from './articles'

export const LABEL_MM = { width: 89, height: 36 } as const
export const LABEL_DPI = 300
export const MAX_LABEL_ROWS = 100

export type Rounding = '95' | '99' | '50' | '00'
export interface PriceRule { pct: number; rounding: Rounding | null }

export interface LabelCommand {
  /** Artikelnummers, artikelnummers van de leverancier of EAN's die letterlijk zijn genoemd. */
  codes: string[]
  /** Overige zoekwoorden, zoals een categorie of serie ("alle tafels", "serie Lisboa"). */
  query: string
  rule: PriceRule
  /** Aantal etiketten per artikel, als dat is genoemd ("2x", "3 stuks"). */
  qty: number | null
  test: boolean
}

const FILLER = new Set([
  // Nederlands
  'print', 'printen', 'print', 'druk', 'af', 'afdrukken', 'maak', 'alle', 'al', 'de', 'het', 'een', 'van', 'voor', 'en', 'met', 'zonder',
  'etiket', 'etiketten', 'label', 'labels', 'prijs', 'prijzen', 'prijsetiket', 'prijsetiketten', 'artikel', 'artikelen', 'artikelnummer',
  'artikelnummers', 'verhogen', 'verlagen', 'verhoogd', 'erbij', 'plus', 'min', 'graag', 'aub', 'svp', 'ook', 'nog', 'op', 'serie',
  'categorie', 'uit', 'stuks', 'stuk', 'keer', 'x', 'afronden', 'afgerond', 'rond', 'af', 'korting', 'per', 'in', 'alles',
  // Engels
  'please', 'all', 'the', 'for', 'of', 'and', 'with', 'price', 'prices', 'labels', 'items', 'item', 'round', 'rounded', 'to', 'series', 'category', 'pcs', 'times',
  // Spaans
  'imprime', 'imprimir', 'todas', 'todos', 'las', 'los', 'el', 'la', 'del', 'para', 'con', 'etiqueta', 'etiquetas', 'precio', 'precios', 'redondear', 'redondeado', 'serie', 'y', 'uds', 'unidades',
])

const OWN_NUMBER = /\b[A-Z]{3}-[A-Z]{3}-\d{10}\b/gi
/** Een code bevat cijfers en is minstens vier tekens: 12345, 4-4071-B, 8712345678906. Geen bedrag of percentage. */
const looksLikeCode = (w: string) => w.length >= 4 && /\d/.test(w) && /^[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]$/.test(w) && !/^\d+[.,]\d{1,2}$/.test(w)

/** Leest een opdracht in gewone taal, zoals "alle tafels +10% afronden ,95" of "LOL-TSE-0000000012 2x". */
export function parseLabelCommand(input: string): LabelCommand {
  let t = ` ${input.trim()} `
  const test = /\b(test|testetiket|test label|etiqueta de prueba)\b/i.test(t)

  let pct = 0
  const p = t.match(/([+-]|\bplus\b|\bmin\b|\bminus\b|\bmenos\b|\bkorting\b|\bdescuento\b|\bdiscount\b)?\s*(\d+(?:[.,]\d+)?)\s*%/i)
  if (p) {
    const sign = !p[1] || /^(\+|plus)$/i.test(p[1]) ? 1 : -1
    pct = sign * Number(p[2].replace(',', '.'))
    t = t.replace(p[0], ' ')
  }

  let rounding: Rounding | null = null
  const r = t.match(/\b(?:afronden|afgerond|rond(?:\s+af)?|round(?:ed)?|redondea(?:r|do)?)\b(?:\s*(?:op|naar|to|a))?\s*(?:[.,]?\s*(95|99|50|00)\b|(hele?\s+euro'?s?|heel|whole|entero))?/i)
  if (r) {
    rounding = (r[1] as Rounding) ?? (r[2] ? '00' : '95')
    t = t.replace(r[0], ' ')
  } else {
    const end = t.match(/\s[.,](95|99|50|00)\b/)
    if (end) { rounding = end[1] as Rounding; t = t.replace(end[0], ' ') }
  }

  let qty: number | null = null
  const q = t.match(/\b(\d{1,3})\s*(?:x|×|stuks|stuk|keer|etiketten|labels|uds|unidades|pcs|times)\b|\b(?:x|×)\s*(\d{1,3})\b/i)
  if (q) { qty = Number(q[1] ?? q[2]); t = t.replace(q[0], ' ') }

  const codes: string[] = []
  for (const m of t.matchAll(OWN_NUMBER)) codes.push(m[0].toUpperCase())
  t = t.replace(OWN_NUMBER, ' ')

  const words: string[] = []
  for (const raw of t.split(/[\s,;]+/)) {
    const w = raw.replace(/^["'(]+|["'):.!?]+$/g, '')
    if (!w) continue
    if (looksLikeCode(w)) codes.push(w)
    else if (!FILLER.has(w.toLowerCase()) && !/^\d+$/.test(w)) words.push(w)
  }
  return { codes: [...new Set(codes)], query: test ? '' : words.join(' '), rule: { pct, rounding }, qty, test }
}

/** Zoekwoorden in enkelvoud, zodat "tafels" ook "tuintafel" vindt en "stoelen" ook "stoel". */
export function singularQuery(query: string) {
  return query.split(/\s+/).filter(Boolean).map((w) => {
    const l = w.toLowerCase()
    if (l.length > 5 && l.endsWith('en')) return l.slice(0, -2)
    if (l.length > 4 && l.endsWith('s')) return l.slice(0, -1)
    return l
  }).join(' ')
}

/** Past de regel toe op een prijs: eerst het percentage, dan afronden naar boven op de gekozen eindcijfers. */
export function adjustPrice(price: number, rule: PriceRule) {
  let v = Math.round(price * (1 + rule.pct / 100) * 100) / 100
  if (rule.rounding) {
    const end = Number(rule.rounding) / 100
    const cents = Math.round(v * 100)
    const whole = Math.floor(cents / 100)
    const target = Math.round((whole + end) * 100)
    v = (target >= cents ? target : Math.round((whole + 1 + end) * 100)) / 100
  }
  return v
}

/** Omschrijving van de regel, voor in de printlijst. */
export const ruleIsEmpty = (rule: PriceRule) => !rule.pct && !rule.rounding

/** Verkoopprijs voor het etiket: de prijs van het product als het al eens verkocht is, anders de prijs van de leverancier met toeslag. */
export function labelBasePrice(article: CatalogArticle, products: Product[], suppliers: Supplier[]) {
  const product = products.find((x) => x.catalog_article_number === article.article_number)
  if (product) return product.sale_price
  return priceWithSurcharge(article.price, suppliers.find((x) => x.id === article.supplier_id))
}

/** Verkorte naam in hoofdletters, maximaal 40 tekens en op een heel woord afgebroken. Merk- en vulwoorden vallen weg. */
export function shortLabelName(name: string, supplierName = '') {
  const drop = new Set(['life', 'outdoor', 'living', 'ha-co', 'haco', 'tuinmeubelen', 'tuinmeubel', 'outdoorliving', ...supplierName.toLowerCase().split(/\s+/).filter((w) => w.length > 2)])
  const words = name.replace(/\([^)]*\)/g, ' ').replace(/[|]/g, ' ').split(/\s+/).filter(Boolean).filter((w) => !drop.has(w.toLowerCase().replace(/[^\p{L}-]/gu, '')))
  let out = ''
  for (const w of words) {
    const next = out ? `${out} ${w}` : w
    if (next.length > 40) break
    out = next
  }
  return (out || name.slice(0, 40)).toUpperCase().trim()
}

// Code 128 ---------------------------------------------------------------------------------------------
// Breedtes van streep, spatie, streep, ... per teken (waarde 0 t/m 106). Elk teken is 11 modules, stop 13.
const CODE128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
export const CODE128_PATTERNS = CODE128
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106

/** Tekenwaarden van Code 128 (B voor tekst, C voor reeksen van minstens vier cijfers), inclusief start, controle en stop. */
export function code128Values(text: string): number[] {
  if (!text || /[^\x20-\x7e]/.test(text)) throw new Error('Alleen gewone tekens passen in een streepjescode.')
  const vals: number[] = []
  let i = 0
  let set: 'B' | 'C' | null = null
  const digitsAt = (k: number) => { let n = 0; while (k + n < text.length && /\d/.test(text[k + n])) n++; return n }
  while (i < text.length) {
    const run = digitsAt(i)
    const useC = run >= 4 && (i + run === text.length || run >= 6 || i === 0)
    if (useC) {
      const even = run - (run % 2)
      if (set !== 'C') { vals.push(set === null ? START_C : CODE_C); set = 'C' }
      for (let k = 0; k < even; k += 2) vals.push(Number(text.slice(i + k, i + k + 2)))
      i += even
    } else {
      if (set !== 'B') { vals.push(set === null ? START_B : CODE_B); set = 'B' }
      vals.push(text.charCodeAt(i) - 32)
      i++
    }
  }
  const check = vals.reduce((sum, v, k) => sum + v * (k === 0 ? 1 : k), 0) % 103
  return [...vals, check, STOP]
}

/** De modules van de streepjescode: true is zwart. Zonder rustzone. */
export function code128Modules(text: string): boolean[] {
  const out: boolean[] = []
  for (const v of code128Values(text)) {
    [...CODE128[v]].forEach((w, k) => { for (let n = 0; n < Number(w); n++) out.push(k % 2 === 0) })
  }
  return out
}

// DYMO LabelWriter 450 -----------------------------------------------------------------------------------
// Rasteropdrachten volgens de LabelWriter 450 Series Technical Reference: per rasterregel SYN plus de bytes,
// ESC D voor het aantal bytes per regel, ESC B voor de verschuiving over de printkop en ESC E voor door naar het volgende etiket.
export const DYMO_VENDOR_ID = 0x0922
export const PRINTHEAD_DOTS = 672

export interface PrinterSettings {
  /** Verschuiving over de printkop in mm (ESC B). */
  offsetMm: number
  /** Etiket 180 graden draaien als het ondersteboven uit de printer komt. */
  rotate180: boolean
  /** Spiegelen over de breedte, als de tekst in spiegelbeeld uit de printer komt. */
  mirror: boolean
  /** Donkerte: licht, normaal of donker. */
  density: 'light' | 'normal' | 'dark'
}
export const DEFAULT_PRINTER: PrinterSettings = { offsetMm: 0, rotate180: false, mirror: false, density: 'normal' }

/**
 * Zet een etiket (zwart-wit, liggend, rij voor rij van boven naar beneden) om naar rasterregels voor de printer.
 * De printer drukt in de lengterichting: elke kolom van het liggende etiket wordt één rasterregel over de breedte van de kop.
 */
export function labelToRaster(bits: Uint8Array, width: number, height: number, opts: { rotate180: boolean; mirror: boolean }) {
  const { rotate180, mirror } = opts
  const bytesPerLine = Math.ceil(height / 8)
  const lines: Uint8Array[] = []
  for (let n = 0; n < width; n++) {
    const x = rotate180 ? width - 1 - n : n
    const line = new Uint8Array(bytesPerLine)
    for (let k = 0; k < height; k++) {
      const flip = rotate180 !== mirror
      const y = flip ? k : height - 1 - k
      if (bits[y * width + x]) line[k >> 3] |= 0x80 >> (k & 7)
    }
    lines.push(line)
  }
  return { bytesPerLine, lines }
}

/** Volledige opdracht voor een of meer etiketten. */
export function dymoJob(labels: { bytesPerLine: number; lines: Uint8Array[] }[], settings: PrinterSettings) {
  const ESC = 0x1b, SYN = 0x16
  const parts: number[] = []
  const dotTab = Math.max(0, Math.min(PRINTHEAD_DOTS / 8 - 1, Math.round((settings.offsetMm / 25.4) * LABEL_DPI / 8)))
  parts.push(ESC, 0x40) // reset
  parts.push(ESC, { light: 0x63, normal: 0x65, dark: 0x67 }[settings.density]) // donkerte
  parts.push(ESC, 0x68) // tekstkwaliteit 300 x 300 dpi
  parts.push(ESC, 0x42, dotTab)
  for (const label of labels) {
    parts.push(ESC, 0x44, label.bytesPerLine)
    parts.push(ESC, 0x4c, (label.lines.length >> 8) & 0xff, label.lines.length & 0xff)
    for (const line of label.lines) { parts.push(SYN); for (const b of line) parts.push(b) }
    parts.push(ESC, 0x45) // door naar het begin van het volgende etiket
  }
  return new Uint8Array(parts)
}
