// Voorbeeldgegevens. Alles is verzonnen en wordt opgebouwd met dezelfde functies als de echte app,
// zodat de voorbeeldsituatie altijd klopt. Datums lopen mee met vandaag.
import { newId, type Driver } from '../data/driver'
import type { Customer, Product, Salesperson, Settings, Supplier, Warehouse } from '../data/types'
import { addDays, openLinesOnTransport, todayISO } from './calc'
import {
  closeShipment, createDelivery, createInvoice, createTransport, createOrder, createPurchaseOrder, lineFromProduct, markDelivered, markNotePrinted, markReady, payInvoice,
  receiveGoods, rescheduleOrder, setTransportStatus, transferStock, type OrderHeader, type OrderLineInput,
} from './services'
import { loadSnapshot } from '../data/driver'

// Plaatsen bij de verzonnen adressen, zodat de routeplanning meteen iets laat zien.
const COORDS: Record<string, [number, number]> = {
  'Orihuela Costa': [37.9341, -0.7395], Torrevieja: [37.9787, -0.6822], Campoamor: [37.8992, -0.7522],
  Rojales: [38.0887, -0.7233], 'Pilar de la Horadada': [37.8654, -0.7923],
}

const RENAMED_SUPPLIERS: Record<string, string> = {
  'Eikenhoeve Meubelmakers': 'Coöperatieve Inkoopvereniging Ha-Co U.A.',
  'Noorderzon Outdoor': 'Life Outdoor Living International B.V.',
}

/** Zet de oude voorbeeldleveranciers in een bestaande browser om naar de standaardleveranciers. */
export async function renameOldSuppliers(db: Driver) {
  for (const x of await db.list('suppliers')) {
    const name = RENAMED_SUPPLIERS[x.name]
    if (name) await db.update('suppliers', x.id, { name, city: '' })
  }
}

/** Herstellen van de voorbeeldgegevens laat ingevoerde leveranciersgegevens staan. */
/** Herstellen raakt de eigen bedrijfsgegevens en instellingen niet. Nieuwe velden houden hun standaardwaarde. */
export async function restoreSettings(db: Driver, previous: Settings | undefined) {
  if (!previous) return
  const { id: _id, ...patch } = previous
  await db.update('settings', 'default', patch)
}

export async function restoreSuppliers(db: Driver, previous: Supplier[]) {
  const current = await db.list('suppliers')
  for (const { id: _id, ...old } of previous) {
    const match = current.find((x) => x.name === old.name)
    if (match) await db.update('suppliers', match.id, old)
    else await db.insert('suppliers', [{ ...old, id: newId() }])
  }
}

