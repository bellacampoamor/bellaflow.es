import { useMemo, useState } from 'react'
import { CreditCard, Plus, ShoppingCart, Store, Trash2 } from 'lucide-react'
import type { Customer, Fulfilment, OrderType, Payment } from '../data/types'
import { inboundByProduct, lineTotal, onHandMap, plannedQty, reservedMap, round2, stockKey, todayISO, vatBreakdown } from '../domain/calc'
import { createOrder, lineFromProduct, saveRecord, updateOrder, type OrderHeader, type OrderLineInput } from '../domain/services'
import { go, useApp } from '../ui/app-context'
import { AreaField, Check, Combo, Empty, eur, Field, Head, Modal, NumberField, SelectField, TextField } from '../ui/kit'

type Line = OrderLineInput & { key: number }
let k = 1

const emptyCustomer: Omit<Customer, 'id'> = { kind: 'particulier', name: '', company: '', tax_id: '', email: '', phone: '', language: 'es', address: '', postal_code: '', city: '', province: 'Alicante', country: 'España', notes: '' }

export function CustomerFields({ c, set }: { c: Omit<Customer, 'id'>; set: (p: Partial<Customer>) => void }) {
  return (
    <div className="form-grid">
      <SelectField label="Soort klant" value={c.kind} onChange={(v) => set({ kind: v })} options={[{ value: 'particulier', label: 'Particulier' }, { value: 'zakelijk', label: 'Zakelijk' }]} />
      <TextField className="span-2" label="Naam" value={c.name} onChange={(v) => set({ name: v })} />
      <SelectField label="Factuurtaal" value={c.language} onChange={(v) => set({ language: v })} options={[{ value: 'es', label: 'Spaans' }, { value: 'nl', label: 'Nederlands' }, { value: 'en', label: 'Engels' }]} />
      {c.kind === 'zakelijk' && <TextField className="span-2" label="Bedrijfsnaam" value={c.company} onChange={(v) => set({ company: v })} />}
      <TextField label={c.kind === 'zakelijk' ? 'CIF' : 'NIF / NIE'} value={c.tax_id} onChange={(v) => set({ tax_id: v })} />
      <TextField label="Telefoon" type="tel" value={c.phone} onChange={(v) => set({ phone: v })} />
      <TextField label="E-mail" type="email" value={c.email} onChange={(v) => set({ email: v })} />
      <TextField className="span-2" label="Adres" value={c.address} onChange={(v) => set({ address: v })} />
      <TextField label="Postcode" value={c.postal_code} onChange={(v) => set({ postal_code: v })} />
      <TextField label="Plaats" value={c.city} onChange={(v) => set({ city: v })} />
      <TextField label="Provincie" value={c.province} onChange={(v) => set({ province: v })} />
      <TextField label="Land" value={c.country} onChange={(v) => set({ country: v })} />
    </div>
  )
}

