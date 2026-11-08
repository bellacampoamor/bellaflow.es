import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpen, Calculator, ChevronDown, FileBarChart, Headset, Moon, Store, Sun, Boxes, ClipboardList, FileText, LayoutDashboard, PackageCheck, Settings2, ShoppingCart, Truck, Warehouse as WarehouseIcon } from 'lucide-react'
import { parseOrdersParam } from './domain/orderFlow'
import { parsePurchasesParam } from './domain/purchaseFlow'
import { useApp, useHash } from './ui/app-context'
import { Logo, Modal } from './ui/kit'
import { Overview } from './screens/Overview'
import { PurchaseDetail, PurchaseForm, Purchases } from './screens/Purchases'
import { Inbound } from './screens/Inbound'
import { ReceiptForm, Receipts } from './screens/Receipts'
import { OrderDetail, Orders } from './screens/Orders'
import { OrderForm } from './screens/OrderForm'
import { Deliveries } from './screens/Deliveries'
import { DeliveryNote } from './screens/DeliveryNote'
import { InvoiceDetail, Invoices } from './screens/Invoices'
import { Stock } from './screens/Stock'
import { Admin } from './screens/Admin'
import { Driver } from './screens/Driver'
import { LabelAgent } from './screens/LabelAgent'
import { ScanApp } from './screens/ScanApp'
import { SalesOrderDocument } from './screens/SalesOrderDocument'
import { PurchaseOrderDocument, PurchaseOrdersDocument } from './screens/PurchaseOrderDocument'
import { PurchaseDispatch } from './screens/PurchaseDispatch'
import { Reports } from './screens/Reports'
import { Catalogs } from './screens/Catalogs'
import { Pos } from './screens/Pos'
import { getLanguage, setLanguage, tx, type UiLanguage } from './i18n'
import { LangFlags } from './ui/LangFlags'

// Twee gescheiden processen, elk met eigen menu-optie. Er is geen stappenbalk meer: het spoor per
// verkooporder en inkooporder toont de flow in detail, met de fasekoppen vast bij scrollen (besluit Rick 7 november 2026).
const FLOWS = {
  verkoop: { label: 'Verkoop', icon: Store, home: 'orders', screens: ['orders', 'levering', 'facturatie'] },
  inkoop: { label: 'Inkoop', icon: ShoppingCart, home: 'inkoop', screens: ['inkoop', 'inkomend', 'ontvangst'] },
} as const
type FlowKey = keyof typeof FLOWS
const flowOf = (screen: string): FlowKey | null =>
  (Object.keys(FLOWS) as FlowKey[]).find((k) => (FLOWS[k].screens as readonly string[]).includes(screen)) ?? null

const THEME_KEY = 'bella-flow-theme'
function useTheme() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY)
      if (saved === 'light' || saved === 'dark') return saved
    } catch { /* systeemstand */ }
    return document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* alleen deze sessie */ }
  }, [theme])
  return [theme, () => setTheme((v) => (v === 'dark' ? 'light' : 'dark'))] as const
}

