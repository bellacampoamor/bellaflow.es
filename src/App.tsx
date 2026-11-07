import { useEffect, useRef, useState } from 'react'
import { BookOpen, FileBarChart, Headset, Languages, Moon, Store, Sun, Boxes, ClipboardList, FileText, LayoutDashboard, PackageCheck, Settings2, ShoppingCart, Truck, Warehouse as WarehouseIcon } from 'lucide-react'
import { flowCounts } from './domain/calc'
import { followUpCount } from './domain/orderFlow'
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
import { PurchaseOrderDocument } from './screens/PurchaseOrderDocument'
import { Reports } from './screens/Reports'
import { Catalogs } from './screens/Catalogs'
import { getLanguage, setLanguage, tx, type UiLanguage } from './i18n'

// Twee gescheiden processen, elk met eigen menu-optie en eigen stappen.
const FLOWS = {
  verkoop: {
    label: 'Verkoop', icon: Store, home: 'orders',
    steps: [
      { key: 'orders', label: '4. Verkooporders', sub: (n: number) => tx("{0} op te volgen", n), icon: ClipboardList, tint: 'sell' },
      { key: 'levering', label: '5. Levering', sub: (n: number) => tx("{0} vandaag", n), icon: Truck, tint: 'ship' },
      { key: 'facturatie', label: '6. Facturatie', sub: (n: number) => tx("{0} te factureren", n), icon: FileText, tint: 'bill' },
    ],
  },
  inkoop: {
    label: 'Inkoop', icon: ShoppingCart, home: 'inkoop',
    steps: [
      { key: 'inkoop', label: '1. Inkooporders', sub: (n: number) => tx("{0} nog in te kopen", n), icon: ShoppingCart, tint: '' },
      { key: 'inkomend', label: '2. Gepland transport', sub: (n: number) => (n ? tx("{0} te laat", n) : tx("op schema")), icon: Truck, tint: '' },
      { key: 'ontvangst', label: '3. Ontvangst', sub: (n: number) => tx("{0} binnen 7 dagen", n), icon: PackageCheck, tint: '' },
    ],
  },
} as const
type FlowKey = keyof typeof FLOWS
const flowOf = (screen: string): FlowKey | null =>
  (Object.keys(FLOWS) as FlowKey[]).find((k) => FLOWS[k].steps.some((st) => st.key === screen)) ?? null

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
  // De stappenbalk plakt direct onder het hoofdmenu, dat op smalle schermen hoger is.
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => document.documentElement.style.setProperty('--top-h', `${el.offsetHeight}px`)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
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
  const counts = { ...flowCounts(s), orders: followUpCount(s) }
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
            {(Object.keys(FLOWS) as FlowKey[]).map((k) => {
              const F = FLOWS[k], Icon = F.icon
              return <a key={k} href={`#${F.home}`} className={flow === k ? 'on flow-link' : 'flow-link'}><Icon size={16} />{tx(F.label)}</a>
            })}
            <a href="#rapportage" className={screen === 'rapportage' || screen === 'archief' ? 'on' : ''}><FileBarChart size={16} />{tx("Rapportage")}</a>
            <a href="#voorraad" className={screen === 'voorraad' ? 'on' : ''}><Boxes size={16} />{tx("Voorraad")}</a>
            <a href="#beheer" className={screen === 'beheer' ? 'on' : ''}><Settings2 size={16} />{tx("Beheer")}</a>
            <a href="#catalogi" className={screen === 'catalogi' ? 'on' : ''}><BookOpen size={16} />{tx("Catalogi")}</a>
            <label className="lang-pick"><Languages size={16} /><select aria-label={tx("Taal")} value={language} onChange={(e) => switchLanguage(e.target.value as UiLanguage)}><option value="nl">Nederlands</option><option value="en">English</option><option value="es">Español</option></select></label>
            <button className="btn-toggle" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? tx("Dagstand") : tx("Nachtstand")}</button>
            <button className="btn-toggle" aria-label={tx("Contact en support")} title={tx("Contact en support")} onClick={() => setSupport(true)}><Headset size={18} /></button>
            {onSignOut && <a href="#overzicht" onClick={onSignOut}>{tx("Uitloggen")}</a>}
          </nav>
        </div>
      </header>
      {flow && (
        <div className="ribbon-wrap wrap">
          <nav className="inner ribbon" aria-label={tx(FLOWS[flow].label)}>
            {FLOWS[flow].steps.map((st) => {
              const Icon = st.icon
              return (
                <a key={st.key} href={`#${st.key}`} className={`step ${st.tint} ${screen === st.key ? 'on' : ''}`} aria-current={screen === st.key ? 'page' : undefined}>
                  <span className="ico"><Icon size={16} /></span>
                  <span className="t">{tx(st.label)}<small>{st.sub(counts[st.key])}</small></span>
                </a>
              )
            })}
          </nav>
        </div>
      )}
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

function Route({ screen, param }: { screen: string; param: string }) {
  switch (screen) {
    case 'overzicht': return <Overview />
    case 'inkoop': return param.startsWith('print-') ? <PurchaseOrderDocument key={param} id={param.slice(6)} /> : param === 'nieuw' ? <PurchaseForm /> : param.startsWith('nieuw-order-') ? <PurchaseForm orderId={param.slice(12)} /> : param === 'proforma' ? <Purchases key="proforma" tab="proforma" /> : param ? <PurchaseDetail id={param} /> : <Purchases key="orders" />
    case 'inkomend': return <Inbound />
    case 'ontvangst': return param ? <ReceiptForm key={param} transportId={param} /> : <Receipts />
    case 'orders':
      if (param === 'nieuw') return <OrderForm />
      if (param.startsWith('print-')) return <SalesOrderDocument key={param} id={param.slice(6)} />
      if (param.startsWith('wijzig-')) return <OrderForm id={param.slice(7)} />
      return param ? <OrderDetail id={param} /> : <Orders />
    case 'levering': return param.startsWith('print-') ? <DeliveryNote key={param} id={param.slice(6)} autoPrint /> : param.startsWith('archief-') ? <DeliveryNote key={param} id={param.slice(8)} fromArchive /> : param ? <DeliveryNote key={param} id={param} /> : <Deliveries />
    case 'facturatie': return param.startsWith('print-') ? <InvoiceDetail key={param} id={param.slice(6)} autoPrint /> : param ? <InvoiceDetail key={param} id={param} /> : <Invoices />
    case 'rapportage': return <Reports tab="facturen" />
    case 'archief': return <Reports tab="archief" />
    case 'catalogi': return <Catalogs supplierId={param} />
    case 'voorraad': return <Stock />
    case 'beheer': return <Admin />
    default: return (
      <div className="panel">
        <WarehouseIcon size={20} />
        <p>{tx("Deze pagina bestaat niet.")} <a href="#overzicht">{tx("Ga naar het overzicht")}</a>.</p>
      </div>
    )
  }
}
