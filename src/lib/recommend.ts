/**
 * Content-based "where next?" model.
 *
 * Every candidate city is compared with every place the user has logged, feature by
 * feature. A logged city is described by its own data (size, fame, capital status,
 * exact location) plus its country's; a country logged without a city is described
 * by country-level data only, and its city-specific features are simply skipped.
 *
 * Two modes:
 * - `similar`: ratings turn each logged place into a weighted example (loved places
 *   pull, disliked ones push away); affinity to those is blended with a little novelty
 *   and a prior for well-known places.
 * - `different`: rewards being unlike every logged place, firsts (new continent,
 *   region, country) and fame, so "different" still means a real destination.
 * A diversity pass then spreads picks across countries (and continents, when different).
 */
import type { Country, CountryVisit, Rating, Visit } from '../types'
import type { CityKind, IndexedCity } from './cities'
import { continentNames, countryByCode } from './countries'
import { formatCompact, formatNumber } from './format'

// ───────────── Tunable parameters ─────────────

/** How much each feature group counts toward the similarity of two places. */
const FEATURE_WEIGHTS = {
  size: 1,
  prominence: 1,
  kind: 0.5,
  continent: 0.5,
  subregion: 1,
  language: 1.25,
  currency: 0.5,
  landlocked: 0.25,
  location: 1.5,
  neighbours: 0.75,
  // Country-level cost data (World Bank). Visitor spend counts for less: it also
  // varies with trip length and how each country counts arrivals.
  prices: 1,
  spend: 0.4,
} as const

type FeatureGroup = keyof typeof FEATURE_WEIGHTS
type Weights = Record<FeatureGroup, number>

/** Example weight per rating. Negative = steer away from places like this. */
// 1★ steers away from look-alikes, 2★ ("it was okay") is neutral, 3–5★ steer toward.
const RATING_WEIGHT: Record<Rating, number> = { 1: -1, 2: 0, 3: 0.4, 4: 0.8, 5: 1 }

// Places in the same region share a lot of country-level features, so only
// similarity above this floor counts against a candidate when a place was disliked.
const DISLIKE_SIMILARITY_FLOOR = 0.4
const UNRATED_WEIGHT = 0.6

/** `similar` mode: a slight lean toward countries you haven't been to yet. */
const SIMILAR_EXPLORE = 0.1

/** `different` mode: reward unlikeness and firsts, but keep to real destinations. */
const DIFFERENT = {
  contrast: 0.5, // 1 − similarity to the closest logged place
  novelty: 0.3, // new country / subregion / continent
  destination: 0.6, // fame and size, so 'different' never means obscure
  continentRepeatPenalty: 0.06, // spread picks across continents
}

/**
 * Size, fame and capital status are left out when measuring how different a place
 * is: otherwise being tiny and unknown would count as "different".
 */
const contrastWeights = (w: Weights): Weights => ({ ...w, size: 0, prominence: 0, kind: 0 })

/** How much of a destination a city is, from fame, size and capital status. */
const destinationScore = (f: PlaceFeatures) => 0.6 * f.prominence! + 0.3 * f.size! + 0.1 * (f.rank! / 2)

export interface ModelParams {
  weights: Weights
  topK: number // affinity = mean of the K strongest weighted matches
  dislikePenalty: number
  prominencePrior: number // nudge toward well-known places
  countryRepeatPenalty: number // diversity: per earlier pick in the same country
  nearbyPenalty: number // diversity: per earlier pick within 150 km
}

export const DEFAULT_PARAMS: ModelParams = {
  weights: FEATURE_WEIGHTS,
  topK: 4,
  dislikePenalty: 0.7,
  prominencePrior: 0.35, // tuned by leave-one-out across sample travellers (see tests)
  countryRepeatPenalty: 0.08,
  nearbyPenalty: 0.15,
}
const CITY_LOCATION_SCALE_KM = 800
const MIN_DISTANCE_FROM_VISITED_KM = 25 // skip suburbs of places already logged

const EARTH_RADIUS_KM = 6371

// ───────────── Feature extraction ─────────────

interface PlaceFeatures {
  country: Country
  // City-specific; undefined for a country logged without a city.
  size?: number // 0..1, log-scaled population
  prominence?: number // 0..1, log-scaled alternate-name count
  rank?: number // 0 ordinary, 1 regional seat, 2 capital
  // Unit vector on the globe, so distance is a dot product.
  x: number
  y: number
  z: number
  locationScaleKm: number
}

