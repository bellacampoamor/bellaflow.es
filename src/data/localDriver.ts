import type { Driver } from './driver'
import { TABLES, type EmailAttachment, type Snapshot, type TableName } from './types'

const KEY = 'bella-flow-v1'

export function emptySnapshot(): Snapshot {
  return Object.fromEntries(TABLES.map((t) => [t, []])) as unknown as Snapshot
}

/** Bewaart alles in de browser. Als opslag geblokkeerd is, blijft het in het geheugen werken. */
export class LocalDriver implements Driver {
  data: Snapshot
  constructor(private persist = true) {
    this.data = emptySnapshot()
    if (persist) {
      try {
        const raw = localStorage.getItem(KEY)
        if (raw) this.data = { ...this.data, ...JSON.parse(raw) }
      } catch { /* geheugen volstaat */ }
    }
  }
  get isEmpty() { return this.data.settings.length === 0 }
  private save() {
    if (!this.persist) return
    try { localStorage.setItem(KEY, JSON.stringify(this.data)) } catch { /* geheugen volstaat */ }
  }
  clear() { this.data = emptySnapshot(); this.save() }
  async list<T extends TableName>(table: T) {
    return structuredClone(this.data[table]) as Snapshot[T]
  }
  async insert<T extends TableName>(table: T, rows: Snapshot[T][number][]) {
    (this.data[table] as unknown[]).push(...structuredClone(rows)); this.save()
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Snapshot[T][number]>) {
    const row = (this.data[table] as { id: string }[]).find((r) => r.id === id)
    if (!row) throw new Error(`Record ${id} niet gevonden in ${table}`)
    Object.assign(row, patch); this.save()
  }
  async remove(table: TableName, id: string) {
    const rows = this.data[table] as { id: string }[]
    const i = rows.findIndex((r) => r.id === id)
    if (i >= 0) rows.splice(i, 1)
    this.save()
  }
  // Voorbeeldgegevens in de browser: er gaat nooit echte mail de deur uit.
  async sendEmail(_id: string, _attachment: EmailAttachment): Promise<'sent' | 'demo'> { return 'demo' }
  async nextNumber(series: string, year: number) {
    const id = `${series}-${year}`
    let row = this.data.number_series.find((r) => r.id === id)
    if (!row) { row = { id, last_number: 0 }; this.data.number_series.push(row) }
    row.last_number += 1; this.save()
    return `${id}-${String(row.last_number).padStart(4, '0')}`
  }
}
