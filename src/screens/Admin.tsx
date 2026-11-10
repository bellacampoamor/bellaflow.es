import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Customer, DocumentLanguage, Language, ListLanguage, Salesperson, Settings, Supplier, Warehouse } from '../data/types'
import { saveRecord, saveSettings, saveStaff, saveSupplier, saveSupplierSurcharge, type PrefixField } from '../domain/services'
import { priceWithSurcharge } from '../domain/articles'
import { useApp } from '../ui/app-context'
import { useNavUi } from '../ui/nav'
import { fold } from '../domain/search'
import { AreaField, BackToTop, Check, Empty, eur, Head, Modal, NumberField, Pager, Pill, SelectField, Tabs, TextField } from '../ui/kit'
import { CustomerFields } from './OrderForm'
import { tx } from '../i18n'
import { isSpanishSupplier } from '../domain/calc'
import { ROLE_LABEL, roleOf, STAFF_ROLES } from '../domain/staff'
import { BELLA_DEFAULTS, HDB_DEFAULTS, imageSrc } from '../domain/issuers'
import { mailsAutomatically } from '../domain/mailSettings'
import { simplifiedPrint, type SimplifiedPrint } from '../domain/receipt'

// Geen tabblad Producten: de producten zijn de artikelen uit de catalogi van de leveranciers, met een eigen artikelnummer.
type Tab = 'magazijnen' | 'leveranciers' | 'toeslagen' | 'klanten' | 'medewerkers' | 'bedrijf'

const NEW = {
  warehouse: { code: '', name: '', kind: 'magazijn', address: '', postal_code: '', city: '', phone: '', contact_name: '', receives_goods: true, ships_goods: true, is_active: true, latitude: null, longitude: null, is_route_origin: false } as Omit<Warehouse, 'id'>,
  supplier: { name: '', vat_number: '', contact_name: '', email: '', phone: '', address: '', postal_code: '', city: '', country: 'Nederland', lead_time_days: 21, payment_terms: '', notes: '', is_active: true } as Omit<Supplier, 'id'>,
  customer: { kind: 'particulier', name: '', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: 'Alicante', country: 'España', notes: '' } as Omit<Customer, 'id'>,
}