interface Example extends PlaceFeatures {
  label: string
  population?: number // cities only
  weight: number
  rating?: Rating
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const sizeOf = (population: number) => clamp01((Math.log10(Math.max(population, 1)) - 4) / 3.5)
const prominenceOf = (altNames: number) => clamp01(Math.log1p(altNames) / Math.log1p(150))
const rankOf = (kind: CityKind) => (kind === 2 ? 2 : kind === 1 ? 1 : 0)

function unitVector(lat: number, lng: number) {
  const φ = (lat * Math.PI) / 180
  const λ = (lng * Math.PI) / 180
  return { x: Math.cos(φ) * Math.cos(λ), y: Math.cos(φ) * Math.sin(λ), z: Math.sin(φ) }
}

const kmBetween = (a: PlaceFeatures, b: PlaceFeatures) =>
  EARTH_RADIUS_KM * Math.acos(Math.min(1, Math.max(-1, a.x * b.x + a.y * b.y + a.z * b.z)))

function cityFeatures(city: IndexedCity, country: Country): PlaceFeatures {
  return {
    country,
    size: sizeOf(city.population),
    prominence: prominenceOf(city.prominence),
    rank: rankOf(city.kind),
    ...unitVector(city.lat, city.lng),
    locationScaleKm: CITY_LOCATION_SCALE_KM,
  }
}

function countryFeatures(country: Country): PlaceFeatures {
  return {
    country,
    ...unitVector(country.lat, country.lng),
    // A country's centre stands in for anywhere in it, so be more forgiving in big ones.
    locationScaleKm: CITY_LOCATION_SCALE_KM + Math.sqrt(country.area),
  }
}

const ratingWeight = (r: Rating | undefined) => (r ? RATING_WEIGHT[r] : UNRATED_WEIGHT)

/** Turns the user's log into weighted examples, using live city data where possible. */
function buildExamples(
  cityById: Map<number, IndexedCity>,
  visits: Visit[],
  countryVisits: CountryVisit[],
): Example[] {
  const examples: Example[] = []
  for (const v of visits) {
    const country = countryByCode.get(v.country)
    if (!country) continue
    // Prefer the dataset's record (it has kind and prominence); fall back to the stored copy.
    const city = cityById.get(v.id) ?? { ...v, kind: 0 as CityKind, prominence: 0, nameKey: '', key: '' }
    const f = cityFeatures(city, country)
    if (!cityById.has(v.id)) f.prominence = undefined
    examples.push({
      ...f,
      label: v.name,
      population: v.population,
      weight: ratingWeight(v.rating),
      rating: v.rating,
    })
  }
  for (const c of countryVisits) {
    const country = countryByCode.get(c.code)
    if (!country) continue
    examples.push({
      ...countryFeatures(country),
      label: country.name,
      weight: ratingWeight(c.rating),
      rating: c.rating,
    })
  }
  return examples
}

// ───────────── Similarity ─────────────

type GroupScores = Partial<Record<FeatureGroup, number>>

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setB = new Set(b)
  const shared = a.filter((x) => setB.has(x)).length
  return shared / (a.length + b.length - shared)
}

type CountryGroup = 'continent' | 'subregion' | 'language' | 'currency' | 'landlocked' | 'neighbours' | 'prices' | 'spend'

/** Similarity of two cost figures on a log scale: equal = 1, `ratio`× apart or more = 0. */
const ratioCloseness = (a: number, b: number, ratio: number) => clamp01(1 - Math.abs(Math.log(a / b)) / Math.log(ratio))

/**
 * Groups that depend only on the two countries, so they can be cached per country pair.
 * Cost figures are missing for some countries; those groups are then left out.
 */
function countryScores(cc: Country, ec: Country): Partial<Record<CountryGroup, number>> {
  const s: Partial<Record<CountryGroup, number>> = {
    continent: cc.continent === ec.continent ? 1 : 0,
    subregion: cc.subregion === ec.subregion ? 1 : 0,
    language: jaccard(cc.languages, ec.languages),
    currency: cc.currencies.some((x) => ec.currencies.includes(x)) ? 1 : 0,
    landlocked: cc.landlocked === ec.landlocked ? 1 : 0,
    neighbours: cc.code === ec.code ? 1 : cc.borders.includes(ec.code) ? 0.6 : 0,
  }
  if (cc.priceLevel !== null && ec.priceLevel !== null) s.prices = ratioCloseness(cc.priceLevel, ec.priceLevel, 2.5)
  if (cc.visitorSpend !== null && ec.visitorSpend !== null)
    s.spend = ratioCloseness(cc.visitorSpend, ec.visitorSpend, 4)
  return s
}

const locationScore = (c: PlaceFeatures, e: PlaceFeatures) => Math.exp(-kmBetween(c, e) / e.locationScaleKm)
const closeness = (a: number, b: number) => clamp01(1 - Math.abs(a - b) / 0.5)
const kindScore = (a: number, b: number) => 1 - Math.abs(a - b) / 2

/** Per-group similarity in 0..1. Groups a place has no data for are left out. */
function groupScores(c: PlaceFeatures, e: PlaceFeatures): GroupScores {
  const s: GroupScores = { ...countryScores(c.country, e.country), location: locationScore(c, e) }
  if (e.size !== undefined && c.size !== undefined) s.size = closeness(c.size, e.size)
  if (e.prominence !== undefined && c.prominence !== undefined) s.prominence = closeness(c.prominence, e.prominence)
  if (e.rank !== undefined && c.rank !== undefined) s.kind = kindScore(c.rank, e.rank)
  return s
}

