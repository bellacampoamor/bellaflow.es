// Schermtaal. De Nederlandse tekst is de sleutel; ontbreekt een vertaling, dan blijft het Nederlands staan.
// Afleverbon, factuur en klantberichten volgen de taal van de klant en staan hier los van.
import { en } from './i18n.en'
import { es } from './i18n.es'

export type UiLanguage = 'nl' | 'en' | 'es'
const KEY = 'bella-flow-language'

let current: UiLanguage = 'nl'
try {
  const saved = localStorage.getItem(KEY)
  if (saved === 'en' || saved === 'es') current = saved
} catch { /* standaardtaal */ }

export const getLanguage = () => current
const LOCALES: Record<UiLanguage, string> = { nl: 'nl-NL', en: 'en-GB', es: 'es-ES' }
export const locale = () => LOCALES[current]
export function setLanguage(language: UiLanguage) {
  current = language
  try { localStorage.setItem(KEY, language) } catch { /* alleen deze sessie */ }
}

export function tx(text: string, ...args: unknown[]) {
  const template = (current === 'en' ? en[text] : current === 'es' ? es[text] : text) ?? text
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))
}
