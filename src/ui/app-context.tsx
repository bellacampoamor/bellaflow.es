import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadSnapshot, type Driver } from '../data/driver'
import type { Snapshot } from '../data/types'
import { FlowError } from '../domain/services'
import { tx } from '../i18n'
import { goBack } from './nav'

interface Ctx {
  db: Driver
  s: Snapshot
  refresh: () => Promise<void>/** Voert een handeling uit, ververst de gegevens en toont het resultaat. Geeft true bij succes. */
  /** Voert een handeling uit, ververst de gegevens en toont het resultaat. Geeft true bij succes. */
  run: (fn: (db: Driver) => Promise<unknown>, success?: string) => Promise<boolean>
  toast: (msg: string, err?: boolean) => void
}
const AppCtx = createContext<Ctx | null>(null)
export const useApp = () => useContext(AppCtx)!
/** Zoals useApp, maar null buiten de AppProvider (bijv. op het laadscherm). */
export const useAppOptional = () => useContext(AppCtx)

export function AppProvider({ db, children, fallback }: { db: Driver; children: ReactNode; fallback: ReactNode }) {
  const [s, setS] = useState<Snapshot | null>(null)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [loadError, setLoadError] = useState('')

  const refresh = useCallback(async () => { setS(await loadSnapshot(db)) }, [db])
  useEffect(() => { refresh().catch((e) => setLoadError(String(e?.message ?? e))) }, [refresh])
  useEffect(() => {
    if (!msg || msg.err) return
    const t = setTimeout(() => setMsg(null), 3500)
    return () => clearTimeout(t)
  }, [msg])

  // Wijzigingen uit een ander tabblad meteen tonen, zodat niemand op een oude stand verder werkt.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'bella-flow-v1') void refresh() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [refresh])
  const toast = useCallback((text: string, err = false) => setMsg({ text, err }), [])
  const run = useCallback<Ctx['run']>(async (fn, success) => {
    try {
      await fn(db)
      await refresh()
      if (success) toast(success)
      return true
    } catch (e) {
      await refresh().catch(() => {})
      toast(e instanceof FlowError || e instanceof Error ? e.message : tx("De handeling is niet gelukt. Probeer het opnieuw."), true)
      return false
    }
  }, [db, refresh, toast])

  if (loadError) return <div className="wrap" style={{ paddingBlock: 40 }}><div className="note bad">{tx("De gegevens konden niet worden geladen:")} {loadError}</div></div>
  if (!s) return <>{fallback}</>
  return (
    <AppCtx.Provider value={{ db, s, refresh, run, toast }}>
      {children}
      {msg && (
        <div className={`toast ${msg.err ? 'err' : ''}`} role="status">
          <span>{msg.text}</span>
          {msg.err && <button className="linklike" onClick={() => setMsg(null)}>{tx("Sluiten")}</button>}
        </div>
      )}
    </AppCtx.Provider>
  )
}

/** Opent na het tonen van het document meteen het afdrukvenster en keert daarna terug. */
export function useAutoPrint(enabled: boolean, ready: boolean, backTo = 'archief') {
  useEffect(() => {
    if (!enabled || !ready) return
    // Na afdrukken terug naar waar je vandaan kwam; anders naar backTo.
    const back = () => goBack(backTo)
    window.addEventListener('afterprint', back)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      // Het logo moet geladen zijn, anders ontbreekt het op papier.
      await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)))
      if (!cancelled) window.print()
    }, 150)
    return () => { cancelled = true; window.clearTimeout(timer); window.removeEventListener('afterprint', back) }
  }, [enabled, ready, backTo])
}

export function useHash() {
  const read = () => location.hash.replace(/^#/, '') || 'overzicht'
  const [hash, setHash] = useState(read)
  useEffect(() => {
    const on = () => { setHash(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}
export const go = (hash: string) => { location.hash = hash }
