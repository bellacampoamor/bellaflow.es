import { addDays, deliveryIsOpen, depositAvailable, deliveryValue, invoiceBalance, invoiceState, linesToPurchase, onHandMap, orderStage, reservedMap, shipmentIsOpen, shipmentOpenQty, STAGE_LABEL, stockKey, todayISO, uninvoicedDeliveries } from '../domain/calc'
import { useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, fmtShort, Head, Pill } from '../ui/kit'
import { Plus } from 'lucide-react'
import { tx } from '../i18n'

export function Overview() {
  const { s } = useApp()
  const today = todayISO()
  const name = <T extends { id: string; name: string }>(rows: T[], id: string | null) => rows.find((r) => r.id === id)?.name ?? '–'
  const custOf = (orderId: string) => name(s.customers, s.sales_orders.find((o) => o.id === orderId)?.customer_id ?? null)

  const inbound = s.inbound_shipments.filter(shipmentIsOpen).filter((x) => x.expected_date <= addDays(today, 14)).sort((a, b) => a.expected_date.localeCompare(b.expected_date))
  const deliveries = s.deliveries.filter(deliveryIsOpen).sort((a, b) => a.planned_date.localeCompare(b.planned_date)).slice(0, 6)
  const orders = s.sales_orders.filter((o) => ['te_plannen', 'wacht_op_goederen'].includes(orderStage(s, o)))
  const toBill = s.sales_orders.flatMap((o) => o.status === 'open' ? uninvoicedDeliveries(s, o.id) : [])
  const openInvoices = s.invoices.filter((i) => invoiceBalance(s, i) > 0)
  const toBuy = linesToPurchase(s)
  const lowStock = s.products.filter((p) => {
    const hand = onHandMap(s), res = reservedMap(s)
    const free = s.warehouses.reduce((n, w) => n + (hand.get(stockKey(p.id, w.id)) ?? 0) - (res.get(stockKey(p.id, w.id)) ?? 0), 0)
    return p.is_active && free < p.min_stock
  })
  const deposits = s.sales_orders.filter((o) => o.status === 'open').reduce((n, o) => n + depositAvailable(s, o.id), 0)
  const receivable = openInvoices.reduce((n, i) => n + invoiceBalance(s, i), 0)

  return (
    <>
      <Head title={tx("Overzicht")} sub={tx("Wat er vandaag speelt, {0}.", fmtShort(today))}>
        <a className="btn" href="#inkoop-nieuw"><Plus size={16} />{tx("Inkooporder")}</a>
        <a className="btn primary" href="#orders-nieuw"><Plus size={16} />{tx("Nieuwe verkooporder")}</a>
      </Head>

      <div className="figures">
        <div><b>{s.sales_orders.filter((o) => o.status === 'open' && orderStage(s, o) !== 'gefactureerd').length}</b><span className="muted small">{tx("Lopende verkooporders")}</span></div>
        <div><b>{inbound.length}</b><span className="muted small">{tx("Zendingen binnen 14 dagen")}</span></div>
        <div><b>{eur(receivable)}</b><span className="muted small">{tx("Open op facturen")}</span></div>
        <div><b>{eur(deposits)}</b><span className="muted small">{tx("Vooruitbetaald, nog te verrekenen")}</span></div>
      </div>

      <div className="work">
        <section className="panel">
          <div className="panel-head"><h2>{tx("Binnenkomende zendingen")}</h2><a className="small" href="#inkomend">{tx("Alle zendingen")}</a></div>
          {inbound.length === 0 && <Empty>{tx("Er staan geen zendingen gepland.")}</Empty>}
          {inbound.map((x) => {
            const po = s.purchase_orders.find((p) => p.id === x.purchase_order_id)!
            const late = x.expected_date < today
            return (
              <a className="task" key={x.id} href={`#ontvangst-${x.id}`}>
                <div><div className="task-t">{po.number}{tx(", zending")} {x.sequence}</div>
                  <div className="muted small">{name(s.suppliers, po.supplier_id)}, {shipmentOpenQty(s, x.id)} {tx("stuks naar")} {name(s.warehouses, x.warehouse_id)}</div></div>
                <Pill tone={late ? 'bad' : x.expected_date === today ? 'warn' : ''}>{late ? tx("Te laat, ") : ''}{fmtShort(x.expected_date)}</Pill>
              </a>
            )
          })}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>{tx("Verkooporders die aandacht vragen")}</h2><a className="small" href="#orders">{tx("Alle verkooporders")}</a></div>
          {orders.length === 0 && <Empty>{tx("Alle verkooporders zijn ingepland.")}</Empty>}
          {orders.map((o) => {
            const st = orderStage(s, o)
            return (
              <a className="task" key={o.id} href={`#orders-${o.id}`}>
                <div><div className="task-t">{o.number}</div><div className="muted small">{name(s.customers, o.customer_id)}{o.requested_date ? tx(", gewenst {0}", fmtDate(o.requested_date)) : ''}</div></div>
                <Pill tone={st === 'te_plannen' ? 'sell' : 'warn'}>{tx(STAGE_LABEL[st])}</Pill>
              </a>
            )
          })}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>{tx("Leveringen aan klanten")}</h2><a className="small" href="#levering">{tx("Planning")}</a></div>
          {deliveries.length === 0 && <Empty>{tx("Er staan geen leveringen gepland.")}</Empty>}
          {deliveries.map((d) => (
            <a className="task" key={d.id} href="#levering">
              <div><div className="task-t">{d.number}, {custOf(d.sales_order_id)}</div><div className="muted small">{d.time_slot || tx("Geen tijdvak")}{d.sequence > 1 ? tx(", deellevering {0}", d.sequence) : ''}</div></div>
              <Pill tone={d.planned_date < today ? 'bad' : d.planned_date === today ? 'warn' : ''}>{fmtShort(d.planned_date)}</Pill>
            </a>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>{tx("Geld")}</h2><a className="small" href="#facturatie">{tx("Facturatie")}</a></div>
          {toBill.length === 0 && openInvoices.length === 0 && <Empty>{tx("Alles is gefactureerd en betaald.")}</Empty>}
          {toBill.map((d) => (
            <a className="task" key={d.id} href="#facturatie">
              <div><div className="task-t">{d.number} {tx("factureren")}</div><div className="muted small">{custOf(d.sales_order_id)}</div></div>
              <span className="num strong">{eur(deliveryValue(s, d.id))}</span>
            </a>
          ))}
          {openInvoices.map((i) => (
            <a className="task" key={i.id} href={`#facturatie-${i.id}`}>
              <div><div className="task-t">{i.number}</div><div className="muted small">{name(s.customers, i.customer_id)}{tx(", vervalt")} {fmtDate(i.due_date)}</div></div>
              <Pill tone={invoiceState(s, i) === 'te_laat' ? 'bad' : 'bill'}>{eur(invoiceBalance(s, i))}</Pill>
            </a>
          ))}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>{tx("Inkopen")}</h2><a className="small" href="#inkoop">{tx("Inkoop")}</a></div>
          {toBuy.length === 0 && lowStock.length === 0 && <Empty>{tx("Niets om in te kopen.")}</Empty>}
          {toBuy.map((l) => (
            <a className="task" key={l.id} href="#inkoop-nieuw">
              <div><div className="task-t">{l.qty} {tx("×")} {l.description}</div><div className="muted small">{tx("Voor")} {s.sales_orders.find((o) => o.id === l.sales_order_id)?.number}{l.options ? `, ${l.options}` : ''}</div></div>
              <Pill tone="warn">{tx("Op bestelling")}</Pill>
            </a>
          ))}
          {lowStock.map((p) => (
            <a className="task" key={p.id} href="#voorraad">
              <div><div className="task-t">{p.name}</div><div className="muted small">{tx("Minimaal")} {p.min_stock} {tx("vrij op voorraad")}</div></div>
              <Pill>{tx("Onder minimum")}</Pill>
            </a>
          ))}
        </section>
      </div>
    </>
  )
}
