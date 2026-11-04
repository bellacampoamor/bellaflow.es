import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Customer, Product, Salesperson, Settings, Supplier, Warehouse } from '../data/types'
import { saveRecord, saveSettings, type PrefixField } from '../domain/services'
import { useApp } from '../ui/app-context'
import { AreaField, Check, eur, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField } from '../ui/kit'
import { CustomerFields } from './OrderForm'
import { tx } from '../i18n'

type Tab = 'magazijnen' | 'producten' | 'leveranciers' | 'klanten' | 'verkopers' | 'bedrijf'

const NEW = {
  warehouse: { code: '', name: '', kind: 'magazijn', address: '', postal_code: '', city: '', phone: '', contact_name: '', receives_goods: true, ships_goods: true, is_active: true, latitude: null, longitude: null, is_route_origin: false } as Omit<Warehouse, 'id'>,
  product: { sku: '', name: '', collection: '', category: '', material: '', color: '', dimensions: '', weight_kg: 0, colli: 1, purchase_price: 0, sale_price: 0, vat_rate: 21, supplier_id: null, min_stock: 0, is_active: true, volume_m3: 0 } as Omit<Product, 'id'>,
  supplier: { name: '', vat_number: '', contact_name: '', email: '', phone: '', address: '', postal_code: '', city: '', country: 'Nederland', lead_time_days: 21, payment_terms: '', notes: '', is_active: true } as Omit<Supplier, 'id'>,
  customer: { kind: 'particulier', name: '', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: 'Alicante', country: 'España', notes: '' } as Omit<Customer, 'id'>,
}

