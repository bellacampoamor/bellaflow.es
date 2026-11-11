/**
 * Spaanse omschrijving van een artikel voor de kassabon (besluit Rick 11 november 2026).
 *
 * De namen in de catalogi zijn Nederlands (Life Outdoor Living, HA-CO) of Engels (HomeDecoBali). Er is geen
 * Spaanse naam bij de leverancier, dus vertaalt Bella Flow de omschrijving bij het afdrukken met een vaste woordenlijst.
 * Wat niet in de lijst staat (serienamen, maten, merknamen) blijft zoals het is. De opgeslagen omschrijving op de
 * factuurregel verandert niet.
 *
 * Werkwijze: woorden en vaste combinaties opzoeken; een Nederlands samengesteld woord (loungebank, zweefparasol)
 * splitsen in een bekend begin en een bekend eind; een materiaal, kleur of maat die vóór een zelfstandig naamwoord
 * staat (Engels "Teak Root Bowl Large", Nederlands "Teak loungebank") komt erachter, met "de" voor het materiaal,
 * en een bijvoeglijk naamwoord volgt het geslacht van het zelfstandig naamwoord.
 */

type Gender = 'm' | 'f'
type Entry =
  | { k: 'n'; es: string; g: Gender; pl?: boolean } // zelfstandig naamwoord
  | { k: 'm'; es: string } // materiaal: "de teca"
  | { k: 'a'; es: [string, string] } // bijvoeglijk naamwoord (kleur, vorm, maat): mannelijk, vrouwelijk
  | { k: 'x'; es: string } // overig, letterlijk

const n = (es: string, g: Gender, pl = false): Entry => ({ k: 'n', es, g, pl })
const m = (es: string): Entry => ({ k: 'm', es })
const a = (mas: string, fem = mas): Entry => ({ k: 'a', es: [mas, fem] })
const x = (es: string): Entry => ({ k: 'x', es })

