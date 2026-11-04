import { useState } from 'react'
import { ArrowLeftRight, SlidersHorizontal } from 'lucide-react'
import { onHandMap, reservedMap, stockKey, todayISO } from '../domain/calc'
import { correctStock, transferStock } from '../domain/services'
import { useApp } from '../ui/app-context'
import { Combo, Empty, Field, fmtDate, Head, Modal, NumberField, Pill, SelectField, Tabs, TextField } from '../ui/kit'
import { tx } from '../i18n'

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
  const hand = onHandMap(s), res = reservedMap(s)
  const wh = s.warehouses.filter((w) => w.is_active)
  const t = q.trim().toLowerCase()
  const products = s.products.filter((p) => !t || `${p.name} ${p.sku} ${p.collection} ${p.category}`.toLowerCase().includes(t))
  const moves = [...s.stock_movements].sort((a, b) => b.moved_at.localeCompare(a.moved_at)).slice(0, 80)
  const productOpts = s.products.map((p) => ({ value: p.id, label: p.name, sub: p.sku, search: p.sku }))
  const openModal = (m: 'transfer' | 'correct') => { setModal(m); setProductId(''); setFrom(wh[0]?.id ?? ''); setTo(wh[1]?.id ?? ''); setQty(m === 'transfer' ? 1 : -1); setNote('') }

  const moveToShowroom = (id: string) => {
    openModal('transfer')
    const showroom = wh.find((w) => w.kind === 'winkel')
    const free = (w: string) => (hand.get(stockKey(id, w)) ?? 0) - (res.get(stockKey(id, w)) ?? 0)
    const source = wh.filter((w) => w.id !== showroom?.id).sort((a, b) => free(b.id) - free(a.id))[0]
    setProductId(id); setFrom(source?.id ?? ''); setTo(showroom?.id ?? ''); setQty(1)
  }

  return (
    <>
      <Head title={tx("Voorraad")} sub={tx("Per product en per locatie: wat er ligt en wat daarvan vrij is. Vrij is aanwezig minus gereserveerd voor verkooporders.")}>
        <button className="btn" onClick={() => openModal('correct')}><SlidersHorizontal size={16} />{tx("Correctie")}</button>
        <button className="btn primary" onClick={() => openModal('transfer')}><ArrowLeftRight size={16} />{tx("Verhuizen")}</button>
      </Head>
      <section className="panel">
        <div className="panel-head" style={{ alignItems: 'flex-end' }}>
          <Tabs value={tab} onChange={setTab} tabs={[{ value: 'stand', label: tx("Voorraadstand") }, { value: 'moves', label: tx("Mutaties") }]} />
          {tab === 'stand' && <input style={{ maxWidth: 280, marginBottom: 14 }} aria-label={tx("Product zoeken")} placeholder={tx("Zoek op product of artikelnummer")} value={q} onChange={(e) => setQ(e.target.value)} />}
        </div>
        {tab === 'stand' && <div className="table-wrap"><table>
          <thead><tr><th>{tx("Product")}</th>{wh.map((w) => <th key={w.id} className="num">{w.name}</th>)}<th className="num">{tx("Totaal vrij")}</th><th></th><th></th></tr></thead>
          <tbody>{products.map((p) => {
            let free = 0
            return (
              <tr key={p.id}>
                <td><span className="strong">{p.name}</span><div className="muted small">{p.sku}</div></td>
                {wh.map((w) => {
                  const h = hand.get(stockKey(p.id, w.id)) ?? 0, r = res.get(stockKey(p.id, w.id)) ?? 0
                  free += h - r
                  return <td key={w.id} className="stock-cell">{h === 0 && r === 0 ? <span className="zero">0</span> : <>{h}{r > 0 && <small>{h - r} {tx("vrij,")} {r} {tx("gereserveerd")}</small>}</>}</td>
                })}
                <td className="num strong" style={free < 0 ? { color: 'var(--bad)' } : undefined}>{free}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm" onClick={() => moveToShowroom(p.id)}>{tx("Verhuizen")}</button></td>
                <td>{free < p.min_stock && <Pill tone={free < 0 ? 'bad' : 'warn'}>{tx("Onder minimum (")}{p.min_stock})</Pill>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>}
        {tab === 'moves' && (moves.length === 0 ? <Empty>{tx("Nog geen mutaties.")}</Empty> : <div className="table-wrap"><table>
          <thead><tr><th>{tx("Datum")}</th><th>{tx("Product")}</th><th>{tx("Locatie")}</th><th>{tx("Soort")}</th><th>{tx("Bron")}</th><th className="num">{tx("Aantal")}</th></tr></thead>
          <tbody>{moves.map((m) => (
            <tr key={m.id}><td>{fmtDate(m.moved_at)}</td><td>{s.products.find((p) => p.id === m.product_id)?.name}</td><td>{s.warehouses.find((w) => w.id === m.warehouse_id)?.name}</td><td>{m.kind === 'overboeking' ? tx("Verhuizing") : tx(m.kind[0].toUpperCase() + m.kind.slice(1))}</td><td className="muted">{m.ref_id || m.note || '–'}</td><td className="num strong" style={{ color: m.qty < 0 ? 'var(--bad)' : 'var(--good)' }}>{m.qty > 0 ? '+' : ''}{m.qty}</td></tr>
          ))}</tbody>
        </table></div>)}
      </section>

      {modal && (
        <Modal title={modal === 'transfer' ? tx("Voorraad verhuizen") : tx("Voorraad corrigeren")} onClose={() => setModal(null)} footer={<>
          <button className="btn" onClick={() => setModal(null)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={async () => {
            const ok = await run((db) => modal === 'transfer'
              ? transferStock(db, { product_id: productId, from_id: from, to_id: to, qty, note, date: todayISO() })
              : correctStock(db, { product_id: productId, warehouse_id: from, qty, note, date: todayISO() }), modal === 'transfer' ? tx("Voorraad verhuisd, direct op de nieuwe locatie") : tx("Voorraad gecorrigeerd"))
            if (ok) setModal(null)
          }} disabled={!productId}>{modal === 'transfer' ? tx("Verhuizen") : tx("Correctie opslaan")}</button>
        </>}>
          <Field label={tx("Product")}>{(id) => <Combo id={id} value={productId} options={productOpts} onChange={setProductId} placeholder={tx("Zoek een product")} />}</Field>
          <div className="form-grid">
            <SelectField label={modal === 'transfer' ? tx("Van") : tx("Locatie")} value={from} onChange={setFrom} options={wh.map((w) => ({ value: w.id, label: productId ? tx("{0} ({1} vrij)", w.name, (hand.get(stockKey(productId, w.id)) ?? 0) - (res.get(stockKey(productId, w.id)) ?? 0)) : w.name }))} />
            {modal === 'transfer' && <SelectField label={tx("Naar")} value={to} onChange={setTo} options={wh.map((w) => ({ value: w.id, label: `${w.name}${productId ? ` (${hand.get(stockKey(productId, w.id)) ?? 0})` : ''}` }))} />}
            <NumberField label={modal === 'transfer' ? tx("Aantal") : tx("Afwijking (+ of -)")} value={qty} step="1" onChange={setQty} />
          </div>
          {modal === 'transfer' && <p className="small muted" style={{ margin: 0 }}>{tx("De stuks staan direct op de nieuwe locatie.")}</p>}
          <TextField label={modal === 'transfer' ? tx("Notitie") : tx("Reden")} value={note} onChange={setNote} placeholder={modal === 'correct' ? tx("Bijvoorbeeld telling, schade") : ''} />
        </Modal>
      )}
    </>
  )
}
