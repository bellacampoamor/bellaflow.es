import { describe, expect, it } from 'vitest'
import { listLanguage, settingsUpgrade } from '../src/domain/issuers'

describe('taal van lijsten (Rapportage)', () => {
  it('volgt standaard de schermtaal', () => {
    expect(listLanguage('scherm', 'es')).toBe('es')
    expect(listLanguage(undefined, 'en')).toBe('en')
  })
  it('een vaste taal uit Instellingen gaat voor', () => {
    expect(listLanguage('nl', 'es')).toBe('nl')
  })
  it('bestaande instellingen krijgen schermtaal, een gekozen taal blijft', () => {
    expect(settingsUpgrade({}).language_lists).toBe('scherm')
    expect(settingsUpgrade({ language_lists: 'en' }).language_lists).toBeUndefined()
  })
})