function similarity(scores: GroupScores, weights: Weights): number {
  let total = 0
  let weight = 0
  for (const g in scores) {
    const w = weights[g as FeatureGroup]
    total += w * scores[g as FeatureGroup]!
    weight += w
  }
  return weight ? total / weight : 0
}

/**
 * Same result as `similarity(groupScores(c, e))`, but for the ranking hot loop:
 * country-level groups are summed once per (example, country) and cached, and
 * nothing is allocated per pair.
 */
function makeScorer(e: Example, weights: Weights) {
  // Per candidate country: weighted sum of the country groups, and the weight they carry.
  const countryParts = new Map<string, { sum: number; weight: number }>()
  let placeWeight = weights.location
  if (e.size !== undefined) placeWeight += weights.size
  if (e.prominence !== undefined) placeWeight += weights.prominence
  if (e.rank !== undefined) placeWeight += weights.kind

  return (c: PlaceFeatures): number => {
    let part = countryParts.get(c.country.code)
    if (part === undefined) {
      const s = countryScores(c.country, e.country)
      part = { sum: 0, weight: 0 }
      for (const g in s) {
        part.sum += weights[g as CountryGroup] * s[g as CountryGroup]!
        part.weight += weights[g as CountryGroup]
      }
      countryParts.set(c.country.code, part)
    }
    let sum = part.sum + weights.location * locationScore(c, e)
    if (e.size !== undefined) sum += weights.size * closeness(c.size!, e.size)
    if (e.prominence !== undefined) sum += weights.prominence * closeness(c.prominence!, e.prominence)
    if (e.rank !== undefined) sum += weights.kind * kindScore(c.rank!, e.rank)
    const total = part.weight + placeWeight
    return total ? sum / total : 0
  }
}

// ───────────── Ranking ─────────────

/**
 * `similar`: places that resemble the ones you rated well.
 * `different`: well-known places that resemble nothing you've logged.
 */
export type RecommendMode = 'similar' | 'different'

export interface Reason {
  kind: 'match' | 'new' | 'contrast' // shared with a past trip / a first for you / unlike your trips
  title: string // short, shown in bold
  detail?: string // the specifics behind it
}

export interface Recommendation {
  mode: RecommendMode
  city: IndexedCity
  country: Country
  score: number
  affinity: number // 0..1, how much it resembles places you liked
  novelty: number // 0..1, how new it is to you
  /** The logged place it most resembles, and how closely (0..1). */
  closest?: { label: string; rating?: Rating; similarity: number }
  reasons: Reason[]
  /** Additive pieces of `score`, largest first; they sum to it exactly. */
  breakdown: ScorePart[]
}

export interface RecommendOptions {
  mode?: RecommendMode
  /** `similar` mode only: 0 = purely like past trips, higher favours new countries. */
  explore?: number
  limit?: number
  /** Cities to leave out, e.g. ones the user hid or one held out for evaluation. */
  exclude?: Set<number>
  /** Countries to leave out entirely. */
  excludeCountries?: Set<string>
  /** Override model parameters, for tuning and evaluation. */
  params?: Partial<ModelParams>
}

interface Candidate {
  city: IndexedCity
  f: PlaceFeatures
}

const candidateCache = new WeakMap<IndexedCity[], Candidate[]>()

function candidatesFor(cities: IndexedCity[]): Candidate[] {
  let list = candidateCache.get(cities)
  if (!list) {
    list = []
    for (const city of cities) {
      if (city.kind === 3) continue // districts of a larger city aren't destinations
      const country = countryByCode.get(city.country)
      if (country) list.push({ city, f: cityFeatures(city, country) })
    }
    candidateCache.set(cities, list)
  }
  return list
}

/** What the user's log covers, for novelty scores and "first time" explanations. */
interface Coverage {
  ids: Set<number>
  countries: Set<string>
  subregions: Set<string>
  continents: Set<string>
  languages: Set<string>
  north: boolean
  south: boolean
  landlocked: boolean
  cheapest?: Country // by price level, among countries with data
  priciest?: Country
  smallest?: Example // city examples by population
  largest?: Example
}

function coverageOf(visits: Visit[], examples: Example[]): Coverage {
  const cities = examples.filter((e) => e.population !== undefined)
  const byPop = [...cities].sort((a, b) => a.population! - b.population!)
  const byPrice = [...new Set(examples.map((e) => e.country))]
    .filter((c) => c.priceLevel !== null)
    .sort((a, b) => a.priceLevel! - b.priceLevel!)
  return {
    ids: new Set(visits.map((v) => v.id)),
    countries: new Set(examples.map((e) => e.country.code)),
    subregions: new Set(examples.map((e) => e.country.subregion)),
    continents: new Set(examples.map((e) => e.country.continent)),
    languages: new Set(examples.flatMap((e) => e.country.languages)),
    north: examples.some((e) => e.z >= 0),
    south: examples.some((e) => e.z < 0),
    landlocked: examples.some((e) => e.country.landlocked),
    smallest: byPop[0],
    largest: byPop[byPop.length - 1],
    cheapest: byPrice[0],
    priciest: byPrice[byPrice.length - 1],
  }
}

