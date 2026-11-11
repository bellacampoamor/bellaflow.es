// Stand van een kassaverkoop van HDB in Shopify: nummer (met link naar de Shopify-admin), status en Opnieuw versturen.
import type { MouseEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { pushToShopify, sendSaleToShopify } from '../domain/services'
import { SHOPIFY_STATE, shopifyAdminUrl, shopifyBacklog, shopifyNumber, shopifyOrderOf } from '../domain/shopify'
import { tx } from '../i18n'
import { useApp } from './app-context'
import { Pill } from './kit'

const resultText = (r: string) => r === 'demo' ? tx("Testversie: niet naar Shopify gestuurd.") : r === 'mislukt' ? tx("Shopify mislukt. Zie de melding.") : tx("In Shopify gezet.")

/** Op de factuur en in de lijst: stand in Shopify van één eenvoudige factuur van HDB. */
export function ShopifyStatus({ invoiceId, compact = false }: { invoiceId: string; compact?: boolean }) {
  const { s, run, toast } = useApp()
  const row = shopifyOrderOf(s, invoiceId)
  const store = s.settings[0]?.hdb_shopify_store ?? ''
  const send = async (e: MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    let r = ''
    if (await run(async (db) => { r = await sendSaleToShopify(db, invoiceId) })) toast(resultText(r), r === 'mislukt')
  }
  if (!row) return <span className="shopify-status">{!compact && <Pill tone="warn">{tx("Nog niet naar Shopify")}</Pill>} <button className="linklike small" onClick={send}><RefreshCw size={13} /> {tx("Naar Shopify")}</button></span>
  const [label, tone] = SHOPIFY_STATE[row.status]
  const num = shopifyNumber(row)
  const url = shopifyAdminUrl(row, store)
  return (
    <span className="shopify-status">
      {row.status === 'aangemaakt' && num
        ? <Pill tone={row.error ? 'warn' : 'good'}>Shopify {url ? <a href={url} target="_blank" rel="noreferrer">{num}</a> : num}{!row.shopify_order_name && ` (${tx("conceptorder")})`}</Pill>
        : <Pill tone={tone}>{tx(label)}</Pill>}
      {(row.status === 'mislukt' || row.status === 'wachtrij' || row.status === 'demo') && <> <button className="linklike small" onClick={send}><RefreshCw size={13} /> {tx("Opnieuw versturen")}</button></>}
      {!compact && row.error && <span className="small muted"> {row.error}</span>}
    </span>
  )
}

/** Boven het factuuroverzicht van HDB: wat nog niet in Shopify staat, met één knop om alles opnieuw te versturen. */
export function ShopifyBacklog() {
  const { s, run, toast } = useApp()
  const todo = shopifyBacklog(s)
  if (!todo.length) return null
  const failed = todo.filter((r) => r.status === 'mislukt')
  const send = async () => {
    let r = ''
    if (await run(async (db) => { r = await pushToShopify(db) })) toast(resultText(r), r === 'mislukt')
  }
  return (
    <div className={`note ${failed.length ? 'bad' : 'warn'} no-print`} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ flex: 1 }}>
        {tx("{0} kassaverkoop/verkopen van HDB staan nog niet in Shopify.", todo.length)}
        {failed[0]?.error && <span className="small"> {tx("Laatste melding")}: {failed[0].error}</span>}
      </span>
      <button className="btn" onClick={send}><RefreshCw size={15} />{tx("Alles opnieuw versturen")}</button>
    </div>
  )
}
