import { TABLES, type Snapshot } from '../src/data/types'

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Zet een snapshot om naar INSERT-regels. De factuurbewaking staat tijdens het laden uit. */
export function toSeedSql(s: Snapshot) {
  const out = ['delete from settings;', 'alter table invoices disable trigger invoices_guard;']
  for (const t of TABLES) {
    for (const row of s[t] as unknown as Record<string, unknown>[]) {
      const cols = Object.keys(row)
      out.push(`insert into ${t} (${cols.join(', ')}) values (${cols.map((c) => lit(row[c])).join(', ')});`)
    }
  }
  out.push('alter table invoices enable trigger invoices_guard;')
  return out.join('\n') + '\n'
}
