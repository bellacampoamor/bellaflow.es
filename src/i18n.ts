// Schermtaal. De Nederlandse tekst is de sleutel; ontbreekt een vertaling, dan blijft het Nederlands staan.
// Afleverbon, factuur en klantberichten volgen de taal van de klant en staan hier los van.
import { en } from './i18n.en'

export type UiLanguage = 'nl' | 'en'
const KEY = 'bella-flow-language'

let current: UiLanguage = 'nl'
try {
  if (localStorage.getItem(KEY) === 'en') current = 'en'
} catch { /* standaardtaal */ }

export const getLanguage = () => current
export const locale = () => (current === 'en' ? 'en-GB' : 'nl-NL')
export function setLanguage(language: UiLanguage) {
  current = language
  try { localStorage.setItem(KEY, language) } catch { /* alleen deze sessie */ }
}

export function tx(text: string, ...args: unknown[]) {
  const template = current === 'en' ? en[text] ?? text : text
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))
}
