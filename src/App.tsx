import { useState } from 'react'
import { Boxes, ClipboardList, FileText, LayoutDashboard, PackageCheck, Settings2, ShoppingCart, Truck, Warehouse as WarehouseIcon } from 'lucide-react'
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
import { InvoiceDetail, Invoices } from './screens/Invoices'
import { Stock } from './screens/Stock'
import { Admin } from './screens/Admin'

const STEPS = [
  { key: 'inkoop', label: '1. Inkoop', sub: (n: number) => `${n} nog in te kopen`, icon: ShoppingCart, tint: '' },
  { key: 'inkomend', label: '2. Inkomend', sub: (n: number) => (n ? `${n} te laat` : 'deelleveringen'), icon: Truck, tint: '' },
  { key: 'ontvangst', label: '3. Ontvangst', sub: (n: number) => `${n} binnen 7 dagen`, icon: PackageCheck, tint: 'sell' },
  { key: 'orders', label: '4. Orders', sub: (n: number) => `${n} te plannen`, icon: ClipboardList, tint: 'sell' },
  { key: 'levering', label: '5. Levering', sub: (n: number) => `${n} vandaag`, icon: Truck, tint: 'ship' },
  { key: 'facturatie', label: '6. Facturatie', sub: (n: number) => `${n} te factureren`, icon: FileText, tint: 'bill' },
] as const

export function App({ onResetDemo, onSignOut }: { onResetDemo?: () => Promise<void>; onSignOut?: () => void }) {
  const { s } = useApp()
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
            <span>Dit zijn verzonnen voorbeeldgegevens. Wijzigingen blijven alleen in deze browser.</span>
            <button className="linklike" onClick={() => setConfirmReset(true)}>Voorbeeldgegevens herstellen</button>
          </div>
        </div>
      )}
      <header className="top wrap">
        <div className="inner top-row">
          <a className="brand" href="#overzicht" aria-label="Bella Flow, naar overzicht"><Logo /></a>
          <nav className="util" aria-label="Algemeen">
            <a href="#overzicht" className={screen === 'overzicht' ? 'on' : ''}><LayoutDashboard size={16} />Overzicht</a>
            <a href="#voorraad" className={screen === 'voorraad' ? 'on' : ''}><Boxes size={16} />Voorraad</a>
            <a href="#beheer" className={screen === 'beheer' ? 'on' : ''}><Settings2 size={16} />Beheer</a>
            {onSignOut && <a href="#overzicht" onClick={onSignOut}>Uitloggen</a>}
          </nav>
        </div>
      </header>
      <div className="ribbon-wrap wrap">
        <nav className="inner ribbon" aria-label="Processtappen">
          {STEPS.map((st) => {
            const Icon = st.icon
            return (
              <a key={st.key} href={`#${st.key}`} className={`step ${st.tint} ${screen === st.key ? 'on' : ''}`} aria-current={screen === st.key ? 'page' : undefined}>
                <span className="ico"><Icon size={16} /></span>
                <span className="t">{st.label}<small>{st.sub(counts[st.key])}</small></span>
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
        <Modal title="Voorbeeldgegevens herstellen?" onClose={() => setConfirmReset(false)} footer={<>
          <button className="btn" onClick={() => setConfirmReset(false)}>Annuleren</button>
          <button className="btn primary" onClick={() => { location.hash = 'overzicht'; void onResetDemo() }}>Herstellen</button>
        </>}>
          <p style={{ margin: 0 }}>Alles wat je hebt ingevoerd verdwijnt en de voorbeeldsituatie komt terug.</p>
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
    case 'levering': return <Deliveries />
    case 'facturatie': return param ? <InvoiceDetail id={param} /> : <Invoices />
    case 'voorraad': return <Stock />
    case 'beheer': return <Admin />
    default: return (
      <div className="panel">
        <WarehouseIcon size={20} />
        <p>Deze pagina bestaat niet. <a href="#overzicht">Ga naar het overzicht</a>.</p>
      </div>
    )
  }
}
