import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Regel (13 november 2026): Supabase weigert via de app (PostgREST, pg-safeupdate) een update of delete zonder
// where: "UPDATE requires a WHERE clause". Testgegevens wissen liep daarop vast. Daarom moet in elke databasefunctie
// (de laatste versie per functie) elke update en delete een where hebben; desnoods 'where true'.
const DIR = 'supabase/migrations'

const code = (sql: string) => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')

function latestFunctions(): Map<string, string> {
  const out = new Map<string, string>()
  const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()
  const re = /create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2/gi
  for (const f of files) {
    const sql = code(readFileSync(`${DIR}/${f}`, 'utf8'))
    for (const m of sql.matchAll(re)) out.set(m[1].replace(/^public\./, ''), `${f}: ${m[3]}`)
  }
  return out
}

describe('Update en delete in databasefuncties', () => {
  it('heeft altijd een where (pg-safeupdate)', () => {
    const bad: string[] = []
    for (const [name, body] of latestFunctions()) {
      for (const stmt of body.split(';')) {
        const s = stmt.trim()
        if (!/^(update|delete)\b/i.test(s)) continue
        if (!/\bwhere\b/i.test(s)) bad.push(`${name}: ${s.replace(/\s+/g, ' ').slice(0, 80)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('wipe_test_data zet de instellingen met where', () => {
    const body = latestFunctions().get('wipe_test_data') ?? ''
    expect(body).toMatch(/update settings set[^;]*\bwhere true/)
  })
})
