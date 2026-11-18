import { readdirSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { beforeEach, describe, expect, it } from 'vitest'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import type { StaffRole } from '../src/data/types'
import { seedDemo } from '../src/domain/demo'
import { saveStaff } from '../src/domain/services'
import { roleOf, STAFF_ROLES, staffChoice } from '../src/domain/staff'

let db: LocalDriver
beforeEach(async () => { db = new LocalDriver(false); await seedDemo(db, '2026-11-08') })

describe('Medewerkers met een rol', () => {
  it('kent drie rollen; een medewerker zonder rol is Verkoper', () => {
    expect(STAFF_ROLES).toEqual(['verkoper', 'administratie', 'beheerder'])
    expect(roleOf({})).toBe('verkoper')
    expect(roleOf({ role: 'beheerder' })).toBe('beheerder')
    expect(roleOf({ role: 'onzin' as StaffRole })).toBe('verkoper')
  })

  it('slaat een medewerker met rol op en wijzigt de rol', async () => {
    const id = await saveStaff(db, { name: '  Ingrid  ', email: '', phone: '', is_active: true, role: 'administratie' })
    let p = (await loadSnapshot(db)).salespeople.find((x) => x.id === id)!
    expect(p.name).toBe('Ingrid')
    expect(p.role).toBe('administratie')
    await saveStaff(db, { ...p, role: 'beheerder' })
    p = (await loadSnapshot(db)).salespeople.find((x) => x.id === id)!
    expect(p.role).toBe('beheerder')
  })

  it('weigert zonder naam of zonder geldige rol', async () => {
    await expect(saveStaff(db, { name: ' ', email: '', phone: '', is_active: true, role: 'verkoper' })).rejects.toThrow()
    await expect(saveStaff(db, { name: 'X', email: '', phone: '', is_active: true, role: 'chef' as StaffRole })).rejects.toThrow()
    await expect(saveStaff(db, { name: 'X', email: '', phone: '', is_active: true })).rejects.toThrow()
  })

  it('voorbeeldgegevens hebben alle drie de rollen', async () => {
    const roles = new Set((await loadSnapshot(db)).salespeople.map(roleOf))
    expect(roles).toEqual(new Set(STAFF_ROLES))
  })

  it('migratie: bestaande medewerkers worden verkoper, alleen de drie rollen mogen', async () => {
    const pg = new PGlite({ extensions: { pg_trgm } })
    await pg.exec('create role authenticated; create role service_role; create role anon;')
    const files = readdirSync('supabase/migrations').sort()
    const before = files.filter((f) => f < '20261108090000')
    await pg.exec(before.map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n'))
    await pg.exec(`insert into salespeople (name) values ('Bestaand')`)
    await pg.exec(readFileSync('supabase/migrations/20261108090000_medewerkers_rol.sql', 'utf8'))
    const r = await pg.query<{ role: string }>(`select role from salespeople where name = 'Bestaand'`)
    expect(r.rows[0].role).toBe('verkoper')
    await pg.exec(`insert into salespeople (name, role) values ('Admin', 'beheerder')`)
    await expect(pg.exec(`insert into salespeople (name, role) values ('Fout', 'chef')`)).rejects.toThrow()
  }, 60000)
})

describe('Medewerker kiezen op Kassa, Scan-app en Etiketten (besluit Rick 18 november 2026)', () => {
  const people = [
    { id: 'a', name: 'Beheerder', email: 'baas@voorbeeld.test', phone: '', is_active: true, role: 'beheerder' as StaffRole, user_id: 'u-a' },
    { id: 'b', name: 'Verkoper', email: 'Verkoop@Voorbeeld.test', phone: '', is_active: true, role: 'verkoper' as StaffRole, user_id: null },
    { id: 'c', name: 'Collega', email: 'collega@voorbeeld.test', phone: '', is_active: true, role: 'verkoper' as StaffRole, user_id: 'u-c' },
  ]
  it('zonder login (demo) mag iedereen kiezen', () => {
    expect(staffChoice(people, null)).toMatchObject({ locked: false, people })
  })
  it('een beheerder kiest vrij uit alle medewerkers', () => {
    const r = staffChoice(people, { userId: 'u-a', email: 'baas@voorbeeld.test', role: 'beheerder' })
    expect(r.locked).toBe(false); expect(r.people).toHaveLength(3); expect(r.self?.id).toBe('a')
  })
  it('een verkoper ziet alleen zichzelf, gevonden op inlogaccount of e-mailadres', () => {
    expect(staffChoice(people, { userId: 'u-c', email: 'ander@voorbeeld.test', role: 'verkoper' })).toMatchObject({ locked: true, people: [people[2]] })
    expect(staffChoice(people, { userId: 'u-x', email: 'verkoop@voorbeeld.test ', role: 'verkoper' })).toMatchObject({ locked: true, people: [people[1]] })
  })
  it('administratie staat ook vast op zichzelf; zonder koppeling geen keuze', () => {
    expect(staffChoice(people, { userId: 'u-c', email: '', role: 'administratie' }).people.map((p) => p.id)).toEqual(['c'])
    expect(staffChoice(people, { userId: 'u-x', email: 'onbekend@voorbeeld.test', role: 'verkoper' })).toMatchObject({ locked: true, people: [], self: undefined })
  })
})
