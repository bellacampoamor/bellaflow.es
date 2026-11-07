import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Plus, ShoppingCart, Store } from 'lucide-react'
import { addDays, orderTotal } from '../domain/calc'
import { overview } from '../domain/overview'
import { useApp } from '../ui/app-context'
import { Empty, eur, fmtDate, fmtShort, Head, Pill } from '../ui/kit'
import { locale, tx } from '../i18n'

const MAX = 5

/** "En nog N" onder een ingekorte lijst. */
const More = ({ n, href }: { n: number; href: string }) => n > 0 ? <a className="ov-more small" href={href}>{tx("En nog {0}", n)} →</a> : null

const Group = ({ title, n, tone = '', children }: { title: string; n?: ReactNode; tone?: string; children: ReactNode }) => (
  <div className="ov-group">
    <div className={`ov-group-h ${tone}`}><span>{title}</span>{n != null && <span className="ov-count">{n}</span>}</div>
    {children}
  </div>
)

export function Overview() {
  const { s } = useApp()
  const o = overview(s)
  const today = o.today
  const name = <T extends { id: string; name: string }>(rows: T[], id: string | null) => rows.find((r) => r.id === id)?.name ?? '–'
  const custOf = (orderId: string) => name(s.customers, o.order(orderId)?.customer_id ?? null)
  const cityOf = (orderId: string) => o.order(orderId)?.delivery_city ?? ''
  const longDate = new Date(`${today}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' })
  const dayLabel = (iso: string) => iso === today ? tx("Vandaag") : fmtShort(iso)
  const deliveryState = { planned: tx("Gepland"), ready: tx("Klaargezet"), in_transit: tx("Onderweg"), delivered: '', cancelled: '' }

  return (
    <>
      <Head title={tx("Overzicht")} sub={<span className="ov-date">{longDate}</span>}>
        <a className="btn" href="#inkoop-nieuw"><Plus size={16} />{tx("Inkooporder")}</a>
        <a className="btn primary" href="#orders-nieuw"><Plus size={16} />{tx("Nieuwe verkooporder")}</a>
      </Head>

      {/* Nu te doen: alleen wat vandaag een handeling vraagt, te laat eerst. */}
      <section className="ov-todo" aria-label={tx("Nu te doen")}>
        {o.actions.length === 0
          ? <div className="ov-calm"><CheckCircle2 size={20} />{tx("Niets dringends. Alles loopt volgens planning.")}</div>
          : o.actions.map((a) => (
            <a key={a.key} className={`ov-action ${a.flow}${a.urgent ? ' urgent' : ''}`} href={a.href}>
              <b>{a.n}</b>
              <span>{a.urgent && <AlertTriangle size={14} />}{tx(a.label)}</span>
            </a>
          ))}
      </section>

      <div className="figures ov-money">
        <div><b>{eur(o.money.revenueMonth)}</b><span className="muted small">{tx("Gefactureerd deze maand")}{o.money.invoicesMonth === 1 ? tx(", 1 factuur") : o.money.invoicesMonth ? tx(", {0} facturen", o.money.invoicesMonth) : ''}</span></div>
        <div><b>{eur(o.money.toBill)}</b><span className="muted small">{tx("Afgeleverd, nog te factureren")}</span></div>
        <div><b>{eur(o.money.receivable)}</b><span className="muted small">{tx("Open op facturen")}{o.money.overdue > 0 && <> · <span className="ov-bad">{tx("{0} vervallen", eur(o.money.overdue))}</span></>}</span></div>
        <div><b>{eur(o.money.deposits)}</b><span className="muted small">{tx("Vooruitbetaald, nog te verrekenen")}</span></div>
      </div>

      <div className="ov-cols">
        {/* Verkoop */}
        <div className="ov-col">
          <div className="ov-col-h sell"><Store size={16} />{tx("Verkoop")}<span className="muted small">{tx("{0} lopende verkooporders", o.sales.running)}</span></div>

          <section className="panel">
            <div className="panel-head"><h2>{tx("Bezorgplanning, komende 7 dagen")}</h2><a className="small" href="#levering">{tx("Levering")}</a></div>
            {o.delivery.days.length === 0 && <Empty>{tx("Er staan geen leveringen gepland.")}</Empty>}
            {o.delivery.days.map((day) => (
              <Group key={day.late ? 'laat' : day.date} title={day.late ? tx("Te laat") : dayLabel(day.date)} tone={day.late ? 'bad' : day.date === today ? 'now' : ''}
                n={tx("{0} van {1} klaargezet", day.ready, day.deliveries.length)}>
                {day.deliveries.map((d) => (
                  <a className="task" key={d.id} href="#levering">
                    <div><div className="task-t">{custOf(d.sales_order_id)}</div>
                      <div className="muted small">{d.number}{cityOf(d.sales_order_id) ? `, ${cityOf(d.sales_order_id)}` : ''}{d.sequence > 1 ? tx(", deellevering {0}", d.sequence) : ''}{day.late ? `, ${fmtShort(d.planned_date)}` : ''}</div></div>
                    <Pill tone={d.status === 'planned' ? (day.late ? 'bad' : '') : 'good'}>{deliveryState[d.status]}</Pill>
                  </a>
                ))}
              </Group>
            ))}
            {o.delivery.later > 0 && <More n={o.delivery.later} href="#levering" />}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>{tx("Verkooporders die aandacht vragen")}</h2><a className="small" href="#orders">{tx("Alle verkooporders")}</a></div>
            {o.sales.proformas.length + o.sales.toPlan.length + o.sales.waiting.length === 0 && <Empty>{tx("Alle verkooporders zijn ingepland.")}</Empty>}
            {o.sales.proformas.length > 0 && (
              <Group title={tx("Proforma, nog te bevestigen")} n={o.sales.proformas.length}>
                {o.sales.proformas.slice(0, MAX).map((x) => (
                  <a className="task" key={x.id} href={`#orders-${x.id}`}>
                    <div><div className="task-t">{x.number}</div><div className="muted small">{tx("Gescand door {0}, {1}", name(s.salespeople, x.salesperson_id), fmtDate(x.order_date))}</div></div>
                    <span className="num strong">{eur(orderTotal(s, x.id))}</span>
                  </a>
                ))}
                <More n={o.sales.proformas.length - MAX} href="#orders" />
              </Group>
            )}
            {o.sales.toPlan.length > 0 && (
              <Group title={tx("Te plannen")} n={o.sales.toPlan.length}>
                {o.sales.toPlan.slice(0, MAX).map((x) => (
                  <a className="task" key={x.id} href={`#orders-${x.id}`}>
                    <div><div className="task-t">{name(s.customers, x.customer_id)}</div><div className="muted small">{x.number}</div></div>
                    {x.requested_date ? <Pill tone={x.requested_date < today ? 'bad' : x.requested_date <= addDays(today, 3) ? 'warn' : 'sell'}>{tx("Gewenst {0}", fmtShort(x.requested_date))}</Pill> : <Pill tone="sell">{tx("Te plannen")}</Pill>}
                  </a>
                ))}
                <More n={o.sales.toPlan.length - MAX} href="#orders" />
              </Group>
            )}
            {o.sales.waiting.length > 0 && (
              <Group title={tx("Wacht op goederen")} n={o.sales.waiting.length}>
                {o.sales.waiting.slice(0, MAX).map((x) => (
                  <a className="task" key={x.id} href={`#orders-${x.id}`}>
                    <div><div className="task-t">{name(s.customers, x.customer_id)}</div><div className="muted small">{x.number}</div></div>
                    {x.requested_date ? <Pill tone={x.requested_date < today ? 'bad' : 'warn'}>{tx("Gewenst {0}", fmtShort(x.requested_date))}</Pill> : <Pill tone="warn">{tx("Wacht op goederen")}</Pill>}
                  </a>
                ))}
                <More n={o.sales.waiting.length - MAX} href="#orders" />
              </Group>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>{tx("Facturatie")}</h2><a className="small" href="#facturatie">{tx("Naar facturatie")}</a></div>
            {o.billing.toBill.length === 0 && o.billing.openInvoices.length === 0 && <Empty>{tx("Alles is gefactureerd en betaald.")}</Empty>}
            {o.billing.toBill.length > 0 && (
              <Group title={tx("Proforma's, klaar om te factureren")} n={o.billing.toBill.length}>
                {o.billing.toBill.slice(0, MAX).map(({ d, value }) => (
                  <a className="task" key={d.id} href="#facturatie">
                    <div><div className="task-t">{custOf(d.sales_order_id)}</div><div className="muted small">{d.proforma_number ?? d.number}{d.delivered_at ? tx(", geleverd {0}", fmtShort(d.delivered_at)) : ''}</div></div>
                    <span className="num strong">{eur(value)}</span>
                  </a>
                ))}
                <More n={o.billing.toBill.length - MAX} href="#facturatie" />
              </Group>
            )}
            {o.billing.openInvoices.length > 0 && (
              <Group title={tx("Openstaande facturen")} n={o.billing.openInvoices.length} tone={o.billing.overdue ? 'bad' : ''}>
                {o.billing.openInvoices.slice(0, MAX).map(({ i, balance }) => (
                  <a className="task" key={i.id} href={`#facturatie-${i.id}`}>
                    <div><div className="task-t">{name(s.customers, i.customer_id)}</div><div className="muted small">{i.number}, {i.due_date < today ? tx("vervallen {0}", fmtShort(i.due_date)) : tx("vervalt {0}", fmtShort(i.due_date))}</div></div>
                    <Pill tone={i.due_date < today ? 'bad' : 'bill'}>{eur(balance)}</Pill>
                  </a>
                ))}
                <More n={o.billing.openInvoices.length - MAX} href="#facturatie" />
              </Group>
            )}
          </section>
        </div>

        {/* Inkoop */}
        <div className="ov-col">
          <div className="ov-col-h buy"><ShoppingCart size={16} />{tx("Inkoop")}</div>

          <section className="panel">
            <div className="panel-head"><h2>{tx("Binnenkomende transporten")}</h2><a className="small" href="#inkomend">{tx("Gepland transport")}</a></div>
            {o.purchase.transports.length === 0 && <Empty>{tx("Geen transporten in de komende 14 dagen.")}</Empty>}
            {o.purchase.transports.map(({ t, lines, qty, sold, load }) => {
              const late = t.arrival_date < today
              const cap = t.capacity_m3
              const pct = cap ? Math.min(100, Math.round((load.m3 / cap) * 100)) : 0
              return (
                <a className="task ov-transport" key={t.id} href={`#ontvangst-${t.id}`}>
                  <div>
                    <div className="task-t">{t.number}{t.carrier ? <span className="muted small"> · {t.carrier}</span> : null}</div>
                    <div className="muted small">{tx("{0} regels, {1} stuks", lines, qty)}{sold ? tx(", {0} voor klanten", sold) : ''}</div>
                    {cap > 0 && <div className="ov-load"><div className="fill" role="img" aria-label={tx("{0} van {1} m³ gevuld", load.m3, cap)}><span style={{ width: `${pct}%`, background: load.m3 > cap ? 'var(--bad)' : 'var(--primary)' }} /></div><span className="small muted">{load.m3} / {cap} m³</span></div>}
                  </div>
                  <Pill tone={late ? 'bad' : t.arrival_date === today ? 'warn' : 'info'}>{late ? tx("Te laat, {0}", fmtShort(t.arrival_date)) : dayLabel(t.arrival_date)}</Pill>
                </a>
              )
            })}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>{tx("In te kopen")}</h2><a className="small" href="#inkoop-proforma">{tx("Proforma-inkooporders")}</a></div>
            {o.purchase.proformaBySupplier.length === 0 && o.purchase.lowStock.length === 0 && <Empty>{tx("Niets om in te kopen.")}</Empty>}
            {o.purchase.proformaBySupplier.length > 0 && (
              <Group title={tx("Om te zetten naar inkooporder")} n={o.purchase.proformaBySupplier.reduce((n, x) => n + x.proformas, 0)}>
                {o.purchase.proformaBySupplier.map((x) => (
                  <a className="task" key={x.supplierId} href="#inkoop-proforma">
                    <div><div className="task-t">{name(s.suppliers, x.supplierId)}</div><div className="muted small">{tx("{0} proforma's, {1} stuks", x.proformas, x.qty)}</div></div>
                    {x.value > 0 ? <span className="num strong">{eur(x.value)}</span> : <Pill tone="warn">{tx("Op bestelling")}</Pill>}
                  </a>
                ))}
              </Group>
            )}
            {o.purchase.lowStock.length > 0 && (
              <Group title={tx("Onder minimumvoorraad")} n={o.purchase.lowStock.length}>
                {o.purchase.lowStock.slice(0, MAX).map((p) => (
                  <a className="task" key={p.id} href="#voorraad">
                    <div><div className="task-t">{p.name}</div><div className="muted small">{p.sku}</div></div>
                    <Pill>{tx("Minimaal {0}", p.min_stock)}</Pill>
                  </a>
                ))}
                <More n={o.purchase.lowStock.length - MAX} href="#voorraad" />
              </Group>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