const noveltyOf = (country: Country, seen: Coverage) =>
  (seen.countries.has(country.code) ? 0 : 0.5) +
  (seen.subregions.has(country.subregion) ? 0 : 0.2) +
  (seen.continents.has(country.continent) ? 0 : 0.3)

export function recommend(
  cities: IndexedCity[],
  visits: Visit[],
  countryVisits: CountryVisit[],
  { mode = 'similar', explore = SIMILAR_EXPLORE, limit = 6, exclude, excludeCountries, params: overrides }: RecommendOptions = {},
): Recommendation[] {
  const p: ModelParams = { ...DEFAULT_PARAMS, ...overrides }
  const { weights, topK } = p
  const cityById = new Map(cities.map((c) => [c.id, c]))
  const examples = buildExamples(cityById, visits, countryVisits)
  const liked = examples.filter((e) => e.weight > 0)
  const seen = coverageOf(visits, examples)
  const visitedPoints = examples.filter((e) => e.size !== undefined)
  const minDot = Math.cos(MIN_DISTANCE_FROM_VISITED_KM / EARTH_RADIUS_KM)

  const likedScorers = liked.map((e) => ({ sim: makeScorer(e, weights), weight: e.weight }))
  const dislikedScorers = examples
    .filter((e) => e.weight < 0)
    .map((e) => ({ sim: makeScorer(e, weights), weight: -e.weight }))
  // "Different" is measured against every logged place, whatever its rating.
  const allScorers = mode === 'different' ? examples.map((e) => makeScorer(e, contrastWeights(weights))) : []

  const scored: { c: Candidate; score: number; affinity: number; novelty: number }[] = []
  const top = new Array<number>(topK)

  for (const c of candidatesFor(cities)) {
    if (seen.ids.has(c.city.id) || exclude?.has(c.city.id) || excludeCountries?.has(c.city.country)) continue
    if (visitedPoints.some((e) => c.f.x * e.x + c.f.y * e.y + c.f.z * e.z > minDot)) continue

    // Affinity: mean of the K strongest (similarity × rating weight) matches.
    top.fill(0)
    for (const e of likedScorers) {
      const v = e.sim(c.f) * e.weight
      if (v > top[topK - 1]) {
        let i = topK - 1
        while (i > 0 && top[i - 1] < v) {
          top[i] = top[i - 1]
          i--
        }
        top[i] = v
      }
    }
    const k = Math.min(topK, liked.length)
    const affinity = k ? top.slice(0, k).reduce((a, b) => a + b, 0) / k : 0
    const novelty = noveltyOf(c.f.country, seen)

    let score: number
    if (examples.length === 0) {
      // With no history there's nothing to be similar or new relative to, so rank by
      // how much of a destination the city is. Alternate-name counts alone are noisy
      // (they also reflect wartime coverage), so blend in size and capital status.
      score = destinationScore(c.f)
    } else if (mode === 'different') {
      let maxSim = 0
      for (const sim of allScorers) maxSim = Math.max(maxSim, sim(c.f))
      score =
        DIFFERENT.contrast * (1 - maxSim) +
        DIFFERENT.novelty * novelty +
        DIFFERENT.destination * destinationScore(c.f)
    } else {
      let dislike = 0
      for (const e of dislikedScorers) {
        const lookalike = clamp01((e.sim(c.f) - DISLIKE_SIMILARITY_FLOOR) / (1 - DISLIKE_SIMILARITY_FLOOR))
        dislike = Math.max(dislike, lookalike * e.weight)
      }
      score =
        (1 - explore) * affinity + explore * novelty + p.prominencePrior * c.f.prominence! - p.dislikePenalty * dislike
    }
    scored.push({ c, score, affinity, novelty })
  }

  scored.sort((a, b) => b.score - a.score)
  const picked = diversify(scored.slice(0, 400), limit, p, mode === 'different' ? DIFFERENT.continentRepeatPenalty : 0)

  return picked.map(({ c, score, affinity, novelty }) => ({
    mode,
    city: c.city,
    country: c.f.country,
    score,
    affinity,
    novelty,
    ...(examples.length === 0
      ? { reasons: [{ kind: 'new' as const, title: 'One of the world’s best-known cities' }] }
      : mode === 'different'
        ? explainDifferent(c, examples, seen, weights)
        : explainSimilar(c, liked, seen, weights)),
    breakdown:
      examples.length === 0
        ? [{ key: 'destination', label: 'Real destination', value: score, detail: 'No history yet: ranked by fame, size and capital status' }]
        : mode === 'different'
          ? differentBreakdown(c, examples, seen, weights, novelty)
          : similarBreakdown(c, liked, examples.filter((e) => e.weight < 0), seen, p, explore, novelty),
  }))
}

