import { StrictMode, useEffect, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { App } from './App'
import { LocalDriver } from './data/localDriver'
import { createSupabase, SupabaseDriver } from './data/supabaseDriver'
import { seedDemo } from './domain/demo'
import { AppProvider } from './ui/app-context'
import { LogoFull } from './ui/kit'
import './styles.css'

const Loading = () => <div className="wrap" style={{ paddingBlock: 40 }}>Gegevens laden…</div>

// Eén driver per paginabezoek, ook als React een effect dubbel uitvoert.
let localBoot: Promise<LocalDriver> | null = null
const bootLocal = () => (localBoot ??= (async () => {
  const d = new LocalDriver()
  if (d.isEmpty) await seedDemo(d)
  return d
})())

function LocalRoot() {
  const [driver, setDriver] = useState<LocalDriver | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    bootLocal().then(setDriver)
  }, [])
  if (!driver) return <Loading />
  const reset = async () => { driver.clear(); await seedDemo(driver); setVersion((v) => v + 1) }
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
      if (err) setError('Inloggen is niet gelukt. Controleer je e-mailadres en wachtwoord.')
    }
    return (
      <div className="wrap login">
        <form className="panel" onSubmit={login}>
          <div className="brand"><LogoFull /></div>
          <div className="field"><label htmlFor="login-email">E-mailadres</label><input id="login-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="login-pass">Wachtwoord</label><input id="login-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <div className="note bad">{error}</div>}
          <button className="btn primary">Inloggen</button>
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
