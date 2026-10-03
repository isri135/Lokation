import { useCallback, useState } from 'react'
import type { City, CountryVisit, Rating, Visit } from '../types'
import { countryByCode } from './countries'

// Where this browser stored the log before sign-in existed (read once, for migration).
const LEGACY_VISITS_KEY = 'lokation.visits.v1'
const LEGACY_COUNTRIES_KEY = 'lokation.countries.v1'

const asRating = (r: unknown): Rating | undefined =>
  typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5 ? (r as Rating) : undefined

function isVisit(v: unknown): v is Visit {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'number' &&
    typeof o.name === 'string' &&
    typeof o.lat === 'number' &&
    typeof o.lng === 'number' &&
    typeof o.country === 'string'
  )
}

function normalizeVisit(v: Visit): Visit {
  return {
    id: v.id,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    country: v.country,
    region: typeof v.region === 'string' ? v.region : '',
    population: typeof v.population === 'number' ? v.population : 0,
    addedAt: typeof v.addedAt === 'string' ? v.addedAt : new Date().toISOString(),
    rating: asRating(v.rating),
  }
}

function isCountryVisit(v: unknown): v is CountryVisit {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CountryVisit).code === 'string' &&
    countryByCode.has((v as CountryVisit).code)
  )
}

const normalizeCountryVisit = (v: CountryVisit): CountryVisit => ({
  code: v.code,
  addedAt: typeof v.addedAt === 'string' ? v.addedAt : new Date().toISOString(),
  rating: asRating(v.rating),
})

export interface TravelLog {
  visits: Visit[]
  countries: CountryVisit[]
}

/**
 * Parses an exported file. Accepts the current `{ visits, countries }` shape
 * and a bare array of city visits. Throws if it's neither.
 */
export function parseTravelLog(json: string): TravelLog {
  const data: unknown = JSON.parse(json)
  const obj = data as { visits?: unknown; countries?: unknown }
  const list = Array.isArray(data) ? data : obj?.visits
  if (!Array.isArray(list)) throw new Error('File does not contain a list of visits')
  const countries = Array.isArray(obj?.countries) ? obj.countries : []
  return {
    visits: list.filter(isVisit).map(normalizeVisit),
    countries: countries.filter(isCountryVisit).map(normalizeCountryVisit),
  }
}

/** Cleans a log that came from the server or a cache, dropping anything malformed. */
export function sanitizeTravelLog(data: unknown): TravelLog {
  const obj = (data ?? {}) as { visits?: unknown; countries?: unknown }
  return {
    visits: Array.isArray(obj.visits) ? obj.visits.filter(isVisit).map(normalizeVisit) : [],
    countries: Array.isArray(obj.countries) ? obj.countries.filter(isCountryVisit).map(normalizeCountryVisit) : [],
  }
}

/**
 * The log this browser kept before accounts existed, so it can be uploaded on
 * someone's first sign-in. Null if there isn't one.
 */
export function loadLegacyLog(): TravelLog | null {
  try {
    const log = sanitizeTravelLog({
      visits: JSON.parse(localStorage.getItem(LEGACY_VISITS_KEY) ?? '[]'),
      countries: JSON.parse(localStorage.getItem(LEGACY_COUNTRIES_KEY) ?? '[]'),
    })
    return log.visits.length || log.countries.length ? log : null
  } catch {
    return null
  }
}

/** Drops country-only entries for countries that now have a city logged. */
const withoutCovered = (countries: CountryVisit[], visits: Visit[]) => {
  const covered = new Set(visits.map((v) => v.country))
  return countries.filter((c) => !covered.has(c.code))
}

/** The signed-in person's log. Saving is handled by the caller (see useCloudSync). */
export function useVisits(initial: TravelLog) {
  const [visits, setVisits] = useState<Visit[]>(initial.visits)
  const [countryVisits, setCountryVisits] = useState<CountryVisit[]>(initial.countries)

  const add = useCallback((city: City) => {
    setVisits((prev) =>
      prev.some((v) => v.id === city.id)
        ? prev
        : [
            ...prev,
            {
              id: city.id,
              name: city.name,
              lat: city.lat,
              lng: city.lng,
              country: city.country,
              region: city.region,
              population: city.population,
              addedAt: new Date().toISOString(),
            },
          ],
    )
    // A city now stands in for the country, so a country-only entry is redundant.
    setCountryVisits((prev) => prev.filter((c) => c.code !== city.country))
  }, [])

  const remove = useCallback((id: number) => {
    setVisits((prev) => prev.filter((v) => v.id !== id))
  }, [])

  /** Marks a country as visited without a specific city. No-op if it's already visited. */
  const addCountry = useCallback(
    (code: string) => {
      if (visits.some((v) => v.country === code)) return
      setCountryVisits((prev) =>
        prev.some((c) => c.code === code) ? prev : [...prev, { code, addedAt: new Date().toISOString() }],
      )
    },
    [visits],
  )

  const removeCountry = useCallback((code: string) => {
    setCountryVisits((prev) => prev.filter((c) => c.code !== code))
  }, [])

  /** Sets or clears (undefined) a city's rating. */
  const rateCity = useCallback((id: number, rating: Rating | undefined) => {
    setVisits((prev) => prev.map((v) => (v.id === id ? { ...v, rating } : v)))
  }, [])

  /** Sets or clears (undefined) a country-only visit's rating. */
  const rateCountry = useCallback((code: string, rating: Rating | undefined) => {
    setCountryVisits((prev) => prev.map((c) => (c.code === code ? { ...c, rating } : c)))
  }, [])

  /** Merges an imported log, keeping existing entries. */
  const importLog = useCallback(
    (log: TravelLog) => {
      const seen = new Set(visits.map((v) => v.id))
      const mergedVisits = [...visits, ...log.visits.filter((v) => !seen.has(v.id) && seen.add(v.id))]
      const seenCodes = new Set(countryVisits.map((c) => c.code))
      const mergedCountries = [
        ...countryVisits,
        ...log.countries.filter((c) => !seenCodes.has(c.code) && seenCodes.add(c.code)),
      ]
      setVisits(mergedVisits)
      setCountryVisits(withoutCovered(mergedCountries, mergedVisits))
    },
    [visits, countryVisits],
  )

  const clear = useCallback(() => {
    setVisits([])
    setCountryVisits([])
  }, [])

  return {
    visits,
    countryVisits,
    add,
    remove,
    addCountry,
    removeCountry,
    rateCity,
    rateCountry,
    importLog,
    clear,
  }
}

/** Called once the pre-sign-in log has been given to an account, so no one else picks it up. */
export function clearLegacyLog() {
  try {
    localStorage.removeItem(LEGACY_VISITS_KEY)
    localStorage.removeItem(LEGACY_COUNTRIES_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
