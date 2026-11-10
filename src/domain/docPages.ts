// Factuur over meerdere A4-bladen (besluit Rick 9 november 2026).
// Past een factuur niet op één A4, dan komt er een vervolgblad. Onderaan elk blad behalve het laatste staat
// een subtotaal, dat bovenaan het volgende blad als transport terugkomt. Op elk blad "Pagina x van y".
// Totalen staan alleen op het laatste blad, en altijd samen met minstens de laatste regel.
// Eén regel voor het scherm (gemeten in de browser) en voor de pdf (gemeten met pdf-lib).
import type { Language } from '../data/types'

export const PAGE_TEXT: Record<Language, { carry: string; brought: string; page: string }> = {
  nl: { carry: 'Subtotaal, transport naar volgende pagina', brought: 'Transport van vorige pagina', page: 'Pagina {0} van {1}' },
  es: { carry: 'Suma y sigue', brought: 'Suma anterior', page: 'Página {0} de {1}' },
  en: { carry: 'Subtotal carried forward', brought: 'Brought forward', page: 'Page {0} of {1}' },
}

/** "Pagina 2 van 3" in de taal van het document (paginanummers vanaf 1). */
export const pageLabel = (language: Language, page: number, pages: number) =>
  PAGE_TEXT[language].page.replace('{0}', String(page)).replace('{1}', String(pages))

export interface PageLayout {
  /** Hoogte van elke regel, in dezelfde eenheid als de rest (px op het scherm, pt in de pdf). */
  rows: number[]
  /** Ruimte voor regels op het eerste blad: blad min kop, klant en kolomkoppen. */
  first: number
  /** Ruimte voor regels op een vervolgblad: blad min korte kop en kolomkoppen. */
  next: number
  /** Regel "Subtotaal, transport naar volgende pagina" onderaan een blad. */
  carry: number
  /** Regel "Transport van vorige pagina" bovenaan een vervolgblad. */
  brought: number
  /** Totalen en betaalregel na de laatste regel. */
  totals: number
}

export interface DocPage {
  /** Eerste en (exclusief) laatste regel op dit blad. */
  start: number
  end: number
  /** Transport van vorige pagina (0 op het eerste blad). */
  brought: number
  /** Subtotaal tot en met dit blad; null op het laatste blad. */
  carry: number | null
}

const sum = (xs: number[], a: number, b: number) => { let n = 0; for (let i = a; i < b; i++) n += xs[i]; return n }
const cents = (n: number) => Math.round(n * 100) / 100

/**
 * Verdeelt de regels over bladen. `amounts` zijn de regeltotalen (incl. IVA) voor subtotaal en transport.
 * Een regel die hoger is dan een heel blad komt toch op een eigen blad (hij loopt dan over, maar blijft niet hangen).
 */
export function paginateRows(layout: PageLayout, amounts: number[]): DocPage[] {
  const { rows, carry, brought, totals } = layout
  const n = rows.length
  const ranges: [number, number][] = []
  let i = 0
  while (true) {
    const isFirst = ranges.length === 0
    const avail = isFirst ? layout.first : layout.next - brought
    // Past de rest samen met de totalen, dan is dit het laatste blad.
    if (sum(rows, i, n) + totals <= avail) { ranges.push([i, n]); break }
    // Anders zoveel regels als er passen met ruimte voor het subtotaal.
    let k = 0, used = 0
    while (i + k < n && used + rows[i + k] + carry <= avail) { used += rows[i + k]; k++ }
    // Passen alle regels wel, maar de totalen niet: de laatste regel gaat mee naar het volgende blad,
    // zodat de totalen nooit alleen staan.
    if (i + k === n) k = Math.max(0, k - 1)
    // Een te hoge regel op een leeg vervolgblad: toch plaatsen, anders loopt het nooit af.
    if (k === 0 && !isFirst) k = 1
    if (i + k === n) { ranges.push([i, n]); break }
    ranges.push([i, i + k])
    i += k
  }
  let running = 0
  return ranges.map(([start, end], p) => {
    const before = running
    running = cents(running + sum(amounts, start, end))
    return { start, end, brought: p === 0 ? 0 : before, carry: p === ranges.length - 1 ? null : running }
  })
}