export function App({ onResetDemo, onSignOut }: { onResetDemo?: () => Promise<void>; onSignOut?: () => void }) {
  const { s } = useApp()
  const [theme, toggleTheme] = useTheme()
  // Vaste fasekoppen plakken direct onder het hoofdmenu, dat op smalle schermen hoger is.
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => {
      document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`)
      // Lichte overgang achter het logo (nachtstand): plek van logo en menu meten, zie .top in styles.css.
      const brand = el.querySelector<HTMLElement>('.brand'), nav = el.querySelector<HTMLElement>('.util')
      if (!brand || !nav) return
      const h = el.getBoundingClientRect(), b = brand.getBoundingClientRect(), n = nav.getBoundingClientRect()
      const wrapped = n.top >= b.bottom - 4
      el.classList.toggle('top-wrapped', wrapped)
      el.style.setProperty('--logo-x', `${Math.round(b.left - h.left)}px`)
      el.style.setProperty('--logo-w', `${Math.round(b.width)}px`)
      el.style.setProperty('--glow-row', wrapped ? `${Math.round(b.bottom - h.top + 8)}px` : '100%')
      el.style.setProperty('--glow-fade', `${wrapped ? 140 : Math.max(24, Math.min(220, Math.round(n.left - b.right - 24)))}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.querySelectorAll('.brand, .util').forEach((x) => ro.observe(x))
    return () => ro.disconnect()
  }, [])
  const [language, setUiLanguage] = useState(getLanguage)
  const switchLanguage = (next: UiLanguage) => {
    setLanguage(next)
    setUiLanguage(next)
  }
  useEffect(() => { document.documentElement.lang = language }, [language])
  const hash = useHash()
  const [confirmReset, setConfirmReset] = useState(false)
  const [support, setSupport] = useState(false)
  const dash = hash.indexOf('-')
  const screen = dash < 0 ? hash : hash.slice(0, dash)
  const param = dash < 0 ? '' : hash.slice(dash + 1)
  const flow = flowOf(screen)

  if (screen === 'chauffeur') return <Driver param={param} />
  if (screen === 'client') return <LabelAgent />
  if (screen === 'scan') return <ScanApp />

  return (
    <>
      {onResetDemo && (
        <div className="demo-bar wrap">
          <div className="inner">
            <span>{tx("Dit zijn verzonnen voorbeeldgegevens. Wijzigingen blijven alleen in deze browser.")}</span>
            <button className="linklike" onClick={() => setConfirmReset(true)}>{tx("Voorbeeldgegevens herstellen")}</button>
          </div>
        </div>
      )}
      <header className="top wrap" ref={headerRef}>
        <div className="inner top-row">
          <a className="brand" href="#overzicht" aria-label={tx("Bella Flow, naar overzicht")}><Logo /></a>
          <nav className="util" aria-label={tx("Algemeen")}>
            <a href="#overzicht" className={screen === 'overzicht' ? 'on' : ''}><LayoutDashboard size={16} />{tx("Overzicht")}</a>
            <a href="#kassa" className={screen === 'kassa' ? 'on' : ''}><Calculator size={16} />{tx("Kassa")}</a>
            {(Object.keys(FLOWS) as FlowKey[]).map((k) => {
              const F = FLOWS[k], Icon = F.icon
              return <a key={k} href={`#${F.home}`} className={flow === k ? 'on flow-link' : 'flow-link'}><Icon size={16} />{tx(F.label)}</a>
            })}
            <a href="#voorraad" className={screen === 'voorraad' ? 'on' : ''}><Boxes size={16} />{tx("Voorraad")}</a>
            <LangFlags value={language} onChange={switchLanguage} label={tx("Taal")} />
            <button className="btn-toggle" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? tx("Dagstand") : tx("Nachtstand")}</button>
            <button className="btn-toggle" aria-label={tx("Contact en support")} title={tx("Contact en support")} onClick={() => setSupport(true)}><Headset size={18} /></button>
            <AdminMenu screen={screen} />
            {onSignOut && <a href="#overzicht" onClick={onSignOut}>{tx("Uitloggen")}</a>}
          </nav>
        </div>
      </header>
      <main className="wrap">
        <div className="inner">
          <Route screen={screen} param={param} />
        </div>
      </main>
      {support && (
        <Modal center title={tx("Contact en support")} onClose={() => setSupport(false)} footer={<button className="btn primary" onClick={() => setSupport(false)}>{tx("Sluiten")}</button>}>
          <p style={{ margin: 0 }}>{tx("Bella Flow © {0} is gemaakt en uitgegeven door Rick van Hoeven. Alle rechten voorbehouden. Niets uit deze software mag zonder voorafgaande schriftelijke toestemming worden verveelvoudigd, verspreid of openbaar gemaakt.", new Date().getFullYear())}</p>
          <p style={{ margin: 0 }}>{tx("Voor verdere informatie neem contact op via")} <a href="mailto:support@bellaflow.es">support@bellaflow.es</a></p>
        </Modal>
      )}
      {confirmReset && onResetDemo && (
        <Modal title={tx("Voorbeeldgegevens herstellen?")} onClose={() => setConfirmReset(false)} footer={<>
          <button className="btn" onClick={() => setConfirmReset(false)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={() => { location.hash = 'overzicht'; void onResetDemo() }}>{tx("Herstellen")}</button>
        </>}>
          <p style={{ margin: 0 }}>{tx("Wat je hebt ingevoerd verdwijnt en de voorbeeldsituatie komt terug. Bedrijfsgegevens, instellingen en leveranciers blijven bewaard.")}</p>
        </Modal>
      )}
    </>
  )
}

