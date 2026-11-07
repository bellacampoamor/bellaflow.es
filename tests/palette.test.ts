import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Kleurenkaart: leesbaarheid per stand en gelijke nachtstand in beide CSS-blokken.
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')
const block = (start: string) => {
  const from = css.indexOf(start) + start.length
  return css.slice(from, css.indexOf('}', from))
}
const tokens = (text: string) => Object.fromEntries([...text.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]))
const day = tokens(block(':root {'))
const nightText = block(':root[data-theme="dark"] {')
const night = tokens(nightText)

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const pairs: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg', 'surface-2'], ['fg', 'neutral-bg'],
  ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
  ['heading', 'bg'], ['heading', 'surface'], ['heading', 'surface-2'],
  ['link', 'surface'], ['link', 'surface-2'], ['link', 'bg'],
  ['on-primary', 'primary'], ['on-primary', 'primary-hover'], ['on-selected', 'selected'],
  ['buy-fg', 'buy'], ['sell-fg', 'sell'], ['ship-fg', 'ship'], ['bill-fg', 'bill'],
  ['buy', 'buy-fg'], ['sell', 'sell-fg'], ['ship', 'ship-fg'], ['bill', 'bill-fg'],
  ['good', 'good-bg'], ['warn', 'warn-bg'], ['bad', 'bad-bg'], ['info', 'info-bg'],
  ['bad', 'surface'], ['good', 'surface'],
  ['acc-klant', 'surface'], ['acc-producten', 'surface'], ['acc-levering', 'surface'], ['acc-notitie', 'surface'],
]

describe('kleurenkaart', () => {
  for (const [name, set] of [['dagstand', day], ['nachtstand', night]] as const) {
    it.each(pairs)(`${name}: %s op %s is leesbaar`, (fg, bg) => {
      expect(set[fg], fg).toBeTruthy()
      expect(set[bg], bg).toBeTruthy()
      expect(ratio(set[fg], set[bg])).toBeGreaterThanOrEqual(4.5)
    })
  }
  it('beide blokken van de nachtstand zijn gelijk', () => {
    expect(block('@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {').trim()).toBe(nightText.trim())
  })
})
