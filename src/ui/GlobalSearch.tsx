import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Boxes, FileText, Package, Receipt, Search, ShoppingCart, Truck, User } from 'lucide-react'
import type { ArticleHit } from '../data/types'
import { globalSearch, groupHits, type HitKind, type SearchHit } from '../domain/search'
import { searchCatalogArticles } from '../domain/services'
import { go, useApp } from './app-context'
import { Modal, Sku } from './kit'
import { setCatalogQuery } from './nav'
import { tx } from '../i18n'

const GROUP: Record<HitKind, { label: string; icon: typeof Search }> = {
  verkooporder: { label: 'Verkooporders', icon: ShoppingCart },
  factuur: { label: 'Facturen', icon: Receipt },
  klant: { label: 'Klanten', icon: User },
  inkooporder: { label: 'Inkooporders', icon: Package },
  levering: { label: 'Afleverbonnen', icon: FileText },
  transport: { label: 'Transporten', icon: Truck },
  artikel: { label: 'Artikelen in de catalogi', icon: Boxes },
}

const isTyping = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement).isContentEditable)

/**
 * Eén zoekveld voor alles (opdracht Rick 8 november 2026). Knop in het hoofdmenu, of Ctrl+K (Cmd+K) en / overal.
 * Zoekt in verkooporders, facturen, klanten, inkooporders, afleverbonnen, transporten en de catalogi.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true) }
      else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(document.activeElement)) { e.preventDefault(); setOpen(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      <button className="btn-toggle" onClick={() => setOpen(true)} title={tx("Zoeken in alles (Ctrl+K)")} aria-label={tx("Zoeken in alles")}><Search size={16} />{tx("Zoeken")}</button>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  )
}

interface Row { key: string; kind: HitKind; title: string; sub: string; open: () => void; code?: string }

function SearchDialog({ onClose }: { onClose: () => void }) {
  const { s, db } = useApp()
  const [q, setQ] = useState('')
  const [articles, setArticles] = useState<ArticleHit[]>([])
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const hits = useMemo(() => globalSearch(s, q), [s, q])

  // Artikelen zoekt de opslag zelf (tienduizenden per catalogus), even wachten tot er niet meer getypt wordt.
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setArticles([]); return }
    let live = true
    const t = setTimeout(() => { void searchCatalogArticles(db, { q: term, limit: 6 }).then((r) => { if (live) setArticles(r) }).catch(() => { if (live) setArticles([]) }) }, 180)
    return () => { live = false; clearTimeout(t) }
  }, [q, db])

  const supplierName = (id: string) => s.suppliers.find((x) => x.id === id)?.name ?? ''
  const groups = useMemo(() => {
    const g: { kind: HitKind; rows: Row[] }[] = groupHits(hits).map((x) => ({ kind: x.kind, rows: x.hits.map((h: SearchHit) => ({ key: `${h.kind}-${h.id}`, kind: h.kind, title: h.title, sub: h.sub, open: () => go(h.href) })) }))
    if (articles.length) g.push({ kind: 'artikel', rows: articles.map((a) => ({
      key: `artikel-${a.id}`, kind: 'artikel', title: a.name, code: a.article_number, sub: [supplierName(a.supplier_id), a.supplier_sku].filter(Boolean).join(' · '),
      open: () => { setCatalogQuery(a.supplier_id, a.supplier_sku); go(`catalogi-${a.supplier_id}`) },
    })) })
    return g
  }, [hits, articles, s])
  const flat = groups.flatMap((g) => g.rows)
  useEffect(() => { setActive(0) }, [q])
  useEffect(() => { list.current?.querySelector('.gs-row.on')?.scrollIntoView({ block: 'nearest' }) }, [active])

  const choose = (r: Row | undefined) => { if (!r) return; onClose(); r.open() }
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(flat[active]) }
  }
  let n = -1
  return (
    <Modal title={tx("Zoeken in alles")} onClose={onClose} wide>
      <div className="gs-input">
        <Search size={18} aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} spellCheck={false} autoComplete="off"
          placeholder={tx("Nummer, klant, telefoon, leverancier of artikel")} aria-label={tx("Zoeken in alles")} />
      </div>
      <div className="gs-list" ref={list} role="listbox" aria-label={tx("Resultaten")}>
        {q.trim().length < 2 && <p className="small muted" style={{ margin: 0 }}>{tx("Typ minimaal twee tekens. Zoekt in verkooporders, facturen, klanten, inkooporders, afleverbonnen, transporten en de catalogi. Pijltjes en Enter om te openen.")}</p>}
        {q.trim().length >= 2 && flat.length === 0 && <p className="small muted" style={{ margin: 0 }}>{tx("Niets gevonden voor {0}.", q.trim())}</p>}
        {groups.map((g) => {
          const Icon = GROUP[g.kind].icon
          return (
            <div key={g.kind} className="gs-group">
              <div className="gs-group-head"><Icon size={14} />{tx(GROUP[g.kind].label)}</div>
              {g.rows.map((r) => {
                n++
                const idx = n
                return (
                  <button key={r.key} type="button" role="option" aria-selected={idx === active} className={`gs-row${idx === active ? ' on' : ''}`} onMouseMove={() => setActive(idx)} onClick={() => choose(r)}>
                    <span className="gs-title">{r.title}{r.code && <Sku code={r.code} />}</span>
                    {r.sub && <span className="gs-sub">{r.sub}</span>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
