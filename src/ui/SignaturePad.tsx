import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

export interface SignaturePadHandle { clear: () => void; toDataUrl: () => string }

/** Tekenvlak voor vinger, pen of muis. Altijd zwart op wit, ook in de nachtstand, zodat de bon leesbaar blijft. */
export const SignaturePad = forwardRef<SignaturePadHandle, { label: string; onInk: (hasInk: boolean) => void }>(function SignaturePad({ label, onInk }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const blank = () => {
    const c = canvas.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#ffffff'
    g.fillRect(0, 0, c.width, c.height)
  }
  const size = () => {
    const c = canvas.current
    if (!c) return
    const r = c.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(r.width * dpr)
    c.height = Math.round(r.height * dpr)
    blank()
    onInk(false)
  }
  // Draaien van de telefoon wijzigt het vlak; dan begint de handtekening opnieuw.
  useEffect(() => {
    size()
    window.addEventListener('orientationchange', size)
    return () => window.removeEventListener('orientationchange', size)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useImperativeHandle(ref, () => ({
    clear: () => { blank(); onInk(false) },
    toDataUrl: () => canvas.current?.toDataURL('image/png') ?? '',
  }))
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget, r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  const line = (c: HTMLCanvasElement, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const g = c.getContext('2d')
    if (!g) return
    g.strokeStyle = '#0B182A'
    g.lineWidth = 2.4 * (c.width / c.getBoundingClientRect().width)
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke()
  }
  return (
    <canvas
      ref={canvas}
      className="sign-pad"
      role="img"
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); last.current = p; line(e.currentTarget, p, { x: p.x + 0.1, y: p.y + 0.1 }); onInk(true) }}
      onPointerMove={(e) => { if (!last.current) return; const p = at(e); line(e.currentTarget, last.current, p); last.current = p }}
      onPointerUp={() => { last.current = null }}
      onPointerCancel={() => { last.current = null }}
    />
  )
})
