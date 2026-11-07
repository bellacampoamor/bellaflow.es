import { useMemo, useRef } from 'react'
import { Upload } from 'lucide-react'
import type { Supplier } from '../data/types'
import { importSupplierFile } from '../domain/services'
import { showroomOf, showroomParts } from '../domain/showroom'
import { ShowroomList } from './CatalogShowroom'
import { useApp } from '../ui/app-context'
import { BackToTop, Empty, Head } from '../ui/kit'
import { tx } from '../i18n'

/** Catalogi: per leverancier de showroom (de dealercatalogus). Bella werkt alleen met de showroom, niet met de webshop. */
export function Catalogs({ supplierId }: { supplierId: string }) {
  const { s, run, toast } = useApp()
  const file = useRef<HTMLInputElement>(null)
  const supplier = s.suppliers.find((x) => x.id === supplierId)
  const partsIndex = useMemo(() => showroomParts(s.supplier_showroom_items, s.supplier_showroom_details).parentOf, [s])
  const showroomCount = (sup: Supplier) => showroomOf(s, sup, {}, partsIndex).length

  const pick = (id: string) => { location.hash = `catalogi-${id}` }
  const onFile = async (f: File | undefined) => {
    if (!f) return
    const text = await f.text()
    let result: { kind: 'showroom' | 'details'; added: number; updated: number } | undefined
    const ok = await run(async (db) => { result = await importSupplierFile(db, text) })
    if (ok && result) {
      toast(result.kind === 'showroom' ? tx("Showroom ingelezen: {0} nieuw, {1} bijgewerkt.", result.added, result.updated)
        : tx("Specificaties en elementen ingelezen: {0} nieuw, {1} bijgewerkt.", result.added, result.updated))
    }
    if (file.current) file.current.value = ''
  }

  return (
    <>
      <Head title={tx("Catalogi")} sub={tx("De showroom van elke leverancier, zoals de leverancier die aanbiedt. Klik op een artikel voor de artikelkaart.")}>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <button className="btn" onClick={() => file.current?.click()}><Upload size={16} />{tx("Catalogus inlezen (CSV)")}</button>
      </Head>

      <div className="cat-suppliers" role="tablist" aria-label={tx("Leverancier")}>
        {s.suppliers.filter((x) => x.is_active).map((x) => {
          const n = showroomCount(x)
          return (
            <button key={x.id} role="tab" aria-selected={x.id === supplierId} className={`cat-supplier ${x.id === supplierId ? 'on' : ''}`} onClick={() => pick(x.id)}>
              <span className="strong">{x.name}</span>
              <small>{n ? tx("Showroom: {0} artikelen", n) : tx("Nog geen catalogus")}</small>
            </button>
          )
        })}
      </div>

      {!supplier ? <section className="panel"><Empty>{tx("Kies eerst een leverancier.")}</Empty></section> : <ShowroomList key={supplier.id} supplier={supplier} />}
      <BackToTop />
    </>
  )
}