/** Woordenlijst Nederlands en Engels naar Spaans, in kleine letters. */
const DICT: Record<string, Entry> = {
  // Meubels
  bank: n('sofá', 'm'), sofa: n('sofá', 'm'), couch: n('sofá', 'm'), loungebank: n('sofá lounge', 'm'), hoekbank: n('sofá rinconero', 'm'),
  'corner sofa': n('sofá rinconero', 'm'), daybed: n('daybed', 'm'), lounge: x('lounge'), loungeset: n('conjunto lounge', 'm'),
  stoel: n('silla', 'f'), chair: n('silla', 'f'), eetkamerstoel: n('silla de comedor', 'f'), 'dining chair': n('silla de comedor', 'f'),
  tuinstoel: n('silla de jardín', 'f'), fauteuil: n('sillón', 'm'), armchair: n('sillón', 'm'), loungestoel: n('sillón lounge', 'm'),
  loungefauteuil: n('sillón lounge', 'm'), 'lounge chair': n('sillón lounge', 'm'), barstoel: n('taburete de bar', 'm'), barkruk: n('taburete de bar', 'm'),
  'bar stool': n('taburete de bar', 'm'), kruk: n('taburete', 'm'), stool: n('taburete', 'm'), hocker: n('taburete', 'm'),
  poef: n('puf', 'm'), pouf: n('puf', 'm'), voetenbank: n('reposapiés', 'm'), footstool: n('reposapiés', 'm'), ottoman: n('reposapiés', 'm'),
  bankje: n('banco', 'm'), bench: n('banco', 'm'), tafel: n('mesa', 'f'), table: n('mesa', 'f'), eettafel: n('mesa de comedor', 'f'),
  'dining table': n('mesa de comedor', 'f'), tuintafel: n('mesa de jardín', 'f'), salontafel: n('mesa de centro', 'f'), 'coffee table': n('mesa de centro', 'f'),
  bijzettafel: n('mesa auxiliar', 'f'), 'side table': n('mesa auxiliar', 'f'), bartafel: n('mesa alta', 'f'), 'bar table': n('mesa alta', 'f'),
  ligbed: n('tumbona', 'f'), lounger: n('tumbona', 'f'), sunlounger: n('tumbona', 'f'), 'sun lounger': n('tumbona', 'f'), 'daybed lounger': n('tumbona', 'f'),
  schommelstoel: n('mecedora', 'f'), hangstoel: n('silla colgante', 'f'), 'hanging chair': n('silla colgante', 'f'), kast: n('armario', 'm'), cabinet: n('armario', 'm'),
  dressoir: n('aparador', 'm'), sideboard: n('aparador', 'm'), buffet: n('aparador', 'm'), wandkast: n('armario', 'm'), boekenkast: n('librería', 'f'),
  rek: n('estantería', 'f'), shelf: n('estante', 'm'), plank: n('estante', 'm'), ladder: n('escalera', 'f'), bed: n('cama', 'f'), nachtkastje: n('mesita de noche', 'f'),
  'bedside table': n('mesita de noche', 'f'), 'tv-meubel': n('mueble TV', 'm'), console: n('consola', 'f'), sidetable: n('consola', 'f'), bureau: n('escritorio', 'm'), desk: n('escritorio', 'm'),
  // Element van een loungeset
  hoekelement: n('módulo de esquina', 'm'), 'corner element': n('módulo de esquina', 'm'), middenelement: n('módulo central', 'm'),
  'middle element': n('módulo central', 'm'), eindelement: n('módulo final', 'm'), element: n('módulo', 'm'), module: n('módulo', 'm'),
  links: x('izquierdo'), rechts: x('derecho'), left: x('izquierdo'), right: x('derecho'),
  // Schaduw en licht
  parasol: n('sombrilla', 'f'), umbrella: n('sombrilla', 'f'), zweefparasol: n('sombrilla excéntrica', 'f'), 'cantilever parasol': n('sombrilla excéntrica', 'f'),
  stokparasol: n('sombrilla central', 'f'), parasolvoet: n('base de sombrilla', 'f'), 'parasol base': n('base de sombrilla', 'f'), voet: n('base', 'f'), base: n('base', 'f'),
  gazebo: n('cenador', 'm'), paviljoen: n('cenador', 'm'), pergola: n('pérgola', 'f'), schaduwdoek: n('toldo vela', 'm'), lamp: n('lámpara', 'f'),
  'floor lamp': n('lámpara de pie', 'f'), vloerlamp: n('lámpara de pie', 'f'), staandelamp: n('lámpara de pie', 'f'), 'table lamp': n('lámpara de mesa', 'f'),
  tafellamp: n('lámpara de mesa', 'f'), hanglamp: n('lámpara colgante', 'f'), 'pendant lamp': n('lámpara colgante', 'f'), pendant: n('lámpara colgante', 'f'),
  lantaarn: n('farol', 'm'), lantern: n('farol', 'm'), verlichting: n('iluminación', 'f'), kaars: n('vela', 'f'), candle: n('vela', 'f'),
  kandelaar: n('candelabro', 'm'), 'candle holder': n('portavelas', 'm'), kaarshouder: n('portavelas', 'm'), windlicht: n('portavelas', 'm'), shade: n('pantalla', 'f'), lampenkap: n('pantalla', 'f'),
  // Textiel en onderhoud
  kussen: n('cojín', 'm'), kussens: n('cojines', 'm'), cushion: n('cojín', 'm'), cushions: n('cojines', 'm'), pillow: n('cojín', 'm'),
  sierkussen: n('cojín decorativo', 'm'), zitkussen: n('cojín de asiento', 'm'), 'seat cushion': n('cojín de asiento', 'm'), rugkussen: n('cojín de respaldo', 'm'),
  'back cushion': n('cojín de respaldo', 'm'), plaid: n('manta', 'f'), throw: n('manta', 'f'), deken: n('manta', 'f'), kleed: n('alfombra', 'f'), vloerkleed: n('alfombra', 'f'),
  buitenkleed: n('alfombra de exterior', 'f'), rug: n('alfombra', 'f'), carpet: n('alfombra', 'f'), mat: n('alfombra', 'f'), gordijn: n('cortina', 'f'), curtain: n('cortina', 'f'),
  hoes: n('funda', 'f'), beschermhoes: n('funda protectora', 'f'), cover: n('funda', 'f'), onderhoudsset: n('kit de mantenimiento', 'm'), 'care kit': n('kit de mantenimiento', 'm'),
  reiniger: n('limpiador', 'm'), cleaner: n('limpiador', 'm'), olie: n('aceite', 'm'), oil: n('aceite', 'm'),
  // Decoratie (HomeDecoBali)
  schaal: n('cuenco', 'm'), bowl: n('cuenco', 'm'), kom: n('cuenco', 'm'), bord: n('plato', 'm'), plate: n('plato', 'm'), dienblad: n('bandeja', 'f'), tray: n('bandeja', 'f'),
  vaas: n('jarrón', 'm'), vase: n('jarrón', 'm'), pot: n('maceta', 'f'), bloempot: n('maceta', 'f'), planter: n('maceta', 'f'), mand: n('cesta', 'f'), basket: n('cesta', 'f'),
  spiegel: n('espejo', 'm'), mirror: n('espejo', 'm'), beeld: n('escultura', 'f'), statue: n('escultura', 'f'), sculpture: n('escultura', 'f'), beeldje: n('figura', 'f'), figure: n('figura', 'f'),
  'buddha head': n('cabeza de Buda', 'f'), 'buddha statue': n('estatua de Buda', 'f'), boeddhabeeld: n('estatua de Buda', 'f'), boeddhahoofd: n('cabeza de Buda', 'f'),
  boeddha: n('Buda', 'm'), buddha: n('Buda', 'm'), hoofd: n('cabeza', 'f'), head: n('cabeza', 'f'), wanddecoratie: n('decoración de pared', 'f'), 'wall decor': n('decoración de pared', 'f'),
  'wall art': n('decoración de pared', 'f'), panel: n('panel', 'm'), paneel: n('panel', 'm'), lijst: n('marco', 'm'), frame: n('marco', 'm'), box: n('caja', 'f'), doos: n('caja', 'f'),
  kist: n('baúl', 'm'), chest: n('baúl', 'm'), klok: n('reloj', 'm'), clock: n('reloj', 'm'), fontein: n('fuente', 'f'), fountain: n('fuente', 'f'),
  stam: n('tronco', 'm'), trunk: n('tronco', 'm'), log: n('tronco', 'm'), wortel: m('raíz'), root: m('raíz'), blad: n('hoja', 'f'), leaf: n('hoja', 'f'),
  olifant: n('elefante', 'm'), elephant: n('elefante', 'm'), vis: n('pez', 'm'), fish: n('pez', 'm'), vogel: n('pájaro', 'm'), bird: n('pájaro', 'm'), kikker: n('rana', 'f'), frog: n('rana', 'f'),
  schelp: n('concha', 'f'), shell: n('concha', 'f'), ornament: n('adorno', 'm'), decoratie: n('decoración', 'f'), decoration: n('decoración', 'f'), 'deco': n('decoración', 'f'),
  set: n('juego', 'm'), 'set of': x('juego de'), stuks: x('piezas'), pcs: x('piezas'), pieces: x('piezas'),
  // Materialen
  teak: m('teca'), teakhout: m('teca'), hout: m('madera'), wood: m('madera'), wooden: m('madera'), houten: m('madera'), eiken: m('roble'), eikenhout: m('roble'), oak: m('roble'),
  acacia: m('acacia'), mahonie: m('caoba'), mahogany: m('caoba'), suar: m('suar'), bamboe: m('bambú'), bamboo: m('bambú'), rotan: m('ratán'), rattan: m('ratán'), riet: m('mimbre'), wicker: m('mimbre'),
  touw: m('cuerda'), rope: m('cuerda'), aluminium: m('aluminio'), aluminum: m('aluminio'), staal: m('acero'), steel: m('acero'), rvs: m('acero inoxidable'),
  'stainless steel': m('acero inoxidable'), metaal: m('metal'), metal: m('metal'), ijzer: m('hierro'), iron: m('hierro'), smeedijzer: m('hierro forjado'), messing: m('latón'), brass: m('latón'),
  koper: m('cobre'), copper: m('cobre'), glas: m('vidrio'), glass: m('vidrio'), keramiek: m('cerámica'), ceramic: m('cerámica'), aardewerk: m('terracota'), terracotta: m('terracota'),
  steen: m('piedra'), stone: m('piedra'), natuursteen: m('piedra natural'), lavasteen: m('piedra volcánica'), 'lava stone': m('piedra volcánica'), marmer: m('mármol'), marble: m('mármol'),
  graniet: m('granito'), granite: m('granito'), beton: m('hormigón'), concrete: m('hormigón'), keramisch: m('cerámica'), textileen: m('textilene'), textilene: m('textilene'),
  stof: m('tela'), fabric: m('tela'), katoen: m('algodón'), cotton: m('algodón'), linnen: m('lino'), linen: m('lino'), leer: m('piel'), leather: m('piel'), wol: m('lana'), wool: m('lana'),
  jute: m('yute'), zeegras: m('junco marino'), seagrass: m('junco marino'), kunststof: m('plástico'), polyester: m('poliéster'), polyrattan: m('ratán sintético'),
  sunbrella: m('Sunbrella'), olefin: m('olefina'), 'recycled wood': m('madera reciclada'), gerecycled: a('reciclado', 'reciclada'), recycled: a('reciclado', 'reciclada'),
  // Kleuren
  wit: a('blanco', 'blanca'), white: a('blanco', 'blanca'), zwart: a('negro', 'negra'), black: a('negro', 'negra'), grijs: a('gris'), grey: a('gris'), gray: a('gris'),
  antraciet: a('antracita'), anthracite: a('antracita'), lichtgrijs: a('gris claro'), donkergrijs: a('gris oscuro'), 'light grey': a('gris claro'), 'dark grey': a('gris oscuro'),
  zand: a('arena'), sand: a('arena'), beige: a('beige'), taupe: a('taupe'), creme: a('crema'), crème: a('crema'), cream: a('crema'), ecru: a('crudo', 'cruda'),
  naturel: a('natural'), natural: a('natural'), bruin: a('marrón'), brown: a('marrón'), blauw: a('azul'), blue: a('azul'), groen: a('verde'), green: a('verde'),
  rood: a('rojo', 'roja'), red: a('rojo', 'roja'), geel: a('amarillo', 'amarilla'), yellow: a('amarillo', 'amarilla'), oranje: a('naranja'), orange: a('naranja'),
  roze: a('rosa'), pink: a('rosa'), goud: a('dorado', 'dorada'), gold: a('dorado', 'dorada'), zilver: a('plateado', 'plateada'), silver: a('plateado', 'plateada'),
  terra: a('terracota'), olijf: a('oliva'), olive: a('oliva'), 'licht geolied': a('aceitado claro', 'aceitada clara'), geolied: a('aceitado', 'aceitada'), oiled: a('aceitado', 'aceitada'),
  // Vorm en maat
  rond: a('redondo', 'redonda'), ronde: a('redondo', 'redonda'), round: a('redondo', 'redonda'), vierkant: a('cuadrado', 'cuadrada'), vierkante: a('cuadrado', 'cuadrada'),
  square: a('cuadrado', 'cuadrada'), rechthoekig: a('rectangular'), rechthoekige: a('rectangular'), rectangular: a('rectangular'), ovaal: a('ovalado', 'ovalada'), ovale: a('ovalado', 'ovalada'), oval: a('ovalado', 'ovalada'),
  groot: a('grande'), grote: a('grande'), large: a('grande'), big: a('grande'), klein: a('pequeño', 'pequeña'), kleine: a('pequeño', 'pequeña'), small: a('pequeño', 'pequeña'),
  medium: a('mediano', 'mediana'), middel: a('mediano', 'mediana'), hoog: a('alto', 'alta'), hoge: a('alto', 'alta'), high: a('alto', 'alta'), tall: a('alto', 'alta'),
  laag: a('bajo', 'baja'), lage: a('bajo', 'baja'), low: a('bajo', 'baja'), verstelbaar: a('regulable'), verstelbare: a('regulable'), adjustable: a('regulable'),
  inklapbaar: a('plegable'), inklapbare: a('plegable'), klapstoel: n('silla plegable', 'f'), folding: a('plegable'), stapelbaar: a('apilable'), stapelbare: a('apilable'), stackable: a('apilable'),
  uitschuifbaar: a('extensible'), uitschuifbare: a('extensible'), extendable: a('extensible'), handgemaakt: a('hecho a mano', 'hecha a mano'), handmade: a('hecho a mano', 'hecha a mano'),
  buiten: x('de exterior'), outdoor: x('de exterior'), binnen: x('de interior'), indoor: x('de interior'),
  // Verbindingswoorden
  met: x('con'), with: x('con'), en: x('y'), and: x('y'), voor: x('para'), for: x('para'), zonder: x('sin'), without: x('sin'), incl: x('incl.'), 'incl.': x('incl.'), inclusief: x('incluido'),
  of: x('de'), van: x('de'), het: x(''), een: x(''), the: x(''),
}

