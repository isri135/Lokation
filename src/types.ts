/** A city from the bundled GeoNames dataset. */
export interface City {
  id: number
  name: string
  lat: number
  lng: number
  country: string // ISO 3166-1 alpha-2
  region: string
  population: number
}

/** A city the user has been to. Holds a copy of the city data so stats never depend on the dataset loading. */
export interface Visit extends City {
  addedAt: string // ISO timestamp
  rating?: Rating
}

/** 1 (didn't enjoy) to 5 (loved it). Unrated visits count as mildly positive. */
export type Rating = 1 | 2 | 3 | 4 | 5

export interface Country {
  code: string
  iso3: string
  numeric: string
  name: string
  capital: string
  area: number
  population: number
  continent: ContinentCode
  sovereign: boolean
  flag: string
  lat: number
  lng: number
  aliases: string[] // other names people search for, e.g. 'England' or 'UK' for GB
  subregion: string
  languages: string[]
  currencies: string[]
  landlocked: boolean
  borders: string[] // ISO alpha-2 codes of neighbouring countries
  // Cost (World Bank, country-level; null where unavailable or implausible)
  priceLevel: number | null // everyday prices relative to the US (= 1)
  priceYear: number | null
  visitorSpend: number | null // US$ spent per international visitor per trip
  spendYear: number | null
}

/** A country the user has been to without logging a specific city. */
export interface CountryVisit {
  code: string
  addedAt: string // ISO timestamp
  rating?: Rating
}

export type ContinentCode = 'AF' | 'AN' | 'AS' | 'EU' | 'NA' | 'OC' | 'SA'
