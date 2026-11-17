import { describe, expect, it } from 'vitest'
import { HELP_ORDER, helpNeighbours, helpTopicFor } from '../src/domain/help'
import { HELP_NL } from '../src/domain/helpContent'

describe('Hulp per scherm (F1)', () => {
  it('herkent elk scherm aan het adres', () => {
    const cases: [string, string][] = [
      ['', 'start'], ['overzicht', 'overzicht'], ['#kassa', 'kassa'],
      ['orders', 'verkooporders'], ['orders-lijst-alles', 'verkooporders'], ['orders-nieuw', 'verkooporder-maken'],
      ['orders-wijzig-abc', 'verkooporder-maken'], ['orders-print-abc', 'verkooporders'], ['orders-abc-123', 'verkooporder'],
      ['levering', 'levering'], ['levering-naar-abc', 'levering'], ['levering-abc', 'afleverbon'], ['levering-print-abc', 'afleverbon'],
      ['facturatie', 'facturatie'], ['facturatie-abc', 'facturatie'], ['facturatie-crediteren-abc', 'crediteren'],
      ['inkoop', 'inkooporders'], ['inkoop-lijst-alles', 'inkooporders'], ['inkoop-abc', 'inkooporders'],
      ['inkoop-nieuw', 'inkooporder-maken'], ['inkoop-nieuw-order-abc', 'inkooporder-maken'], ['inkoop-omzetten-abc', 'omzetten'],
      ['inkoop-versturen-2026-11-03', 'afdrukken-versturen'], ['inkoop-afdrukken-2026-11-03-a,b', 'afdrukken-versturen'],
      ['inkomend', 'gepland-transport'], ['inkomend-nl-abc', 'gepland-transport'], ['ontvangst', 'ontvangst'], ['ontvangst-io-abc', 'ontvangst'],
      ['voorraad', 'voorraad'], ['rapportage', 'rapportage'], ['rapportage-leverbaar', 'rapportage'], ['archief', 'rapportage'],
      ['rapportage-kassa', 'kassabeheer'], ['kassabeheer-dagafsluiting', 'kassabeheer'], ['catalogi-abc', 'catalogi'],
      ['instellingen', 'instellingen'], ['beheer', 'instellingen'], ['onbekend-scherm', 'start'],
    ]
    for (const [hash, topic] of cases) expect([hash, helpTopicFor(hash)]).toEqual([hash, topic])
  })
  it('kiest onder Instellingen het onderwerp van het open tabblad', () => {
    expect(helpTopicFor('instellingen', { adminTab: 'bedrijf' })).toBe('bedrijf-factuur')
    expect(helpTopicFor('instellingen', { adminTab: 'klanten' })).toBe('instellingen')
  })
  it('heeft voor elk onderwerp een pagina, en elke verwijzing bestaat', () => {
    expect(new Set(HELP_ORDER).size).toBe(HELP_ORDER.length)
    expect(Object.keys(HELP_NL).sort()).toEqual([...HELP_ORDER].sort())
    for (const t of HELP_ORDER) {
      const page = HELP_NL[t]
      expect(page.title.length).toBeGreaterThan(2)
      expect(page.blocks.length).toBeGreaterThan(0)
      for (const b of page.blocks) {
        if (b.t === 'see') expect(HELP_ORDER).toContain(b.topic)
        if (b.t === 'img') expect(b.src).toMatch(/^https:\/\/res\.cloudinary\.com\/uhdvgzei\/image\/upload\/.+\/bellaflow-handleiding\/[\w-]+\.jpg$/)
      }
    }
  })
  it('bladert in de volgorde van het hoofdmenu', () => {
    expect(helpNeighbours('start')).toEqual({ prev: null, next: 'overzicht' })
    expect(helpNeighbours('kassa')).toEqual({ prev: 'overzicht', next: 'verkooporders' })
    expect(helpNeighbours(HELP_ORDER[HELP_ORDER.length - 1]).next).toBeNull()
  })
})