/** Begin van een samengesteld Nederlands woord dat als materiaal of kenmerk achter het hoofdwoord komt. */
const PREFIX: Record<string, Entry> = {
  teak: m('teca'), eiken: m('roble'), hout: m('madera'), rotan: m('ratán'), touw: m('cuerda'), aluminium: m('aluminio'), alu: m('aluminio'), glas: m('vidrio'), steen: m('piedra'),
  tuin: x('de jardín'), buiten: x('de exterior'), lounge: x('lounge'), bar: x('alta'), hoek: x('rinconero'), eet: x('de comedor'), wand: x('de pared'), vloer: x('de suelo'),
  zweef: x('excéntrica'), kinder: x('infantil'), sier: x('decorativo'),
}

/** Spaans meervoud: casa → casas, mesa de comedor → mesas de comedor, sillón → sillones. */
const plural = (es: string) => es.replace(/^(\S+)/, (w) => (/[aeiouáéó]$/i.test(w) ? `${w}s` : `${w.replace(/ón$/, 'on').replace(/z$/, 'c')}es`))

function lookup(w: string): Entry | undefined {
  const low = w.toLowerCase()
  if (DICT[low]) return DICT[low]
  // Engels en Nederlands meervoud (baskets, bowls, stoelen, tafels): enkelvoud opzoeken en in het Spaans meervoud maken.
  for (const sing of [low.replace(/s$/, ''), low.replace(/es$/, ''), low.replace(/en$/, ''), low.replace(/ies$/, 'y')]) {
    const e = sing !== low ? DICT[sing] : undefined
    if (e?.k === 'n') return n(plural(e.es), e.g, true)
  }
  return undefined
}

