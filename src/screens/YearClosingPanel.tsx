import { useState } from 'react'
import { CalendarCheck, RotateCcw } from 'lucide-react'
import { todayISO } from '../domain/calc'
import { closeYear, rollbackYearClosing } from '../domain/services'
import { activeClosings, closeBlocker, lastNumbers, openYear, rollbackBlocker } from '../domain/yearClosing'
import type { YearClosing } from '../data/types'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { Empty, fmtDate, Modal, Pill, SelectField, TextField } from '../ui/kit'

/**
 * Instellingen > Bedrijf en factuur: jaarafsluiting (opdracht Rick 13 november 2026). Het open boekjaar bepaalt het jaar
 * in elk nieuw documentnummer. Afsluiten zet het boekjaar één verder: elke reeks begint weer bij 0001. Verregaand, dus
 * het jaar intypen én een tweede bevestiging. De laatst gebruikte nummers liggen vast; terugdraaien kan zolang het
 * nieuwe jaar nog geen nummer heeft uitgegeven.
 */
export function YearClosingPanel() {
  const { s, run } = useApp()
  const today = todayISO()
  const co = s.settings[0]
  const year = openYear(co, today)
  const closings = s.year_closings ?? []
  const numbers = lastNumbers(s.number_series, year, co).filter((n) => n.last_number > 0)
  const blocker = closeBlocker(year, today)
  const behind = Number(today.slice(0, 4)) > year
  const staff = s.salespeople.filter((p) => p.is_active).map((p) => ({ value: p.name, label: p.name }))
  const [step, setStep] = useState<0 | 1 | 2>(0)
  const [by, setBy] = useState('')
  const [typed, setTyped] = useState('')
  const [undo, setUndo] = useState<YearClosing | null>(null)
  const [undoBy, setUndoBy] = useState('')
  const close = () => { setStep(0); setTyped('') }
  const history = [...closings].sort((a, b) => b.closed_at.localeCompare(a.closed_at))
  const latest = activeClosings(closings)[0]

  return (
    <section className="panel section">
      <h2>{tx("Jaarafsluiting")}</h2>
      <p className="small muted">{tx("Het jaar in elk nieuw nummer (verkooporders, inkooporders, afleverbonnen, proforma's, facturen, kassabonnen, creditfacturen, ontvangsten, transporten) is het open boekjaar, niet het jaar van de datum. Pas de jaarafsluiting zet het boekjaar verder; daarna begint elke reeks weer bij 0001. De laatst gebruikte nummers worden vastgelegd.")}</p>
      <div className="year-open">
        <div><span className="small muted">{tx("Open boekjaar")}</span><div className="strong" style={{ fontSize: '1.4rem' }}>{year}</div></div>
        {behind && <div className="note warn">{tx("Het is {0}, maar boekjaar {1} is nog open: nieuwe documenten krijgen nog een nummer met {1}. Sluit het jaar af om in {0} weer bij 0001 te beginnen.", today.slice(0, 4), year)}</div>}
        <button type="button" className="btn danger" disabled={!!blocker} title={blocker ?? undefined} onClick={() => { setStep(1); setBy(''); setTyped('') }}><CalendarCheck size={16} />{tx("Boekjaar {0} afsluiten", year)}</button>
      </div>
      {blocker && <p className="small muted">{blocker}</p>}

      <h3 style={{ marginTop: 18 }}>{tx("Laatst gebruikte nummers in {0}", year)}</h3>
      {numbers.length === 0 ? <Empty>{tx("In {0} is nog geen nummer uitgegeven.", year)}</Empty> : <div className="table-wrap"><table>
        <thead><tr><th>{tx("Reeks")}</th><th>{tx("Laatste nummer")}</th><th className="num">{tx("Aantal")}</th></tr></thead>
        <tbody>{numbers.map((n) => <tr key={n.series}><td>{tx(n.label)}</td><td className="strong">{n.last_document}</td><td className="num">{n.last_number}</td></tr>)}</tbody>
      </table></div>}

      <h3 style={{ marginTop: 18 }}>{tx("Eerdere afsluitingen")}</h3>
      {history.length === 0 ? <Empty>{tx("Nog geen jaar afgesloten.")}</Empty> : <div className="table-wrap"><table>
        <thead><tr><th>{tx("Boekjaar")}</th><th>{tx("Afgesloten")}</th><th>{tx("Laatste nummers")}</th><th>{tx("Status")}</th><th /></tr></thead>
        <tbody>{history.map((c) => (
          <tr key={c.id}>
            <td className="strong">{c.year}</td>
            <td>{fmtDate(c.closed_at.slice(0, 10))}, {c.closed_by}</td>
            <td className="small">{c.last_numbers.filter((n) => n.last_number > 0).map((n) => n.last_document).join(', ') || '–'}</td>
            <td>{c.rolled_back_at ? <Pill>{tx("Teruggedraaid {0}, {1}", fmtDate(c.rolled_back_at.slice(0, 10)), c.rolled_back_by)}</Pill> : <Pill tone="good">{tx("Afgesloten")}</Pill>}</td>
            <td>{latest?.id === c.id && <button type="button" className="btn sm" onClick={() => { setUndo(c); setUndoBy('') }}><RotateCcw size={14} />{tx("Terugdraaien")}</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>}

      {step > 0 && <Modal title={tx("Boekjaar {0} afsluiten", year)} onClose={close} footer={step === 1 ? <>
        <button className="btn" onClick={close}>{tx("Annuleren")}</button>
        <button className="btn danger" disabled={typed.trim() !== String(year) || !by} onClick={() => setStep(2)}>{tx("Verder")}</button>
      </> : <>
        <button className="btn" onClick={() => setStep(1)}>{tx("Terug")}</button>
        <button className="btn danger-solid" onClick={async () => { if (await run((db) => closeYear(db, { year, confirm: typed, closed_by: by, today }), tx("Boekjaar {0} afgesloten. Nieuwe nummers beginnen in {1} bij 0001.", year, year + 1))) close() }}>{tx("Definitief afsluiten")}</button>
      </>}>
        {step === 1 ? <>
          <div className="note warn">{tx("Dit heeft verregaande gevolgen. Na de afsluiting krijgt elk nieuw document een nummer met {0}, en elke reeks begint weer bij 0001. Documenten van {1} behouden hun nummer.", year + 1, year)}</div>
          <p className="small">{tx("Deze laatste nummers worden vastgelegd:")}</p>
          {numbers.length === 0 ? <p className="small muted">{tx("In {0} is nog geen nummer uitgegeven.", year)}</p> : <ul className="small">{numbers.map((n) => <li key={n.series}>{tx(n.label)}: <strong>{n.last_document}</strong></li>)}</ul>}
          <div className="form-grid">
            <SelectField label={tx("Afgesloten door")} value={by} onChange={setBy} options={staff} placeholder={tx("Kies een medewerker")} />
            <TextField label={tx("Typ {0} ter bevestiging", year)} value={typed} onChange={setTyped} />
          </div>
        </> : <>
          <p className="strong">{tx("Weet je het zeker? Boekjaar {0} wordt afgesloten en alle nummering begint in {1} opnieuw bij 0001.", year, year + 1)}</p>
          <p className="small muted">{tx("Terugdraaien kan alleen zolang er in {0} nog geen nummer is uitgegeven.", year + 1)}</p>
        </>}
      </Modal>}

      {undo && (() => {
        const why = rollbackBlocker(undo, closings, s.number_series, co?.fiscal_year)
        return <Modal title={tx("Afsluiting {0} terugdraaien", undo.year)} onClose={() => setUndo(null)} footer={<>
          <button className="btn" onClick={() => setUndo(null)}>{tx("Annuleren")}</button>
          <button className="btn danger" disabled={!!why || !undoBy} onClick={async () => { if (await run((db) => rollbackYearClosing(db, { id: undo.id, by: undoBy }), tx("Afsluiting teruggedraaid. Boekjaar {0} is weer open; de nummers lopen door vanaf de vastgelegde laatste nummers.", undo.year))) setUndo(null) }}>{tx("Terugdraaien")}</button>
        </>}>
          {why ? <div className="note warn">{why}</div> : <p>{tx("Boekjaar {0} wordt weer open. Nieuwe documenten krijgen weer een nummer met {0} en tellen door vanaf de vastgelegde laatste nummers.", undo.year)}</p>}
          <SelectField label={tx("Teruggedraaid door")} value={undoBy} onChange={setUndoBy} options={staff} placeholder={tx("Kies een medewerker")} />
        </Modal>
      })()}
    </section>
  )
}
