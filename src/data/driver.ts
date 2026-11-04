import { TABLES, type Snapshot, type TableName } from './types'

// De enige plek waar de app met opslag praat. Schermen en bedrijfslogica kennen alleen dit contract,
// dus overstappen van browseropslag naar Supabase raakt geen enkel scherm.
export interface Driver {
  list<T extends TableName>(table: T): Promise<Snapshot[T]>
  insert<T extends TableName>(table: T, rows: Snapshot[T][number][]): Promise<void>
  update<T extends TableName>(table: T, id: string, patch: Partial<Snapshot[T][number]>): Promise<void>
  remove(table: TableName, id: string): Promise<void>
  /** Geeft bijvoorbeeld 'F-2026-0007'. */
  nextNumber(series: string, year: number): Promise<string>
}

export async function loadSnapshot(db: Driver): Promise<Snapshot> {
  const entries = await Promise.all(TABLES.map(async (t) => [t, await db.list(t)] as const))
  return Object.fromEntries(entries) as unknown as Snapshot
}

export const newId = (): string => crypto.randomUUID()
