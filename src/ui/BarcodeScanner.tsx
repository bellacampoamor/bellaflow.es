import { useEffect, useRef, useState } from 'react'
import { tx } from '../i18n'

// Camera-scanner voor de streepjescode op het prijsetiket (Code 128 met het eigen artikelnummer), en EAN op de verpakking.
// Chrome op Android heeft een ingebouwde BarcodeDetector; Safari op iPhone niet, daar leest ZXing het beeld.

interface Detector { detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]> }
type DetectorCtor = { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> }
const FORMATS = ['code_128', 'ean_13', 'ean_8']
// Over schermwissels heen: hetzelfde etiket dat nog in beeld is, telt niet meteen opnieuw.
const last = { code: '', at: 0 }

export function BarcodeScanner({ onCode, paused = false }: { onCode: (code: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const handler = useRef(onCode)
  const pausedRef = useRef(paused)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  handler.current = onCode
  pausedRef.current = paused

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer = 0
    let stopZxing: (() => void) | null = null
    let alive = true
    const found = (raw: string) => {
      const code = raw.trim()
      const now = Date.now()
      // Dezelfde code blijft in beeld: niet elke frame opnieuw melden.
      if (!code || pausedRef.current || (code === last.code && now - last.at < 3000)) return
      last.code = code; last.at = now
      navigator.vibrate?.(60)
      handler.current(code)
    }
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setError(tx("Deze browser kan de camera niet gebruiken. Typ het artikelnummer hieronder.")); return }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } })
      } catch (e) {
        const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        setError(denied ? tx("Geen toegang tot de camera. Sta de camera toe in de browser, of typ het artikelnummer hieronder.") : tx("De camera kon niet starten. Typ het artikelnummer hieronder."))
        return
      }
      if (!alive || !video.current) { stream.getTracks().forEach((t) => t.stop()); return }
      const el = video.current
      el.srcObject = stream
      await el.play().catch(() => {})
      setReady(true)
      const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
      const supported = Native ? await Native.getSupportedFormats?.().catch(() => [] as string[]) ?? FORMATS : []
      if (Native && supported.includes('code_128')) {
        const detector = new Native({ formats: FORMATS.filter((f) => supported.includes(f)) })
        const tick = async () => {
          if (!alive) return
          if (!pausedRef.current && el.readyState >= 2) {
            try { const r = await detector.detect(el); if (r[0]) found(r[0].rawValue) } catch { /* volgend beeld */ }
          }
          timer = window.setTimeout(tick, 150)
        }
        void tick()
        return
      }
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')])
      if (!alive) return
      const hints = new Map<number, unknown>([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8]]])
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })
      const controls = await reader.decodeFromVideoElement(el, (result) => { if (result) found(result.getText()) })
      stopZxing = () => controls.stop()
    }
    void start()
    return () => {
      alive = false
      window.clearTimeout(timer)
      stopZxing?.()
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className={`scan-cam ${paused ? 'paused' : ''}`}>
      <video ref={video} playsInline muted aria-label={tx("Camerabeeld")} />
      {ready && !error && <div className="scan-frame" aria-hidden="true"><span /></div>}
      {!ready && !error && <div className="scan-cam-msg">{tx("Camera starten…")}</div>}
      {error && <div className="scan-cam-msg">{error}</div>}
    </div>
  )
}
