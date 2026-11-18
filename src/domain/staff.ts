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

/** Wie er is ingelogd. Zonder login (demo in de browser) is er geen Login en mag iedereen kiezen. */
export interface Login { userId: string; email: string; role: string | null }

/**
 * Medewerkers waaruit gekozen kan worden op de Kassa, de Scan-app en de Etiketten-app (besluit Rick 18 november 2026).
 * Een beheerder kiest vrij. Een verkoper of administratie staat vast op zichzelf en kan geen andere naam kiezen.
 * Gevonden op de koppeling met het inlogaccount (user_id), anders op e-mailadres.
 */
export function staffChoice(people: Salesperson[], login: Login | null | undefined): { people: Salesperson[]; locked: boolean; self: Salesperson | undefined } {
  if (!login) return { people, locked: false, self: undefined }
  const mail = login.email.trim().toLowerCase()
  const self = people.find((p) => p.user_id && p.user_id === login.userId) ?? (mail ? people.find((p) => p.email.trim().toLowerCase() === mail) : undefined)
  if (login.role === 'beheerder') return { people, locked: false, self }
  return { people: self ? [self] : [], locked: true, self }
}

/**
 * Mag de ingelogde medewerker Instellingen openen? Alleen een beheerder (besluit Rick 18 november 2026).
 * Zonder login (demo in de browser) wel.
 */
export function canOpenSettings(login: Login | null | undefined): boolean {
  return !login || login.role === 'beheerder'
}
