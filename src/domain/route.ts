// Beste rijvolgorde: vertrek vanaf het magazijn, langs alle stops en weer terug.
// Rekent op een matrix van reistijden of afstanden; index 0 is het vertrekpunt.

export interface Point { latitude: number; longitude: number }
export type Matrix = number[][]

const EXACT_LIMIT = 9

export function tourCost(m: Matrix, order: number[]) {
  let cost = 0, at = 0
  for (const next of order) { cost += m[at][next]; at = next }
  return cost + (order.length ? m[at][0] : 0)
}

function exact(m: Matrix): number[] {
  const n = m.length - 1
  let best: number[] = [], bestCost = Infinity
  const used = new Array(n + 1).fill(false)
  const path: number[] = []
  const walk = (at: number, cost: number) => {
    if (cost >= bestCost) return
    if (path.length === n) {
      const total = cost + m[at][0]
      if (total < bestCost) { bestCost = total; best = [...path] }
      return
    }
    for (let i = 1; i <= n; i++) {
      if (used[i]) continue
      used[i] = true; path.push(i)
      walk(i, cost + m[at][i])
      path.pop(); used[i] = false
    }
  }
  walk(0, 0)
  return best
}

function heuristic(m: Matrix): number[] {
  const left = new Set(m.map((_, i) => i).slice(1))
  const order: number[] = []
  let at = 0
  while (left.size) {
    let next = -1
    for (const i of left) if (next < 0 || m[at][i] < m[at][next]) next = i
    order.push(next); left.delete(next); at = next
  }
  let improved = true
  while (improved) {
    improved = false
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]
        if (tourCost(m, candidate) + 1e-9 < tourCost(m, order)) { order.splice(0, order.length, ...candidate); improved = true }
      }
    }
  }
  return order
}

/** Geeft de stopindexen (1..n) in de beste volgorde. Tot 9 stops gegarandeerd de kortste rit. */
export const optimizeRoute = (m: Matrix): number[] => (m.length - 1 <= EXACT_LIMIT ? exact(m) : heuristic(m))

export function haversineKm(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude), dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/** Google Maps neemt maximaal 9 tussenstops in een link. */
export const MAPS_MAX_WAYPOINTS = 9
export function googleMapsRouteUrl(origin: Point, stops: Point[]) {
  const ll = (p: Point) => `${p.latitude},${p.longitude}`
  const q = new URLSearchParams({ api: '1', origin: ll(origin), destination: ll(origin), travelmode: 'driving' })
  if (stops.length) q.set('waypoints', stops.map(ll).join('|'))
  return `https://www.google.com/maps/dir/?${q.toString()}`
}

/** Zet één element op een nieuwe plek in de lijst. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/** Nieuwe plek van een gesleepte rij: het aantal andere rijen waarvan het midden boven het midden van de gesleepte rij ligt. */
export function dropIndex(midpoints: number[], from: number, draggedMid: number) {
  return midpoints.filter((m, i) => i !== from && m < draggedMid).length
}