export function OrderForm({ id }: { id?: string }) {
  const { s, run, toast } = useApp()
  const today = todayISO()
  const existing = id ? s.sales_orders.find((o) => o.id === id) : undefined

  const [h, setH] = useState<OrderHeader>(() => existing ? (({ id: _i, number: _n, status: _s, ...rest }) => rest)(existing) : {
    customer_id: '', order_date: today, channel: 'winkel', salesperson: '', customer_reference: '', order_type: 'direct', fulfilment: 'meenemen',
    requested_date: null, promised_date: null, delivery_name: '', delivery_phone: '', delivery_address: '', delivery_postal_code: '', delivery_city: '',
    floor: '', has_elevator: false, needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '',
  })
  const [lines, setLines] = useState<Line[]>(() => existing ? s.sales_order_lines.filter((l) => l.sales_order_id === id).map((l) => ({ ...l, key: k++ })) : [])
  const [deposit, setDeposit] = useState(0)
  const [depositMethod, setDepositMethod] = useState<Payment['method']>('pin')
  const [depositRef, setDepositRef] = useState('')
  const [newCust, setNewCust] = useState<Omit<Customer, 'id'> | null>(null)

  const set = (p: Partial<OrderHeader>) => setH((v) => ({ ...v, ...p }))
  const stock = onHandMap(s), reserved = reservedMap(s), inbound = inboundByProduct(s)
  const warehouses = s.warehouses.filter((w) => w.is_active)
  const custOptions = useMemo(() => s.customers.map((c) => ({ value: c.id, label: c.company || c.name, sub: [c.company ? c.name : '', c.city, c.phone].filter(Boolean).join(', '), search: `${c.email} ${c.tax_id}` })), [s.customers])
  const prodOptions = useMemo(() => s.products.filter((p) => p.is_active).map((p) => {
    const free = s.warehouses.reduce((n, w) => n + (stock.get(stockKey(p.id, w.id)) ?? 0) - (reserved.get(stockKey(p.id, w.id)) ?? 0), 0)
    return { value: p.id, label: p.name, sub: `${p.sku}, ${eur(p.sale_price)}, ${free} vrij`, search: `${p.sku} ${p.collection} ${p.category}` }
  }), [s.products, s.stock_movements, s.sales_order_lines]) // eslint-disable-line

  const freeAt = (pid: string, wid: string) => (stock.get(stockKey(pid, wid)) ?? 0) - (reserved.get(stockKey(pid, wid)) ?? 0)
  // Bij wijzigen telt wat deze regel zelf al reserveert niet mee als bezet.
  const freeFor = (l: Line, wid: string) => {
    const own = l.id && l.warehouse_id === wid ? (existing ? s.sales_order_lines.find((x) => x.id === l.id)?.qty ?? 0 : 0) : 0
    return freeAt(l.product_id, wid) + own
  }
  const bestWarehouse = (pid: string, qty: number) => {
    const sorted = [...warehouses].sort((a, b) => freeAt(pid, b.id) - freeAt(pid, a.id))
    return sorted.find((w) => freeAt(pid, w.id) >= qty)?.id ?? null
  }
  const pickCustomer = (cid: string) => {
    const c = s.customers.find((x) => x.id === cid)!
    set({ customer_id: cid, delivery_name: c.company || c.name, delivery_phone: c.phone, delivery_address: c.address, delivery_postal_code: c.postal_code, delivery_city: c.city })
  }
  const addLine = () => setLines((v) => [...v, { ...lineFromProduct({ id: '', name: '', sale_price: 0, vat_rate: 21 } as never), key: k++ }])
  const patch = (key: number, p: Partial<Line>) => setLines((v) => v.map((l) => l.key === key ? { ...l, ...p } : l))
  const pickProduct = (key: number, pid: string) => {
    const p = s.products.find((x) => x.id === pid)!
    const cur = lines.find((l) => l.key === key)!
    const wid = bestWarehouse(pid, cur.qty)
    const onOrder = !wid && h.order_type === 'bestelling'
    patch(key, { product_id: pid, description: p.name, unit_price: p.sale_price, vat_rate: p.vat_rate, source: onOrder ? 'bestelling' : 'voorraad', warehouse_id: onOrder ? null : wid ?? warehouses[0]?.id ?? null })
  }
  const setType = (t: OrderType) => {
    set({ order_type: t, fulfilment: t === 'direct' ? h.fulfilment : h.fulfilment === 'meenemen' ? 'bezorgen' : h.fulfilment })
    if (t === 'direct') setLines((v) => v.map((l) => l.source === 'bestelling' ? { ...l, source: 'voorraad', warehouse_id: l.warehouse_id ?? bestWarehouse(l.product_id, l.qty) ?? warehouses[0]?.id ?? null } : l))
  }
  const setFulfilment = (f: Fulfilment) => set({ fulfilment: f })

  const breakdown = vatBreakdown(lines.map((l) => ({ total: lineTotal(l), vat_rate: l.vat_rate })))
  const fullDiscount = round2(lines.reduce((n, l) => n + l.qty * l.unit_price, 0) - breakdown.total)
  const margin = round2(lines.reduce((n, l) => {
    const p = s.products.find((x) => x.id === l.product_id)
    return n + lineTotal(l) / (1 + l.vat_rate / 100) - (p?.purchase_price ?? 0) * l.qty
  }, 0))

  const save = async () => {
    const payload = lines.map(({ key: _k, ...l }) => (id ? l : (({ id: _i, ...r }) => r)(l as Line & { id?: string })) as OrderLineInput)
    if (existing) {
      if (await run((db) => updateOrder(db, id!, { header: h, lines: payload }), 'Order opgeslagen')) go(`orders-${id}`)
      return
    }
    let newId = ''
    const ok = await run(async (db) => {
      newId = await createOrder(db, { header: h, lines: payload, deposit: deposit > 0 ? { amount: deposit, method: depositMethod, reference: depositRef } : undefined })
    }, h.order_type === 'direct' && h.fulfilment === 'meenemen' ? 'Order geregistreerd en meegegeven' : 'Order aangemaakt')
    if (ok) go(`orders-${newId}`)
  }
  const saveCustomer = async () => {
    if (!newCust?.name.trim()) return toast('Vul de naam van de klant in.', true)
    let cid = ''
    const ok = await run(async (db) => { cid = await saveRecord(db, 'customers', newCust as Customer) }, 'Klant toegevoegd')
    if (ok) {
      set({ customer_id: cid, delivery_name: newCust.company || newCust.name, delivery_phone: newCust.phone, delivery_address: newCust.address, delivery_postal_code: newCust.postal_code, delivery_city: newCust.city })
      setNewCust(null)
    }
  }

  const needsAddress = h.fulfilment !== 'meenemen'
  const customer = s.customers.find((c) => c.id === h.customer_id)

  return (
    <>
      <Head title={existing ? `${existing.number} wijzigen` : 'Nieuwe order'} back={existing ? { href: `#orders-${id}`, label: existing.number } : { href: '#orders', label: 'Orders' }} />
      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>Klant</h2>
            <div className="form-grid">
              <Field className="span-2" label="Klant">{(fid) => <Combo id={fid} value={h.customer_id} options={custOptions} placeholder="Zoek op naam, telefoon of e-mail" onChange={pickCustomer} />}</Field>
              <div className="field" style={{ justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={() => setNewCust({ ...emptyCustomer })}><Plus size={16} />Nieuwe klant</button></div>
              {customer && <div className="span-all small muted">{[customer.phone, customer.email, customer.address, customer.postal_code, customer.city].filter(Boolean).join(', ')}</div>}
              <SelectField label="Verkocht via" value={h.channel} onChange={(v) => set({ channel: v })} options={[{ value: 'winkel', label: 'Winkel' }, { value: 'online', label: 'Online' }, { value: 'telefoon', label: 'Telefoon of e-mail' }, { value: 'beurs', label: 'Beurs' }]} />
              <TextField label="Verkoper" value={h.salesperson} onChange={(v) => set({ salesperson: v })} />
              <TextField label="Orderdatum" type="date" value={h.order_date} onChange={(v) => set({ order_date: v })} />
              <TextField label="Referentie klant" value={h.customer_reference} onChange={(v) => set({ customer_reference: v })} />
            </div>
          </section>

          <section className="panel">
            <h2>Soort verkoop</h2>
            <div className="choice">
              <button type="button" className={h.order_type === 'direct' ? 'on' : ''} onClick={() => setType('direct')} disabled={!!existing}>
                <Store size={20} /><span><strong>Optie A: directe levering</strong><small>Uit voorraad. Meenemen of direct verzenden.</small></span>
              </button>
              <button type="button" className={h.order_type === 'bestelling' ? 'on' : ''} onClick={() => setType('bestelling')} disabled={!!existing}>
                <ShoppingCart size={20} /><span><strong>Optie B: bestelling</strong><small>Op voorraad of op bestelling, met of zonder vooruitbetaling.</small></span>
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Producten</h2><button className="btn sm" type="button" onClick={addLine}><Plus size={14} />Product toevoegen</button></div>
            {lines.length === 0 && <Empty>Voeg het eerste product toe.</Empty>}
            <div className="stack">
              {lines.map((l) => {
                const locked = l.id ? plannedQty(s, l.id) : 0
                const free = l.warehouse_id && l.product_id ? freeFor(l, l.warehouse_id) : 0
                const short = l.source === 'voorraad' && l.product_id && l.warehouse_id && l.qty > free
                const others = l.product_id ? warehouses.filter((w) => w.id !== l.warehouse_id && freeAt(l.product_id, w.id) > 0) : []
                return (
                  <div key={l.key} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 14 }}>
                    <div className="form-grid">
                      <Field className="span-2" label="Product">{(fid) => <Combo id={fid} value={l.product_id} options={prodOptions} placeholder="Zoek op naam of artikelnummer" onChange={(v) => pickProduct(l.key, v)} />}</Field>
                      <TextField label="Uitvoering" value={l.options} onChange={(v) => patch(l.key, { options: v })} placeholder="Stof, kleur, afwerking" />
                      <NumberField label="Aantal" value={l.qty} min={Math.max(1, locked)} step="1" hint={locked ? `${locked} staat op een levering` : undefined} onChange={(v) => patch(l.key, { qty: v })} />
                      <NumberField label="Prijs incl. IVA" value={l.unit_price} step="0.01" min={0} onChange={(v) => patch(l.key, { unit_price: v })} />
                      <NumberField label="Korting %" value={l.discount_pct} step="0.5" min={0} onChange={(v) => patch(l.key, { discount_pct: v })} />
                      {h.order_type === 'bestelling' && (
                        <SelectField label="Herkomst" value={l.source} onChange={(v) => patch(l.key, { source: v, warehouse_id: v === 'bestelling' ? null : l.warehouse_id ?? bestWarehouse(l.product_id, l.qty) ?? warehouses[0]?.id ?? null })} options={[{ value: 'voorraad', label: 'Uit voorraad' }, { value: 'bestelling', label: 'Op bestelling' }]} />
                      )}
                      {l.source === 'voorraad' && (
                        <SelectField className="span-2" label="Uit magazijn" value={l.warehouse_id} onChange={(v) => patch(l.key, { warehouse_id: v })} options={warehouses.map((w) => ({ value: w.id, label: `${w.name} (${l.product_id ? freeFor(l, w.id) : 0} vrij)` }))} />
                      )}
                    </div>
                    <div className="panel-head" style={{ margin: '8px 0 0' }}>
                      <div className="small">
                        {short && <span style={{ color: 'var(--bad)', fontWeight: 600 }}>Maar {free} vrij op dit magazijn{others.length ? `. Wel op ${others.map((w) => `${w.name} (${freeAt(l.product_id, w.id)})`).join(', ')}` : ''}. </span>}
                        {l.source === 'bestelling' && l.product_id && <span className="muted">Komt op de lijst "Nog in te kopen"{inbound.get(l.product_id) ? `. Al ${inbound.get(l.product_id)} onderweg` : ''}. </span>}
                      </div>
                      <div className="actions">
                        <span className="num strong">{eur(lineTotal(l))}</span>
                        <button className="btn icon" type="button" disabled={locked > 0} aria-label="Regel verwijderen" onClick={() => setLines((v) => v.filter((x) => x.key !== l.key))}><Trash2 size={16} /></button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="panel">
            <h2>Levering</h2>
            <div className="form-grid">
              <SelectField className="span-2" label="Afleverwijze" value={h.fulfilment} onChange={setFulfilment} options={[
                ...(h.order_type === 'direct' || h.fulfilment === 'meenemen' ? [{ value: 'meenemen' as const, label: 'Klant neemt mee' }] : [{ value: 'meenemen' as const, label: 'Klant haalt op' }]),
                { value: 'bezorgen', label: 'Bezorgen door eigen team' }, { value: 'verzenden', label: 'Verzenden met vervoerder' },
              ]} />
              {!(h.order_type === 'direct' && h.fulfilment === 'meenemen') && <>
                <TextField label="Gewenste leverdatum" type="date" value={h.requested_date} onChange={(v) => set({ requested_date: v || null })} />
                <TextField label="Beloofde leverdatum" type="date" value={h.promised_date} onChange={(v) => set({ promised_date: v || null })} />
              </>}
              {needsAddress && <>
                <TextField className="span-2" label="Afleveren bij" value={h.delivery_name} onChange={(v) => set({ delivery_name: v })} />
                <TextField label="Telefoon bij levering" type="tel" value={h.delivery_phone} onChange={(v) => set({ delivery_phone: v })} />
                <TextField className="span-2" label="Afleveradres" value={h.delivery_address} onChange={(v) => set({ delivery_address: v })} />
                <TextField label="Postcode" value={h.delivery_postal_code} onChange={(v) => set({ delivery_postal_code: v })} />
                <TextField label="Plaats" value={h.delivery_city} onChange={(v) => set({ delivery_city: v })} />
                <TextField label="Verdieping" value={h.floor} onChange={(v) => set({ floor: v })} placeholder="Begane grond, 2e, ..." />
                <div className="span-all actions" style={{ gap: '4px 22px' }}>
                  <Check label="Lift aanwezig" checked={h.has_elevator} onChange={(v) => set({ has_elevator: v })} />
                  <Check label="Montage gewenst" checked={h.needs_assembly} onChange={(v) => set({ needs_assembly: v })} />
                  <Check label="Oude meubels meenemen" checked={h.remove_old_furniture} onChange={(v) => set({ remove_old_furniture: v })} />
                </div>
                <AreaField className="span-all" label="Instructies voor de bezorgers" value={h.delivery_notes} onChange={(v) => set({ delivery_notes: v })} />
              </>}
            </div>
          </section>
          <section className="panel"><AreaField label="Interne notitie" value={h.notes} onChange={(v) => set({ notes: v })} /></section>
        </div>

        <div className="stack" style={{ position: 'sticky', top: 96 }}>
          <section className="panel">
            <h2>Totaal</h2>
            <div className="totals" style={{ maxWidth: 'none' }}>
              {fullDiscount > 0 && <div><span>Korting</span><span>−{eur(fullDiscount)}</span></div>}
              <div><span>Excl. IVA</span><span>{eur(breakdown.base)}</span></div>
              {breakdown.rates.map((r) => <div key={r.rate}><span>IVA {r.rate}%</span><span>{eur(r.vat)}</span></div>)}
              <div className="grand"><span>Totaal</span><span>{eur(breakdown.total)}</span></div>
              {lines.length > 0 && <div className="muted small"><span>Marge excl. IVA</span><span>{eur(margin)}</span></div>}
            </div>
          </section>
          {!existing && (
            <section className="panel">
              <h2><CreditCard size={16} style={{ verticalAlign: -2, marginRight: 6 }} />Vooruitbetaling</h2>
              <div className="stack" style={{ gap: 10 }}>
                <div className="actions">
                  <button type="button" className="btn sm" onClick={() => setDeposit(round2(breakdown.total * .3))}>30%</button>
                  <button type="button" className="btn sm" onClick={() => setDeposit(round2(breakdown.total * .5))}>50%</button>
                  <button type="button" className="btn sm" onClick={() => setDeposit(breakdown.total)}>Alles</button>
                </div>
                <NumberField label="Bedrag" value={deposit} step="0.01" min={0} onChange={setDeposit} />
                <SelectField label="Betaalwijze" value={depositMethod} onChange={setDepositMethod} options={[{ value: 'pin', label: 'Pin' }, { value: 'contant', label: 'Contant' }, { value: 'overboeking', label: 'Overboeking' }, { value: 'online', label: 'Online' }]} />
                <TextField label="Betaalreferentie" value={depositRef} onChange={setDepositRef} />
                {deposit > 0 && <div className="small muted">Nog te betalen: {eur(round2(breakdown.total - deposit))}. Wordt verrekend op de factuur.</div>}
              </div>
            </section>
          )}
          <button className="btn primary" type="button" onClick={save}>{existing ? 'Wijzigingen opslaan' : h.order_type === 'direct' && h.fulfilment === 'meenemen' ? 'Order afronden en meegeven' : 'Order aanmaken'}</button>
          <a className="btn" href={existing ? `#orders-${id}` : '#orders'}>Annuleren</a>
        </div>
      </div>

      {newCust && (
        <Modal wide title="Nieuwe klant" onClose={() => setNewCust(null)} footer={<>
          <button className="btn" onClick={() => setNewCust(null)}>Annuleren</button>
          <button className="btn primary" onClick={saveCustomer}>Klant toevoegen</button>
        </>}>
          <CustomerFields c={newCust} set={(p) => setNewCust((v) => ({ ...v!, ...p }))} />
        </Modal>
      )}
    </>
  )
}