/**
 * Greedy diversity re-rank: each pick pays a penalty for sharing a country (or, if
 * asked, a continent) with earlier picks, or sitting near one, so the list isn't
 * five towns in one region.
 */
function diversify<T extends { c: Candidate; score: number }>(
  pool: T[],
  limit: number,
  p: ModelParams,
  continentPenalty: number,
): T[] {
  const picked: T[] = []
  const remaining = [...pool]
  while (picked.length < limit && remaining.length) {
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i]
      let adjusted = r.score
      for (const prev of picked) {
        if (prev.c.f.country.code === r.c.f.country.code) adjusted -= p.countryRepeatPenalty
        if (prev.c.f.country.continent === r.c.f.country.continent) adjusted -= continentPenalty
        if (kmBetween(prev.c.f, r.c.f) < 150) adjusted -= p.nearbyPenalty
      }
      if (adjusted > bestScore) {
        bestScore = adjusted
        best = i
      }
    }
    picked.push(remaining.splice(best, 1)[0])
  }
  return picked
}

// ───────────── Explanations ─────────────

/** Which shared features make the most telling explanation; vaguer ones go last. */
const REASON_PRIORITY: Record<FeatureGroup, number> = {
  location: 1.5,
  language: 1.25,
  size: 1,
  subregion: 0.9,
  neighbours: 0.8,
  kind: 0.6,
  currency: 0.5,
  landlocked: 0.3,
  continent: 0.3,
  prominence: 0.3,
  prices: 0.9,
  spend: 0.4,
}

export const pricePct = (level: number) => `${Math.round(level * 100)}%`
export const usd = (n: number) => `US$${formatCompact(n)}`

const roundKm = (km: number) => formatNumber(km < 1000 ? Math.round(km / 10) * 10 : Math.round(km / 100) * 100)

function firstTimeReason(country: Country, seen: Coverage): Reason | null {
  if (!seen.continents.has(country.continent))
    return { kind: 'new', title: `First trip to ${continentNames[country.continent]}` }
  if (!seen.countries.has(country.code))
    return { kind: 'new', title: 'New country', detail: `Your first time in ${country.name}` }
  return null
}

function explainSimilar(
  c: Candidate,
  liked: Example[],
  seen: Coverage,
  weights: Weights,
): Pick<Recommendation, 'closest' | 'reasons'> {
  const reasons: Reason[] = []
  const first = firstTimeReason(c.f.country, seen)
  if (first) reasons.push(first)

  let best: Example | undefined
  let bestScores: GroupScores = {}
  let bestValue = 0
  for (const e of liked) {
    const scores = groupScores(c.f, e)
    const v = similarity(scores, weights) * e.weight
    if (v > bestValue) {
      best = e
      bestScores = scores
      bestValue = v
    }
  }
  if (!best) return { reasons }

  const shared = (Object.keys(bestScores) as FeatureGroup[])
    // Any shared language is worth saying, even if the countries have others too.
    .filter((g) => bestScores[g]! >= (g === 'language' ? 0.3 : 0.75))
    .sort((a, b) => REASON_PRIORITY[b] * bestScores[b]! - REASON_PRIORITY[a] * bestScores[a]!)

  for (const g of shared) {
    const reason = describeMatch(g, c, best)
    if (reason && !reasons.some((r) => r.title === reason.title)) reasons.push(reason)
    if (reasons.length >= 4) break
  }
  return {
    closest: { label: best.label, rating: best.rating, similarity: similarity(bestScores, weights) },
    reasons,
  }
}

function describeMatch(g: FeatureGroup, c: Candidate, e: Example): Reason | null {
  const cc = c.f.country
  const ec = e.country
  const like = { kind: 'match' as const }
  switch (g) {
    case 'location': {
      const km = kmBetween(c.f, e)
      return km < 600 ? { ...like, title: `Near ${e.label}`, detail: `${roundKm(km)} km away` } : null
    }
    case 'language': {
      const lang = cc.languages.find((l) => ec.languages.includes(l))
      return lang ? { ...like, title: `${lang}-speaking`, detail: `like ${cc.code === ec.code ? e.label : ec.name}` } : null
    }
    case 'subregion':
      return { ...like, title: cc.subregion, detail: `same region as ${e.label}` }
    case 'continent':
      return cc.subregion === ec.subregion
        ? null
        : { ...like, title: continentNames[cc.continent], detail: `same continent as ${e.label}` }
    case 'size':
      return {
        ...like,
        title: 'Similar size',
        detail: `pop. ${formatCompact(c.city.population)} vs ${e.label} ${formatCompact(e.population!)}`,
      }
    case 'prominence':
      return { ...like, title: 'Just as well-known', detail: `as ${e.label}` }
    case 'kind':
      if (c.f.rank === 2) return { ...like, title: 'A capital city', detail: `like ${e.label}` }
      if (c.f.rank === 1) return { ...like, title: 'A regional capital', detail: `like ${e.label}` }
      return null
    case 'currency': {
      const cur = cc.currencies.find((x) => ec.currencies.includes(x))
      return cur && cc.code !== ec.code ? { ...like, title: `Uses the ${cur}`, detail: `like ${ec.name}` } : null
    }
    case 'neighbours':
      return cc.code === ec.code ? null : { ...like, title: 'Next door', detail: `${cc.name} borders ${ec.name}` }
    case 'landlocked':
      return cc.landlocked ? { ...like, title: 'Landlocked', detail: `like ${ec.name}` } : null
    // Cost is country-level, so it says nothing new about a city in the same country.
    case 'prices':
      return cc.code === ec.code
        ? null
        : {
            ...like,
            title: 'Similar prices',
            detail: `${pricePct(cc.priceLevel!)} of US prices vs ${ec.name} ${pricePct(ec.priceLevel!)}`,
          }
    case 'spend':
      return cc.code === ec.code
        ? null
        : {
            ...like,
            title: 'Similar visitor spend',
            detail: `${usd(cc.visitorSpend!)}/trip vs ${ec.name} ${usd(ec.visitorSpend!)}`,
          }
  }
}