export async function seedDemo(db: Driver, today = todayISO()) {
  const d = (n: number) => addDays(today, n)

  await db.insert('settings', [{
    id: 'default', company_name: 'Bella Outdoor and Furnishing', tax_id: '(CIF invullen in Beheer)', address: '(adres invullen in Beheer)',
    postal_code: '', city: 'Campoamor', province: 'Alicante', phone: '', email: '', iban: '(IBAN invullen in Beheer)',
    payment_days: 14, invoice_footer: '',
    prefix_sales_order: 'VO', prefix_purchase: 'IO', prefix_receipt: 'OV', prefix_delivery: 'LV', prefix_invoice: 'F', prefix_transport: 'TR', prefix_proforma: 'PF', language_reports: 'nl', delivery_note_mode: 'papier', shop_email: 'winkel@voorbeeld.test', language_purchase_order: 'nl', language_sales_order: 'klant', language_delivery_note: 'klant', language_invoice: 'klant',
  }])

  const wh = (code: string, name: string, kind: Warehouse['kind'], city: string, receives = true): Warehouse => ({
    id: newId(), code, name, kind, address: '', postal_code: '', city, phone: '', contact_name: '', receives_goods: receives, ships_goods: true, is_active: true, latitude: null, longitude: null, is_route_origin: false,
  })
  const shop = wh('SHR-CAM', 'Showroom Campoamor', 'winkel', 'Campoamor')
  const north = wh('MAG-CAM', 'Magazijn Campoamor', 'magazijn', 'Campoamor')
  const south = wh('MAG-ALM', 'Magazijn Almoradí', 'magazijn', 'Almoradí')
  north.latitude = 37.911372; north.longitude = -0.74365; north.is_route_origin = true
  await db.insert('warehouses', [shop, north, south])

  const sup = (name: string, city: string, lead: number): Supplier => ({
    id: newId(), name, vat_number: '', contact_name: '', email: '', phone: '', address: '', postal_code: '', city, country: 'Nederland',
    lead_time_days: lead, payment_terms: '30 dagen', notes: '', is_active: true, code: null,
  })
  const oak = sup('Coöperatieve Inkoopvereniging Ha-Co U.A.', '', 28)
  const lounge = sup('Life Outdoor Living International B.V.', '', 21)
  oak.code = 'HAC'; lounge.code = 'LOL'
  await db.insert('suppliers', [oak, lounge])

  const prod = (sku: string, name: string, collection: string, category: string, material: string, color: string, dim: string, kg: number, colli: number, buy: number, sell: number, s: Supplier, min: number): Product => ({
    id: newId(), sku, name, collection, category, material, color, dimensions: dim, weight_kg: kg, colli, purchase_price: buy, sale_price: sell, vat_rate: 21, supplier_id: s.id, min_stock: min, is_active: true, volume_m3: Number((kg / 40).toFixed(2)),
  })
  const sofa = prod('LOU-3Z-TK', 'Loungebank Marbella 3-zits', 'Marbella', 'Loungesets', 'Teak, Sunbrella', 'Zand', '220 × 92 × 74 cm', 68, 2, 890, 1895, lounge, 2)
  const chair = prod('LOU-FT-TK', 'Loungefauteuil Marbella', 'Marbella', 'Loungesets', 'Teak, Sunbrella', 'Zand', '86 × 92 × 74 cm', 29, 1, 390, 795, lounge, 4)
  const coffee = prod('TAF-SL-TK', 'Salontafel Marbella', 'Marbella', 'Tafels', 'Teak', 'Naturel', '120 × 70 × 38 cm', 24, 1, 210, 445, lounge, 2)
  const table = prod('TAF-EK-240', 'Eettafel Altea 240', 'Altea', 'Tafels', 'Massief eiken', 'Licht geolied', '240 × 100 × 76 cm', 85, 2, 980, 1990, oak, 1)
  const dining = prod('STO-EK-RT', 'Eetkamerstoel Altea', 'Altea', 'Stoelen', 'Eiken, rotan', 'Naturel', '52 × 58 × 82 cm', 7, 1, 118, 259, oak, 8)
  const bed = prod('LIG-AL-WT', 'Ligbed Calpe', 'Calpe', 'Ligbedden', 'Aluminium, textileen', 'Wit', '200 × 72 × 35 cm', 16, 1, 165, 365, lounge, 4)
  const parasol = prod('PAR-3M-SN', 'Zweefparasol 3 m', 'Calpe', 'Parasols', 'Aluminium, acryl', 'Zand', '300 × 300 × 250 cm', 22, 1, 240, 545, lounge, 2)
  const cabinet = prod('KST-EK-180', 'Dressoir Altea 180', 'Altea', 'Kasten', 'Massief eiken', 'Licht geolied', '180 × 45 × 80 cm', 62, 1, 620, 1345, oak, 1)
  await db.insert('products', [sofa, chair, coffee, table, dining, bed, parasol, cabinet])

  const cust = (name: string, phone: string, email: string, language: Customer['language'], address: string, pc: string, city: string, extra: Partial<Customer> = {}): Customer => ({
    id: newId(), kind: 'particulier', name, company: '', tax_id: '', email, phone, language, address, postal_code: pc, city, province: 'Alicante', country: 'España', notes: '', ...extra,
  })
  const c1 = cust('Marieke de Vries', '+34 600 000 101', 'marieke@voorbeeld.test', 'nl', 'Calle del Mar 12', '03189', 'Orihuela Costa')
  const c2 = cust('Carlos Ruiz Martín', '+34 600 000 102', 'carlos@voorbeeld.test', 'es', 'Avenida de la Playa 45', '03181', 'Torrevieja')
  const c3 = cust('James Whitfield', '+34 600 000 103', 'james@voorbeeld.test', 'en', 'Urb. Las Colinas 8', '03189', 'Orihuela Costa')
  const c4 = cust('Hotel Mirador', '+34 600 000 104', 'inkoop@voorbeeld.test', 'es', 'Paseo Marítimo 3', '03189', 'Campoamor', { kind: 'zakelijk', company: 'Hotel Mirador SL', tax_id: 'B00000000' })
  const c5 = cust('Peter en Anja Bakker', '+34 600 000 105', 'bakker@voorbeeld.test', 'nl', 'Calle Jazmín 21', '03170', 'Rojales')
  const c6 = cust('Lucía Fernández', '+34 600 000 106', 'lucia@voorbeeld.test', 'es', 'Calle Mayor 7', '03190', 'Pilar de la Horadada')
  await db.insert('customers', [c1, c2, c3, c4, c5, c6])

  const truck = (dep: number, arr: number) => createTransport(db, { departure_date: d(dep), arrival_date: d(arr), carrier: 'Dutch Freight', reference: '', capacity_m3: 90, notes: '' })
  const trFirst = await truck(-37, -34)
  const trSecond = await truck(-12, -9)
  const trLate = await truck(-4, -1)
  const trNext = await truck(2, 5)
  await truck(9, 12)

  // Beginvoorraad: één volledig ontvangen inkooporder, verdeeld over de locaties.
  const lines = [
    { p: sofa, qty: 8 }, { p: chair, qty: 14 }, { p: coffee, qty: 8 }, { p: bed, qty: 16 }, { p: parasol, qty: 7 },
  ]
  const po0 = await createPurchaseOrder(db, {
    supplier_id: lounge.id, order_date: d(-48), supplier_reference: 'NZ-88120', notes: 'Eerste voorjaarslevering',
    lines: lines.map((l) => ({ product_id: l.p.id, qty: l.qty, unit_cost: l.p.purchase_price, sales_order_line_id: null })),
    transport_id: trFirst,
  })
  let s = await loadSnapshot(db)
  const linesOn = (transport: string) => openLinesOnTransport(s, transport)
  const pOf = (lid: string) => s.purchase_order_lines.find((l) => l.id === s.inbound_shipment_lines.find((i) => i.id === lid)!.purchase_order_line_id)!.product_id
  await receiveGoods(db, {
    transport_id: trFirst, received_date: d(-34), delivery_note: 'PB-44871', received_by: 'Magazijn', notes: '',
    rows: linesOn(trFirst).map((l) => ({ shipment_line_id: l.id, qty_received: l.qty, qty_damaged: 0, location_bin: '' })),
  })
  // Alles komt binnen op Magazijn Campoamor en wordt daarna verhuisd.
  for (const l of lines) {
    const qty = Math.min(2, Math.floor(l.qty / 3))
    if (qty) await transferStock(db, { product_id: l.p.id, from_id: north.id, to_id: shop.id, qty, note: 'Naar de showroom', date: d(-34) })
  }

  // Eén inkooporder waarvan de regels op verschillende transporten staan.
  await createPurchaseOrder(db, {
    supplier_id: oak.id, order_date: d(-26), supplier_reference: 'EH-2291', notes: '',
    lines: [
      { product_id: table.id, qty: 2, unit_cost: table.purchase_price, sales_order_line_id: null, transport_id: trSecond },
      { product_id: dining.id, qty: 12, unit_cost: dining.purchase_price, sales_order_line_id: null, transport_id: trSecond },
      { product_id: cabinet.id, qty: 2, unit_cost: cabinet.purchase_price, sales_order_line_id: null, transport_id: trSecond },
      { product_id: table.id, qty: 2, unit_cost: table.purchase_price, sales_order_line_id: null, transport_id: trNext },
      { product_id: dining.id, qty: 12, unit_cost: dining.purchase_price, sales_order_line_id: null, transport_id: trNext },
      { product_id: cabinet.id, qty: 2, unit_cost: cabinet.purchase_price, sales_order_line_id: null, transport_id: trNext },
    ],
  })
  s = await loadSnapshot(db)
  const secondLines = linesOn(trSecond).map((l) => ({ line: l, product: pOf(l.id) }))
  await receiveGoods(db, {
    transport_id: trSecond, received_date: d(-8), delivery_note: 'PB-45102', received_by: 'Magazijn', notes: 'Eén stoel niet ontvangen, gemeld bij leverancier',
    rows: secondLines.map(({ line: l, product }) => ({ shipment_line_id: l.id, qty_received: product === dining.id ? l.qty - 1 : l.qty, qty_damaged: 0, location_bin: '' })),
  })
  for (const { line: l, product } of secondLines) {
    const good = product === dining.id ? l.qty - 1 : l.qty
    const qty = Math.floor(good / 2)
    if (qty) await transferStock(db, { product_id: product, from_id: north.id, to_id: south.id, qty, note: 'Naar Almoradí', date: d(-8) })
  }
  s = await loadSnapshot(db)
  for (const x of s.inbound_shipments.filter((y) => y.transport_id === trSecond && y.status === 'partial')) await closeShipment(db, x.id, 'Gecrediteerd door leverancier')

  const sellerA: Salesperson = { id: newId(), name: 'Voorbeeldverkoper Showroom', email: '', phone: '', is_active: true }
  const sellerB: Salesperson = { id: newId(), name: 'Voorbeeldverkoper Online', email: '', phone: '', is_active: true }
  await db.insert('salespeople', [sellerA, sellerB])

  const header = (c: Customer, date: string, type: OrderHeader['order_type'], fulfilment: OrderHeader['fulfilment'], over: Partial<OrderHeader> = {}): OrderHeader => ({
    customer_id: c.id, order_date: date, channel: 'winkel', salesperson_id: sellerA.id, customer_reference: '', order_type: type, fulfilment,
    requested_date: null, promised_date: null, delivery_name: c.name, delivery_phone: c.phone, delivery_address: fulfilment === 'meenemen' ? '' : c.address,
    delivery_postal_code: fulfilment === 'meenemen' ? '' : c.postal_code, delivery_city: fulfilment === 'meenemen' ? '' : c.city, delivery_latitude: fulfilment === 'meenemen' ? null : COORDS[c.city]?.[0] ?? null, delivery_longitude: fulfilment === 'meenemen' ? null : COORDS[c.city]?.[1] ?? null, floor: '', has_elevator: false,
    needs_assembly: false, remove_old_furniture: false, delivery_notes: '', notes: '', ...over,
  })
  const line = (p: Product, qty: number, w: Warehouse | null, over: Partial<OrderLineInput> = {}) =>
    lineFromProduct(p, { qty, warehouse_id: w?.id ?? null, source: w ? 'voorraad' : 'bestelling', ...over })
  const oLines = async (id: string) => (await loadSnapshot(db)).sales_order_lines.filter((l) => l.sales_order_id === id)

  // Volledig geleverd, gefactureerd en betaald.
  const o1 = await createOrder(db, {
    header: header(c1, d(-21), 'bestelling', 'bezorgen', { promised_date: d(-14), floor: 'Begane grond', needs_assembly: true }),
    lines: [line(sofa, 1, north), line(chair, 2, north), line(coffee, 1, north)],
    deposit: { amount: 1000, method: 'pin', reference: '' },
  })
  const dl1 = await createDelivery(db, { sales_order_id: o1, method: 'eigen_team', planned_date: d(-14), carrier: '', notes: '', lines: (await oLines(o1)).map((l) => ({ sales_order_line_id: l.id, qty: l.qty })) })
  await markReady(db, dl1, { approved_by: 'Magazijn', date: d(-15) })
  await markDelivered(db, dl1, { date: d(-14), signed_by: 'M. de Vries', signed_note_received: true })
  const inv1 = await createInvoice(db, { sales_order_id: o1, delivery_ids: [dl1], invoice_date: d(-14), settle_deposit: true })
  const invoice1 = (await loadSnapshot(db)).invoices.find((i) => i.id === inv1)!
  await payInvoice(db, { invoice_id: inv1, amount: invoice1.total - invoice1.deposit_settled, method: 'overboeking', paid_at: d(-11), reference: '' })

  // Meenemen uit de winkel.
  await createOrder(db, {
    header: header(c6, d(-6), 'direct', 'meenemen'),
    lines: [line(bed, 2, shop, { take_now: true })],
    deposit: { amount: 730, method: 'pin', reference: '' },
  })

  // Twee deelleveringen: eerste geleverd en wacht op factuur, tweede vandaag op planning.
  const o2 = await createOrder(db, {
    header: header(c4, d(-12), 'bestelling', 'bezorgen', { channel: 'telefoon', customer_reference: 'PO-MIR-118', promised_date: d(-3), delivery_notes: 'Melden bij receptie, laden via achterzijde' }),
    lines: [line(bed, 8, north), line(parasol, 4, north)],
    deposit: { amount: 1500, method: 'overboeking', reference: 'Aanbetaling 118' },
  })
  const o2l = await oLines(o2)
  const dl2 = await createDelivery(db, { sales_order_id: o2, method: 'eigen_team', planned_date: d(-3), carrier: '', notes: '', lines: o2l.map((l) => ({ sales_order_line_id: l.id, qty: Math.ceil(l.qty / 2) })) })
  await markReady(db, dl2, { approved_by: 'Magazijn', date: d(-4) })
  await markDelivered(db, dl2, { date: d(-3), signed_by: 'Receptie Mirador', signed_note_received: true })
  await createInvoice(db, { sales_order_id: o2, delivery_ids: [dl2], invoice_date: d(-3), settle_deposit: true })
  await rescheduleOrder(db, o2, { new_date: today, reason: 'Tweede deel', customer_notified: true })
  const dl3 = await createDelivery(db, { sales_order_id: o2, method: 'eigen_team', planned_date: today, carrier: '', notes: '', lines: o2l.map((l) => ({ sales_order_line_id: l.id, qty: Math.floor(l.qty / 2) })) })

  await markReady(db, dl3, { approved_by: 'Magazijn', date: today })
  await markNotePrinted(db, dl3)

  // Vier bezorgingen voor morgen, nog niet op rijvolgorde gezet.
  for (const [c, p, qty] of [[c5, coffee, 1], [c1, chair, 2], [c6, chair, 2], [c3, coffee, 1]] as const) {
    const id = await createOrder(db, { header: header(c, d(-1), 'bestelling', 'bezorgen', { promised_date: d(1) }), lines: [line(p, qty, north)] })
    await createDelivery(db, { sales_order_id: id, method: 'eigen_team', planned_date: d(1), carrier: '', notes: '', lines: (await oLines(id)).map((l) => ({ sales_order_line_id: l.id, qty: l.qty })) })
  }

  // Te plannen uit voorraad, op twee locaties.
  await createOrder(db, {
    header: header(c2, d(-4), 'bestelling', 'bezorgen', { channel: 'online', requested_date: d(9), floor: '2e verdieping', has_elevator: true }),
    lines: [line(table, 1, north), line(dining, 6, north, { options: 'Zitting rotan naturel' })],
    deposit: { amount: 800, method: 'online', reference: '' },
  })

  // Op bestelling: wacht op een inkooporder die nog gemaakt moet worden.
  await createOrder(db, {
    header: header(c3, d(-2), 'bestelling', 'bezorgen', { requested_date: d(30), needs_assembly: true, remove_old_furniture: true }),
    lines: [line(cabinet, 2, null, { options: 'Afwerking donker geolied' })],
    deposit: { amount: 1000, method: 'pin', reference: '' },
  })

  // Op bestelling met lopende inkoop, en die zending is te laat.
  const o5 = await createOrder(db, {
    header: header(c5, d(-15), 'bestelling', 'verzenden', { promised_date: d(4) }),
    lines: [line(sofa, 1, null, { options: 'Stof Sunbrella Canvas Granite' }), line(coffee, 1, north)],
    deposit: { amount: 500, method: 'pin', reference: '' },
  })
  const o5l = (await oLines(o5)).find((l) => l.source === 'bestelling')!
  await createPurchaseOrder(db, {
    supplier_id: lounge.id, order_date: d(-14), supplier_reference: 'NZ-88344', notes: 'Maatwerk stof voor klantorder',
    lines: [
      { product_id: sofa.id, qty: 1, unit_cost: 940, sales_order_line_id: o5l.id },
      { product_id: chair.id, qty: 6, unit_cost: chair.purchase_price, sales_order_line_id: null },
    ],
    transport_id: trLate,
  })

  // De verkoop van vandaag: regels die nog doorgezet moeten worden naar inkoop, bij twee leveranciers.
  await createOrder(db, {
    header: header(c2, today, 'bestelling', 'bezorgen', { requested_date: d(21) }),
    lines: [line(table, 1, null, { options: 'Blad 260 cm' }), line(sofa, 1, null, { options: 'Stof Sunbrella Canvas Natural' })],
  })
  await createOrder(db, {
    header: header(c1, today, 'bestelling', 'bezorgen', { requested_date: d(25) }),
    lines: [line(dining, 8, null, { options: 'Zitting rotan zwart' })],
  })

  // Inkoop voor showroom en magazijn: op het volgende transport, en de inkoop van vandaag nog zonder transport.
  await createPurchaseOrder(db, {
    supplier_id: lounge.id, order_date: d(-2), supplier_reference: 'NZ-88402', notes: 'Showroom aanvullen',
    lines: [{ product_id: parasol.id, qty: 6, unit_cost: parasol.purchase_price, sales_order_line_id: null }, { product_id: bed.id, qty: 10, unit_cost: bed.purchase_price, sales_order_line_id: null }],
    label: 'showroom', transport_id: trNext,
  })
  await createPurchaseOrder(db, {
    supplier_id: oak.id, order_date: today, supplier_reference: 'EH-2340', notes: '',
    lines: [{ product_id: dining.id, qty: 8, unit_cost: dining.purchase_price, sales_order_line_id: null }],
  })
  await setTransportStatus(db, trLate, 'departed')
}
