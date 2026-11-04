import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Customer, Product, Settings, Supplier, Warehouse } from '../data/types'
import { saveRecord } from '../domain/services'
import { useApp } from '../ui/app-context'
import { AreaField, Check, eur, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField } from '../ui/kit'
import { CustomerFields } from './OrderForm'

type Tab = 'magazijnen' | 'producten' | 'leveranciers' | 'klanten' | 'bedrijf'

const NEW = {
  warehouse: { code: '', name: '', kind: 'magazijn', address: '', postal_code: '', city: '', phone: '', contact_name: '', receives_goods: true, ships_goods: true, is_active: true } as Omit<Warehouse, 'id'>,
  product: { sku: '', name: '', collection: '', category: '', material: '', color: '', dimensions: '', weight_kg: 0, colli: 1, purchase_price: 0, sale_price: 0, vat_rate: 21, supplier_id: null, min_stock: 0, is_active: true } as Omit<Product, 'id'>,
  supplier: { name: '', vat_number: '', contact_name: '', email: '', phone: '', address: '', city: '', country: 'Nederland', lead_time_days: 21, payment_terms: '', notes: '', is_active: true } as Omit<Supplier, 'id'>,
  customer: { kind: 'particulier', name: '', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: 'Alicante', country: 'España', notes: '' } as Omit<Customer, 'id'>,
}

