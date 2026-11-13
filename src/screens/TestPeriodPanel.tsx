import { useState } from 'react'
import { Rocket, Trash2 } from 'lucide-react'
import { todayISO } from '../domain/calc'
import { goLive, wipeTestData } from '../domain/services'
import { tx } from '../i18n'
import { useApp } from '../ui/app-context'
import { Check, fmtDate, Modal, SelectField, TextField } from '../ui/kit'

/**
 * Instellingen > Bedrijf en factuur: testperiode (opdracht Rick 13 november 2026). Tot Bella Flow echt live gaat in de
 * winkel kan alles wat tijdens het testen ontstond gewist worden; elke reeks begint daarna weer bij 0001. Live zetten
 * sluit de testperiode af. Beide met het woord intypen en een tweede bevestiging.
 */
export function TestPeriodPanel() {
  const { s, run, toast } = useApp()
  const co = s.settings[0]
  const staff = s.salespeople.filter((p) => p.is_active).map((p) => ({ value: p.name, label: p.name }))
  const [mode, setMode] = useState<'wipe' | 'live' | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [typed, setTyped] = useState('')
  const [by, setBy] = useState('')
  const [customers, setCustomers] = useState(false)
  const open = (m: 'wipe' | 'live') => { setMode(m); setStep(1); setTyped(''); setBy(''); setCustomers(false) }
  const close = () => setMode(null)
  const word = mode === 'live' ? 'LIVE' : 'WISSEN'
  const ready = typed.trim().toUpperCase() === word && (mode === 'live' || !!by)
  const counts = { verkooporders: s.sales_orders.length, facturen: s.invoices.length, inkooporders: s.purchase_orders.length, mutaties: s.stock_movements.length, producten: s.products.length }

  if (co?.live_since) return (
    <section className="panel section">
      <h2>{tx("Testperiode")}</h2>
      <p className="small muted">{tx("Bella Flow is live sinds {0}. Testgegevens wissen kan niet meer.", fmtDate(co.live_since))}</p>
    </section>
  )

  return (
    <section className="panel section">
      <h2>{tx("Testperiode")}</h2>
      <div className="note warn">{tx("Bella Flow is nog niet live. Alles wat je nu invoert, kun je hier wissen om opnieuw te beginnen.")}</div>
      <p className="small muted">{tx("Testgegevens wissen haalt alle verkooporders, kassabonnen en facturen, betalingen, leveringen, inkooporders, transporten, ontvangsten, dagafsluitingen, voorraadmutaties en producten weg. Daarna is de voorraad leeg en begint elke reeks weer bij 0001. Instellingen, magazijnen, leveranciers, medewerkers en catalogi blijven staan. Klanten wissen is een keuze.")}</p>
      <p className="small muted">{tx("Let op: een kassaverkoop van HDB gaat ook in de testperiode naar de Shopify van HomeDecoBali. Wissen haalt die bestellingen niet uit Shopify.")}</p>
      {co?.test_wiped_at && <p className="small">{tx("Laatst gewist op {0} door {1}.", fmtDate(co.test_wiped_at.slice(0, 10)), co.test_wiped_by || '–')}</p>}
      <div className="year-open">
        <button type="button" className="btn danger" onClick={() => open('wipe')}><Trash2 size={16} />{tx("Testgegevens wissen")}</button>
        <button type="button" className="btn" onClick={() => open('live')}><Rocket size={16} />{tx("Live zetten")}</button>
      </div>

      {mode && <Modal title={mode === 'wipe' ? tx("Testgegevens wissen") : tx("Bella Flow live zetten")} onClose={close} footer={step === 1 ? <>
        <button className="btn" onClick={close}>{tx("Annuleren")}</button>
        <button className="btn danger" disabled={!ready} onClick={() => setStep(2)}>{tx("Verder")}</button>
      </> : <>
        <button className="btn" onClick={() => setStep(1)}>{tx("Terug")}</button>
        {mode === 'wipe'
          ? <button className="btn danger-solid" onClick={async () => { let n: Record<string, number> = {}; if (await run(async (db) => { n = await wipeTestData(db, { confirm: typed, by, customers }) })) { close(); toast(tx("Testgegevens gewist ({0} facturen, {1} verkooporders, {2} mutaties). Alle nummers beginnen weer bij 0001.", n.facturen ?? 0, n.verkooporders ?? 0, n.mutaties ?? 0)) } }}>{tx("Definitief wissen")}</button>
          : <button className="btn danger-solid" onClick={async () => { if (await run((db) => goLive(db, { confirm: typed, date: todayISO() }), tx("Bella Flow is live. Testgegevens wissen kan niet meer."))) close() }}>{tx("Definitief live zetten")}</button>}
      </>}>
        {step === 1 ? (mode === 'wipe' ? <>
          <div className="note warn">{tx("Dit wist {0} verkooporders, {1} facturen en kassabonnen, {2} inkooporders, {3} voorraadmutaties en {4} producten. Dit kan niet ongedaan worden gemaakt.", counts.verkooporders, counts.facturen, counts.inkooporders, counts.mutaties, counts.producten)}</div>
          <div className="form-grid">
            <SelectField label={tx("Gewist door")} value={by} onChange={setBy} options={staff} placeholder={tx("Kies een medewerker")} />
            <TextField label={tx("Typ {0} ter bevestiging", 'WISSEN')} value={typed} onChange={setTyped} />
          </div>
          <Check label={tx("Ook alle klanten wissen (behalve de vaste klant Kassaverkoop)")} checked={customers} onChange={setCustomers} />
        </> : <>
          <div className="note warn">{tx("Na live zetten blijven alle documenten bewaard en kan testgegevens wissen niet meer. Doe dit op de dag dat de kassa echt in gebruik gaat, direct na de laatste keer wissen.")}</div>
          <TextField label={tx("Typ {0} ter bevestiging", 'LIVE')} value={typed} onChange={setTyped} />
        </>) : <p className="strong">{mode === 'wipe'
          ? tx("Weet je het zeker? Alle testgegevens worden definitief gewist.")
          : tx("Weet je het zeker? Vanaf vandaag ({0}) is Bella Flow live.", fmtDate(todayISO()))}</p>}
      </Modal>}
    </section>
  )
}