// Klein, bescheiden menu Beheer (besluit Rick 8 november 2026): Rapportage, Catalogi en Instellingen
// (het vroegere Beheer). Het uitklapvlak staat vast in beeld, zodat het op een telefoon niet wordt afgesneden
// door het zijwaarts scrollende menu.
const ADMIN_SCREENS = ['rapportage', 'archief', 'catalogi', 'instellingen', 'beheer']
function AdminMenu({ screen }: { screen: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, right: 0 })
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { setOpen(false) }, [screen])
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || box.current?.contains(t)) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus() } }
    // Bij scrollen (ook het zijwaarts scrollende menu op de telefoon) schuift het vlak mee met de knop.
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])
  function place() {
    const r = btn.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
  }
  const toggle = () => { place(); setOpen((v) => !v) }
  const item = (href: string, on: boolean, icon: ReactNode, label: string) =>
    <a role="menuitem" href={href} className={on ? 'on' : ''} onClick={() => setOpen(false)}>{icon}{label}</a>
  const active = ADMIN_SCREENS.includes(screen)
  return (
    <>
      <button ref={btn} className={active ? 'btn-toggle admin-menu on' : 'btn-toggle admin-menu'} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        {tx("Beheer")}<ChevronDown size={13} />
      </button>
      {open && (
        <div ref={box} className="admin-pop" role="menu" style={{ top: pos.top, right: pos.right }}>
          {item('#rapportage', screen === 'rapportage' || screen === 'archief', <FileBarChart size={16} />, tx("Rapportage"))}
          {item('#catalogi', screen === 'catalogi', <BookOpen size={16} />, tx("Catalogi"))}
          {item('#instellingen', screen === 'instellingen' || screen === 'beheer', <Settings2 size={16} />, tx("Instellingen"))}
        </div>
      )}
    </>
  )
}

function Route({ screen, param }: { screen: string; param: string }) {
  switch (screen) {
    case 'overzicht': return <Overview />
    case 'kassa': return <Pos />
    case 'inkoop': return param.startsWith('versturen') ? <PurchaseDispatch key={param} date={param.slice(10)} /> : param.startsWith('afdrukken-') ? <PurchaseOrdersDocument key={param} ids={param.slice(21).split(',').filter(Boolean)} back={`inkoop-versturen-${param.slice(10, 20)}`} /> : param.startsWith('print-') ? <PurchaseOrderDocument key={param} id={param.slice(6)} /> : param === 'nieuw' ? <PurchaseForm /> : param.startsWith('nieuw-order-') ? <PurchaseForm orderId={param.slice(12)} /> : param.startsWith('omzetten-') ? <PurchaseDetail key={param} id={param.slice(9)} convert /> : param && param !== 'proforma' && !param.startsWith('lijst-') ? <PurchaseDetail key={param} id={param} /> : (() => { const l = parsePurchasesParam(param); return <Purchases key={param} tab={l.tab} phase={l.phase} /> })()
    case 'inkomend': return <Inbound key={param} focus={param.replace(/^(nl|klaar)-/, '') || undefined} />
    case 'ontvangst': return param.startsWith('io-') ? <ReceiptForm key={param} purchaseOrderId={param.slice(3)} /> : param ? <ReceiptForm key={param} transportId={param} /> : <Receipts />
    case 'orders':
      if (param === 'nieuw') return <OrderForm />
      if (param.startsWith('print-')) return <SalesOrderDocument key={param} id={param.slice(6)} />
      if (param.startsWith('wijzig-')) return <OrderForm id={param.slice(7)} />
      if (!param || param.startsWith('lijst-')) { const l = parseOrdersParam(param); return <Orders key={param} tab={l.tab} phase={l.phase} /> }
      return <OrderDetail id={param} />
    case 'levering': return param.startsWith('print-') ? <DeliveryNote key={param} id={param.slice(6)} autoPrint /> : param.startsWith('archief-') ? <DeliveryNote key={param} id={param.slice(8)} fromArchive /> : param.startsWith('naar-') ? <Deliveries key={param} focus={param.slice(5)} /> : param ? <DeliveryNote key={param} id={param} /> : <Deliveries />
    case 'facturatie': return param.startsWith('print-') ? <InvoiceDetail key={param} id={param.slice(6)} autoPrint /> : param.startsWith('naar-') ? <Invoices key={param} focus={param.slice(5)} /> : param ? <InvoiceDetail key={param} id={param} /> : <Invoices />
    case 'rapportage': return <Reports key={param} tab={param === 'leverbaar' ? 'leverbaar' : param === 'kassa' ? 'kassa' : 'facturen'} />
    case 'archief': return <Reports tab="archief" />
    case 'catalogi': return <Catalogs supplierId={param} />
    case 'voorraad': return <Stock />
    case 'instellingen':
    case 'beheer': return <Admin />
    default: return (
      <div className="panel">
        <WarehouseIcon size={20} />
        <p>{tx("Deze pagina bestaat niet.")} <a href="#overzicht">{tx("Ga naar het overzicht")}</a>.</p>
      </div>
    )
  }
}
