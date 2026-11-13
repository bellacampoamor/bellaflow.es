import { OPTIONAL_TABLES, TABLES, type ArticleHit, type ArticleQuery, type CatalogArticle, type CatalogListItem, type CatalogListPage, type CatalogListQuery, type CatalogArticleElement, type EmailAttachment, type Snapshot, type TableName } from './types'

// De enige plek waar de app met opslag praat. Schermen en bedrijfslogica kennen alleen dit contract,
// dus overstappen van browseropslag naar Supabase raakt geen enkel scherm.
export interface Driver {
  list<T extends TableName>(table: T): Promise<Snapshot[T]>
  insert<T extends TableName>(table: T, rows: Snapshot[T][number][]): Promise<void>
  /** Voegt toe of overschrijft op id, in één keer. Voor grote aantallen, zoals een catalogus. */
  upsert<T extends TableName>(table: T, rows: Snapshot[T][number][]): Promise<void>
  update<T extends TableName>(table: T, id: string, patch: Partial<Snapshot[T][number]>): Promise<void>
  remove(table: TableName, id: string): Promise<void>
  /** Geeft bijvoorbeeld 'F-2026-0007'. */
  nextNumber(series: string, year: number): Promise<string>
  /** Verstuurt een mail uit de wachtrij. 'demo' betekent dat deze opslag niet kan mailen. */
  sendEmail(id: string, attachment: EmailAttachment): Promise<'sent' | 'demo'>
  /**
   * Zet kassaverkopen van HDB uit de wachtrij hdb_shopify_orders in Shopify (edge function hdb-shopify).
   * Lege lijst = alles wat nog wacht of mislukt is. 'demo' betekent dat deze opslag niet met Shopify praat.
   */
  pushShopifyOrders(ids: string[]): Promise<'sent' | 'demo'>

  // Catalogusartikelen met eigen artikelnummer. Niet in de Snapshot: de opslag zoekt zelf, zodat ook
  // honderdduizenden artikelen van tien leveranciers het scherm niet vertragen.
  /** Zoekt op eigen artikelnummer, artikelnummer van de leverancier, EAN, naam of serie. Alle woorden moeten voorkomen. */
  searchArticles(q: ArticleQuery): Promise<ArticleHit[]>
  /** De actieve artikelen van één leverancier, per pagina, gesorteerd op naam. Voor het scherm Catalogi. */
  listArticles(f: CatalogListQuery): Promise<CatalogListPage>
  /** Artikelen op id, of per leverancier op artikelnummer van de leverancier. */
  /** skuPrefix: alle artikelen (ook inactief) waarvan het artikelnummer leverancier zo begint, zoals een batch (FU2602 vindt FU26020010). */
  findArticles(f: { ids?: string[]; numbers?: string[]; supplierId?: string; skus?: string[]; skuPrefix?: string; limit?: number }): Promise<CatalogArticle[]>
  /** De elementen van een artikel, in de volgorde van de leverancier. */
  articleElements(parentId: string): Promise<ArticleHit[]>
  /** De actieve varianten van een verzamelartikel, op naam. */
  articleVariants(parentId: string): Promise<CatalogListItem[]>
  /** Het artikel of de artikelen waar dit artikel element van is. */
  articleParents(elementId: string): Promise<CatalogArticle[]>
  /** Aantal actieve artikelen per leverancier, voor de keuze in welke catalogi gezocht wordt. */
  articleCounts(): Promise<{ supplier_id: string; n: number }[]>
  /** Alle artikelen en koppelingen, voor het bijwerken na inlezen. */
  articleIndex(): Promise<{ articles: CatalogArticle[]; links: CatalogArticleElement[] }>
  /** Voegt toe of werkt bij op id. Een toegekend artikelnummer wijzigt nooit. Koppelingen worden alleen toegevoegd. */
  saveArticles(articles: CatalogArticle[], links: CatalogArticleElement[]): Promise<void>
  /** Reserveert een blok volgnummers en geeft het eerste. */
  reserveArticleNumbers(count: number): Promise<number>
  /**
   * Testperiode: wist alle documenten en bewegingen (verkoop, kassa, inkoop, transport, ontvangst, betalingen, voorraad,
   * dagafsluitingen, producten, tellers) en optioneel de klanten. Geeft per soort het aantal gewiste rijen.
   */
  wipeTestData(by: string, customers: boolean): Promise<Record<string, number>>
}

export async function loadSnapshot(db: Driver): Promise<Snapshot> {
  const entries = await Promise.all(TABLES.map(async (t) => [t, OPTIONAL_TABLES.has(t) ? await db.list(t).catch(() => []) : await db.list(t)] as const))
  return Object.fromEntries(entries) as unknown as Snapshot
}

export const newId = (): string => crypto.randomUUID()
