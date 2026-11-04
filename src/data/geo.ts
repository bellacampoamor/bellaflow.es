// Externe kaartdiensten. Alles hierachter is vervangbaar door bijvoorbeeld Google Maps Platform.
import { haversineKm, type Matrix, type Point } from '../domain/route'

const GEOCODER = 'https://nominatim.openstreetmap.org/search'
const ROUTER = 'https://router.project-osrm.org/table/v1/driving/'
const ROAD_FACTOR = 1.3 // van hemelsbreed naar over de weg
const ESTIMATE_KMH = 60

export async function geocodeAddress(address: string): Promise<Point | null> {
  try {
    const res = await fetch(`${GEOCODER}?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(address)}`)
    if (!res.ok) return null
    const hits = await res.json()
    return hits[0] ? { latitude: Number(hits[0].lat), longitude: Number(hits[0].lon) } : null
  } catch { return null }
}

export interface TravelMatrix { minutes: Matrix; km: Matrix; source: 'weg' | 'schatting' }

export function estimateMatrix(points: Point[]): TravelMatrix {
  const km = points.map((a) => points.map((b) => haversineKm(a, b) * ROAD_FACTOR))
  return { km, minutes: km.map((row) => row.map((d) => (d / ESTIMATE_KMH) * 60)), source: 'schatting' }
}

export function parseRouterTable(json: { code?: string; durations?: (number | null)[][]; distances?: (number | null)[][] }): TravelMatrix | null {
  if (json.code !== 'Ok' || !json.durations || !json.distances) return null
  if ([...json.durations, ...json.distances].some((r) => r.some((v) => v === null))) return null
  return {
    source: 'weg',
    minutes: json.durations.map((r) => r.map((v) => (v as number) / 60)),
    km: json.distances.map((r) => r.map((v) => (v as number) / 1000)),
  }
}

/** Echte rijtijden als de routeservice bereikbaar is, anders een schatting. */
export async function travelMatrix(points: Point[]): Promise<TravelMatrix> {
  try {
    const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';')
    const res = await fetch(`${ROUTER}${coords}?annotations=duration,distance`)
    if (res.ok) {
      const parsed = parseRouterTable(await res.json())
      if (parsed) return parsed
    }
  } catch { /* schatting hieronder */ }
  return estimateMatrix(points)
}
