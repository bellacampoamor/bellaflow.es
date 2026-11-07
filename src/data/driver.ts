import { TABLES, type ArticleHit, type ArticleQuery, type CatalogArticle, type CatalogArticleElement, type EmailAttachment, type Snapshot, type TableName } from './types'

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

  // Catalogusartikelen met eigen artikelnummer. Niet in de Snapshot: de opslag zoekt zelf, zodat ook
  // honderdduizenden artikelen van tien leveranciers het scherm niet vertragen.
  /** Zoekt op eigen artikelnummer, artikelnummer van de leverancier, EAN, naam of serie. Alle woorden moeten voorkomen. */
  searchArticles(q: ArticleQuery): Promise<ArticleHit[]>
  /** Artikelen op id, of per leverancier op artikelnummer van de leverancier. */
  findArticles(f: { ids?: string[]; numbers?: string[]; supplierId?: string; skus?: string[] }): Promise<CatalogArticle[]>
  /** De elementen van een artikel, in de volgorde van de leverancier. */
  articleElements(parentId: string): Promise<ArticleHit[]>
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
}

export async function loadSnapshot(db: Driver): Promise<Snapshot> {
  const entries = await Promise.all(TABLES.map(async (t) => [t, await db.list(t)] as const))
  return Object.fromEntries(entries) as unknown as Snapshot
}

export const newId = (): string => crypto.randomUUID()
