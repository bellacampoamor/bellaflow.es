// Kassa met twee bedrijven: een factura simplificada komt van Bella Outdoor and Furnishing of van
// Handmade Bali Treasures SL (HomeDecoBali, HDB). HDB valt buiten de boekhouding van Bella.
import type { Invoice, Language, ListLanguage, Settings } from '../data/types'
import { MAIL_DEFAULTS } from './mailSettings'

export type Issuer = 'bella' | 'hdb'
export const ISSUERS: Issuer[] = ['bella', 'hdb']

/** Standaardgegevens van HDB, zoals Rick ze opgaf (8 november 2026). Onder Beheer te wijzigen. */
export const HDB_DEFAULTS = {
  hdb_company_name: 'Handmade Bali Treasures SL',
  hdb_trade_name: 'HomeDecoBali',
  hdb_tax_id: 'B05730825',
  hdb_address: 'Avd de Constitución s/n',
  hdb_postal_code: '03179',
  hdb_city: 'Formentera del Segura',
  hdb_province: 'ALC',
  hdb_country: 'Spain',
  hdb_phone: '',
  hdb_email: '',
  logo_hdb: 'assets/brand/hdb-logo.png',
  mark_hdb: 'assets/brand/hdb-beeldmerk.png',
} as const

/** Standaardlogo's van Bella (aangeleverd door Rick, 8 november 2026). Een upload onder Instellingen gaat voor. */
export const BELLA_DEFAULTS = {
  logo_bella: 'assets/brand/bella-logo.png',
  mark_bella: 'assets/brand/bella-beeldmerk.png',
} as const

/** Nummerreeks per bedrijf: eigen teller en eigen voorvoegsel onder Instellingen. */
export const ISSUER_SERIES = {
  bella: { series: 'FS', field: 'prefix_invoice_simplified', fallback: 'FS-BELLA' },
  hdb: { series: 'FSH', field: 'prefix_invoice_simplified_hdb', fallback: 'FS-HDB' },
} as const

export interface IssuerInfo {
  key: Issuer; name: string; short: string; tax_id: string; address: string; postal_code: string; city: string
  province: string; country: string; phone: string; email: string
  /** Logo linksboven op de factuur en klein beeldmerk onderaan: data-URL (upload) of pad in public/. Leeg = geen. */
  logo: string; mark: string
}

/** Naam op documenten en in klantmails: de handelsnaam, anders de juridische naam (besluit Rick 10 november 2026). */
export const tradeName = (co: Pick<Settings, 'company_name' | 'trade_name'> | undefined | null): string =>
  co?.trade_name?.trim() || co?.company_name || ''

export const issuerOf = (inv: Pick<Invoice, 'issuer'> | undefined | null): Issuer => (inv?.issuer === 'hdb' ? 'hdb' : 'bella')

/** De gegevens van het bedrijf dat de factuur uitgeeft. */
export function issuerInfo(co: Settings | undefined, key: Issuer): IssuerInfo {
  if (key === 'hdb') {
    const v = <K extends keyof typeof HDB_DEFAULTS>(k: K) => (co?.[k] ?? HDB_DEFAULTS[k]) as string
    return {
      key, name: v('hdb_company_name'), short: 'HDB', tax_id: v('hdb_tax_id'), address: v('hdb_address'), postal_code: v('hdb_postal_code'), city: v('hdb_city'),
      province: v('hdb_province'), country: v('hdb_country'), phone: v('hdb_phone'), email: v('hdb_email'), logo: v('logo_hdb'), mark: v('mark_hdb'),
    }
  }
  return {
    key, name: co?.company_name ?? '', short: 'Bella', tax_id: co?.tax_id ?? '', address: co?.address ?? '', postal_code: co?.postal_code ?? '', city: co?.city ?? '',
    province: co?.province ?? '', country: 'España', phone: co?.phone ?? '', email: co?.email ?? '', logo: co?.logo_bella ?? BELLA_DEFAULTS.logo_bella, mark: co?.mark_bella ?? BELLA_DEFAULTS.mark_bella,
  }
}

/** Juridische regel onderaan: naam, adres, postcode, plaats (provincie), land, CIF. */
export function legalLine(i: IssuerInfo) {
  const place = [i.postal_code, i.city ? `${i.city}${i.province ? ` (${i.province})` : ''}` : ''].filter(Boolean).join(', ')
  return [i.name, i.address, place, i.country, i.tax_id ? `CIF: ${i.tax_id}` : ''].filter((x) => x && x.trim()).join(', ')
}

/** Afbeelding uit Beheer: een upload (data-URL) staat er zelf in, een standaardlogo is een pad in public/. */
export const imageSrc = (src: string, base = '') => (!src ? '' : /^(data:|https?:|\/)/.test(src) ? src : `${base}${src}`)

/** Ontbrekende instellingen voor de kassa met twee bedrijven, met hun standaardwaarde. */
export function settingsUpgrade(co: Partial<Settings>): Partial<Settings> {
  const patch: Partial<Settings> = {}
  // Het eerste voorvoegsel van vanochtend (FS) wordt FS-BELLA (besluit Rick 8 november 2026).
  if (!co.prefix_invoice_simplified || co.prefix_invoice_simplified === 'FS') patch.prefix_invoice_simplified = 'FS-BELLA'
  if (co.prefix_invoice_simplified_hdb === undefined) patch.prefix_invoice_simplified_hdb = 'FS-HDB'
  // Creditfacturen (facturas rectificativas): elk een eigen reeks (8 november 2026).
  if (co.prefix_invoice_credit === undefined) patch.prefix_invoice_credit = 'FR'
  if (co.prefix_invoice_credit_simplified === undefined) patch.prefix_invoice_credit_simplified = 'FRS-BELLA'
  if (co.prefix_invoice_credit_simplified_hdb === undefined) patch.prefix_invoice_credit_simplified_hdb = 'FRS-HDB'
  if (co.language_invoice_simplified === undefined) patch.language_invoice_simplified = 'es'
  // Afdrukformaat van de eenvoudige factuur (9 november 2026): standaard A4, zoals tot nu toe.
  if (co.print_invoice_simplified === undefined) patch.print_invoice_simplified = 'a4'
  // Lijsten volgen voortaan de schermtaal, tenzij er bewust een vaste taal gekozen wordt (besluit Rick 8 november 2026).
  if (co.language_lists === undefined) patch.language_lists = 'scherm'
  // Mailen per document (8 november 2026): ontbreekt de keuze, dan de standaard.
  for (const [k, v] of Object.entries(MAIL_DEFAULTS)) if ((co as Record<string, unknown>)[k] === undefined) (patch as Record<string, unknown>)[k] = v
  // Nog nooit een logo voor Bella ingesteld: de aangeleverde logo's. Bewust verwijderd (leeg) blijft leeg.
  for (const [k, v] of Object.entries(BELLA_DEFAULTS)) if ((co as Record<string, unknown>)[k] === undefined) (patch as Record<string, unknown>)[k] = v
  for (const [k, v] of Object.entries(HDB_DEFAULTS)) if ((co as Record<string, unknown>)[k] === undefined) (patch as Record<string, unknown>)[k] = v
  return patch
}

/** Taal van een lijst: met 'scherm' (of niets ingesteld) de schermtaal, anders de vaste taal uit Instellingen. */
export const listLanguage = (setting: ListLanguage | undefined | null, screen: Language): Language => (!setting || setting === 'scherm' ? screen : setting)
