import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { dropIndex, moveItem } from '../domain/route'

export interface RouteDrag { day: string; id: string; from: number; to: number; dy: number; height: number }

const INTERACTIVE = 'a, button, input, select, textarea, label'
const START_AFTER_PX = 5
const SCROLL_EDGE_PX = 90
const SCROLL_STEP_PX = 14

/** Slepen van stops binnen één dag. Met de muis pak je de hele rij, op een touchscreen de greep, zodat scrollen blijft werken. */
export function useRouteDrag(onDrop: (day: string, ids: string[]) => Promise<unknown>) {
  const [drag, setDrag] = useState<RouteDrag | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopRef.current?.(), [])

  const begin = (e: ReactPointerEvent<HTMLElement>, day: string, id: string, ids: string[]) => {
    const target = e.target as HTMLElement
    if (ids.length < 2 || e.button !== 0 || target.closest(INTERACTIVE)) return
    if (e.pointerType !== 'mouse' && !target.closest('.stop-grip')) return
    const row = e.currentTarget
    const rows = [...(row.parentElement?.querySelectorAll<HTMLElement>(':scope > .stop') ?? [])]
    const from = ids.indexOf(id)
    if (rows.length !== ids.length || from < 0) return
    const scroll0 = window.scrollY
    const rects = rows.map((r) => r.getBoundingClientRect())
    const midpoints = rects.map((r) => r.top + scroll0 + r.height / 2)
    const pointerId = e.pointerId
    const startY = e.clientY
    let lastY = startY
    let active = false
    let to = from
    let timer = 0

    const update = () => {
      const dy = lastY - startY + window.scrollY - scroll0
      to = dropIndex(midpoints, from, midpoints[from] + dy)
      setDrag({ day, id, from, to, dy, height: rects[from].height })
    }
    const finish = () => {
      window.clearInterval(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', onKey)
      document.body.classList.remove('route-dragging')
      stopRef.current = null
    }
    const cancel = () => { finish(); setDrag(null) }
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') cancel() }
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      lastY = ev.clientY
      if (!active) {
        if (Math.abs(lastY - startY) < START_AFTER_PX) return
        active = true
        document.body.classList.add('route-dragging')
        window.getSelection()?.removeAllRanges()
        timer = window.setInterval(() => {
          if (lastY < SCROLL_EDGE_PX) window.scrollBy(0, -SCROLL_STEP_PX)
          else if (lastY > window.innerHeight - SCROLL_EDGE_PX) window.scrollBy(0, SCROLL_STEP_PX)
          else return
          update()
        }, 16)
      }
      update()
    }
    const onUp = async (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      finish()
      // De rijen blijven op hun plek staan tot de nieuwe volgorde is opgeslagen, zodat er niets verspringt.
      try { if (active && to !== from) await onDrop(day, moveItem(ids, from, to)) } finally { setDrag(null) }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', onKey)
    stopRef.current = finish
  }

  /** Verschuiving en getoond volgnummer van een rij tijdens het slepen. */
  const rowState = (day: string, id: string, index: number) => {
    if (!drag || drag.day !== day) return { nr: index + 1, dragging: false, y: 0, active: false }
    if (drag.id === id) return { nr: drag.to + 1, dragging: true, y: drag.dy, active: true }
    let y = 0, nr = index
    if (drag.from < index && index <= drag.to) { y = -drag.height; nr = index - 1 }
    else if (drag.to <= index && index < drag.from) { y = drag.height; nr = index + 1 }
    return { nr: nr + 1, dragging: false, y, active: true }
  }

  return { begin, rowState }
}