function explainDifferent(
  c: Candidate,
  examples: Example[],
  seen: Coverage,
  weights: Weights,
): Pick<Recommendation, 'closest' | 'reasons'> {
  const country = c.f.country
  const reasons: Reason[] = []
  const unlike = { kind: 'contrast' as const }

  if (!seen.continents.has(country.continent)) {
    reasons.push({ kind: 'new', title: `First trip to ${continentNames[country.continent]}` })
  }

  const langs = country.languages
  if (langs.length > 0 && langs.every((l) => !seen.languages.has(l))) {
    reasons.push(
      langs.length === 1
        ? { ...unlike, title: `${langs[0]}-speaking`, detail: 'a language new to your travels' }
        : {
            ...unlike,
            title: 'New languages',
            detail: langs.slice(0, 2).join(', ') + (langs.length > 2 ? ` +${langs.length - 2} more` : ''),
          },
    )
  }

  const south = c.f.z < 0
  if (south && !seen.south) {
    reasons.push({ ...unlike, title: 'Southern Hemisphere', detail: 'every trip so far was north of the equator' })
  } else if (!south && !seen.north) {
    reasons.push({ ...unlike, title: 'Northern Hemisphere', detail: 'every trip so far was south of the equator' })
  }

  let nearest: Example | undefined
  let nearestKm = Infinity
  let closest: Example | undefined
  let closestSim = -1
  for (const e of examples) {
    const km = kmBetween(c.f, e)
    if (km < nearestKm) {
      nearestKm = km
      nearest = e
    }
    const sim = similarity(groupScores(c.f, e), contrastWeights(weights))
    if (sim > closestSim) {
      closestSim = sim
      closest = e
    }
  }
  if (nearest && nearestKm >= 2500) {
    reasons.push({ ...unlike, title: `${roundKm(nearestKm)} km away`, detail: `from the nearest place you’ve been, ${nearest.label}` })
  }

  const pop = c.city.population
  if (seen.largest && pop > seen.largest.population! * 1.5) {
    reasons.push({
      ...unlike,
      title: 'Bigger than anywhere you’ve been',
      detail: `pop. ${formatCompact(pop)} vs ${seen.largest.label} ${formatCompact(seen.largest.population!)}`,
    })
  } else if (seen.smallest && pop < seen.smallest.population! / 1.5) {
    reasons.push({
      ...unlike,
      title: 'Smaller than anywhere you’ve been',
      detail: `pop. ${formatCompact(pop)} vs ${seen.smallest.label} ${formatCompact(seen.smallest.population!)}`,
    })
  }

  const price = country.priceLevel
  if (price !== null && seen.priciest && price > seen.priciest.priceLevel! * 1.4) {
    reasons.push({
      ...unlike,
      title: 'Pricier than anywhere you’ve been',
      detail: `${pricePct(price)} of US prices vs your priciest, ${seen.priciest.name} ${pricePct(seen.priciest.priceLevel!)}`,
    })
  } else if (price !== null && seen.cheapest && price < seen.cheapest.priceLevel! / 1.4) {
    reasons.push({
      ...unlike,
      title: 'Cheaper than anywhere you’ve been',
      detail: `${pricePct(price)} of US prices vs your cheapest, ${seen.cheapest.name} ${pricePct(seen.cheapest.priceLevel!)}`,
    })
  }

  if (country.landlocked && !seen.landlocked) {
    reasons.push({ ...unlike, title: 'Landlocked', detail: 'no coastline, unlike everywhere you’ve been' })
  }

  if (reasons.length < 2 && !seen.subregions.has(country.subregion)) {
    reasons.push({ kind: 'new', title: `New region: ${country.subregion}` })
  }
  if (reasons.length < 2 && !seen.countries.has(country.code)) {
    reasons.push({ kind: 'new', title: 'New country', detail: `Your first time in ${country.name}` })
  }

  return {
    closest: closest && { label: closest.label, rating: closest.rating, similarity: closestSim },
    reasons: reasons.slice(0, 4),
  }
}

