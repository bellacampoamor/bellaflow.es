// Medewerkers en hun rol. Technisch blijft de tabel salespeople heten; op het scherm heten ze Medewerkers.
// De rol bepaalt later de toegang in de database; nu is het alleen een gegeven bij de medewerker.
import type { Salesperson, StaffRole } from '../data/types'

export const STAFF_ROLES: StaffRole[] = ['verkoper', 'administratie', 'beheerder']
export const ROLE_LABEL: Record<StaffRole, string> = { verkoper: 'Verkoper', administratie: 'Administratie', beheerder: 'Beheerder' }

/** Rol van een medewerker; bestaande medewerkers zonder rol zijn Verkoper. */
export function roleOf(p: Pick<Salesperson, 'role'>): StaffRole {
  return p.role && STAFF_ROLES.includes(p.role) ? p.role : 'verkoper'
}

export function isStaffRole(v: unknown): v is StaffRole {
  return typeof v === 'string' && (STAFF_ROLES as string[]).includes(v)
}
