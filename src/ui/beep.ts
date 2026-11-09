// Piepje bij een scan op de telefoon. Gemaakt met Web Audio, dus zonder geluidsbestand.
// Safari op iPhone en Chrome op Android laten pas geluid toe na een tik op het scherm:
// bij de eerste tik (medewerker kiezen, knop) wordt het geluid vrijgegeven.

type Ctx = AudioContext
let ctx: Ctx | null = null

function context(): Ctx | null {
  if (ctx) return ctx
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!C) return null
  try {
    // iPhone: ook geluid als de stil-schakelaar aan staat (Safari 17+).
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
    if (session) session.type = 'playback'
    ctx = new C()
  } catch { ctx = null }
  return ctx
}

function unlock() {
  const c = context()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  // Een stille toon maakt het geluid op oudere iPhones definitief vrij.
  const o = c.createOscillator(); const g = c.createGain()
  g.gain.value = 0
  o.connect(g).connect(c.destination)
  o.start(); o.stop(c.currentTime + 0.01)
}

let armed = false
/** Geluid vrijgeven bij de eerste tik of toets. Eén keer aanroepen is genoeg. */
export function armBeep() {
  if (armed || typeof window === 'undefined') return
  armed = true
  const once = () => { unlock(); window.removeEventListener('pointerdown', once); window.removeEventListener('touchend', once); window.removeEventListener('keydown', once) }
  window.addEventListener('pointerdown', once)
  window.addEventListener('touchend', once)
  window.addEventListener('keydown', once)
}

function tone(freq: number, start: number, length: number, volume: number) {
  const c = context()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime + start
  const o = c.createOscillator(); const g = c.createGain()
  o.type = 'square'
  o.frequency.value = freq
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(volume, t + 0.005)
  g.gain.setValueAtTime(volume, t + length - 0.02)
  g.gain.linearRampToValueAtTime(0, t + length)
  o.connect(g).connect(c.destination)
  o.start(t); o.stop(t + length + 0.01)
}

/** Kort, hoog piepje: etiket gelezen (zoals een kassascanner). */
export function beepOk() { try { tone(2700, 0, 0.09, 0.25) } catch { /* geen geluid mogelijk */ } }

/** Twee lage tonen: artikel niet gevonden. */
export function beepError() { try { tone(440, 0, 0.14, 0.25); tone(330, 0.18, 0.2, 0.25) } catch { /* geen geluid mogelijk */ } }
