import { StrictMode, useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { App } from './App'
import { LocalDriver } from './data/localDriver'
import { createSupabase, SupabaseDriver } from './data/supabaseDriver'
import { renameOldSuppliers, restoreSettings, restoreSuppliers, seedDemo, upgradeSettings } from './domain/demo'
import { importShowroom, importShowroomDetails, syncCatalogArticles } from './domain/services'
import { AppProvider } from './ui/app-context'
import { LogoFull } from './ui/kit'
import './styles.css'
import { installNav } from './ui/nav'
import { tx } from './i18n'

// Onthoudt bij elke stap waar je vandaan kwam, vóór React luistert (terugknop in Head).
installNav()

const Loading = () => <div className="wrap" style={{ paddingBlock: 40 }}>{tx("Gegevens laden…")}</div>

// De showroom van Life Outdoor Living uit de aangeleverde exports. Bella werkt alleen met de showroom.
// Ze staan niet in de browseropslag en worden bij elke start opnieuw ingelezen.
async function loadCatalogFiles(d: LocalDriver) {
  const load = async (file: string, read: (db: LocalDriver, csv: string) => Promise<unknown>) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}assets/catalogus/${file}`)
      if (res.ok) await read(d, await res.text())
    } catch { /* blijft leeg; inlezen kan ook met de knop */ }
  }
  if (!(await d.list('supplier_showroom_items')).length) await load('supplier_showroom_items.csv', importShowroom)
       if (!(await d.list('supplier_showroom_items')).some((x) => /ha-co/i.test(x.supplier_name))) await load('supplier_showroom_items_haco.csv', importShowroom)
  if (!(await d.list('supplier_showroom_details')).length) await load('supplier_showroom_details.csv', importShowroomDetails)
  // Eigen artikelnummers voor alle artikelen en elementen. In de browser in het geheugen; met de database blijven ze bewaard.
  try { await syncCatalogArticles(d) } catch { /* zonder nummers blijven de catalogi bruikbaar */ }
}

// Eén driver per paginabezoek, ook als React een effect dubbel uitvoert.
let localBoot: Promise<LocalDriver> | null = null
const bootLocal = () => (localBoot ??= (async () => {
  const d = new LocalDriver()
  if (d.isEmpty) await seedDemo(d)
  await renameOldSuppliers(d)
  await upgradeSettings(d)
  await loadCatalogFiles(d)
  return d
})())

function LocalRoot() {
  const [driver, setDriver] = useState<LocalDriver | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    bootLocal().then(setDriver)
  }, [])
  if (!driver) return <Loading />
  const reset = async () => {
    const suppliers = await driver.list('suppliers')
    const [settings] = await driver.list('settings')
    driver.clear()
    await seedDemo(driver)
    await restoreSuppliers(driver, suppliers)
    await restoreSettings(driver, settings)
    await upgradeSettings(driver)
    await loadCatalogFiles(driver)
    setVersion((v) => v + 1)
  }
  return <AppProvider key={version} db={driver} fallback={<Loading />}><App onResetDemo={reset} /></AppProvider>
}

function SupabaseRoot({ sb }: { sb: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, sess) => setSession(sess))
    return () => data.subscription.unsubscribe()
  }, [sb])
  if (session === undefined) return <Loading />
  if (!session) {
    const login = async (e: FormEvent) => {
      e.preventDefault(); setError('')
      const { error: err } = await sb.auth.signInWithPassword({ email, password })
      if (err) setError(tx("Inloggen is niet gelukt. Controleer je e-mailadres en wachtwoord."))
    }
    return (
      <div className="wrap login">
        <form className="panel" onSubmit={login}>
          <div className="brand"><LogoFull /></div>
          <div className="field"><label htmlFor="login-email">{tx("E-mailadres")}</label><input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="login-pass">{tx("Wachtwoord")}</label><input id="login-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <div className="note bad">{error}</div>}
          <button className="btn primary">{tx("Inloggen")}</button>
        </form>
      </div>
    )
  }
  return <AppProvider db={new SupabaseDriver(sb)} fallback={<Loading />}><App onSignOut={() => sb.auth.signOut()} /></AppProvider>
}

const useSupabase = import.meta.env.VITE_DATA_SOURCE === 'supabase'
const sb = useSupabase ? createSupabase(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>{sb ? <SupabaseRoot sb={sb} /> : <LocalRoot />}</StrictMode>,
)
