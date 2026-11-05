// Gedeelde bouwstenen voor alle schermen.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Check as CheckIcon, X } from 'lucide-react'
import { locale, tx } from '../i18n'
import { DOC_MARK } from '../domain/noteText'
import type { Language } from '../data/types'

const brandFile = (name: string) => `${import.meta.env.BASE_URL}assets/brand/${name}`/** Documentblad: bij afdrukken staat het merkje op elke pagina midden onderaan. Kop en voet houden daar ruimte voor vrij. */
export const DocPaper = ({ language, children }: { language: Language; children: ReactNode }) => (
  <div className="paper">
    <div className="doc-frame">
      <div className="doc-space-top" aria-hidden="true"><div /></div>
      <div className="doc-body">{children}</div>
      <div className="doc-space-bottom" aria-hidden="true"><div /></div>
    </div>
    <div className="doc-mark"><img src={brandFile('bellaflow-logo-small.png')} alt="Bella Flow" /><span>{DOC_MARK[language]}</span></div>
  </div>
)

/** Op smalle schermen het compacte logo. */

/** Op smalle schermen het compacte logo. */
export const Logo = () => (
  <picture>
    <source media="(max-width: 520px)" srcSet={brandFile('bellaflow-logo-small.png')} />
    <img className="logo" src={brandFile('bellaflow-logo-medium.png')} width={800} height={147} alt="Bella Flow" />
  </picture>
)
export const LogoFull = () => <img className="logo-full" src={brandFile('bellaflow-logo-full-tagline.png')} width={2400} height={502} alt="Bella Flow" />

export const eur = (n: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'EUR' }).format(n || 0)
export const fmtDate = (iso?: string | null) => {
  if (!iso) return '–'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}
export const fmtShort = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' })

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'sell' | 'bill' | ''
export const Pill = ({ tone = '', children }: { tone?: Tone; children: ReactNode }) => <span className={`pill ${tone}`}>{children}</span>

export function Head({ title, sub, back, children }: { title: ReactNode; sub?: ReactNode; back?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <div className="head">
      <div style={{ minWidth: 0 }}>
        {back && <a className="back" href={back.href}>‹ {back.label}</a>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  )
}

export function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: (id: string) => ReactNode }) {
  const id = useId()
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

type Common = { label: string; hint?: string; className?: string; required?: boolean }
export const TextField = ({ label, hint, className, value, onChange, type = 'text', placeholder, required }: Common & { value: string | null; onChange: (v: string) => void; type?: string; placeholder?: string }) => (
  <Field label={label} hint={hint} className={className}>{(id) => <input id={id} type={type} value={value ?? ''} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} />}</Field>
)
export const NumberField = ({ label, hint, className, value, onChange, step = 'any', min }: Common & { value: number; onChange: (v: number) => void; step?: string; min?: number }) => (
  <Field label={label} hint={hint} className={className}>{(id) => <input id={id} type="number" inputMode="decimal" step={step} min={min} value={Number.isNaN(value) ? '' : value} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />}</Field>
)
export const AreaField = ({ label, hint, className, value, onChange }: Common & { value: string; onChange: (v: string) => void }) => (
  <Field label={label} hint={hint} className={className}>{(id) => <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />}</Field>
)
export function SelectField<T extends string>({ label, hint, className, value, onChange, options, placeholder }: Common & { value: T | '' | null; onChange: (v: T) => void; options: { value: T; label: string }[]; placeholder?: string }) {
  return (
    <Field label={label} hint={hint} className={className}>{(id) => (
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}</Field>
  )
}
/** Selecteerbare tabelrij: klik of Enter/spatie op de rij wisselt de selectie. Links en knoppen in de rij blijven gewoon werken. */
export const pickRow = (selected: boolean, onToggle: () => void, className = '') => ({
  className: `pick${selected ? ' sel' : ''}${className ? ` ${className}` : ''}`,
  tabIndex: 0,
  'aria-selected': selected,
  onClick: (e: ReactMouseEvent) => { if (!(e.target as Element).closest('a, button, input, select')) onToggle() },
  onKeyDown: (e: ReactKeyboardEvent) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() } },
})
/** Vinkje achteraan een geselecteerde rij. */
export const PickMark = ({ on }: { on: boolean }) => <td style={{ width: 32 }}>{on && <CheckIcon size={16} />}</td>

export const Check = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <label className="check"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
)

export interface ComboOption { value: string; label: string; sub?: string; search?: string }/** Doorzoekbare keuzelijst voor klanten en producten. */
/** Doorzoekbare keuzelijst voor klanten en producten. */
export function Combo({ id, value, options, onChange, placeholder, footer }: { id?: string; value: string | null; options: ComboOption[]; onChange: (v: string) => void; placeholder?: string; footer?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    const hits = t ? options.filter((o) => `${o.label} ${o.sub ?? ''} ${o.search ?? ''}`.toLowerCase().includes(t)) : options
    return hits.slice(0, 40)
  }, [q, options])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (r) setPos({ left: r.left, top: r.bottom + 3, width: Math.max(r.width, 280) })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])
  const pick = (v: string) => { onChange(v); setQ(''); setOpen(false) }
  return (
    <div className="combo" ref={ref}>
      <input
        id={id} value={open ? q : current?.label ?? ''} placeholder={current?.label ?? placeholder} autoComplete="off" role="combobox" aria-expanded={open}
        onFocus={() => { setOpen(true); setHl(0) }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHl(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(h + 1, list.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); if (list[hl]) pick(list[hl].value) }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && pos && (
        <div className="combo-list" style={{ left: Math.min(pos.left, window.innerWidth - pos.width - 8), top: pos.top, width: pos.width }}>
          {list.map((o, i) => (
            <button type="button" key={o.value} className={i === hl ? 'hl' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o.value)}>
              {o.label}{o.sub && <small>{o.sub}</small>}
            </button>
          ))}
          {!list.length && <div className="empty" style={{ padding: '8px 11px' }}>{tx("Niets gevonden voor \"")}{q}"</div>}
          {footer}
        </div>
      )}
    </div>
  )
}

export function Modal({ title, wide, center, onClose, children, footer }: { title: string; wide?: boolean; center?: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'wide' : ''} ${center ? 'center' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-head" style={{ marginBottom: 0 }}>
          <h2>{title}</h2>
          <button className="btn icon" type="button" aria-label={tx("Sluiten")} onClick={onClose}><X size={18} /></button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; n?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={t.value === value} className={t.value === value ? 'on' : ''} onClick={() => onChange(t.value)}>
          {t.label}{t.n !== undefined && <span className="n">{t.n}</span>}
        </button>
      ))}
    </div>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>

/** Artikelnummer onder of naast een productnaam, overal hetzelfde. */
export function Sku({ code }: { code?: string | null }) {
  return code ? <span className="sku">{code}</span> : null
}
