// Document op losse A4-bladen (besluit Rick 9 november 2026, eerst voor de factuur).
// Meet kop, regels, subtotaalregel, totalen en voet op een onzichtbaar blad van dezelfde maat,
// verdeelt de regels met paginateRows en bouwt daarna de bladen. Afdrukken geeft precies die bladen.
// Herbruikbaar voor verkooporder en inkooporder.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Language } from '../data/types'
import { PAGE_TEXT, pageLabel, paginateRows, type DocPage } from '../domain/docPages'
import { eur } from './kit'

export interface PagedRow { key: string; cells: ReactNode; amount: number }

interface Props {
  language: Language
  /** Kop van het eerste blad: afzender, titel, nummer, klant. */
  head: ReactNode
  /** Korte kop van een vervolgblad. */
  contHead: ReactNode
  /** Vaste kolombreedtes, zodat elk blad dezelfde kolommen heeft. */
  colgroup: ReactNode
  /** De rij met kolomkoppen (<tr>). */
  thead: ReactNode
  /** Aantal kolommen; het bedrag van subtotaal en transport staat in de laatste. */
  cols: number
  rows: PagedRow[]
  /** Totalen en betaalregel, alleen op het laatste blad. */
  totals: ReactNode
  /** Voet op elk blad (QR, juridische regel, bellaflow.es). */
  foot: ReactNode
  /** Klaar met meten (logo's en lettertype geladen): pas dan automatisch afdrukken. */
  onReady?: () => void
}

/** Kleine marge per blad tegen afronding van de browser. */
const SLACK = 2
const h = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().height : 0)

export function PagedDoc({ language, head, contHead, colgroup, thead, cols, rows, totals, foot, onReady }: Props) {
  const measure = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState<DocPage[] | null>(null)
  const [version, setVersion] = useState(0)
  const ready = useRef(false)
  const text = PAGE_TEXT[language]
  const amounts = rows.map((r) => r.amount)

  // Meten vóór het tekenen; opnieuw zodra een logo of het lettertype geladen is.
  useLayoutEffect(() => {
    const m = measure.current
    if (!m) return
    const q = (sel: string) => m.querySelector(sel)
    const body = q('.sheet-empty .sheet-body') as HTMLElement | null
    const thead = h(q('.sheet-free thead'))
    const rowEls = [...m.querySelectorAll('.sheet-free tbody tr.doc-row')]
    const page = (body?.clientHeight ?? 0) - SLACK
    setPages(paginateRows({
      rows: rowEls.map(h),
      first: page - h(q('.sheet-free .m-head')) - thead,
      next: page - h(q('.sheet-free .m-cont')) - thead,
      carry: h(q('.sheet-free tr.doc-carry')),
      brought: h(q('.sheet-free tr.doc-brought')),
      totals: h(q('.sheet-free .m-totals')),
    }, amounts))
    // amounts volgt rows; version is de herlaadteller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, head, contHead, totals, foot, version])

  useEffect(() => {
    const m = measure.current
    if (!m) return
    let cancelled = false
    const imgs = [...m.querySelectorAll('img')]
    const bump = () => { if (!cancelled) setVersion((v) => v + 1) }
    imgs.forEach((img) => { if (!img.complete) img.addEventListener('load', bump, { once: true }) })
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve()
    Promise.all([fonts, ...imgs.map((img) => img.decode().catch(() => undefined))]).then(() => {
      if (cancelled) return
      bump()
      // Eén frame later staan de bladen er met de laatste meting.
      requestAnimationFrame(() => { if (!cancelled && !ready.current) { ready.current = true; onReady?.() } })
    })
    return () => { cancelled = true; imgs.forEach((img) => img.removeEventListener('load', bump)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const carryRow = (n: number) => <tr className="doc-carry"><td colSpan={cols - 1}>{text.carry}</td><td className="num">{eur(n)}</td></tr>
  const broughtRow = (n: number) => <tr className="doc-brought"><td colSpan={cols - 1}>{text.brought}</td><td className="num">{eur(n)}</td></tr>
  const table = (body: ReactNode) => <table className="doc-lines">{colgroup}<thead>{thead}</thead><tbody>{body}</tbody></table>
  const sheetFoot = (label: string) => <div className="sheet-foot"><div className="sheet-page">{label}</div>{foot}</div>

  return (
    <>
      <div className="sheets-measure" ref={measure} aria-hidden="true">
        <div className="paper sheet sheet-empty"><div className="sheet-body" />{sheetFoot(pageLabel(language, 99, 99))}</div>
        <div className="paper sheet sheet-free">
          <div className="sheet-block m-head">{head}</div>
          <div className="sheet-block m-cont">{contHead}</div>
          {table(<>
            {rows.map((r) => <tr key={r.key} className="doc-row">{r.cells}</tr>)}
            {carryRow(99999.99)}
            {broughtRow(99999.99)}
          </>)}
          <div className="sheet-block m-totals">{totals}</div>
        </div>
      </div>
      {pages && (
        <div className="sheets">
          {pages.map((p, i) => (
            <div className="paper sheet" key={i}>
              <div className="sheet-body">
                <div className="sheet-block">{i === 0 ? head : contHead}</div>
                {table(<>
                  {i > 0 && broughtRow(p.brought)}
                  {rows.slice(p.start, p.end).map((r) => <tr key={r.key} className="doc-row">{r.cells}</tr>)}
                  {p.carry !== null && carryRow(p.carry)}
                </>)}
                {p.carry === null && <div className="sheet-block">{totals}</div>}
              </div>
              {sheetFoot(pageLabel(language, i + 1, pages.length))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
