import rawCountries from '../data/countries.json'
import type { ContinentCode, Country } from '../types'

export const countries = rawCountries as Country[]

export const countryByCode = new Map(countries.map((c) => [c.code, c]))
export const countryByNumeric = new Map(countries.map((c) => [c.numeric, c]))

/** Map polygons that have no ISO numeric id in world-atlas. */
export const countryCodeByShapeName: Record<string, string> = {
  Kosovo: 'XK',
  Somaliland: 'SO',
  'N. Cyprus': 'CY',
}

export const continentNames: Record<ContinentCode, string> = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
}

export const continentOrder: ContinentCode[] = ['NA', 'SA', 'EU', 'AF', 'AS', 'OC', 'AN']

export const sovereignCount = countries.filter((c) => c.sovereign).length

export const worldArea = countries.reduce((sum, c) => sum + c.area, 0)
export const worldPopulation = countries.reduce((sum, c) => sum + c.population, 0)

export function countryName(code: string): string {
  return countryByCode.get(code)?.name ?? code
}

export interface CountryMatch {
  country: Country
  via?: string // the alternate name that matched, when it wasn't the country's own name
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()

const searchIndex = countries.map((country) => ({
  country,
  name: fold(country.name),
  aliases: country.aliases.map((a) => ({ alias: a, key: fold(a) })),
}))

/**
 * Countries whose name or an alternate name starts with the query.
 * Short aliases (codes like "UK", "USA") only match exactly.
 */
export function searchCountries(query: string, limit = 3): CountryMatch[] {
  const q = fold(query)
  if (q.length < 2) return []
  const exact: CountryMatch[] = []
  const prefix: CountryMatch[] = []
  for (const { country, name, aliases } of searchIndex) {
    if (name === q || country.code.toLowerCase() === q) {
      exact.push({ country })
      continue
    }
    const alias = aliases.find((a) => a.key === q)
    if (alias) {
      exact.push({ country, via: alias.alias })
      continue
    }
    if (q.length < 3) continue
    if (name.startsWith(q) || name.includes(` ${q}`)) {
      prefix.push({ country })
      continue
    }
    const partial = aliases.find((a) => a.key.length > 3 && a.key.startsWith(q))
    if (partial) prefix.push({ country, via: partial.alias })
  }
  prefix.sort((a, b) => b.country.population - a.country.population)
  return [...exact, ...prefix].slice(0, limit)
}

type NumericField = 'population' | 'area' | 'priceLevel' | 'visitorSpend'

/** Median across sovereign countries that have the figure. */
export function worldMedian(field: NumericField): number {
  const values = countries
    .filter((c) => c.sovereign && c[field] !== null)
    .map((c) => c[field] as number)
    .sort((a, b) => a - b)
  const mid = values.length >> 1
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2
}

/** 1-based rank among sovereign countries with the figure (1 = largest), and how many have it. */
export function worldRank(field: NumericField, value: number): { rank: number; of: number } {
  const values = countries.filter((c) => c.sovereign && c[field] !== null).map((c) => c[field] as number)
  return { rank: values.filter((v) => v > value).length + 1, of: values.length }
}
