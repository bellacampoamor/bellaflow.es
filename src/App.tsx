import { useEffect, useState } from 'react'
import { Languages, Moon, Sun, Boxes, ClipboardList, FileText, LayoutDashboard, PackageCheck, Settings2, ShoppingCart, Truck, Warehouse as WarehouseIcon } from 'lucide-react'
import { flowCounts } from './domain/calc'
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
import { getLanguage, setLanguage, tx } from './i18n'

const STEPS = [
  { key: 'inkoop', label: '1. Inkoop', sub: (n: number) => tx("{0} nog in te kopen", n), icon: ShoppingCart, tint: '' },
  { key: 'inkomend', label: '2. Inkomend', sub: (n: number) => (n ? tx("{0} te laat", n) : tx("deelleveringen")), icon: Truck, tint: '' },
  { key: 'ontvangst', label: '3. Ontvangst', sub: (n: number) => tx("{0} binnen 7 dagen", n), icon: PackageCheck, tint: 'sell' },
  { key: 'orders', label: '4. Orders', sub: (n: number) => tx("{0} te plannen", n), icon: ClipboardList, tint: 'sell' },
  { key: 'levering', label: '5. Levering', sub: (n: number) => tx("{0} vandaag", n), icon: Truck, tint: 'ship' },
  { key: 'facturatie', label: '6. Facturatie', sub: (n: number) => tx("{0} te factureren", n), icon: FileText, tint: 'bill' },
] as const

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
  const [language, setUiLanguage] = useState(getLanguage)
  const switchLanguage = () => {
    const next = language === 'nl' ? 'en' : 'nl'
    setLanguage(next)
    setUiLanguage(next)
  }
  useEffect(() => { document.documentElement.lang = language }, [language])
  const hash = useHash()
  const [confirmReset, setConfirmReset] = useState(false)
  const dash = hash.indexOf('-')
  const screen = dash < 0 ? hash : hash.slice(0, dash)
  const param = dash < 0 ? '' : hash.slice(dash + 1)
  const counts = flowCounts(s)

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
      <header className="top wrap">
        <div className="inner top-row">
          <a className="brand" href="#overzicht" aria-label={tx("Bella Flow, naar overzicht")}><Logo /></a>
          <nav className="util" aria-label={tx("Algemeen")}>
            <a href="#overzicht" className={screen === 'overzicht' ? 'on' : ''}><LayoutDashboard size={16} />{tx("Overzicht")}</a>
            <a href="#voorraad" className={screen === 'voorraad' ? 'on' : ''}><Boxes size={16} />{tx("Voorraad")}</a>
            <a href="#beheer" className={screen === 'beheer' ? 'on' : ''}><Settings2 size={16} />{tx("Beheer")}</a>
            <button className="btn-toggle" onClick={switchLanguage}><Languages size={16} />{language === 'nl' ? 'English' : 'Nederlands'}</button>
            <button className="btn-toggle" onClick={toggleTheme}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}{theme === 'dark' ? tx("Dagstand") : tx("Nachtstand")}</button>
            {onSignOut && <a href="#overzicht" onClick={onSignOut}>{tx("Uitloggen")}</a>}
          </nav>
        </div>
      </header>
      <div className="ribbon-wrap wrap">
        <nav className="inner ribbon" aria-label={tx("Processtappen")}>
          {STEPS.map((st) => {
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
      <main className="wrap">
        <div className="inner">
          <Route screen={screen} param={param} />
        </div>
      </main>
      {confirmReset && onResetDemo && (
        <Modal title={tx("Voorbeeldgegevens herstellen?")} onClose={() => setConfirmReset(false)} footer={<>
          <button className="btn" onClick={() => setConfirmReset(false)}>{tx("Annuleren")}</button>
          <button className="btn primary" onClick={() => { location.hash = 'overzicht'; void onResetDemo() }}>{tx("Herstellen")}</button>
        </>}>
          <p style={{ margin: 0 }}>{tx("Alles wat je hebt ingevoerd verdwijnt en de voorbeeldsituatie komt terug.")}</p>
        </Modal>
      )}
    </>
  )
}

function Route({ screen, param }: { screen: string; param: string }) {
  switch (screen) {
    case 'overzicht': return <Overview />
    case 'inkoop': return param === 'nieuw' ? <PurchaseForm /> : param ? <PurchaseDetail id={param} /> : <Purchases />
    case 'inkomend': return <Inbound />
    case 'ontvangst': return param ? <ReceiptForm shipmentId={param} /> : <Receipts />
    case 'orders':
      if (param === 'nieuw') return <OrderForm />
      if (param.startsWith('wijzig-')) return <OrderForm id={param.slice(7)} />
      return param ? <OrderDetail id={param} /> : <Orders />
    case 'levering': return param ? <DeliveryNote id={param} /> : <Deliveries />
    case 'facturatie': return param ? <InvoiceDetail id={param} /> : <Invoices />
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