// ───────────── Score breakdown ─────────────

/** One additive piece of a recommendation's score. The pieces sum to the score exactly. */
export interface ScorePart {
  key: string
  label: string
  value: number // signed contribution to the score
  detail: string
}

/** Breakdown labels per mode: what a feature adds when shared vs when it differs. */
const SIMILAR_LABELS: Record<FeatureGroup, string> = {
  location: 'Nearby',
  language: 'Shared language',
  size: 'Similar size',
  prominence: 'Similar fame',
  kind: 'Same kind of city',
  subregion: 'Same region',
  continent: 'Same continent',
  currency: 'Same currency',
  landlocked: 'Same coastline',
  neighbours: 'Same or next-door country',
  prices: 'Similar prices',
  spend: 'Similar visitor spend',
}

const DIFFERENT_LABELS: Record<FeatureGroup, string> = {
  location: 'Far away',
  language: 'Different language',
  size: 'Different size',
  prominence: 'Different fame',
  kind: 'Different kind of city',
  subregion: 'Different region',
  continent: 'Different continent',
  currency: 'Different currency',
  landlocked: 'Different coastline',
  neighbours: 'Not a neighbour',
  prices: 'Different prices',
  spend: 'Different visitor spend',
}

const MAX_PARTS = 9 // 8 named parts, the rest fold into "Other features"

/** Sorts by size and folds the smallest parts together, keeping the total unchanged. */
function tidyParts(parts: ScorePart[]): ScorePart[] {
  const nonzero = parts.filter((p) => p.value !== 0).sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
  // A penalty always stays visible, however small.
  const keep = nonzero.filter((p, i) => i < MAX_PARTS - 1 || p.value < 0)
  const rest = nonzero.filter((p) => !keep.includes(p))
  if (rest.length === 1) keep.push(rest[0])
  else if (rest.length > 1) {
    keep.push({
      key: 'other',
      label: `Other features (${rest.length})`,
      value: rest.reduce((s, p) => s + p.value, 0),
      detail: rest.map((p) => p.label).join(', '),
    })
  }
  // Largest first, with the catch-all always last.
  return keep.sort((a, b) => (a.key === 'other' ? 1 : b.key === 'other' ? -1 : b.value - a.value))
}

