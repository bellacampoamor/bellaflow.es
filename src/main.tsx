import { StrictMode, useEffect, useState, type FormEvent, type ReactNode } from 'react'
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

const LoginShell = ({ children, onSubmit }: { children: ReactNode; onSubmit?: (e: FormEvent) => void }) => (
  <div className="wrap login">
    <form className="panel login-panel" onSubmit={onSubmit}>
      <div className="brand"><LogoFull /></div>
      {children}
    </form>
  </div>
)

/** Inloggen met e-mailadres en wachtwoord, met "Wachtwoord vergeten?" (mail met een link om een nieuw wachtwoord te kiezen). */
function LoginForm({ sb }: { sb: SupabaseClient }) {
  const [mode, setMode] = useState<'login' | 'forgot' | 'sent'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setBusy(true)
    if (mode === 'login') {
      const { error: err } = await sb.auth.signInWithPassword({ email, password })
      if (err) setError(tx("Inloggen is niet gelukt. Controleer je e-mailadres en wachtwoord."))
    } else {
      const { error: err } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}` })
      if (err) setError(tx("Versturen is niet gelukt. Probeer het later opnieuw.")); else setMode('sent')
    }
    setBusy(false)
  }
  const emailField = <div className="field"><label htmlFor="login-email">{tx("E-mailadres")}</label><input id="login-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
  if (mode === 'sent') return (
    <LoginShell>
      <div className="note good">{tx("Als {0} bij ons bekend is, staat er nu een mail met een link om een nieuw wachtwoord te kiezen.", email)}</div>
      <button type="button" className="btn" onClick={() => setMode('login')}>{tx("Terug naar inloggen")}</button>
    </LoginShell>
  )
  return (
    <LoginShell onSubmit={submit}>
      {mode === 'forgot' && <p className="small muted" style={{ margin: 0 }}>{tx("Vul je e-mailadres in. Je krijgt een mail met een link om een nieuw wachtwoord te kiezen.")}</p>}
      {emailField}
      {mode === 'login' && <div className="field"><label htmlFor="login-pass">{tx("Wachtwoord")}</label><input id="login-pass" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>}
      {error && <div className="note bad">{error}</div>}
      <button className="btn primary" disabled={busy}>{mode === 'login' ? tx("Inloggen") : tx("Link versturen")}</button>
      <button type="button" className="btn link-btn" onClick={() => { setError(''); setMode(mode === 'login' ? 'forgot' : 'login') }}>{mode === 'login' ? tx("Wachtwoord vergeten?") : tx("Terug naar inloggen")}</button>
    </LoginShell>
  )
}

/** Na een uitnodiging of "wachtwoord vergeten": zelf een wachtwoord kiezen. */
function SetPasswordForm({ sb, email, onDone }: { sb: SupabaseClient; email: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError('')
    if (password.length < 8) return setError(tx("Kies een wachtwoord van minstens 8 tekens."))
    if (password !== again) return setError(tx("De twee wachtwoorden zijn niet gelijk."))
    setBusy(true)
    const { error: err } = await sb.auth.updateUser({ password })
    setBusy(false)
    if (err) return setError(tx("Opslaan is niet gelukt: {0}", err.message))
    history.replaceState(null, '', location.pathname)
    onDone()
  }
  return (
    <LoginShell onSubmit={submit}>
      <p className="small muted" style={{ margin: 0 }}>{tx("Kies een wachtwoord voor {0}.", email)}</p>
      <div className="field"><label htmlFor="pw-new">{tx("Nieuw wachtwoord")}</label><input id="pw-new" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="field"><label htmlFor="pw-again">{tx("Nogmaals")}</label><input id="pw-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></div>
      {error && <div className="note bad">{error}</div>}
      <button className="btn primary" disabled={busy}>{tx("Wachtwoord opslaan")}</button>
    </LoginShell>
  )
}

// Komt iemand binnen via de link uit een uitnodiging of "wachtwoord vergeten"? Vastgelegd vóór Supabase de adresbalk leegmaakt.
const AUTH_LINK = typeof location !== 'undefined' && /type=(invite|recovery)/.test(location.hash)

function SupabaseRoot({ sb }: { sb: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  // Rol van de ingelogde medewerker: undefined = nog laden, null = geen toegang.
  const [role, setRole] = useState<string | null | undefined>(undefined)
  const [roleError, setRoleError] = useState('')
  const [needPassword, setNeedPassword] = useState(AUTH_LINK)
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((event, sess) => {
      if (event === 'PASSWORD_RECOVERY') setNeedPassword(true)
      setSession(sess)
    })
    return () => data.subscription.unsubscribe()
  }, [sb])
  const uid = session?.user.id
  useEffect(() => {
    setRole(undefined); setRoleError('')
    if (!uid) return
    let off = false
    sb.rpc('current_employee_role').then(({ data, error }) => {
      if (off) return
      if (error) setRoleError(error.message)
      setRole(error ? null : ((data as string | null) ?? null))
    })
    return () => { off = true }
  }, [sb, uid])
  if (session === undefined) return <Loading />
  if (!session) return <LoginForm sb={sb} />
  if (needPassword) return <SetPasswordForm sb={sb} email={session.user.email ?? ''} onDone={() => setNeedPassword(false)} />
  if (role === undefined) return <Loading />
  if (role === null) return (
    <LoginShell>
      <div className="note warn">
        {roleError
          ? tx("Je toegang kon niet worden gecontroleerd: {0}", roleError)
          : tx("Je bent ingelogd als {0}, maar nog geen medewerker met toegang tot Bella Flow. Vraag een beheerder om je toe te voegen onder Beheer > Instellingen > Medewerkers, met dit e-mailadres.", session.user.email ?? '')}
      </div>
      <button type="button" className="btn" onClick={() => sb.auth.signOut()}>{tx("Uitloggen")}</button>
    </LoginShell>
  )
  return <AppProvider db={new SupabaseDriver(sb)} fallback={<Loading />}><App onSignOut={() => sb.auth.signOut()} /></AppProvider>
}

const useSupabase = import.meta.env.VITE_DATA_SOURCE === 'supabase'
const sb = useSupabase ? createSupabase(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>{sb ? <SupabaseRoot sb={sb} /> : <LocalRoot />}</StrictMode>,
)
