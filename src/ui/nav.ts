import { useCallback, useState } from 'react'

/**
 * Terug naar waar je vandaan kwam (besluit Rick 8 november 2026).
 *
 * Elke stap in de app is een hash (#rapportage-kassa, #facturatie-<id>, ...). Bij elke nieuwe stap
 * onthouden we in `history.state` van welk scherm je kwam. De terugknop linksboven (Head in kit.tsx)
 * gaat daarheen en heet ook zo. Opent iemand een scherm rechtstreeks (link, bladwijzer, nieuw
 * tabblad), dan valt de knop terug op het vaste bovenliggende scherm.
 *
 * Tussenstappen (formulieren, afdrukschermen) tellen niet als herkomst: na Opslaan op een
 * verkooporder gaat Terug naar de lijst waar je het formulier opende, niet naar het formulier.
 */

export interface NavState {
  /** Hash (zonder #) van het scherm waar je vandaan kwam. */
  from?: string
  /** True als `from` direct de vorige stap in de browsergeschiedenis is: dan gaat Terug via history.back(). */
  direct?: boolean
  /** Filters en keuzes van het scherm zelf (periode, bedrijf), zodat ze er bij terugkeren nog staan. */
  ui?: Record<string, unknown>
}

const TRANSIENT: RegExp[] = [
  /^orders-nieuw$/, /^orders-wijzig-/, /^orders-print-/,
  /^inkoop-nieuw/, /^inkoop-print-/, /^inkoop-afdrukken-/, /^inkoop-omzetten-/,
  /^levering-print-/, /^facturatie-print-/,
]
/** Formulieren en afdrukschermen: je komt er doorheen, het is geen plek om naar terug te keren. */
export const isTransient = (hash: string) => TRANSIENT.some((r) => r.test(hash))

const hashOf = (url: string) => {
  const i = url.indexOf('#')
  return i < 0 ? 'overzicht' : url.slice(i + 1) || 'overzicht'
}
const current = () => location.hash.replace(/^#/, '') || 'overzicht'
export const navState = (): NavState => (history.state && typeof history.state === 'object' ? history.state as NavState : {})

/** Bepaalt de herkomst van een nieuwe stap. Los van de browser, zodat het getest kan worden. */
export function originFor(oldHash: string, newHash: string, previous: NavState): NavState {
  if (oldHash === newHash) return previous
  if (isTransient(oldHash)) {
    if (!previous.from || previous.from === newHash) return {}
    return { from: previous.from, direct: false }
  }
  return { from: oldHash, direct: true }
}

let last: NavState = {}
let installed = false
/** Eén keer aanroepen bij het starten, vóór React (main.tsx). */
export function installNav() {
  if (installed || typeof window === 'undefined') return
  installed = true
  last = navState()
  window.addEventListener('hashchange', (e) => {
    const st = history.state as NavState | null
    if (st && typeof st === 'object') {
      // Terug of vooruit in de browser: deze stap kent zijn herkomst al.
      last = st
      return
    }
    const next = originFor(hashOf(e.oldURL), hashOf(e.newURL), last)
    history.replaceState(next, '')
    last = next
  })
}

/** Gaat terug naar `fallback` (hash zonder #) als er geen herkomst is. */
export function goBack(fallback?: string) {
  const st = navState()
  if (st.from && st.from !== current()) {
    if (st.direct) history.back()
    else location.hash = st.from
    return
  }
  if (fallback) location.hash = fallback
}

/** Vervangt de hash zonder nieuwe stap (filters in een lijst) en houdt de herkomst vast. */
export function replaceHash(href: string) {
  history.replaceState(navState(), '', href)
  last = navState()
}

/** Bewaart een keuze van het scherm in de huidige stap, zodat Terug hem herstelt. */
export function rememberUi(key: string, value: unknown) {
  const st = navState()
  const next: NavState = { ...st, ui: { ...(st.ui ?? {}), [key]: value } }
  history.replaceState(next, '')
  last = next
}
export function recallUi<T>(key: string, fallback: T): T {
  const v = navState().ui?.[key]
  return v === undefined ? fallback : v as T
}

/** useState dat in de huidige stap van de browsergeschiedenis wordt bewaard (bijv. periode en bedrijf in Rapportage). */
export function useNavUi<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => recallUi(key, initial))
  const set = useCallback((v: T) => { setValue(v); rememberUi(key, v) }, [key])
  return [value, set]
}