const listNames = (names: string[]) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`

function noveltyDetail(country: Country, seen: Coverage): string {
  const firsts = [
    !seen.countries.has(country.code) && 'new country',
    !seen.subregions.has(country.subregion) && 'new region',
    !seen.continents.has(country.continent) && 'new continent',
  ].filter(Boolean) as string[]
  return firsts.length ? firsts.join(', ').replace(/^./, (ch) => ch.toUpperCase()) : 'Nothing new: you’ve been to this country'
}

/**
 * Mirrors the `similar` score: affinity spread over the feature groups of the top-K
 * matches it averaged, plus the novelty, fame and dislike terms.
 */
function similarBreakdown(
  c: Candidate,
  liked: Example[],
  disliked: Example[],
  seen: Coverage,
  p: ModelParams,
  explore: number,
  novelty: number,
): ScorePart[] {
  const { weights, topK } = p
  const matches = liked
    .map((e) => {
      const scores = groupScores(c.f, e)
      return { e, scores, value: similarity(scores, weights) * e.weight }
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.min(topK, liked.length))
  const k = matches.length

  const byGroup = new Map<FeatureGroup, { value: number; from: { label: string; value: number }[] }>()
  for (const m of matches) {
    let total = 0
    for (const g in m.scores) total += weights[g as FeatureGroup]
    for (const g in m.scores) {
      const group = g as FeatureGroup
      const v = ((1 - explore) / k) * m.e.weight * ((weights[group] * m.scores[group]!) / total)
      const entry = byGroup.get(group) ?? { value: 0, from: [] }
      entry.value += v
      if (v > 0) entry.from.push({ label: m.e.label, value: v })
      byGroup.set(group, entry)
    }
  }

  const parts: ScorePart[] = [...byGroup].map(([g, { value, from }]) => ({
    key: g,
    label: SIMILAR_LABELS[g],
    value,
    detail: from.length
      ? `Shared with ${listNames(from.sort((a, b) => b.value - a.value).map((f) => f.label))}`
      : 'Nothing in common here',
  }))

  parts.push({ key: 'novelty', label: 'Something new', value: explore * novelty, detail: noveltyDetail(c.f.country, seen) })
  parts.push({
    key: 'fame',
    label: 'Well-known place (boost)',
    value: p.prominencePrior * c.f.prominence!,
    detail: `Fame ${Math.round(c.f.prominence! * 100)}/100, from how many names GeoNames lists`,
  })

  let worst: Example | undefined
  let dislike = 0
  for (const e of disliked) {
    const lookalike = clamp01((similarity(groupScores(c.f, e), weights) - DISLIKE_SIMILARITY_FLOOR) / (1 - DISLIKE_SIMILARITY_FLOOR))
    const v = lookalike * -e.weight
    if (v > dislike) {
      dislike = v
      worst = e
    }
  }
  if (worst) {
    parts.push({
      key: 'dislike',
      label: 'Like a place you disliked',
      value: -p.dislikePenalty * dislike,
      detail: `Resembles ${worst.label} (${worst.rating}★)`,
    })
  }
  return tidyParts(parts)
}

/** How a candidate and the closest logged place differ on one feature, in plain words. */
function differenceDetail(g: FeatureGroup, c: Candidate, e: Example): string {
  const cc = c.f.country
  const ec = e.country
  switch (g) {
    case 'location':
      return `${roundKm(kmBetween(c.f, e))} km from ${e.label}`
    case 'language':
      return `${cc.languages.slice(0, 2).join(', ') || 'unknown'} vs ${ec.languages.slice(0, 2).join(', ') || 'unknown'}`
    case 'subregion':
      return `${cc.subregion} vs ${ec.subregion}`
    case 'continent':
      return `${continentNames[cc.continent]} vs ${continentNames[ec.continent]}`
    case 'currency':
      return `${cc.currencies[0] ?? 'unknown'} vs ${ec.currencies[0] ?? 'unknown'}`
    case 'landlocked':
      return `${cc.landlocked ? 'Landlocked' : 'Has a coast'} vs ${ec.name} ${ec.landlocked ? 'landlocked' : 'with a coast'}`
    case 'neighbours':
      return cc.borders.includes(ec.code) ? `Borders ${ec.name}` : `Doesn’t border ${ec.name}`
    case 'prices':
      return `${pricePct(cc.priceLevel!)} of US prices vs ${ec.name} ${pricePct(ec.priceLevel!)}`
    case 'spend':
      return `${usd(cc.visitorSpend!)}/trip vs ${ec.name} ${usd(ec.visitorSpend!)}`
    default:
      return `vs ${e.label}`
  }
}

/** Mirrors the `different` score: contrast with the closest logged place, novelty, destination. */
function differentBreakdown(c: Candidate, examples: Example[], seen: Coverage, weights: Weights, novelty: number): ScorePart[] {
  const cw = contrastWeights(weights)
  let closest: Example | undefined
  let closestScores: GroupScores = {}
  let maxSim = -1
  for (const e of examples) {
    const scores = groupScores(c.f, e)
    const sim = similarity(scores, cw)
    if (sim > maxSim) {
      maxSim = sim
      closest = e
      closestScores = scores
    }
  }

  const parts: ScorePart[] = []
  if (closest) {
    let total = 0
    for (const g in closestScores) total += cw[g as FeatureGroup]
    for (const g in closestScores) {
      const group = g as FeatureGroup
      if (!cw[group]) continue
      parts.push({
        key: group,
        label: DIFFERENT_LABELS[group],
        value: DIFFERENT.contrast * ((cw[group] * (1 - closestScores[group]!)) / total),
        detail: differenceDetail(group, c, closest),
      })
    }
  }
  parts.push({ key: 'novelty', label: 'Something new', value: DIFFERENT.novelty * novelty, detail: noveltyDetail(c.f.country, seen) })
  parts.push({
    key: 'destination',
    label: 'Real destination',
    value: DIFFERENT.destination * destinationScore(c.f),
    detail: `Fame ${Math.round(c.f.prominence! * 100)}/100 · pop. ${formatCompact(c.city.population)}${c.f.rank === 2 ? ' · capital' : ''}`,
  })
  return tidyParts(parts)
}

/** The scale that fits every breakdown in a list. */
export function breakdownScale(lists: ScorePart[][]): { pos: number; neg: number } {
  let pos = 0
  let neg = 0
  for (const parts of lists) {
    for (const p of parts) {
      if (p.value > pos) pos = p.value
      if (-p.value > neg) neg = -p.value
    }
  }
  return { pos, neg }
}

// ───────────── Evaluation ─────────────

/**
 * Leave-one-out hit rate: hide each logged city in turn and check whether the model,
 * given everything else, ranks it in the top `k`. A rough measure of whether the
 * features capture the user's taste.
 */
export function leaveOneOutHitRate(
  cities: IndexedCity[],
  visits: Visit[],
  countryVisits: CountryVisit[],
  k = 10,
  params?: Partial<ModelParams>,
): number {
  if (visits.length < 2) return 0
  let hits = 0
  for (const held of visits) {
    const rest = visits.filter((v) => v.id !== held.id)
    const recs = recommend(cities, rest, countryVisits, { mode: 'similar', explore: 0, limit: k, params })
    if (recs.some((r) => r.city.id === held.id)) hits++
  }
  return hits / visits.length
}
