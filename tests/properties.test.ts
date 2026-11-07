// Verplichte eigenschappen bij bestellen (HA-CO) en andere uitvoeringen. Testartikelen zijn verzonnen.
import { describe, expect, it } from 'vitest'
import { LocalDriver } from '../src/data/localDriver'
import type { SupplierShowroomItem } from '../src/data/types'
import { seedDemo } from '../src/domain/demo'
import { formatOptions, missingProperties, parseOptions, requiredProperties, variantsOf } from '../src/domain/properties'
import { importShowroom } from '../src/domain/services'

const HACO = 'Coöperatieve Inkoopvereniging Ha-Co U.A.'
const props = ['Stofkleur', 'Pootkleur']

describe('verplichte eigenschappen', () => {
  it('zet waarden en vrije tekst om naar één uitvoering en terug', () => {
    const options = formatOptions({ Pootkleur: 'Zwart', Stofkleur: 'Testgrijs 12' }, props, 'Zonder armleuning')
    expect(options).toBe('Stofkleur: Testgrijs 12; Pootkleur: Zwart; Zonder armleuning')
    expect(parseOptions(options, props)).toEqual({ values: { Stofkleur: 'Testgrijs 12', Pootkleur: 'Zwart' }, rest: 'Zonder armleuning' })
  })

  it('meldt welke verplichte eigenschappen nog ontbreken, ook bij lege waarden', () => {
    expect(missingProperties('', props)).toEqual(['Stofkleur', 'Pootkleur'])
    expect(missingProperties('stofkleur: Testgrijs; Pootkleur: ', props)).toEqual(['Pootkleur'])
    expect(missingProperties('Stofkleur: Testgrijs; Pootkleur: Zwart', props)).toEqual([])
    expect(missingProperties('Testgrijs', [])).toEqual([])
  })

  it('laat een spatie tijdens het typen staan en maakt van een puntkomma in een waarde een komma', () => {
    const typing = formatOptions({ Stofkleur: 'Testgrijs ' }, props)
    expect(parseOptions(typing, props).values.Stofkleur).toBe('Testgrijs ')
    expect(formatOptions({ Stofkleur: 'grijs; blauw' }, props)).toBe('Stofkleur: grijs, blauw')
  })

  it('houdt een bestaande vrije uitvoering zonder eigenschap als overige tekst', () => {
    expect(parseOptions('Stof grijs, poot zwart', props)).toEqual({ values: {}, rest: 'Stof grijs, poot zwart' })
  })

  it('negeert dubbele en lege eigenschappen van de leverancier', () => {
    expect(requiredProperties({ properties: ['Stofkleur', ' ', 'stofkleur', 'Pootkleur'] })).toEqual(['Stofkleur', 'Pootkleur'])
    expect(requiredProperties(undefined)).toEqual([])
  })

  it('leest eigenschappen en parent uit de showroom-export', async () => {
    const db = new LocalDriver(false)
    await seedDemo(db, '2026-11-07')
    const csv = [
      'supplier_name,supplier_sku,name,ean,series,categories,price,currency,available_date,available_text,image_url,product_url,scraped_at,active,listed,properties,parent_sku',
      `${HACO},9000001,Testbank Alfa,,Testfabriek,Bankstellen,999.00,EUR,,,,,2026-11-07T09:00:00Z,true,true,Stofkleur | Pootkleur,`,
      `${HACO},9000002,Testbank Alfa breed,,Testfabriek,Bankstellen,1099.00,EUR,,,,,2026-11-07T09:00:00Z,true,true,,9000001`,
    ].join('\n')
    await importShowroom(db, csv)
    const items = await db.list('supplier_showroom_items')
    const alfa = items.find((x) => x.supplier_sku === '9000001')!
    const breed = items.find((x) => x.supplier_sku === '9000002')!
    expect(alfa.properties).toEqual(['Stofkleur', 'Pootkleur'])
    expect(breed.parent_sku).toBe('9000001')
    expect(variantsOf(items, alfa).map((x) => x.supplier_sku)).toEqual(['9000002'])
    expect(variantsOf(items, breed).map((x) => x.supplier_sku)).toEqual(['9000001'])
  })
})

describe('andere uitvoeringen', () => {
  const item = (sku: string, parent = '', active = true): SupplierShowroomItem => ({
    id: sku, supplier_name: HACO, supplier_sku: sku, name: `Testkast ${sku}`, ean: '', series: '', categories: '', price: 1, currency: 'EUR',
    available_date: null, available_text: '', image_url: '', product_url: '', scraped_at: '', active, parent_sku: parent,
  })
  it('toont de parent en de andere kinderen, maar geen inactieve artikelen', () => {
    const items = [item('1'), item('2', '1'), item('3', '1'), item('4', '1', false), item('5')]
    expect(variantsOf(items, items[1]).map((x) => x.id)).toEqual(['1', '3'])
    expect(variantsOf(items, items[0]).map((x) => x.id)).toEqual(['2', '3'])
    expect(variantsOf(items, items[4])).toEqual([])
  })
})
