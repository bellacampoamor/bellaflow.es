// Tekent prijsetiketten (89 x 36 mm, 300 dpi) en stuurt ze rechtstreeks naar de DYMO LabelWriter 450 Turbo via WebUSB,
// zonder DYMO-software. Kan de browser niet bij de printer, dan blijft het printvenster van de browser als terugval.
import { tx } from '../i18n'
import { code128Modules, DEFAULT_PRINTER, DYMO_VENDOR_ID, dymoJob, LABEL_DPI, LABEL_MM, labelToRaster, type PrinterSettings } from '../domain/labels'

export interface LabelData { name: string; price: number | null; articleNumber: string; test?: boolean }

export const LABEL_PX = { w: Math.round((LABEL_MM.width / 25.4) * LABEL_DPI), h: Math.round((LABEL_MM.height / 25.4) * LABEL_DPI) }
const mm = (v: number) => Math.round((v / 25.4) * LABEL_DPI)
const FONT = 'Arial, Helvetica, sans-serif'

export const fmtLabelPrice = (n: number) => `€ ${new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`

// Beeldmerk rechts op het etiket: het staande logo van Bella (zwart vlak, witte letters). Ontbreekt het bestand, dan een zwart vlak met BELLA.
let brand: Promise<HTMLImageElement | null> | null = null
export const loadBrandMark = () => (brand ??= new Promise((resolve) => {
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = () => resolve(null)
  img.src = `${import.meta.env.BASE_URL}assets/etiket/beeldmerk-bella.png`
}))

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (ctx.measureText(next).width <= maxWidth || !cur) cur = next
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  return lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth) ? lines : null
}

