import type { Snapshot } from '../data/types'
import { tx } from '../i18n'

/** Naam van een scherm voor de terugknop: het nummer van het document, of de naam van het scherm. */
export function routeLabel(hash: string, s?: Snapshot | null): string {
  const [screen, ...rest] = hash.split('-')
  const param = rest.join('-')
  const num = <T extends { id: string; number?: string | null }>(list: T[] | undefined, id: string) => list?.find((x) => x.id === id)?.number || ''
  switch (screen) {
    case 'overzicht': return tx("Overzicht")
    case 'kassa': return tx("Kassa")
    case 'orders':
      if (!param || param.startsWith('lijst-')) return tx("Verkooporders")
      return num(s?.sales_orders, param.replace(/^(print|wijzig)-/, '')) || tx("Verkooporder")
    case 'inkoop':
      if (!param || param === 'proforma' || param.startsWith('lijst-')) return tx("Inkooporders")
      if (param.startsWith('versturen')) return tx("Afdrukken en versturen")
      return num(s?.purchase_orders, param.replace(/^(print|omzetten)-/, '')) || tx("Inkooporder")
    case 'inkomend': return tx("Gepland transport")
    case 'ontvangst': {
      if (!param) return tx("Goederenontvangst")
      const n = param.startsWith('io-') ? num(s?.purchase_orders, param.slice(3)) : num(s?.transports, param)
      return n ? tx("Ontvangst {0}", n) : tx("Goederenontvangst")
    }
    case 'levering': {
      if (!param || param.startsWith('naar-')) return tx("Levering aan klant")
      const n = num(s?.deliveries, param.replace(/^(print|archief)-/, ''))
      return n ? tx("Afleverbon {0}", n) : tx("Levering aan klant")
    }
    case 'facturatie':
      if (!param || param.startsWith('naar-')) return tx("Facturatie")
      return num(s?.invoices, param.replace(/^(print|crediteren)-/, '')) || tx("Facturatie")
    case 'rapportage':
      return param === 'kassa' ? tx("Factuuroverzicht kassa") : param === 'leverbaar' ? tx("Leverbaar") : tx("Factuuroverzicht")
    case 'kassabeheer': return param === 'dagafsluiting' ? tx("Dagafsluiting") : tx("Factuuroverzicht kassa")
    case 'archief': return tx("Archief")
    case 'catalogi': return tx("Catalogi")
    case 'voorraad': return tx("Voorraad")
    case 'instellingen':
    case 'beheer': return tx("Instellingen")
    default: return tx("Terug")
  }
}
