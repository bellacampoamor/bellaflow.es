// Verplichte eigenschappen bij bestellen. Sommige leveranciers (HA-CO) kennen geen losse subartikelen, maar keuzes die
// op de bestelregel ingevuld moeten worden, zoals Stofkleur of Pootkleur. Ze komen uit de catalogus van de leverancier
// en worden bewaard in de uitvoering (options) van de verkooporderregel, als "Stofkleur: Lambay Brown; Pootkleur: Zwart".
// De uitvoering gaat al mee naar inkooporder, verkooporder en factuur. Dit bestand bevat alleen rekenwerk.
import type { CatalogArticle, Snapshot, SupplierShowroomItem } from '../data/types'
import { sameName } from './catalog'

export const OPTION_SEPARATOR = '; '

/** Het catalogusartikel van de leverancier bij een artikel met eigen nummer. */
export function showroomItemForArticle(
  s: Pick<Snapshot, 'suppliers' | 'supplier_showroom_items'>,
  a: Pick<CatalogArticle, 'supplier_id' | 'supplier_sku'> | null | undefined,
): SupplierShowroomItem | undefined {
  if (!a) return undefined
  const sup = s.suppliers.find((x) => x.id === a.supplier_id)
  if (!sup) return undefined
  return s.supplier_showroom_items.find((x) => sameName(x.supplier_name, sup.name) && sameName(x.supplier_sku, a.supplier_sku))
}

/** De eigenschappen die bij bestellen ingevuld moeten worden, zonder dubbele namen. */
export function requiredProperties(item: Pick<SupplierShowroomItem, 'properties'> | undefined): string[] {
  const out: string[] = []
  for (const p of item?.properties ?? []) {
    const name = p.trim()
    if (name && !out.some((x) => sameName(x, name))) out.push(name)
  }
  return out
}

/** Splitst een uitvoering in de waarden per eigenschap en de overige vrije tekst. */
export function parseOptions(options: string, props: string[]) {
  const values: Record<string, string> = {}
  const rest: string[] = []
  // Alleen aan het begin bijsnijden: tijdens het typen moet een spatie tussen twee woorden blijven staan.
  for (const part of (options ?? '').split(';').map((x) => x.replace(/^\s+/, '')).filter((x) => x.trim())) {
    const i = part.indexOf(':')
    const label = i > 0 ? part.slice(0, i).trim() : ''
    const prop = label ? props.find((p) => sameName(p, label)) : undefined
    if (prop && !(prop in values)) values[prop] = part.slice(i + 1).replace(/^\s+/, '')
    else rest.push(part)
  }
  return { values, rest: rest.join(OPTION_SEPARATOR) }
}

/** Zet de waarden per eigenschap en de vrije tekst terug in één uitvoering, in de volgorde van de leverancier. */
export function formatOptions(values: Record<string, string>, props: string[], rest = '') {
  const parts = props.map((p) => [p, (values[p] ?? '').replace(/;/g, ',')] as const).filter(([, v]) => v.trim()).map(([p, v]) => `${p}: ${v}`)
  return [...parts, ...(rest.trim() ? [rest] : [])].join(OPTION_SEPARATOR)
}

/** Welke verplichte eigenschappen in de uitvoering nog ontbreken. */
export function missingProperties(options: string, props: string[]) {
  const { values } = parseOptions(options, props)
  return props.filter((p) => !(values[p] ?? '').trim())
}

/**
 * Andere uitvoeringen van hetzelfde artikel bij de leverancier: de parent en alle artikelen met dezelfde parent.
 * Bij HA-CO zijn dat bijvoorbeeld dezelfde kast in een andere breedte of kleur.
 */
export function variantsOf(items: SupplierShowroomItem[], item: SupplierShowroomItem) {
  const sameSup = (x: SupplierShowroomItem) => sameName(x.supplier_name, item.supplier_name)
  const root = item.parent_sku?.trim() || item.supplier_sku
  return items.filter((x) => sameSup(x) && x.id !== item.id && x.active !== false
    && (sameName(x.supplier_sku, root) || (!!x.parent_sku && sameName(x.parent_sku, root))))
}