/** Nederlands samengesteld woord: bekend begin + bekend zelfstandig naamwoord, bijv. teakbank, aluminiumtafel. */
function splitCompound(w: string): Entry | undefined {
  const low = w.toLowerCase()
  for (let i = 3; i <= low.length - 3; i++) {
    const head = DICT[low.slice(i)]
    const pre = PREFIX[low.slice(0, i)]
    if (head?.k === 'n' && pre) return n(`${head.es} ${pre.k === 'm' ? `de ${pre.es}` : pre.es}`, head.g)
  }
  return undefined
}

interface Tok { raw: string; e?: Entry }

export function spanishDescription(text: string): string {
  if (!text?.trim()) return text ?? ''
  // Vaste vormen met een getal.
  const pre = text
    .replace(/\b(\d+)[- ]?zits\b/gi, '$1 plazas').replace(/\b(\d+)[- ]?seater\b/gi, '$1 plazas')
    .replace(/\b(\d+)[- ]?persoons\b/gi, 'para $1 personas').replace(/\b(\d+)[- ]?(person|persons|people)\b/gi, 'para $1 personas')
    .replace(/\bset van (\d+)\b/gi, 'juego de $1').replace(/\bset of (\d+)\b/gi, 'juego de $1')
  const words = pre.split(/\s+/).filter(Boolean)
  // Woorden opzoeken, met voorrang voor combinaties van drie en twee woorden.
  const toks: Tok[] = []
  for (let i = 0; i < words.length;) {
    let hit = false
    for (const len of [3, 2]) {
      if (i + len > words.length) continue
      const phrase = words.slice(i, i + len).join(' ').toLowerCase().replace(/[,;]$/, '')
      if (DICT[phrase]) { toks.push({ raw: words.slice(i, i + len).join(' '), e: DICT[phrase] }); i += len; hit = true; break }
    }
    if (hit) continue
    const w = words[i]
    const core = w.replace(/^[("']+|[)"',;:.]+$/g, '')
    const e = core ? lookup(core) ?? splitCompound(core) : undefined
    toks.push({ raw: w, e: e && core === w ? e : e ? { k: 'x', es: w.replace(core, render(e, 'm')) } : undefined })
    i++
  }
  // Materiaal, kleur of maat vóór een zelfstandig naamwoord: achter het naamwoord zetten.
  const out: string[] = []
  let gender: Gender = 'm'
  let pl = false
  for (let i = 0; i < toks.length; i++) {
    let j = i
    while (j < toks.length && (toks[j].e?.k === 'm' || toks[j].e?.k === 'a')) j++
    if (j > i && j < toks.length && toks[j].e?.k === 'n') {
      const noun = toks[j].e as Extract<Entry, { k: 'n' }>
      const mods = toks.slice(i, j).map((t) => t.e!)
      const mats = mods.filter((e) => e.k === 'm').map((e) => render(e, noun.g, noun.pl))
      const adjs = mods.filter((e) => e.k === 'a').map((e) => render(e, noun.g, noun.pl))
      out.push(noun.es, ...adjs, ...(mats.length ? [`de ${mats.join(' y ')}`] : []))
      // Een kleur of vorm direct na het naamwoord volgt ook het geslacht.
      i = j
      gender = noun.g
      pl = !!noun.pl
      continue
    }
    const t = toks[i]
    if (t.e?.k === 'n') { gender = t.e.g; pl = !!t.e.pl }
    // Een los materiaal (Nederlands "Eettafel Altea teak"): "de teca".
    out.push(!t.e ? t.raw : t.e.k === 'm' ? `de ${t.e.es}` : render(t.e, gender, pl))
  }
  const s = out.filter((w) => w !== '').join(' ').replace(/\s+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Kleuren die een zelfstandig naamwoord zijn, blijven in het meervoud gelijk (cojines arena).
const INVARIABLE = new Set(['arena', 'beige', 'taupe', 'crema', 'antracita', 'naranja', 'rosa', 'oliva', 'terracota', 'hecho a mano', 'hecha a mano'])

function render(e: Entry, g: Gender, pl = false): string {
  if (e.k === 'a') {
    const w = g === 'f' ? e.es[1] : e.es[0]
    if (!pl || INVARIABLE.has(w)) return w
    return w.replace(/^(\S+)/, (x) => (/[aeiouéó]$/.test(x) ? `${x}s` : `${x}es`))
  }
  return e.es
}