/** Tekent één etiket, liggend, zwart op wit. */
export function drawLabel(canvas: HTMLCanvasElement, data: LabelData, mark: HTMLImageElement | null) {
  const { w: W, h: H } = LABEL_PX
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  const M = mm(2.5)

  // Beeldmerk, verticaal rechts
  const slotW = mm(11), slotX = W - M - slotW, slotY = M, slotH = H - 2 * M
  if (mark) {
    const upright = mark.naturalHeight >= mark.naturalWidth
    ctx.save()
    ctx.translate(slotX + slotW / 2, slotY + slotH / 2)
    if (!upright) ctx.rotate(-Math.PI / 2)
    const bw = upright ? slotW : slotH, bh = upright ? slotH : slotW
    const scale = Math.min(bw / mark.naturalWidth, bh / mark.naturalHeight)
    const dw = mark.naturalWidth * scale, dh = mark.naturalHeight * scale
    ctx.drawImage(mark, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  } else {
    ctx.beginPath(); ctx.roundRect(slotX, slotY, slotW, slotH, mm(1.2)); ctx.fill()
    ctx.save()
    ctx.translate(slotX + slotW / 2, slotY + slotH / 2)
    ctx.rotate(Math.PI / 2)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `bold ${mm(5.2)}px ${FONT}`
    ctx.fillText('BELLA', 0, 0)
    ctx.restore()
  }

  const left = M, right = slotX - mm(2), areaW = right - left

  // Verkorte naam, maximaal twee regels, zo groot als past
  let size = mm(5.2), lines: string[] | null = null
  for (; size >= mm(2.6); size -= 2) {
    ctx.font = `bold ${size}px ${FONT}`
    lines = wrapLines(ctx, data.name, areaW, 2)
    if (lines) break
  }
  if (!lines) { ctx.font = `bold ${size}px ${FONT}`; lines = [data.name] }
  ctx.textAlign = 'left'
  lines.forEach((l, i) => ctx.fillText(l, left, M + size * 0.8 + i * size * 1.08, areaW))

  // Prijs
  ctx.font = `bold ${mm(7.2)}px ${FONT}`
  ctx.fillText(data.price === null ? '€ —' : fmtLabelPrice(data.price), left, mm(21), areaW)

  // Streepjescode met het artikelnummer eronder
  const code = data.articleNumber || 'BELLAFLOW'
  const modules = code128Modules(code)
  const x = Math.max(1, Math.min(4, Math.floor(mm(52) / modules.length)))
  const barX = Math.max(left, 10 * x), barY = mm(22.6), barH = mm(8.6)
  modules.forEach((on, i) => { if (on) ctx.fillRect(barX + i * x, barY, x, barH) })
  ctx.font = `${mm(2.4)}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(code, barX + (modules.length * x) / 2, barY + barH + mm(2.5))

  if (data.test) {
    ctx.lineWidth = 3
    ctx.strokeRect(mm(1), mm(1), W - mm(2), H - mm(2))
    ctx.textAlign = 'right'; ctx.font = `bold ${mm(2.6)}px ${FONT}`
    ctx.fillText('TEST  ↑', right, mm(21))
  }
}

/** Zwart-witbeeld van het etiket: 1 = zwart. */
function labelBits(data: LabelData, mark: HTMLImageElement | null) {
  const canvas = document.createElement('canvas')
  drawLabel(canvas, data, mark)
  const { width, height } = canvas
  const px = canvas.getContext('2d')!.getImageData(0, 0, width, height).data
  const bits = new Uint8Array(width * height)
  for (let i = 0; i < bits.length; i++) bits[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11 < 128 ? 1 : 0
  return { bits, width, height }
}

export async function labelImage(data: LabelData) {
  const canvas = document.createElement('canvas')
  drawLabel(canvas, data, await loadBrandMark())
  return canvas.toDataURL('image/png')
}

// Printerinstellingen in deze browser --------------------------------------------------------------------
const SETTINGS_KEY = 'bella-flow-dymo'
export function loadPrinterSettings(): PrinterSettings {
  try { return { ...DEFAULT_PRINTER, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return { ...DEFAULT_PRINTER } }
}
export function savePrinterSettings(s: PrinterSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* alleen deze sessie */ }
}

// WebUSB ----------------------------------------------------------------------------------------------------
// Minimale typen; WebUSB staat (nog) niet in de standaardtypen van TypeScript.
interface UsbEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: string }
interface UsbAlternate { interfaceClass: number; endpoints: UsbEndpoint[] }
interface UsbInterface { interfaceNumber: number; alternate: UsbAlternate; claimed: boolean }
export interface UsbDevice {
  vendorId: number; productId: number; productName?: string; opened: boolean
  configuration: { interfaces: UsbInterface[] } | null
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>
  claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>
  transferOut(endpoint: number, data: Uint8Array): Promise<{ status: string; bytesWritten: number }>
}
interface Usb { getDevices(): Promise<UsbDevice[]>; requestDevice(o: { filters: { vendorId: number }[] }): Promise<UsbDevice> }
const usb = (): Usb | null => (typeof navigator !== 'undefined' && 'usb' in navigator ? (navigator as unknown as { usb: Usb }).usb : null)

export const usbSupported = () => !!usb()
export async function pairedPrinter() {
  const u = usb()
  if (!u) return null
  return (await u.getDevices()).find((d) => d.vendorId === DYMO_VENDOR_ID) ?? null
}
/** Laat de gebruiker de printer kiezen. De browser onthoudt de keuze voor deze site. */
export async function pairPrinter() {
  const u = usb()
  if (!u) throw new Error('WebUSB')
  return u.requestDevice({ filters: [{ vendorId: DYMO_VENDOR_ID }] })
}

async function send(device: UsbDevice, data: Uint8Array) {
  if (!device.opened) await device.open()
  if (!device.configuration) await device.selectConfiguration(1)
  const ifaces = device.configuration!.interfaces
  const iface = ifaces.find((i) => i.alternate.interfaceClass === 7) ?? ifaces[0]
  const out = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk')
  if (!out) throw new Error(tx("Geen uitgang naar de printer gevonden."))
  await device.claimInterface(iface.interfaceNumber)
  try {
    for (let i = 0; i < data.length; i += 16384) {
      const r = await device.transferOut(out.endpointNumber, data.subarray(i, i + 16384))
      if (r.status !== 'ok') throw new Error(tx("De printer meldde {0}.", r.status))
    }
  } finally {
    await device.releaseInterface(iface.interfaceNumber).catch(() => {})
    await device.close().catch(() => {})
  }
}

/** Drukt de etiketten rechtstreeks af. Elk etiket zo vaak als het aantal aangeeft. */
export async function printDirect(device: UsbDevice, labels: { data: LabelData; qty: number }[], settings: PrinterSettings) {
  const mark = await loadBrandMark()
  const rasters = labels.flatMap(({ data, qty }) => {
    const { bits, width, height } = labelBits(data, mark)
    const r = labelToRaster(bits, width, height, settings)
    return Array.from({ length: qty }, () => r)
  })
  await send(device, dymoJob(rasters, settings))
}

/** Terugval: het printvenster van de browser met paginaformaat 89 x 36 mm. Kies daar de DYMO als printer. */
export async function printViaDialog(labels: { data: LabelData; qty: number }[]) {
  const urls = await Promise.all(labels.map(async ({ data, qty }) => ({ url: await labelImage(data), qty })))
  const sheet = document.createElement('div')
  sheet.className = 'label-sheet'
  for (const { url, qty } of urls) for (let i = 0; i < qty; i++) { const img = document.createElement('img'); img.src = url; img.alt = ''; sheet.append(img) }
  const style = document.createElement('style')
  style.textContent = `@media print { @page { size: ${LABEL_MM.width}mm ${LABEL_MM.height}mm; margin: 0; } body > *:not(.label-sheet) { display: none !important; } body { background: #fff; } .label-sheet { display: block !important; } .label-sheet img { display: block; width: ${LABEL_MM.width}mm; height: ${LABEL_MM.height}mm; break-after: page; } } .label-sheet { display: none; }`
  document.head.append(style); document.body.append(sheet)
  await Promise.all([...sheet.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))
  const done = () => { sheet.remove(); style.remove(); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  window.print()
  setTimeout(done, 60_000)
}
