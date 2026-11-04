import { useState } from 'react'
import { ArrowLeftRight, SlidersHorizontal } from 'lucide-react'
import { inboundByProduct, onHandMap, reservedMap, stockKey, todayISO } from '../domain/calc'
import { correctStock, transferStock } from '../domain/services'
import { useApp } from '../ui/app-context'
import { Combo, Empty, Field, fmtDate, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField } from '../ui/kit'

export function Stock() {
  const { s, run } = useApp()
  const [tab, setTab] = useState<'stand' | 'moves'>('stand')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<'transfer' | 'correct' | null>(null)
  const [productId, setProductId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const hand = onHandMap(s), res = reservedMap(s), inbound = inboundByProduct(s)
  const wh = s.warehouses.filter((w) => w.is_active)
  const t = q.trim().toLowerCase()
  const products = s.products.filter((p) => !t || `${p.name} ${p.sku} ${p.collection} ${p.category}`.toLowerCase().includes(t))
  const moves = [...s.stock_movements].sort((a, b) => b.moved_at.localeCompare(a.moved_at)).slice(0, 80)
  const productOpts = s.products.map((p) => ({ value: p.id, label: p.name, sub: p.sku, search: p.sku }))
  const openModal = (m: 'transfer' | 'correct') => { setModal(m); setProductId(''); setFrom(wh[0]?.id ?? ''); setTo(wh[1]?.id ?? ''); setQty(m === 'transfer' ? 1 : -1); setNote('') }

  return (
    <>
      <Head title="Voorraad" sub="Per product en per locatie: wat er ligt en wat daarvan vrij is. Vrij is aanwezig minus gereserveerd voor orders.">
        <button className="btn" onClick={() => openModal('correct')}><SlidersHorizontal size={16} />Correctie</button>
        <button className="btn primary" onClick={() => openModal('transfer')}><ArrowLeftRight size={16} />Overboeken</button>
      </Head>
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-end' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'stand', label: 'Voorraadstand' }, { value: 'moves', label: 'Mutaties' }]} />
          {tab === 'stand' && <input style={{ maxWidth: 280, marginBottom: 14 }} aria-label="Product zoeken" placeholder="Zoek op product of artikelnummer" value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
        {tab === 'stand' && <div className="table-wrap"><table>
          <thead><tr><th>Product</th>{wh.map((w) => <th key={w.id} className="num">{w.name}</th>)}<th className="num">Totaal vrij</th><th className="num">Onderweg</th><th></th></tr></thead>
          <tbody>{products.map((p) => {
            let free = 0
            return (
              <tr key={p.id}>
                <td><span className="strong">{p.name}</span><div className="muted small">{p.sku}</div></td>
                {wh.map((w) => {
                  const h = hand.get(stockKey(p.id, w.id)) ?? 0, r = res.get(stockKey(p.id, w.id)) ?? 0
                  free += h - r
                  return <td key={w.id} className="stock-cell">{h === 0 && r === 0 ? <span className="zero">0</span> : <>{h}{r > 0 && <small>{h - r} vrij, {r} gereserveerd</small>}</>}</td>
                })}
                <td className="num strong" style={free < 0 ? { color: 'var(--bad)' } : undefined}>{free}</td>
                <td className="num">{inbound.get(p.id) || <span className="zero">0</span>}</td>
                <td>{free < p.min_stock && <Pill tone={free < 0 ? 'bad' : 'warn'}>Onder minimum ({p.min_stock})</Pill>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>}
        {tab === 'moves' && (moves.length === 0 ? <Empty>Nog geen mutaties.</Empty> : <div className="table-wrap"><table>
          <thead><tr><th>Datum</th><th>Product</th><th>Locatie</th><th>Soort</th><th>Bron</th><th className="num">Aantal</th></tr></thead>
          <tbody>{moves.map((m) => (
            <tr key={m.id}><td>{fmtDate(m.moved_at)}</td><td>{s.products.find((p) => p.id === m.product_id)?.name}</td><td>{s.warehouses.find((w) => w.id === m.warehouse_id)?.name}</td><td>{m.kind[0].toUpperCase() + m.kind.slice(1)}</td><td className="muted">{m.ref_id || m.note || '–'}</td><td className="num strong" style={{ color: m.qty < 0 ? 'var(--bad)' : 'var(--good)' }}>{m.qty > 0 ? '+' : ''}{m.qty}</td></tr>
          ))}</tbody>
        </table></div>)}
      </section>

      {modal && (
        <Modal title={modal === 'transfer' ? 'Voorraad overboeken' : 'Voorraad corrigeren'} onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>Annuleren</button>
          <button className="btn primary" onClick={async () => {
            const ok = await run((db) => modal === 'transfer'
              ? transferStock(db, { product_id: productId, from_id: from, to_id: to, qty, note, date: todayISO() })
              : correctStock(db, { product_id: productId, warehouse_id: from, qty, note, date: todayISO() }), modal === 'transfer' ? 'Voorraad overgeboekt' : 'Voorraad gecorrigeerd')
            if (ok) setModal(null)
          }} disabled={!productId}>{modal === 'transfer' ? 'Overboeken' : 'Correctie opslaan'}</button>
        </>}>
          <Field label="Product">{(id) => <Combo id={id} value={productId} options={productOpts} onChange={setProductId} placeholder="Zoek een product" />}</Field>
          <div className="form-grid">
            <SelectField label={modal === 'transfer' ? 'Van' : 'Locatie'} value={from} onChange={setFrom} options={wh.map((w) => ({ value: w.id, label: `${w.name}${productId ? ` (${hand.get(stockKey(productId, w.id)) ?? 0})` : ''}` }))} />
            {modal === 'transfer' && <SelectField label="Naar" value={to} onChange={setTo} options={wh.map((w) => ({ value: w.id, label: `${w.name}${productId ? ` (${hand.get(stockKey(productId, w.id)) ?? 0})` : ''}` }))} />}
            <NumberField label={modal === 'transfer' ? 'Aantal' : 'Afwijking (+ of -)'} value={qty} step="1" onChange={setQty} />
          </div>
          <TextField label={modal === 'transfer' ? 'Notitie' : 'Reden'} value={note} onChange={setNote} placeholder={modal === 'correct' ? 'Bijvoorbeeld telling, schade' : ''} />
        </Modal>
      )}
    </>
  )
}