/** param: klant-<id> opent die klant (vanuit het zoekveld voor alles). */
export function Admin({ param = '' }: { param?: string }) {
  const { s, run, toast } = useApp()
  const openCustomer = param.startsWith('klant-') ? s.customers.find((c) => c.id === param.slice(6)) ?? null : null
  const [tab, setTab] = useNavUi<Tab>('admin-tab', openCustomer ? 'klanten' : 'magazijnen')
  const [wh, setWh] = useState<(Omit<Warehouse, 'id'> & { id?: string }) | null>(null)
  const [su, setSu] = useState<(Omit<Supplier, 'id'> & { id?: string }) | null>(null)
  const [cu, setCu] = useState<(Omit<Customer, 'id'> & { id?: string }) | null>(openCustomer)
  const [se, setSe] = useState<(Omit<Salesperson, 'id'> & { id?: string }) | null>(null)
  const [co, setCo] = useState<Settings>(s.settings[0])

  const addButton = { magazijnen: [tx("Magazijn toevoegen"), () => setWh({ ...NEW.warehouse })], leveranciers: [tx("Leverancier toevoegen"), () => setSu({ ...NEW.supplier })], klanten: [tx("Klant toevoegen"), () => setCu({ ...NEW.customer })], medewerkers: [tx("Medewerker toevoegen"), () => setSe({ name: '', email: '', phone: '', is_active: true, role: 'verkoper' })] } as Record<string, [string, () => void]>
  const need = (ok: unknown, msg: string) => { if (!ok) toast(msg, true); return !!ok }

  return (
    <>
      <Head title={tx("Instellingen")} sub={tx("De vaste gegevens waar het hele proces op draait.")}>
        {tab !== 'bedrijf' && tab !== 'toeslagen' && <button className="btn primary" onClick={addButton[tab][1]}><Plus size={16} />{addButton[tab][0]}</button>}
      </Head>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'magazijnen', label: tx("Magazijnen"), n: s.warehouses.length },
        { value: 'leveranciers', label: tx("Leveranciers"), n: s.suppliers.length }, { value: 'toeslagen', label: tx("Toeslagen") }, { value: 'klanten', label: tx("Klanten"), n: s.customers.length }, { value: 'medewerkers', label: tx("Medewerkers"), n: s.salespeople.length }, { value: 'bedrijf', label: tx("Bedrijf en factuur") },
      ]} />

      {tab === 'magazijnen' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Code")}</th><th>{tx("Naam")}</th><th>{tx("Soort")}</th><th>{tx("Plaats")}</th><th>{tx("Ontvangt goederen")}</th><th>{tx("Levert uit")}</th><th>{tx("Status")}</th></tr></thead>
        <tbody>{s.warehouses.map((w) => (
          <tr key={w.id} className="click" onClick={() => setWh(w)}><td className="strong">{w.code}</td><td>{w.name}</td><td>{tx(w.kind[0].toUpperCase() + w.kind.slice(1))}</td><td>{w.city}</td><td>{w.receives_goods ? tx("Ja") : tx("Nee")}</td><td>{w.ships_goods ? tx("Ja") : tx("Nee")}</td><td>{w.is_active ? <Pill tone="good">{tx("Actief")}</Pill> : <Pill>{tx("Inactief")}</Pill>}</td></tr>
        ))}</tbody>
      </table></div></section>}


      {tab === 'leveranciers' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Naam")}</th><th>{tx("Afkorting")}</th><th>{tx("Postcode")}</th><th>{tx("Plaats")}</th><th>{tx("Land")}</th><th>{tx("Contact")}</th><th className="num">{tx("Levertijd")}</th></tr></thead>
        <tbody>{s.suppliers.map((x) => <tr key={x.id} className="click" onClick={() => setSu(x)}><td className="strong">{x.name}</td><td>{x.code || '–'}</td><td className="muted">{x.postal_code || '–'}</td><td>{x.city}</td><td>{x.country}</td><td className="muted">{x.contact_name || x.email || '–'}</td><td className="num">{x.lead_time_days} {tx("dagen")}</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'klanten' && <CustomerList customers={s.customers} onOpen={setCu} />}

      {tab === 'medewerkers' && <section className="panel">
        <p className="small muted" style={{ margin: '0 0 10px' }}>{tx("Iedere medewerker heeft een rol: Verkoper, Administratie of Beheerder. Elke actieve medewerker kan als verkoper op een verkooporder staan en zich kiezen in de scan-app en bij de etiketten. De toegang per rol wordt later aan de database gekoppeld.")}</p>
        <div className="table-wrap"><table>
        <thead><tr><th>{tx("Naam")}</th><th>{tx("Rol")}</th><th>{tx("E-mail")}</th><th>{tx("Telefoon")}</th><th>{tx("Status")}</th></tr></thead>
        <tbody>{s.salespeople.map((x) => <tr key={x.id} className="click" onClick={() => setSe({ ...x, role: roleOf(x) })}><td className="strong">{x.name}</td><td><Pill tone={roleOf(x) === 'beheerder' ? 'info' : ''}>{tx(ROLE_LABEL[roleOf(x)])}</Pill></td><td className="muted">{x.email || '–'}</td><td className="muted">{x.phone || '–'}</td><td>{x.is_active ? <Pill tone="good">{tx("Actief")}</Pill> : <Pill>{tx("Inactief")}</Pill>}</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'toeslagen' && <Surcharges />}

      {tab === 'bedrijf' && <div className="stack">
        <div className="cols-even same-height">
        <section className="panel section">
        <h2>{tx("Bedrijfsgegevens")}</h2>
        <div className="form-grid">
          <TextField className="span-2" label={tx("Juridische naam")} value={co.company_name} onChange={(v) => setCo({ ...co, company_name: v })} />
          <TextField label={tx("CIF")} value={co.tax_id} onChange={(v) => setCo({ ...co, tax_id: v })} />
          <TextField className="span-all" label={tx("Handelsnaam")} hint={tx("Naam op documenten en in mails aan klanten. Leeg = de juridische naam.")} value={co.trade_name ?? ''} onChange={(v) => setCo({ ...co, trade_name: v })} />
          <TextField className="span-2" label={tx("Adres")} value={co.address} onChange={(v) => setCo({ ...co, address: v })} />
          <TextField label={tx("Postcode")} value={co.postal_code} onChange={(v) => setCo({ ...co, postal_code: v })} />
          <TextField label={tx("Plaats")} value={co.city} onChange={(v) => setCo({ ...co, city: v })} />
          <TextField label={tx("Provincie")} value={co.province} onChange={(v) => setCo({ ...co, province: v })} />
          <TextField label={tx("Telefoon")} value={co.phone} onChange={(v) => setCo({ ...co, phone: v })} />
          <TextField label={tx("E-mail")} value={co.email} onChange={(v) => setCo({ ...co, email: v })} />
        </div>
        </section>
        <section className="panel section">
        <h2>{tx("Factuur")}</h2>
        <div className="form-grid">
          <TextField className="span-2" label={tx("IBAN")} value={co.iban} onChange={(v) => setCo({ ...co, iban: v })} />
          <NumberField label={tx("Betaaltermijn (dagen)")} value={co.payment_days} min={0} step="1" onChange={(v) => setCo({ ...co, payment_days: v })} />
          <AreaField className="span-all" label={tx("Tekst onderaan de factuur")} value={co.invoice_footer} onChange={(v) => setCo({ ...co, invoice_footer: v })} />
        </div>
        </section>
        </div>
        <div className="cols-even same-height">
        <section className="panel section">
        <h2>{tx("Afleverbon")}</h2>
        <p className="small muted">{tx("Bij Digitaal tekent de klant in de chauffeursapp en wordt de bezorging daarmee afgemeld. Dit geldt voor het eigen bezorgteam; bij een vervoerder blijft de bon op papier.")}</p>
        <div className="form-grid">
          <SelectField label={tx("Soort afleverbon")} value={co.delivery_note_mode ?? 'papier'} onChange={(v: Settings['delivery_note_mode']) => setCo({ ...co, delivery_note_mode: v })} options={[{ value: 'papier', label: tx("Papier, geprint") }, { value: 'digitaal', label: tx("Digitaal, in de chauffeursapp") }]} />
        </div>
        </section>
        <section className="panel section">
        <h2>{tx("Taal van documenten")}</h2>
        <p className="small muted">{tx("Kies per document in welke taal het wordt afgedrukt. Productnamen blijven zoals ze zijn ingevoerd.")}</p>
        <div className="form-grid">
          <SelectField label={tx("Inkooporder")} value={co.language_purchase_order ?? 'nl'} onChange={(v: Language) => setCo({ ...co, language_purchase_order: v })} options={[{ value: 'nl', label: tx("Nederlands") }, { value: 'en', label: tx("Engels") }, { value: 'es', label: tx("Spaans") }]} />
          <SelectField label={tx("Lijsten (factuuroverzicht)")} value={co.language_lists ?? 'scherm'} onChange={(v: ListLanguage) => setCo({ ...co, language_lists: v })} options={[{ value: 'scherm', label: tx("Schermtaal") }, { value: 'nl', label: tx("Nederlands") }, { value: 'en', label: tx("Engels") }, { value: 'es', label: tx("Spaans") }]} />
          {([['language_sales_order', tx("Verkooporder")], ['language_delivery_note', tx("Afleverbon")], ['language_invoice', tx("Factuur")], ['language_invoice_simplified', tx("Eenvoudige factuur (kassa)")]] as const).map(([field, label]) => (
            <SelectField key={field} label={label} value={co[field] ?? (field === 'language_invoice_simplified' ? 'es' : 'klant')} onChange={(v: DocumentLanguage) => setCo({ ...co, [field]: v })} options={[{ value: 'klant', label: tx("Taal van de klant") }, { value: 'es', label: tx("Spaans") }, { value: 'en', label: tx("Engels") }, { value: 'nl', label: tx("Nederlands") }]} />
          ))}
        </div>
        </section>
        </div>
        <section className="panel section">
        <h2>{tx("Mailen aan de klant")}</h2>
        <p className="small muted">{tx("Kies welke documenten Bella Flow automatisch naar het e-mailadres van de klant mailt, als pdf en in de taal van de klant. Staat een document uit, dan gaat het niet vanzelf de deur uit; met de hand mailen vanaf het document blijft mogelijk.")}</p>
        <div className="mail-docs">
          {([['mail_sales_order', tx("Verkooporder"), tx("Na aanmaken of bevestigen, met prijzen. Niet bij afrekenen aan de kassa.")], ['mail_invoice_simplified', tx("Eenvoudige factuur"), tx("Na afrekenen aan de Kassa.")], ['mail_invoice', tx("Factuur"), tx("Na Afrekenen, factureren en meegeven op een verkooporder.")], ['mail_signed_note', tx("Afleverbon getekend"), tx("Na tekenen in de chauffeursapp.")]] as const).map(([field, label, hint]) => (
            <div key={field}><Check label={label} checked={mailsAutomatically(co, field)} onChange={(v) => setCo({ ...co, [field]: v })} /><div className="small muted">{hint}</div></div>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <TextField className="span-2" label={tx("Winkel e-mail")} type="email" value={co.shop_email ?? ''} onChange={(v) => setCo({ ...co, shop_email: v })} hint={tx("Afzender en antwoordadres; krijgt een bcc van elk gemaild document.")} />
        </div>
        </section>
        <section className="panel section">
        <h2>{tx("Kassa: afdrukken")}</h2>
        <p className="small muted">{tx("Kies hoe de eenvoudige factuur van de kassa uit de printer komt: op A4 of als kassabon op een thermische bonprinter met rollen van 80 mm. Geldt ook voor retouren aan de kassa. Gewone facturen blijven A4, de gemailde pdf ook.")}</p>
        <div className="form-grid">
          <SelectField label={tx("Eenvoudige factuur afdrukken")} value={simplifiedPrint(co)} onChange={(v: SimplifiedPrint) => setCo({ ...co, print_invoice_simplified: v })} options={[{ value: 'a4', label: tx("Eenvoudige factuur op A4") }, { value: 'bon80', label: tx("Kassabon, thermische printer 80 mm") }]} hint={simplifiedPrint(co) === 'bon80' ? tx("Kies in het afdrukvenster de bonprinter, papierformaat 80 mm en marges Geen.") : undefined} />
        </div>
        </section>
        <div className="cols-even same-height">
        <section className="panel section">
        <h2>{tx("Kassa: Bella Outdoor and Furnishing")}</h2>
        <p className="small muted">{tx("Logo linksboven en klein beeldmerk onderaan op de eenvoudige factuur van Bella. De bedrijfsgegevens komen uit Bedrijfsgegevens hierboven.")}</p>
        <div className="form-grid">
          <LogoUpload label={tx("Logo")} value={co.logo_bella ?? BELLA_DEFAULTS.logo_bella} onChange={(v) => setCo({ ...co, logo_bella: v })} max={1000} />
          <LogoUpload label={tx("Beeldmerk")} value={co.mark_bella ?? BELLA_DEFAULTS.mark_bella} onChange={(v) => setCo({ ...co, mark_bella: v })} max={300} />
        </div>
        </section>
        <section className="panel section">
        <h2>{tx("Kassa: Handmade Bali Treasures SL (HDB)")}</h2>
        <p className="small muted">{tx("Tweede bedrijf aan de kassa (HomeDecoBali), buiten de boekhouding van Bella. Deze gegevens staan onderaan de eenvoudige factuur van HDB.")}</p>
        <div className="form-grid">
          <TextField className="span-2" label={tx("Juridische naam")} value={co.hdb_company_name ?? HDB_DEFAULTS.hdb_company_name} onChange={(v) => setCo({ ...co, hdb_company_name: v })} />
          <TextField label={tx("CIF")} value={co.hdb_tax_id ?? HDB_DEFAULTS.hdb_tax_id} onChange={(v) => setCo({ ...co, hdb_tax_id: v })} />
          <TextField className="span-2" label={tx("Adres")} value={co.hdb_address ?? HDB_DEFAULTS.hdb_address} onChange={(v) => setCo({ ...co, hdb_address: v })} />
          <TextField label={tx("Postcode")} value={co.hdb_postal_code ?? HDB_DEFAULTS.hdb_postal_code} onChange={(v) => setCo({ ...co, hdb_postal_code: v })} />
          <TextField label={tx("Plaats")} value={co.hdb_city ?? HDB_DEFAULTS.hdb_city} onChange={(v) => setCo({ ...co, hdb_city: v })} />
          <TextField label={tx("Provincie")} value={co.hdb_province ?? HDB_DEFAULTS.hdb_province} onChange={(v) => setCo({ ...co, hdb_province: v })} />
          <TextField label={tx("Land")} value={co.hdb_country ?? HDB_DEFAULTS.hdb_country} onChange={(v) => setCo({ ...co, hdb_country: v })} />
          <TextField label={tx("Telefoon")} value={co.hdb_phone ?? ''} onChange={(v) => setCo({ ...co, hdb_phone: v })} />
          <TextField label={tx("E-mail")} value={co.hdb_email ?? ''} onChange={(v) => setCo({ ...co, hdb_email: v })} />
          <LogoUpload label={tx("Logo")} value={co.logo_hdb ?? HDB_DEFAULTS.logo_hdb} onChange={(v) => setCo({ ...co, logo_hdb: v })} max={1000} />
          <LogoUpload label={tx("Beeldmerk")} value={co.mark_hdb ?? HDB_DEFAULTS.mark_hdb} onChange={(v) => setCo({ ...co, mark_hdb: v })} max={300} />
        </div>
        </section>
        </div>
        <section className="panel section">
        <h2>{tx("Documentnummers")}</h2>
        <p className="small muted">{tx("Nummers bestaan uit voorvoegsel, jaar en teller. Een nieuw voorvoegsel geldt voor nieuwe documenten en de teller loopt door. Bestaande documenten houden hun nummer.")}</p>
        <div className="form-grid">
          {([['prefix_purchase', tx("Inkooporders")], ['prefix_delivery', tx("Afleverbonnen")], ['prefix_proforma', tx("Proforma's")], ['prefix_invoice', tx("Facturen")], ['prefix_invoice_simplified', tx("Eenvoudige fact Bella")], ['prefix_invoice_simplified_hdb', tx("Eenvoudige fact HDB")], ['prefix_invoice_credit', tx("Creditfacturen")], ['prefix_invoice_credit_simplified', tx("Creditfact kassa Bella")], ['prefix_invoice_credit_simplified_hdb', tx("Creditfact kassa HDB")], ['prefix_sales_order', tx("Verkooporders")], ['prefix_receipt', tx("Goederenontvangsten")], ['prefix_transport', tx("Transporten")]] as [PrefixField, string][]).map(([field, label]) => (
            <TextField key={field} label={label} value={co[field] ?? ''} onChange={(v) => setCo({ ...co, [field]: v.toUpperCase() })} hint={tx("Bijvoorbeeld {0}", `${co[field] || (field === 'prefix_proforma' ? 'PF' : field === 'prefix_invoice_simplified' ? 'FS-BELLA' : field === 'prefix_invoice_simplified_hdb' ? 'FS-HDB' : field === 'prefix_invoice_credit' ? 'FR' : field === 'prefix_invoice_credit_simplified' ? 'FRS-BELLA' : field === 'prefix_invoice_credit_simplified_hdb' ? 'FRS-HDB' : '…')}-${new Date().getFullYear()}-0001`)} />
          ))}
        </div>
        </section>
        <div className="sticky-save"><button className="btn primary" onClick={() => { const { id: _i, ...patch } = co; run((db) => saveSettings(db, patch), tx("Bedrijfsgegevens opgeslagen")) }}>{tx("Opslaan")}</button></div>
      </div>}

      {se && <Modal title={se.id ? se.name : tx("Medewerker toevoegen")} onClose={() => setSe(null)} footer={<>
        <button className="btn" onClick={() => setSe(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(se.name.trim(), tx("Vul de naam in.")) && await run((db) => saveStaff(db, se), tx("Medewerker opgeslagen"))) setSe(null) }}>{tx("Opslaan")}</button>
      </>}>
        <div className="form-grid">
          <TextField label={tx("Naam")} value={se.name} onChange={(v) => setSe({ ...se, name: v })} />
          <SelectField label={tx("Rol")} value={roleOf(se)} onChange={(v) => setSe({ ...se, role: v })} options={STAFF_ROLES.map((r) => ({ value: r, label: tx(ROLE_LABEL[r]) }))} />
          <TextField label={tx("E-mail")} value={se.email} onChange={(v) => setSe({ ...se, email: v })} />
          <TextField label={tx("Telefoon")} value={se.phone} onChange={(v) => setSe({ ...se, phone: v })} />
        </div>
        <Check label={tx("Actief")} checked={se.is_active} onChange={(v) => setSe({ ...se, is_active: v })} />
        <p className="small muted" style={{ margin: 0 }}>{tx("Een inactieve medewerker staat niet meer in de keuzelijsten. Bestaande verkooporders blijven aan hem gekoppeld.")}</p>
      </Modal>}

      {wh && <Modal wide title={wh.id ? wh.name : tx("Magazijn toevoegen")} onClose={() => setWh(null)} footer={<>
        <button className="btn" onClick={() => setWh(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(wh.code && wh.name, tx("Vul een code en een naam in.")) && await run((db) => saveRecord(db, 'warehouses', wh as Warehouse), tx("Magazijn opgeslagen"))) setWh(null) }}>{tx("Opslaan")}</button>
      </>}>
        <div className="form-grid">
          <TextField label={tx("Code")} value={wh.code} onChange={(v) => setWh({ ...wh, code: v })} placeholder={tx("MAG-CAM")} />
          <TextField className="span-2" label={tx("Naam")} value={wh.name} onChange={(v) => setWh({ ...wh, name: v })} />
          <SelectField label={tx("Soort")} value={wh.kind} onChange={(v) => setWh({ ...wh, kind: v })} options={[{ value: 'winkel', label: tx("Winkel") }, { value: 'magazijn', label: tx("Magazijn") }, { value: 'extern', label: tx("Externe opslag") }]} />
          <TextField className="span-2" label={tx("Adres")} value={wh.address} onChange={(v) => setWh({ ...wh, address: v })} />
          <TextField label={tx("Postcode")} value={wh.postal_code} onChange={(v) => setWh({ ...wh, postal_code: v })} />
          <TextField label={tx("Plaats")} value={wh.city} onChange={(v) => setWh({ ...wh, city: v })} />
          <TextField label={tx("Contactpersoon")} value={wh.contact_name} onChange={(v) => setWh({ ...wh, contact_name: v })} />
          <TextField label={tx("Telefoon")} value={wh.phone} onChange={(v) => setWh({ ...wh, phone: v })} />
          <NumberField label={tx("Breedtegraad")} value={wh.latitude ?? 0} onChange={(v) => setWh({ ...wh, latitude: v })} />
          <NumberField label={tx("Lengtegraad")} value={wh.longitude ?? 0} onChange={(v) => setWh({ ...wh, longitude: v })} />
        </div>
        <div className="actions" style={{ gap: '4px 22px' }}>
          <Check label={tx("Ontvangt goederen")} checked={wh.receives_goods} onChange={(v) => setWh({ ...wh, receives_goods: v })} />
          <Check label={tx("Levert uit aan klanten")} checked={wh.ships_goods} onChange={(v) => setWh({ ...wh, ships_goods: v })} />
          <Check label={tx("Vertrekpunt bezorgroute")} checked={wh.is_route_origin} onChange={(v) => setWh({ ...wh, is_route_origin: v })} />
          <Check label={tx("Actief")} checked={wh.is_active} onChange={(v) => setWh({ ...wh, is_active: v })} />
        </div>
      </Modal>}


      {su && <Modal wide title={su.id ? su.name : tx("Leverancier toevoegen")} onClose={() => setSu(null)} footer={<>
        <button className="btn" onClick={() => setSu(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(su.name, tx("Vul de naam in.")) && await run((db) => saveSupplier(db, su as Supplier), tx("Leverancier opgeslagen"))) setSu(null) }}>{tx("Opslaan")}</button>
      </>}>
        <div className="form-grid">
          <TextField className="span-2" label={tx("Naam")} value={su.name} onChange={(v) => setSu({ ...su, name: v })} />
          <TextField label={tx("BTW-nummer")} value={su.vat_number} onChange={(v) => setSu({ ...su, vat_number: v })} />
          <TextField label={tx("Afkorting (3 letters)")} value={su.code ?? ''} onChange={(v) => setSu({ ...su, code: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) })} hint={tx("Begin van het eigen artikelnummer, bijvoorbeeld LOL-LOU-0000000001. Wijzigen geldt alleen voor nieuwe artikelen.")} />
          <TextField label={tx("Contactpersoon")} value={su.contact_name} onChange={(v) => setSu({ ...su, contact_name: v })} />
          <TextField label={tx("E-mail")} value={su.email} onChange={(v) => setSu({ ...su, email: v })} />
          <TextField label={tx("Telefoon")} value={su.phone} onChange={(v) => setSu({ ...su, phone: v })} />
          <TextField className="span-2" label={tx("Adres")} value={su.address} onChange={(v) => setSu({ ...su, address: v })} />
          <TextField label={tx("Postcode")} value={su.postal_code} onChange={(v) => setSu({ ...su, postal_code: v })} />
          <TextField label={tx("Plaats")} value={su.city} onChange={(v) => setSu({ ...su, city: v })} />
          <TextField label={tx("Land")} value={su.country} onChange={(v) => setSu({ ...su, country: v })} hint={isSpanishSupplier(su) ? tx("Spanje: inkoop zonder Ontvangen in NL en transport; de leverancier levert bij ons af.") : tx("Vul España of Spanje in voor een leverancier in Spanje.")} />
          <NumberField label={tx("Levertijd (dagen)")} value={su.lead_time_days} step="1" min={0} onChange={(v) => setSu({ ...su, lead_time_days: v })} />
          <TextField label={tx("Betaalvoorwaarden")} value={su.payment_terms} onChange={(v) => setSu({ ...su, payment_terms: v })} />
          <AreaField className="span-all" label={tx("Notitie")} value={su.notes} onChange={(v) => setSu({ ...su, notes: v })} />
        </div>
      </Modal>}

      {cu && <Modal wide title={cu.id ? cu.name : tx("Klant toevoegen")} onClose={() => setCu(null)} footer={<>
        <button className="btn" onClick={() => setCu(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(cu.name, tx("Vul de naam in.")) && await run((db) => saveRecord(db, 'customers', cu as Customer), tx("Klant opgeslagen"))) setCu(null) }}>{tx("Opslaan")}</button>
      </>}>
        <CustomerFields c={cu} set={(p) => setCu({ ...cu, ...p })} />
      </Modal>}
    </>
  )
}

