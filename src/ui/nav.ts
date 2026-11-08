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
  /** Hoe ver het scherm naar beneden gescrold was, zodat Terug op dezelfde plek in een lange lijst uitkomt. */
  scroll?: number
}

const TRANSIENT: RegExp[] = [
  /^orders-nieuw$/, /^orders-wijzig-/, /^orders-print-/,
  /^inkoop-nieuw/, /^inkoop-print-/, /^inkoop-afdrukken-/, /^inkoop-omzetten-/,
  /^levering-print-/, /^facturatie-print-/, /^facturatie-crediteren-/,
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

/** Bewaart de scrollpositie in de huidige stap. Pas als het scrollen stilstaat en vlak voor een klik, niet bij elke pixel. */
function saveScroll() {
  const y = Math.round(window.scrollY)
  const st = navState()
  if (st.scroll === y) return
  const next: NavState = { ...st, scroll: y }
  try { history.replaceState(next, '') } catch { return }
  last = next
}

/** Waar het scherm na het openen moet staan: bij Terug (de stap kent zijn positie) daar, anders bovenaan. */
export const scrollTarget = (st: NavState | null | undefined) => (st && typeof st.scroll === 'number' && st.scroll > 0 ? st.scroll : 0)

/**
 * Zet het scherm op de bewaarde plek. Een lange lijst is er soms nog niet helemaal (pagina's, foto's),
 * dus proberen we het een korte tijd opnieuw tot de pagina lang genoeg is.
 */
export function restoreScroll(y: number) {
  if (typeof window === 'undefined') return
  if (!y) { window.scrollTo(0, 0); return }
  let tries = 0
  const step = () => {
    window.scrollTo(0, y)
    if (Math.abs(window.scrollY - y) < 2 || ++tries > 30) return
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/** Eén keer aanroepen bij het starten, vóór React (main.tsx). */
export function installNav() {
  if (installed || typeof window === 'undefined') return
  installed = true
  last = navState()
  // De browser zet de positie bij Terug zelf vaak verkeerd, omdat het scherm opnieuw wordt opgebouwd. Dat doen we zelf.
  try { history.scrollRestoration = 'manual' } catch { /* oudere browser */ }
  let timer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(saveScroll, 250) }, { passive: true })
  // Vlak voor een klik (link of knop naar een ander scherm) de positie meteen vastleggen.
  window.addEventListener('pointerdown', () => { clearTimeout(timer); saveScroll() }, { capture: true, passive: true })
  window.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); saveScroll() } }, { capture: true })
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

// Zoekvraag die het zoekveld voor alles meegeeft aan een catalogus (een artikel openen in Catalogi).
const CATALOG_Q = 'bella-flow-catalog-q'
export function setCatalogQuery(supplierId: string, q: string) {
  try { sessionStorage.setItem(CATALOG_Q, JSON.stringify({ supplierId, q })) } catch { /* alleen zonder voorinvulling */ }
}
/** Leest de meegegeven zoekvraag één keer uit (daarna is hij weg). */
export function takeCatalogQuery(supplierId: string): string {
  try {
    const raw = sessionStorage.getItem(CATALOG_Q)
    if (!raw) return ''
    const v = JSON.parse(raw) as { supplierId: string; q: string }
    if (v.supplierId !== supplierId) return ''
    sessionStorage.removeItem(CATALOG_Q)
    return v.q
  } catch { return '' }
}
