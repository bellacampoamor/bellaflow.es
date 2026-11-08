import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { locale } from '../i18n'

/** Leest een getal zoals een gebruiker het typt: komma of punt als decimaalteken, spaties genegeerd. Leeg of ongeldig geeft null. */
export function parseNum(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.')
  if (t === '' || t === '-' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Toont een getal met het decimaalteken van de schermtaal (komma in NL/ES, punt in EN), zonder duizendtallen. */
export function showNum(v: number | null | undefined, decimals?: number): string {
  if (v == null || !Number.isFinite(v)) return ''
  const s = decimals === undefined ? String(v) : v.toFixed(decimals)
  return (1.5).toLocaleString(locale()).includes(',') ? s.replace('.', ',') : s
}

/**
 * Getalveld dat leeg mag zijn tijdens het typen. Wissen zet niet direct een 0 terug (pas bij verlaten van het veld),
 * bij focus is de inhoud geselecteerd zodat typen de oude waarde vervangt, en komma én punt werken als decimaalteken.
 * Het is bewust een tekstveld met numeriek toetsenbord: Chrome laat in een type="number" een komma vallen.
 * Leeg telt als `empty` (standaard 0). `min`/`max` worden bij verlaten van het veld toegepast.
 * Bedragen (step 0.01, of `decimals`) staan buiten het typen altijd met twee decimalen: 187,40 in plaats van 187,4.
 */
export function NumInput({ value, onValue, empty = 0, min, max, step, decimals, inputMode, onFocus, onBlur, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'> & { value: number | null | undefined; onValue: (v: number) => void; empty?: number; min?: number | string; max?: number | string; decimals?: number }) {
  const lo = min === undefined || min === '' ? undefined : Number(min)
  const hi = max === undefined || max === '' ? undefined : Number(max)
  const dec = decimals ?? (step === '0.01' || step === 0.01 ? 2 : undefined)
  const show = (v: number | null | undefined) => showNum(v, dec)
  const [draft, setDraft] = useState(show(value))
  useEffect(() => {
    // Alleen overnemen als de waarde van buiten echt iets anders is dan wat er getypt staat.
    if (value == null || !Number.isFinite(value)) { setDraft(''); return }
    const typed = parseNum(draft) ?? empty
    if (typed !== value) setDraft(show(value))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const integer = step === '1' || step === 1
  return (
    <input {...rest} type="text" inputMode={inputMode ?? (integer ? 'numeric' : 'decimal')} autoComplete="off" value={draft}
      onFocus={(e) => { e.currentTarget.select(); onFocus?.(e) }}
      onChange={(e) => {
        const t = e.target.value
        if (!/^[\s\d.,-]*$/.test(t)) return
        setDraft(t)
        const n = parseNum(t)
        if (t.trim() === '') onValue(empty)
        else if (n != null) onValue(n)
      }}
      onBlur={(e) => {
        let n = parseNum(draft) ?? (value != null && Number.isFinite(value) ? value : empty)
        if (lo !== undefined && n < lo) n = lo
        if (hi !== undefined && n > hi) n = hi
        if (n !== value) onValue(n)
        setDraft(show(n))
        onBlur?.(e)
      }}
    />
  )
}