export function Admin() {
  const { s, run, toast } = useApp()
  const [tab, setTab] = useState<Tab>('magazijnen')
  const [wh, setWh] = useState<(Omit<Warehouse, 'id'> & { id?: string }) | null>(null)
  const [pr, setPr] = useState<(Omit<Product, 'id'> & { id?: string }) | null>(null)
  const [su, setSu] = useState<(Omit<Supplier, 'id'> & { id?: string }) | null>(null)
  const [cu, setCu] = useState<(Omit<Customer, 'id'> & { id?: string }) | null>(null)
  const [se, setSe] = useState<(Omit<Salesperson, 'id'> & { id?: string }) | null>(null)
  const [co, setCo] = useState<Settings>(s.settings[0])

  const addButton = { magazijnen: [tx("Magazijn toevoegen"), () => setWh({ ...NEW.warehouse })], producten: [tx("Product toevoegen"), () => setPr({ ...NEW.product })], leveranciers: [tx("Leverancier toevoegen"), () => setSu({ ...NEW.supplier })], klanten: [tx("Klant toevoegen"), () => setCu({ ...NEW.customer })], verkopers: [tx("Verkoper toevoegen"), () => setSe({ name: '', email: '', phone: '', is_active: true })] } as Record<string, [string, () => void]>
  const need = (ok: unknown, msg: string) => { if (!ok) toast(msg, true); return !!ok }

  return (
    <>
      <Head title={tx("Beheer")} sub={tx("De vaste gegevens waar het hele proces op draait.")}>
        {tab !== 'bedrijf' && <button className="btn primary" onClick={addButton[tab][1]}><Plus size={16} />{addButton[tab][0]}</button>}
      </Head>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'magazijnen', label: tx("Magazijnen"), n: s.warehouses.length }, { value: 'producten', label: tx("Producten"), n: s.products.length },
        { value: 'leveranciers', label: tx("Leveranciers"), n: s.suppliers.length }, { value: 'klanten', label: tx("Klanten"), n: s.customers.length }, { value: 'verkopers', label: tx("Verkopers"), n: s.salespeople.length }, { value: 'bedrijf', label: tx("Bedrijf en factuur") },
      ]} />

      {tab === 'magazijnen' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Code")}</th><th>{tx("Naam")}</th><th>{tx("Soort")}</th><th>{tx("Plaats")}</th><th>{tx("Ontvangt goederen")}</th><th>{tx("Levert uit")}</th><th>{tx("Status")}</th></tr></thead>
        <tbody>{s.warehouses.map((w) => (
          <tr key={w.id} className="click" onClick={() => setWh(w)}><td className="strong">{w.code}</td><td>{w.name}</td><td>{tx(w.kind[0].toUpperCase() + w.kind.slice(1))}</td><td>{w.city}</td><td>{w.receives_goods ? tx("Ja") : tx("Nee")}</td><td>{w.ships_goods ? tx("Ja") : tx("Nee")}</td><td>{w.is_active ? <Pill tone="good">{tx("Actief")}</Pill> : <Pill>{tx("Inactief")}</Pill>}</td></tr>
        ))}</tbody>
      </table></div></section>}

      {tab === 'producten' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Artikelnummer")}</th><th>{tx("Naam")}</th><th>{tx("Collectie")}</th><th>{tx("Categorie")}</th><th>{tx("Maten")}</th><th>{tx("Leverancier")}</th><th className="num">{tx("Inkoop")}</th><th className="num">{tx("Verkoop incl.")}</th></tr></thead>
        <tbody>{s.products.map((p) => (
          <tr key={p.id} className="click" onClick={() => setPr(p)}><td className="strong">{p.sku}</td><td>{p.name}</td><td>{p.collection}</td><td>{p.category}</td><td className="muted small">{p.dimensions}</td><td>{s.suppliers.find((x) => x.id === p.supplier_id)?.name ?? '–'}</td><td className="num">{eur(p.purchase_price)}</td><td className="num">{eur(p.sale_price)}</td></tr>
        ))}</tbody>
      </table></div></section>}

      {tab === 'leveranciers' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Naam")}</th><th>{tx("Postcode")}</th><th>{tx("Plaats")}</th><th>{tx("Land")}</th><th>{tx("Contact")}</th><th className="num">{tx("Levertijd")}</th></tr></thead>
        <tbody>{s.suppliers.map((x) => <tr key={x.id} className="click" onClick={() => setSu(x)}><td className="strong">{x.name}</td><td className="muted">{x.postal_code || '–'}</td><td>{x.city}</td><td>{x.country}</td><td className="muted">{x.contact_name || x.email || '–'}</td><td className="num">{x.lead_time_days} {tx("dagen")}</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'klanten' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Naam")}</th><th>{tx("Soort")}</th><th>{tx("Plaats")}</th><th>{tx("Telefoon")}</th><th>{tx("E-mail")}</th><th>{tx("Factuurtaal")}</th></tr></thead>
        <tbody>{s.customers.map((c) => <tr key={c.id} className="click" onClick={() => setCu(c)}><td className="strong">{c.company || c.name}</td><td>{tx(c.kind[0].toUpperCase() + c.kind.slice(1))}</td><td>{c.city}</td><td>{c.phone}</td><td className="muted">{c.email}</td><td>{{ es: tx("Spaans"), nl: tx("Nederlands"), en: tx("Engels") }[c.language]}</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'verkopers' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>{tx("Naam")}</th><th>{tx("E-mail")}</th><th>{tx("Telefoon")}</th><th>{tx("Status")}</th></tr></thead>
        <tbody>{s.salespeople.map((x) => <tr key={x.id} className="click" onClick={() => setSe(x)}><td className="strong">{x.name}</td><td className="muted">{x.email || '–'}</td><td className="muted">{x.phone || '–'}</td><td>{x.is_active ? <Pill tone="good">{tx("Actief")}</Pill> : <Pill>{tx("Inactief")}</Pill>}</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'bedrijf' && <section className="panel">
        <h2>{tx("Bedrijf en factuur")}</h2>
        <div className="form-grid">
          <TextField className="span-2" label={tx("Bedrijfsnaam")} value={co.company_name} onChange={(v) => setCo({ ...co, company_name: v })} />
          <TextField label={tx("CIF")} value={co.tax_id} onChange={(v) => setCo({ ...co, tax_id: v })} />
          <TextField className="span-2" label={tx("Adres")} value={co.address} onChange={(v) => setCo({ ...co, address: v })} />
          <TextField label={tx("Postcode")} value={co.postal_code} onChange={(v) => setCo({ ...co, postal_code: v })} />
          <TextField label={tx("Plaats")} value={co.city} onChange={(v) => setCo({ ...co, city: v })} />
          <TextField label={tx("Provincie")} value={co.province} onChange={(v) => setCo({ ...co, province: v })} />
          <TextField label={tx("Telefoon")} value={co.phone} onChange={(v) => setCo({ ...co, phone: v })} />
          <TextField label={tx("E-mail")} value={co.email} onChange={(v) => setCo({ ...co, email: v })} />
          <TextField className="span-2" label={tx("IBAN")} value={co.iban} onChange={(v) => setCo({ ...co, iban: v })} />
          <NumberField label={tx("Betaaltermijn (dagen)")} value={co.payment_days} min={0} step="1" onChange={(v) => setCo({ ...co, payment_days: v })} />
          <AreaField className="span-all" label={tx("Tekst onderaan de factuur")} value={co.invoice_footer} onChange={(v) => setCo({ ...co, invoice_footer: v })} />
        </div>
        <h2 style={{ margin: '22px 0 4px' }}>{tx("Documentnummers")}</h2>
        <p className="small muted" style={{ margin: '0 0 12px' }}>{tx("Nummers bestaan uit voorvoegsel, jaar en teller. Een nieuw voorvoegsel geldt voor nieuwe documenten en de teller loopt door. Bestaande documenten houden hun nummer.")}</p>
        <div className="form-grid">
          {([['prefix_purchase', tx("Inkooporders")], ['prefix_delivery', tx("Afleverbonnen")], ['prefix_proforma', tx("Proforma's")], ['prefix_invoice', tx("Facturen")], ['prefix_sales_order', tx("Verkooporders")], ['prefix_receipt', tx("Goederenontvangsten")], ['prefix_transport', tx("Transporten")]] as [PrefixField, string][]).map(([field, label]) => (
            <TextField key={field} label={label} value={co[field] ?? ''} onChange={(v) => setCo({ ...co, [field]: v.toUpperCase() })} hint={tx("Bijvoorbeeld {0}", `${co[field] || (field === 'prefix_proforma' ? 'PF' : '…')}-${new Date().getFullYear()}-0001`)} />
          ))}
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={() => { const { id: _i, ...patch } = co; run((db) => saveSettings(db, patch), tx("Bedrijfsgegevens opgeslagen")) }}>{tx("Opslaan")}</button>
      </section>}

      {se && <Modal title={se.id ? se.name : tx("Verkoper toevoegen")} onClose={() => setSe(null)} footer={<>
        <button className="btn" onClick={() => setSe(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(se.name.trim(), tx("Vul de naam in.")) && await run((db) => saveRecord(db, 'salespeople', se as Salesperson), tx("Verkoper opgeslagen"))) setSe(null) }}>{tx("Opslaan")}</button>
      </>}>
        <div className="form-grid">
          <TextField className="span-2" label={tx("Naam")} value={se.name} onChange={(v) => setSe({ ...se, name: v })} />
          <TextField label={tx("E-mail")} value={se.email} onChange={(v) => setSe({ ...se, email: v })} />
          <TextField label={tx("Telefoon")} value={se.phone} onChange={(v) => setSe({ ...se, phone: v })} />
        </div>
        <Check label={tx("Actief")} checked={se.is_active} onChange={(v) => setSe({ ...se, is_active: v })} />
        <p className="small muted" style={{ margin: 0 }}>{tx("Een inactieve verkoper staat niet meer in de keuzelijst. Bestaande verkooporders blijven aan hem gekoppeld.")}</p>
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

      {pr && <Modal wide title={pr.id ? pr.name : tx("Product toevoegen")} onClose={() => setPr(null)} footer={<>
        <button className="btn" onClick={() => setPr(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(pr.sku && pr.name, tx("Vul een artikelnummer en een naam in.")) && await run((db) => saveRecord(db, 'products', pr as Product), tx("Product opgeslagen"))) setPr(null) }}>{tx("Opslaan")}</button>
      </>}>
        <div className="form-grid">
          <TextField label={tx("Artikelnummer")} value={pr.sku} onChange={(v) => setPr({ ...pr, sku: v })} />
          <TextField className="span-2" label={tx("Naam")} value={pr.name} onChange={(v) => setPr({ ...pr, name: v })} />
          <TextField label={tx("Collectie")} value={pr.collection} onChange={(v) => setPr({ ...pr, collection: v })} />
          <TextField label={tx("Categorie")} value={pr.category} onChange={(v) => setPr({ ...pr, category: v })} />
          <TextField label={tx("Materiaal")} value={pr.material} onChange={(v) => setPr({ ...pr, material: v })} />
          <TextField label={tx("Kleur")} value={pr.color} onChange={(v) => setPr({ ...pr, color: v })} />
          <TextField label={tx("Maten")} value={pr.dimensions} onChange={(v) => setPr({ ...pr, dimensions: v })} placeholder={tx("220 × 92 × 74 cm")} />
          <NumberField label={tx("Gewicht (kg)")} value={pr.weight_kg} min={0} onChange={(v) => setPr({ ...pr, weight_kg: v })} />
          <NumberField label={tx("Volume (m³)")} value={pr.volume_m3} min={0} onChange={(v) => setPr({ ...pr, volume_m3: v })} />
          <NumberField label={tx("Aantal colli")} value={pr.colli} min={1} step="1" onChange={(v) => setPr({ ...pr, colli: v })} />
          <SelectField label={tx("Leverancier")} value={pr.supplier_id} placeholder={tx("Geen vaste leverancier")} onChange={(v) => setPr({ ...pr, supplier_id: v || null })} options={s.suppliers.map((x) => ({ value: x.id, label: x.name }))} />
          <NumberField label={tx("Inkoopprijs excl. IVA")} value={pr.purchase_price} step="0.01" min={0} onChange={(v) => setPr({ ...pr, purchase_price: v })} />
          <NumberField label={tx("Verkoopprijs incl. IVA")} value={pr.sale_price} step="0.01" min={0} onChange={(v) => setPr({ ...pr, sale_price: v })} />
          <NumberField label={tx("IVA %")} value={pr.vat_rate} min={0} onChange={(v) => setPr({ ...pr, vat_rate: v })} />
          <NumberField label={tx("Minimumvoorraad")} value={pr.min_stock} step="1" min={0} onChange={(v) => setPr({ ...pr, min_stock: v })} />
        </div>
        <Check label={tx("Actief in verkoop")} checked={pr.is_active} onChange={(v) => setPr({ ...pr, is_active: v })} />
      </Modal>}

      {su && <Modal wide title={su.id ? su.name : tx("Leverancier toevoegen")} onClose={() => setSu(null)} footer={<>
        <button className="btn" onClick={() => setSu(null)}>{tx("Annuleren")}</button>
        <button className="btn primary" onClick={async () => { if (need(su.name, tx("Vul de naam in.")) && await run((db) => saveRecord(db, 'suppliers', su as Supplier), tx("Leverancier opgeslagen"))) setSu(null) }}>{tx("Opslaan")}</button>
      </>}>
        <div className="form-grid">
          <TextField className="span-2" label={tx("Naam")} value={su.name} onChange={(v) => setSu({ ...su, name: v })} />
          <TextField label={tx("BTW-nummer")} value={su.vat_number} onChange={(v) => setSu({ ...su, vat_number: v })} />
          <TextField label={tx("Contactpersoon")} value={su.contact_name} onChange={(v) => setSu({ ...su, contact_name: v })} />
          <TextField label={tx("E-mail")} value={su.email} onChange={(v) => setSu({ ...su, email: v })} />
          <TextField label={tx("Telefoon")} value={su.phone} onChange={(v) => setSu({ ...su, phone: v })} />
          <TextField className="span-2" label={tx("Adres")} value={su.address} onChange={(v) => setSu({ ...su, address: v })} />
          <TextField label={tx("Postcode")} value={su.postal_code} onChange={(v) => setSu({ ...su, postal_code: v })} />
          <TextField label={tx("Plaats")} value={su.city} onChange={(v) => setSu({ ...su, city: v })} />
          <TextField label={tx("Land")} value={su.country} onChange={(v) => setSu({ ...su, country: v })} />
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
