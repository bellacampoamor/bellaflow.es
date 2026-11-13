// Jaarafsluiting (opdracht Rick 13 november 2026). Het jaar in elk documentnummer komt uit het open boekjaar onder
// Instellingen, niet uit de datum. Pas de handmatige jaarafsluiting zet het boekjaar één verder; dan begint elke reeks
// weer bij 0001. De tellers per jaar (VO-2026, FS-2026, ...) blijven bestaan en de laatst gebruikte nummers liggen
// vast bij de afsluiting, zodat terugdraaien kan zolang het nieuwe jaar nog geen nummer heeft uitgegeven.
// Zuivere functies, zonder opslag. Het label van een reeks is een schermtekst (tx bij tonen).
import type { NumberSeries, Settings, YearClosing, YearClosingNumber } from '../data/types'
import { tx } from '../i18n'

/** Alle nummerreeksen: teller-id, voorvoegselveld in Instellingen en standaardvoorvoegsel. */
export const NUMBER_SERIES: { series: string; label: string; field?: keyof Settings; fallback: string }[] = [
  { series: 'VO', label: 'Verkooporders', field: 'prefix_sales_order', fallback: 'VO' },
  { series: 'PRO', label: "Proforma's verkooporder", fallback: 'PRO' },
  { series: 'IO', label: 'Inkooporders', field: 'prefix_purchase', fallback: 'IO' },
  { series: 'PIO', label: "Proforma's inkooporder", fallback: 'PIO' },
  { series: 'TR', label: 'Transporten', field: 'prefix_transport', fallback: 'TR' },
  { series: 'OV', label: 'Goederenontvangsten', field: 'prefix_receipt', fallback: 'OV' },
  { series: 'LV', label: 'Afleverbonnen', field: 'prefix_delivery', fallback: 'LV' },
  { series: 'PF', label: "Proforma's facturatie", field: 'prefix_proforma', fallback: 'PF' },
  { series: 'F', label: 'Facturen', field: 'prefix_invoice', fallback: 'F' },
  { series: 'FR', label: 'Creditfacturen', field: 'prefix_invoice_credit', fallback: 'FR' },
  { series: 'FS', label: 'Eenvoudige fact Bella', field: 'prefix_invoice_simplified', fallback: 'FS-BELLA' },
  { series: 'FSH', label: 'Eenvoudige fact HDB', field: 'prefix_invoice_simplified_hdb', fallback: 'FS-HDB' },
  { series: 'FRS', label: 'Creditfact kassa Bella', field: 'prefix_invoice_credit_simplified', fallback: 'FRS-BELLA' },
  { series: 'FRSH', label: 'Creditfact kassa HDB', field: 'prefix_invoice_credit_simplified_hdb', fallback: 'FRS-HDB' },
]

const yearOfIso = (iso: string) => Number(iso.slice(0, 4))

/** Het open boekjaar: uit Instellingen, anders (nog nooit ingesteld) het jaar van vandaag. */
export const openYear = (co: Pick<Settings, 'fiscal_year'> | undefined | null, today: string): number => co?.fiscal_year ?? yearOfIso(today)

/** Jaar in een nieuw documentnummer: het open boekjaar; zonder boekjaar het jaar van de datum (zoals vroeger). */
export const numberYear = (co: Pick<Settings, 'fiscal_year'> | undefined | null, dateYear: number): number => co?.fiscal_year ?? dateYear

/** Laatst gebruikte nummer per reeks in een jaar, met het volledige documentnummer zoals het nu zou luiden. */
export function lastNumbers(series: NumberSeries[], year: number, co: Partial<Settings> | undefined | null): YearClosingNumber[] {
  return NUMBER_SERIES.map(({ series: id, label, field, fallback }) => {
    const last = series.find((r) => r.id === `${id}-${year}`)?.last_number ?? 0
    const prefix = (field ? (co?.[field] as string | undefined) : '') || fallback
    return { series: id, label, last_number: last, last_document: last ? `${prefix}-${year}-${String(last).padStart(4, '0')}` : '' }
  })
}

/** Geldige afsluitingen (niet teruggedraaid), nieuwste eerst. */
export const activeClosings = (closings: YearClosing[]) =>
  closings.filter((c) => !c.rolled_back_at).sort((a, b) => b.year - a.year || b.closed_at.localeCompare(a.closed_at))

/** Waarom het open boekjaar (nog) niet afgesloten kan worden; null = het kan. */
export function closeBlocker(year: number, today: string): string | null {
  if (yearOfIso(today) <= year) return tx("Boekjaar {0} loopt nog. Afsluiten kan vanaf 1 januari {1}.", year, year + 1)
  return null
}

/** Waarom een afsluiting niet teruggedraaid kan worden; null = het kan. */
export function rollbackBlocker(closing: YearClosing, closings: YearClosing[], series: NumberSeries[], fiscalYear: number | null | undefined): string | null {
  if (closing.rolled_back_at) return tx("Deze afsluiting is al teruggedraaid.")
  if (activeClosings(closings)[0]?.id !== closing.id) return tx("Alleen de laatste jaarafsluiting kan worden teruggedraaid.")
  if (fiscalYear !== closing.year + 1) return tx("Het open boekjaar is niet {0}.", closing.year + 1)
  const used = series.filter((r) => r.id.endsWith(`-${closing.year + 1}`) && r.last_number > 0)
  if (used.length) return tx("In {0} zijn al nummers uitgegeven ({1}). Terugdraaien zou dubbele of ontbrekende nummers geven.", closing.year + 1, used.map((r) => r.id).join(', '))
  return null
}
