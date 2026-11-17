// Hulp per scherm (opdracht Rick 17 november 2026). Bella Flow herkent aan het adres van het scherm (de hash)
// welk onderwerp van de gebruikershandleiding erbij hoort. F1 opent het hulpvenster rechts, direct op dat onderwerp.

export type HelpTopic =
  | 'start' | 'zoeken' | 'overzicht' | 'kassa'
  | 'verkooporders' | 'verkooporder-maken' | 'verkooporder' | 'levering' | 'afleverbon' | 'facturatie' | 'crediteren'
  | 'inkooporders' | 'inkooporder-maken' | 'omzetten' | 'afdrukken-versturen' | 'gepland-transport' | 'ontvangst'
  | 'voorraad' | 'rapportage' | 'kassabeheer' | 'catalogi' | 'instellingen' | 'bedrijf-factuur'

/** Volgorde van de handleiding: het hoofdmenu van links naar rechts, binnen een menu de flow. */
export const HELP_ORDER: HelpTopic[] = [
  'start', 'overzicht', 'kassa',
  'verkooporders', 'verkooporder-maken', 'verkooporder', 'levering', 'afleverbon', 'facturatie', 'crediteren',
  'inkooporders', 'inkooporder-maken', 'omzetten', 'afdrukken-versturen', 'gepland-transport', 'ontvangst',
  'voorraad', 'zoeken', 'rapportage', 'kassabeheer', 'catalogi', 'instellingen', 'bedrijf-factuur',
]

/** Context die niet in de hash staat: het open tabblad onder Instellingen. */
export interface HelpContext { adminTab?: string }

/** Welk onderwerp hoort bij dit scherm? Een onbekend scherm krijgt de inleiding met het hoofdmenu. */
export function helpTopicFor(hash: string, ctx: HelpContext = {}): HelpTopic {
  const h = hash.replace(/^#/, '')
  const dash = h.indexOf('-')
  const screen = dash < 0 ? h : h.slice(0, dash)
  const param = dash < 0 ? '' : h.slice(dash + 1)
  switch (screen) {
    case '': case 'overzicht': return screen ? 'overzicht' : 'start'
    case 'kassa': return 'kassa'
    case 'orders':
      if (param === 'nieuw' || param.startsWith('wijzig-')) return 'verkooporder-maken'
      if (!param || param.startsWith('lijst-') || param.startsWith('print-')) return 'verkooporders'
      return 'verkooporder'
    case 'inkoop':
      if (param.startsWith('versturen') || param.startsWith('afdrukken-')) return 'afdrukken-versturen'
      if (param.startsWith('omzetten-')) return 'omzetten'
      if (param === 'nieuw' || param.startsWith('nieuw-')) return 'inkooporder-maken'
      return 'inkooporders'
    case 'inkomend': return 'gepland-transport'
    case 'ontvangst': return 'ontvangst'
    case 'levering':
      if (!param || param.startsWith('naar-')) return 'levering'
      return 'afleverbon'
    case 'facturatie': return param.startsWith('crediteren-') ? 'crediteren' : 'facturatie'
    case 'rapportage': return param === 'kassa' ? 'kassabeheer' : 'rapportage'
    case 'archief': return 'rapportage'
    case 'kassabeheer': return 'kassabeheer'
    case 'catalogi': return 'catalogi'
    case 'voorraad': return 'voorraad'
    case 'instellingen': case 'beheer':
      return ctx.adminTab === 'bedrijf' ? 'bedrijf-factuur' : 'instellingen'
    default: return 'start'
  }
}

/** Het onderwerp ervoor en erna in de volgorde van de handleiding, om door te bladeren. */
export function helpNeighbours(topic: HelpTopic): { prev: HelpTopic | null; next: HelpTopic | null } {
  const i = HELP_ORDER.indexOf(topic)
  return { prev: i > 0 ? HELP_ORDER[i - 1] : null, next: i >= 0 && i < HELP_ORDER.length - 1 ? HELP_ORDER[i + 1] : null }
}
