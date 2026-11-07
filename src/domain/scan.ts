// Scannen in de winkel (scan.bellaflow.es): mandje van gescande artikelen, voordat er een proforma van gemaakt wordt.
import type { CatalogArticle } from '../data/types'

export interface BasketRow { article: CatalogArticle; qty: number; price: number | null; noStock: boolean }

/** Hetzelfde artikel nog eens scannen telt op bij de bestaande regel. Een geaccepteerde voorraadwaarschuwing blijft staan. */
export function addToBasket(rows: BasketRow[], row: BasketRow): BasketRow[] {
  const i = rows.findIndex((r) => r.article.article_number === row.article.article_number)
  if (i < 0) return [row, ...rows]
  const merged = { ...rows[i], qty: rows[i].qty + row.qty, noStock: rows[i].noStock || row.noStock }
  return [merged, ...rows.filter((_, j) => j !== i)]
}

export const removeFromBasket = (rows: BasketRow[], articleNumber: string) => rows.filter((r) => r.article.article_number !== articleNumber)

/** Hoeveel er al in het mandje zit van dit artikel. */
export const inBasket = (rows: BasketRow[], articleNumber: string) => rows.find((r) => r.article.article_number === articleNumber)?.qty ?? 0

/**
 * Waarschuwing als er niet genoeg vrije voorraad is voor wat er nu gevraagd wordt, bovenop wat al in het mandje zit.
 * Null betekent: genoeg voorraad, geen waarschuwing.
 */
export function stockShortage(free: number, alreadyInBasket: number, qty: number) {
  const left = Math.max(0, free - alreadyInBasket)
  return qty <= left ? null : { free: left, short: qty - left }
}

/** Een eigen artikelnummer (LLL-CCC-0000000000) uit een scan, ook als de scanner kleine letters of spaties geeft. */
export function articleNumberFromScan(raw: string) {
  const code = raw.trim().replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{3}-[A-Z]{3}-\d{10}$/.test(code) ? code : null
}