export function Admin() {
  const { s, run, toast } = useApp()
  const [tab, setTab] = useState<Tab>('magazijnen')
  const [wh, setWh] = useState<(Omit<Warehouse, 'id'> & { id?: string }) | null>(null)
  const [pr, setPr] = useState<(Omit<Product, 'id'> & { id?: string }) | null>(null)
  const [su, setSu] = useState<(Omit<Supplier, 'id'> & { id?: string }) | null>(null)
  const [cu, setCu] = useState<(Omit<Customer, 'id'> & { id?: string }) | null>(null)
  const [co, setCo] = useState<Settings>(s.settings[0])

  const addButton = { magazijnen: ['Magazijn toevoegen', () => setWh({ ...NEW.warehouse })], producten: ['Product toevoegen', () => setPr({ ...NEW.product })], leveranciers: ['Leverancier toevoegen', () => setSu({ ...NEW.supplier })], klanten: ['Klant toevoegen', () => setCu({ ...NEW.customer })] } as Record<string, [string, () => void]>
  const need = (ok: unknown, msg: string) => { if (!ok) toast(msg, true); return !!ok }

  return (
    <>
      <Head title="Beheer" sub="De vaste gegevens waar het hele proces op draait.">
        {tab !== 'bedrijf' && <button className="btn primary" onClick={addButton[tab][1]}><Plus size={16} />{addButton[tab][0]}</button>}
      </Head>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'magazijnen', label: 'Magazijnen', n: s.warehouses.length }, { value: 'producten', label: 'Producten', n: s.products.length },
        { value: 'leveranciers', label: 'Leveranciers', n: s.suppliers.length }, { value: 'klanten', label: 'Klanten', n: s.customers.length }, { value: 'bedrijf', label: 'Bedrijf en factuur' },
      ]} />

      {tab === 'magazijnen' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Naam</th><th>Soort</th><th>Plaats</th><th>Ontvangt goederen</th><th>Levert uit</th><th>Status</th></tr></thead>
        <tbody>{s.warehouses.map((w) => (
          <tr key={w.id} className="click" onClick={() => setWh(w)}><td className="strong">{w.code}</td><td>{w.name}</td><td>{w.kind[0].toUpperCase() + w.kind.slice(1)}</td><td>{w.city}</td><td>{w.receives_goods ? 'Ja' : 'Nee'}</td><td>{w.ships_goods ? 'Ja' : 'Nee'}</td><td>{w.is_active ? <Pill tone="good">Actief</Pill> : <Pill>Inactief</Pill>}</td></tr>
        ))}</tbody>
      </table></div></section>}

      {tab === 'producten' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Artikelnummer</th><th>Naam</th><th>Collectie</th><th>Categorie</th><th>Maten</th><th>Leverancier</th><th className="num">Inkoop</th><th className="num">Verkoop incl.</th></tr></thead>
        <tbody>{s.products.map((p) => (
          <tr key={p.id} className="click" onClick={() => setPr(p)}><td className="strong">{p.sku}</td><td>{p.name}</td><td>{p.collection}</td><td>{p.category}</td><td className="muted small">{p.dimensions}</td><td>{s.suppliers.find((x) => x.id === p.supplier_id)?.name ?? '–'}</td><td className="num">{eur(p.purchase_price)}</td><td className="num">{eur(p.sale_price)}</td></tr>
        ))}</tbody>
      </table></div></section>}

      {tab === 'leveranciers' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Naam</th><th>Plaats</th><th>Land</th><th>Contact</th><th className="num">Levertijd</th></tr></thead>
        <tbody>{s.suppliers.map((x) => <tr key={x.id} className="click" onClick={() => setSu(x)}><td className="strong">{x.name}</td><td>{x.city}</td><td>{x.country}</td><td className="muted">{x.contact_name || x.email || '–'}</td><td className="num">{x.lead_time_days} dagen</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'klanten' && <section className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Naam</th><th>Soort</th><th>Plaats</th><th>Telefoon</th><th>E-mail</th><th>Factuurtaal</th></tr></thead>
        <tbody>{s.customers.map((c) => <tr key={c.id} className="click" onClick={() => setCu(c)}><td className="strong">{c.company || c.name}</td><td>{c.kind[0].toUpperCase() + c.kind.slice(1)}</td><td>{c.city}</td><td>{c.phone}</td><td className="muted">{c.email}</td><td>{{ es: 'Spaans', nl: 'Nederlands', en: 'Engels' }[c.language]}</td></tr>)}</tbody>
      </table></div></section>}

      {tab === 'bedrijf' && <section className="panel">
        <h2>Bedrijf en factuur</h2>
        <div className="form-grid">
          <TextField className="span-2" label="Bedrijfsnaam" value={co.company_name} onChange={(v) => setCo({ ...co, company_name: v })} />
          <TextField label="CIF" value={co.tax_id} onChange={(v) => setCo({ ...co, tax_id: v })} />
          <TextField className="span-2" label="Adres" value={co.address} onChange={(v) => setCo({ ...co, address: v })} />
          <TextField label="Postcode" value={co.postal_code} onChange={(v) => setCo({ ...co, postal_code: v })} />
          <TextField label="Plaats" value={co.city} onChange={(v) => setCo({ ...co, city: v })} />
          <TextField label="Provincie" value={co.province} onChange={(v) => setCo({ ...co, province: v })} />
          <TextField label="Telefoon" value={co.phone} onChange={(v) => setCo({ ...co, phone: v })} />
          <TextField label="E-mail" value={co.email} onChange={(v) => setCo({ ...co, email: v })} />
          <TextField className="span-2" label="IBAN" value={co.iban} onChange={(v) => setCo({ ...co, iban: v })} />
          <NumberField label="Betaaltermijn (dagen)" value={co.payment_days} min={0} step="1" onChange={(v) => setCo({ ...co, payment_days: v })} />
          <AreaField className="span-all" label="Tekst onderaan de factuur" value={co.invoice_footer} onChange={(v) => setCo({ ...co, invoice_footer: v })} />
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={() => { const { id: _i, ...patch } = co; run((db) => db.update('settings', 'default', patch), 'Bedrijfsgegevens opgeslagen') }}>Opslaan</button>
      </section>}

      {wh && <Modal wide title={wh.id ? wh.name : 'Magazijn toevoegen'} onClose={() => setWh(null)} footer={<>
        <button className="btn" onClick={() => setWh(null)}>Annuleren</button>
        <button className="btn primary" onClick={async () => { if (need(wh.code && wh.name, 'Vul een code en een naam in.') && await run((db) => saveRecord(db, 'warehouses', wh as Warehouse), 'Magazijn opgeslagen')) setWh(null) }}>Opslaan</button>
      </>}>
        <div className="form-grid">
          <TextField label="Code" value={wh.code} onChange={(v) => setWh({ ...wh, code: v })} placeholder="MAG-3" />
          <TextField className="span-2" label="Naam" value={wh.name} onChange={(v) => setWh({ ...wh, name: v })} />
          <SelectField label="Soort" value={wh.kind} onChange={(v) => setWh({ ...wh, kind: v })} options={[{ value: 'winkel', label: 'Winkel' }, { value: 'magazijn', label: 'Magazijn' }, { value: 'extern', label: 'Externe opslag' }]} />
          <TextField className="span-2" label="Adres" value={wh.address} onChange={(v) => setWh({ ...wh, address: v })} />
          <TextField label="Postcode" value={wh.postal_code} onChange={(v) => setWh({ ...wh, postal_code: v })} />
          <TextField label="Plaats" value={wh.city} onChange={(v) => setWh({ ...wh, city: v })} />
          <TextField label="Contactpersoon" value={wh.contact_name} onChange={(v) => setWh({ ...wh, contact_name: v })} />
          <TextField label="Telefoon" value={wh.phone} onChange={(v) => setWh({ ...wh, phone: v })} />
        </div>
        <div className="actions" style={{ gap: '4px 22px' }}>
          <Check label="Ontvangt goederen" checked={wh.receives_goods} onChange={(v) => setWh({ ...wh, receives_goods: v })} />
          <Check label="Levert uit aan klanten" checked={wh.ships_goods} onChange={(v) => setWh({ ...wh, ships_goods: v })} />
          <Check label="Actief" checked={wh.is_active} onChange={(v) => setWh({ ...wh, is_active: v })} />
        </div>
      </Modal>}

      {pr && <Modal wide title={pr.id ? pr.name : 'Product toevoegen'} onClose={() => setPr(null)} footer={<>
        <button className="btn" onClick={() => setPr(null)}>Annuleren</button>
        <button className="btn primary" onClick={async () => { if (need(pr.sku && pr.name, 'Vul een artikelnummer en een naam in.') && await run((db) => saveRecord(db, 'products', pr as Product), 'Product opgeslagen')) setPr(null) }}>Opslaan</button>
      </>}>
        <div className="form-grid">
          <TextField label="Artikelnummer" value={pr.sku} onChange={(v) => setPr({ ...pr, sku: v })} />
          <TextField className="span-2" label="Naam" value={pr.name} onChange={(v) => setPr({ ...pr, name: v })} />
          <TextField label="Collectie" value={pr.collection} onChange={(v) => setPr({ ...pr, collection: v })} />
          <TextField label="Categorie" value={pr.category} onChange={(v) => setPr({ ...pr, category: v })} />
          <TextField label="Materiaal" value={pr.material} onChange={(v) => setPr({ ...pr, material: v })} />
          <TextField label="Kleur" value={pr.color} onChange={(v) => setPr({ ...pr, color: v })} />
          <TextField label="Maten" value={pr.dimensions} onChange={(v) => setPr({ ...pr, dimensions: v })} placeholder="220 × 92 × 74 cm" />
          <NumberField label="Gewicht (kg)" value={pr.weight_kg} min={0} onChange={(v) => setPr({ ...pr, weight_kg: v })} />
          <NumberField label="Aantal colli" value={pr.colli} min={1} step="1" onChange={(v) => setPr({ ...pr, colli: v })} />
          <SelectField label="Leverancier" value={pr.supplier_id} placeholder="Geen vaste leverancier" onChange={(v) => setPr({ ...pr, supplier_id: v || null })} options={s.suppliers.map((x) => ({ value: x.id, label: x.name }))} />
          <NumberField label="Inkoopprijs excl. IVA" value={pr.purchase_price} step="0.01" min={0} onChange={(v) => setPr({ ...pr, purchase_price: v })} />
          <NumberField label="Verkoopprijs incl. IVA" value={pr.sale_price} step="0.01" min={0} onChange={(v) => setPr({ ...pr, sale_price: v })} />
          <NumberField label="IVA %" value={pr.vat_rate} min={0} onChange={(v) => setPr({ ...pr, vat_rate: v })} />
          <NumberField label="Minimumvoorraad" value={pr.min_stock} step="1" min={0} onChange={(v) => setPr({ ...pr, min_stock: v })} />
        </div>
        <Check label="Actief in verkoop" checked={pr.is_active} onChange={(v) => setPr({ ...pr, is_active: v })} />
      </Modal>}

      {su && <Modal wide title={su.id ? su.name : 'Leverancier toevoegen'} onClose={() => setSu(null)} footer={<>
        <button className="btn" onClick={() => setSu(null)}>Annuleren</button>
        <button className="btn primary" onClick={async () => { if (need(su.name, 'Vul de naam in.') && await run((db) => saveRecord(db, 'suppliers', su as Supplier), 'Leverancier opgeslagen')) setSu(null) }}>Opslaan</button>
      </>}>
        <div className="form-grid">
          <TextField className="span-2" label="Naam" value={su.name} onChange={(v) => setSu({ ...su, name: v })} />
          <TextField label="BTW-nummer" value={su.vat_number} onChange={(v) => setSu({ ...su, vat_number: v })} />
          <TextField label="Contactpersoon" value={su.contact_name} onChange={(v) => setSu({ ...su, contact_name: v })} />
          <TextField label="E-mail" value={su.email} onChange={(v) => setSu({ ...su, email: v })} />
          <TextField label="Telefoon" value={su.phone} onChange={(v) => setSu({ ...su, phone: v })} />
          <TextField className="span-2" label="Adres" value={su.address} onChange={(v) => setSu({ ...su, address: v })} />
          <TextField label="Plaats" value={su.city} onChange={(v) => setSu({ ...su, city: v })} />
          <TextField label="Land" value={su.country} onChange={(v) => setSu({ ...su, country: v })} />
          <NumberField label="Levertijd (dagen)" value={su.lead_time_days} step="1" min={0} onChange={(v) => setSu({ ...su, lead_time_days: v })} />
          <TextField label="Betaalvoorwaarden" value={su.payment_terms} onChange={(v) => setSu({ ...su, payment_terms: v })} />
          <AreaField className="span-all" label="Notitie" value={su.notes} onChange={(v) => setSu({ ...su, notes: v })} />
        </div>
      </Modal>}

      {cu && <Modal wide title={cu.id ? cu.name : 'Klant toevoegen'} onClose={() => setCu(null)} footer={<>
        <button className="btn" onClick={() => setCu(null)}>Annuleren</button>
        <button className="btn primary" onClick={async () => { if (need(cu.name, 'Vul de naam in.') && await run((db) => saveRecord(db, 'customers', cu as Customer), 'Klant opgeslagen')) setCu(null) }}>Opslaan</button>
      </>}>
        <CustomerFields c={cu} set={(p) => setCu({ ...cu, ...p })} />
      </Modal>}
    </>
  )
}
