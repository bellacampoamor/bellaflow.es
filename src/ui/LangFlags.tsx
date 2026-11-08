import type { UiLanguage } from '../i18n'

// Kleine vlaggen als SVG: emoji-vlaggen toont Windows niet.
function Flag({ lang }: { lang: UiLanguage }) {
  if (lang === 'nl') return (
    <svg viewBox="0 0 9 6" aria-hidden="true">
      <rect width="9" height="2" fill="#AE1C28" /><rect y="2" width="9" height="2" fill="#FFF" /><rect y="4" width="9" height="2" fill="#21468B" />
    </svg>
  )
  if (lang === 'es') return (
    <svg viewBox="0 0 9 6" aria-hidden="true">
      <rect width="9" height="6" fill="#AA151B" /><rect y="1.5" width="9" height="3" fill="#F1BF00" />
    </svg>
  )
  return (
    <svg viewBox="0 0 60 40" aria-hidden="true">
      <clipPath id="lf-uk"><rect width="60" height="40" /></clipPath>
      <g clipPath="url(#lf-uk)">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#FFF" strokeWidth="8" />
        <path d="M0,0 L60,40 M60,0 L0,40" stroke="#C8102E" strokeWidth="3" />
        <path d="M30,0 V40 M0,20 H60" stroke="#FFF" strokeWidth="12" />
        <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="7" />
      </g>
    </svg>
  )
}

export const LANG_OPTIONS: { code: UiLanguage; name: string }[] = [
  { code: 'nl', name: 'Nederlands' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
]

export function LangFlags({ value, onChange, label }: { value: UiLanguage; onChange: (l: UiLanguage) => void; label: string }) {
  return (
    <div className="lang-flags" role="radiogroup" aria-label={label}>
      {LANG_OPTIONS.map((o) => (
        <button key={o.code} type="button" role="radio" aria-checked={value === o.code} aria-label={o.name} title={o.name}
          className={value === o.code ? 'lang-flag on' : 'lang-flag'} onClick={() => onChange(o.code)}>
          <Flag lang={o.code} />
        </button>
      ))}
    </div>
  )
}
