import type { ContinentCode, Country, CountryVisit, Visit } from '../types'
import {
  continentOrder,
  countries,
  countryByCode,
  sovereignCount,
  worldArea,
  worldPopulation,
} from './countries'
import { distanceKm } from './geo'

export interface CountryStat {
  country: Country
  cities: Visit[] // empty when only the country was logged
}

export interface ContinentStat {
  code: ContinentCode
  visitedCountries: number
  totalCountries: number
  anyVisited: boolean // any country there, with or without cities
  cities: number
}

export interface TravelStats {
  cityCount: number
  countryCount: number
  countryOnlyCount: number // countries logged without a city
  sovereignVisited: number
  sovereignTotal: number
  continentsVisited: number
  areaShare: number // 0..1 of world land area, by visited countries
  populationShare: number // 0..1 of world population, by visited countries
  cityPopulation: number // people living in the cities visited
  countries: CountryStat[] // most cities first
  continents: ContinentStat[]
  extremes: { north: Visit; south: Visit; east: Visit; west: Visit } | null
  farthestPair: { a: Visit; b: Visit; km: number } | null
  hemispheres: { north: boolean; south: boolean; east: boolean; west: boolean }
  largestCity: Visit | null
  smallestCity: Visit | null
}

const extreme = (visits: Visit[], better: (a: Visit, b: Visit) => boolean) =>
  visits.reduce((best, v) => (better(v, best) ? v : best))

// Exact all-pairs search is fine for personal-scale lists; beyond that, sample.
const MAX_PAIR_SEARCH = 1500

function farthestPair(visits: Visit[]) {
  const list = visits.length > MAX_PAIR_SEARCH ? visits.slice(0, MAX_PAIR_SEARCH) : visits
  let best: TravelStats['farthestPair'] = null
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const km = distanceKm(list[i].lat, list[i].lng, list[j].lat, list[j].lng)
      if (!best || km > best.km) best = { a: list[i], b: list[j], km }
    }
  }
  return best
}

export function computeStats(visits: Visit[], countryVisits: CountryVisit[] = []): TravelStats {
  const byCountry = new Map<string, Visit[]>()
  for (const v of visits) {
    const list = byCountry.get(v.country)
    if (list) list.push(v)
    else byCountry.set(v.country, [v])
  }
  for (const c of countryVisits) if (!byCountry.has(c.code)) byCountry.set(c.code, [])

  const countryStats: CountryStat[] = [...byCountry]
    .flatMap(([code, cities]) => {
      const country = countryByCode.get(code)
      return country ? [{ country, cities }] : []
    })
    .sort((a, b) => b.cities.length - a.cities.length || a.country.name.localeCompare(b.country.name))

  const visited = countryStats.map((c) => c.country)

  const continents: ContinentStat[] = continentOrder.map((code) => {
    const inContinent = countries.filter((c) => c.continent === code)
    // Antarctica has no sovereign states, so count territories there.
    const pool = code === 'AN' ? inContinent : inContinent.filter((c) => c.sovereign)
    return {
      code,
      visitedCountries: visited.filter((c) => c.continent === code && pool.includes(c)).length,
      totalCountries: pool.length,
      anyVisited: visited.some((c) => c.continent === code),
      cities: countryStats
        .filter((c) => c.country.continent === code)
        .reduce((sum, c) => sum + c.cities.length, 0),
    }
  })

  const has = visits.length > 0

  return {
    cityCount: visits.length,
    countryCount: visited.length,
    countryOnlyCount: countryStats.filter((c) => c.cities.length === 0).length,
    sovereignVisited: visited.filter((c) => c.sovereign).length,
    sovereignTotal: sovereignCount,
    continentsVisited: continents.filter((c) => c.anyVisited).length,
    areaShare: visited.reduce((s, c) => s + c.area, 0) / worldArea,
    populationShare: visited.reduce((s, c) => s + c.population, 0) / worldPopulation,
    cityPopulation: visits.reduce((s, v) => s + v.population, 0),
    countries: countryStats,
    continents,
    extremes: has
      ? {
          north: extreme(visits, (a, b) => a.lat > b.lat),
          south: extreme(visits, (a, b) => a.lat < b.lat),
          east: extreme(visits, (a, b) => a.lng > b.lng),
          west: extreme(visits, (a, b) => a.lng < b.lng),
        }
      : null,
    farthestPair: farthestPair(visits),
    hemispheres: {
      north: visits.some((v) => v.lat >= 0),
      south: visits.some((v) => v.lat < 0),
      east: visits.some((v) => v.lng >= 0),
      west: visits.some((v) => v.lng < 0),
    },
    largestCity: has ? extreme(visits, (a, b) => a.population > b.population) : null,
    smallestCity: has ? extreme(visits, (a, b) => a.population < b.population) : null,
  }
}
