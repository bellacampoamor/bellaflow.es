import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Regel (beveiliging 8 november 2026): nieuwe policies altijd via is_team_member() of is_admin(),
// nooit using (true) of with check (true). 20261108085000_beveiliging.sql zet de oudere om.
const DIR = 'supabase/migrations'
const SECURITY = '20261108085000_beveiliging.sql'
const OPEN = /(using|with\s+check)\s*\(\s*true\s*\)/i

const code = (sql: string) => sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n')

describe('Beveiliging migraties', () => {
  const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()

  it('heeft de beveiligingsmigratie', () => {
    expect(files).toContain(SECURITY)
  })

  it('geen using (true) of with check (true) na de beveiligingsmigratie', () => {
    const later = files.filter(f => f > SECURITY)
    const open = later.filter(f => OPEN.test(code(readFileSync(`${DIR}/${f}`, 'utf8'))))
    expect(open).toEqual([])
  })

  it('elk versienummer komt maar één keer voor', () => {
    const versions = files.map(f => f.split('_')[0])
    expect(versions.length).toBe(new Set(versions).size)
  })
})
