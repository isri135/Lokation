import type { City } from '../types'
import { countryByCode } from './countries'
import { distanceKm } from './geo'

export type CityTuple = [number, string, string, number, number, string, string, number, CityKind, number]

/** 0 ordinary, 1 regional seat, 2 national capital, 3 district of a larger city */
export type CityKind = 0 | 1 | 2 | 3

export interface IndexedCity extends City {
  kind: CityKind
  prominence: number // count of alternate names in GeoNames; a proxy for fame
  nameKey: string // normalized name
  key: string // normalized name + ascii name, for matching
}

let cache: Promise<IndexedCity[]> | null = null

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

/** Loads the city dataset once (it is ~2 MB, so it lives in /public and is fetched lazily). */
export function loadCities(): Promise<IndexedCity[]> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/cities.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load cities (HTTP ${res.status})`)
      return res.json() as Promise<CityTuple[]>
    })
    .then(indexCities)
    .catch((err) => {
      cache = null
      throw err
    })
  return cache
}

export function indexCities(rows: CityTuple[]): IndexedCity[] {
  return rows.map(([id, name, ascii, lat, lng, country, region, population, kind, prominence]) => ({
    id,
    name,
    lat,
    lng,
    country,
    region,
    population,
    kind,
    prominence,
    nameKey: normalize(name),
    key: normalize(ascii ? `${name} ${ascii}` : name),
  }))
}

/**
 * Finds cities matching a query such as "paris" or "springfield, illinois".
 * Text after a comma narrows by region or country. Results are ranked by
 * match quality, then population (the dataset is pre-sorted by population).
 */
export function searchCities(cities: IndexedCity[], query: string, limit = 8): City[] {
  const [namePart, ...rest] = query.split(',')
  const name = normalize(namePart)
  const place = normalize(rest.join(','))
  if (!name) return []

  const matchesPlace = (c: City) => {
    if (!place) return true
    const country = countryByCode.get(c.country)
    return (
      normalize(c.region).startsWith(place) ||
      (country !== undefined && normalize(country.name).startsWith(place)) ||
      c.country.toLowerCase() === place
    )
  }

  const exact: City[] = []
  const prefix: City[] = []
  const contains: City[] = []
  for (const c of cities) {
    let bucket: City[] | null = null
    if (c.nameKey === name) bucket = exact
    else if (c.key.startsWith(name) || c.key.includes(` ${name}`)) bucket = prefix
    else if (name.length >= 3 && c.key.includes(name)) bucket = contains
    if (bucket && bucket.length < limit && matchesPlace(c)) bucket.push(c)
    if (exact.length >= limit) break
  }
  return [...exact, ...prefix, ...contains].slice(0, limit)
}

/** Nearest city to a point, if one lies within `maxKm`. */
export function nearestCity(cities: City[], lat: number, lng: number, maxKm = 75): City | null {
  let best: City | null = null
  let bestDist = maxKm
  for (const c of cities) {
    // Cheap bounding-box reject before the trig.
    if (Math.abs(c.lat - lat) > 1.5) continue
    const d = distanceKm(lat, lng, c.lat, c.lng)
    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}
