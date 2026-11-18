import { useState } from 'react'
import { staffChoice } from '../domain/staff'
import { useApp } from './app-context'

const read = (key: string): string => { try { const v = localStorage.getItem(key) ?? ''; try { return String(JSON.parse(v)) } catch { return v } } catch { return '' } }
const write = (key: string, value: string) => { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* alleen deze sessie */ } }

/**
 * De medewerker op de Kassa, de Scan-app en de Etiketten-app. Een beheerder kiest vrij (onthouden per apparaat);
 * een verkoper of administratie staat vast op zichzelf (besluit Rick 18 november 2026).
 */
export function useStaffUser(key: string) {
  const { s, login } = useApp()
  const { people, locked, self } = staffChoice(s.salespeople.filter((p) => p.is_active), login)
  const [picked, setPicked] = useState<string>(() => read(key))
  const user = locked ? (self?.id ?? '') : (people.some((p) => p.id === picked) ? picked : (self?.id ?? picked))
  const me = people.find((p) => p.id === user)
  const pickUser = (id: string) => { if (locked) return; setPicked(id); write(key, id) }
  /** Ingelogd, maar niet gekoppeld aan een actieve medewerker. */
  const unlinked = locked && !self
  return { people, user, me, pickUser, locked, unlinked }
}