/** Toeslag per leverancier op de prijs van de leverancier, voor transport en distributie van Nederland naar Spanje. */
const CUSTOMER_PAGE_SIZE = 50

/** Klantenlijst onder Instellingen: 50 regels per pagina, met paginering en een knop naar boven, zoals in Catalogi. */
function CustomerList({ customers: all, onOpen }: { customers: Customer[]; onOpen: (c: Customer) => void }) {
  const [page, setPage] = useNavUi('klanten-pagina', 1)
  const [q, setQ] = useNavUi('klanten-zoek', '')
  const listTop = useRef<HTMLElement>(null)
  const words = fold(q).split(/\s+/).filter(Boolean)
  const customers = words.length ? all.filter((c) => { const hay = fold([c.name, c.company, c.city, c.phone, c.email, c.tax_id].join(' ')); return words.every((w) => hay.includes(w)) }) : all
  const pages = Math.max(1, Math.ceil(customers.length / CUSTOMER_PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = customers.slice((current - 1) * CUSTOMER_PAGE_SIZE, current * CUSTOMER_PAGE_SIZE)
  const goPage = (p: number) => { setPage(p); listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  return (
    <section className="panel" ref={listTop}>
      <input style={{ maxWidth: 320, marginBottom: 14 }} aria-label={tx("Klanten zoeken")} placeholder={tx("Zoek op naam, plaats, telefoon, e-mail of NIF")} value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
      {customers.length === 0 && <Empty>{tx("Geen klanten gevonden.")}</Empty>}
      <div className="table-wrap"><table>
        <thead><tr><th>{tx("Naam")}</th><th>{tx("Soort")}</th><th>{tx("Plaats")}</th><th>{tx("Telefoon")}</th><th>{tx("E-mail")}</th><th>{tx("Factuurtaal")}</th></tr></thead>
        <tbody>{shown.map((c) => <tr key={c.id} className="click" onClick={() => onOpen(c)}><td className="strong">{c.company || c.name}</td><td>{tx(c.kind[0].toUpperCase() + c.kind.slice(1))}</td><td>{c.city}</td><td>{c.phone}</td><td className="muted">{c.email}</td><td>{{ es: tx("Spaans"), nl: tx("Nederlands"), en: tx("Engels") }[c.language]}</td></tr>)}</tbody>
      </table></div>
      {customers.length > 0 && <Pager page={current} size={CUSTOMER_PAGE_SIZE} total={customers.length} onPage={goPage} />}
      <BackToTop />
    </section>
  )
}

function Surcharges() {
  const { s, run } = useApp()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const save = async (id: string) => {
    const v = draft[id]
    if (v === undefined) return
    const pct = Number(v.replace(',', '.'))
    if (await run((db) => saveSupplierSurcharge(db, id, pct), tx("Toeslag opgeslagen"))) setDraft(({ [id]: _x, ...rest }) => rest)
  }
  return (
    <section className="panel">
      <p className="muted small" style={{ marginTop: 0 }}>{tx("Toeslag op de prijs van de leverancier voor transport en distributie naar Spanje. In de verkooporder zit de toeslag onzichtbaar in de prijs van een catalogusartikel. Een artikel dat al eens verkocht is, houdt zijn verkoopprijs.")}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>{tx("Leverancier")}</th><th>{tx("Afkorting")}</th><th style={{ width: 160 }}>{tx("Toeslag %")}</th><th className="num">{tx("Prijs leverancier")}</th><th className="num">{tx("Prijs in verkooporder")}</th></tr></thead>
        <tbody>{s.suppliers.map((x) => {
          const value = draft[x.id] ?? String(x.price_surcharge_pct ?? 0)
          const pct = Number(value.replace(',', '.'))
          return (
            <tr key={x.id}>
              <td className="strong">{x.name}</td>
              <td>{x.code || '–'}</td>
              <td><input type="number" inputMode="decimal" min={0} max={500} step="0.5" aria-label={tx("Toeslag % voor {0}", x.name)} value={value}
                onChange={(e) => setDraft((d) => ({ ...d, [x.id]: e.target.value }))} onBlur={() => void save(x.id)} onKeyDown={(e) => { if (e.key === 'Enter') void save(x.id) }} /></td>
              <td className="num muted">{eur(100)}</td>
              <td className="num">{Number.isFinite(pct) ? eur(priceWithSurcharge(100, { price_surcharge_pct: pct })!) : '–'}</td>
            </tr>
          )
        })}</tbody>
      </table></div>
    </section>
  )
}

/**
 * Logo of beeldmerk uploaden voor de eenvoudige factuur. De afbeelding wordt in de browser verkleind (max. `max` pixels)
 * en als PNG (data-URL) bij de instellingen bewaard; na upload is hij direct zichtbaar. Opslaan gaat met de knop Opslaan.
 */
function LogoUpload({ label, value, onChange, max }: { label: string; value: string; onChange: (v: string) => void; max: number }) {
  const { toast } = useApp()
  const input = useRef<HTMLInputElement>(null)
  const pick = (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return toast(tx("Kies een afbeelding (PNG, JPG, WebP of SVG)."), true)
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round((img.naturalWidth || max) * scale))
        canvas.height = Math.max(1, Math.round((img.naturalHeight || max) * scale))
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
        onChange(canvas.toDataURL('image/png'))
      }
      img.onerror = () => toast(tx("Deze afbeelding kan niet worden gelezen."), true)
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }
  return (
    <div className="field span-2 logo-upload">
      <span className="lbl">{label}</span>
      <div className="logo-preview">{value ? <img src={imageSrc(value, import.meta.env.BASE_URL)} alt={label} /> : <span className="small muted">{tx("Nog geen afbeelding")}</span>}</div>
      <div className="actions">
        <button type="button" className="btn sm" onClick={() => input.current?.click()}>{value ? tx("Andere afbeelding") : tx("Uploaden")}</button>
        {value && <button type="button" className="btn sm" onClick={() => onChange('')}>{tx("Verwijderen")}</button>}
        <span className="small muted">{tx("Wordt bewaard met Opslaan.")}</span>
      </div>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}
