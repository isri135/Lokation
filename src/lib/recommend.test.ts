import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CountryVisit, Rating, Visit } from '../types'
import { indexCities, type CityTuple } from './cities'
import { countryByCode } from './countries'
import { DEFAULT_PARAMS, leaveOneOutHitRate, recommend } from './recommend'

const cities = indexCities(JSON.parse(readFileSync('public/data/cities.json', 'utf8')) as CityTuple[])

function visit(name: string, country: string, rating?: Rating): Visit {
  const c = cities.find((x) => x.name === name && x.country === country)
  if (!c) throw new Error(`No city ${name}, ${country} in dataset`)
  return { ...c, addedAt: '2026-01-01T00:00:00Z', rating }
}

const countryOnly = (code: string, rating?: Rating): CountryVisit => ({
  code,
  addedAt: '2026-01-01T00:00:00Z',
  rating,
})

const rankOf = (recs: ReturnType<typeof recommend>, name: string) =>
  recs.findIndex((r) => r.city.name === name)

describe('recommend', () => {
  const westernEurope = [
    visit('Paris', 'FR', 5),
    visit('Lyon', 'FR', 5),
    visit('Barcelona', 'ES', 4),
    visit('Amsterdam', 'NL', 4),
  ]

  it('stays close to the user’s taste when not exploring', () => {
    const recs = recommend(cities, westernEurope, [], { explore: 0, limit: 6 })
    expect(recs).toHaveLength(6)
    for (const r of recs) expect(r.country.continent).toBe('EU')
    expect(recs[0].closest).toBeDefined()
  })

  describe('different mode', () => {
    const recs = recommend(cities, westernEurope, [], { mode: 'different', limit: 6 })

    it('suggests places far from the user’s trips', () => {
      for (const r of recs) expect(r.country.continent).not.toBe('EU')
    })

    it('scores lower similarity than similar mode does', () => {
      const similar = recommend(cities, westernEurope, [], { mode: 'similar', limit: 6 })
      const avg = (rs: typeof recs) => rs.reduce((s, r) => s + r.closest!.similarity, 0) / rs.length
      expect(avg(recs)).toBeLessThan(avg(similar))
    })

    it('still picks real destinations, not obscure towns', () => {
      for (const r of recs) expect(r.city.population).toBeGreaterThan(500_000)
    })

    it('spreads picks across continents', () => {
      expect(new Set(recs.map((r) => r.country.continent)).size).toBeGreaterThanOrEqual(3)
    })

    it('explains picks by contrast, not by shared features', () => {
      for (const r of recs) {
        expect(r.reasons.length).toBeGreaterThan(0)
        for (const reason of r.reasons) expect(reason.kind).not.toBe('match')
      }
    })
  })

  describe('score breakdown', () => {
    const history = [...westernEurope, visit('Tokyo', 'JP', 5), visit('Marrakesh', 'MA', 1)]
    for (const mode of ['similar', 'different'] as const) {
      it(`adds up to the ${mode} score exactly`, () => {
        for (const r of recommend(cities, history, [countryOnly('PE', 3)], { mode, limit: 3 })) {
          const total = r.breakdown.reduce((s, p) => s + p.value, 0)
          expect(total).toBeCloseTo(r.score, 9)
          expect(r.breakdown.length).toBeGreaterThan(2)
        }
      })
    }

    it('shows the penalty when a suggestion resembles a disliked place', () => {
      const recs = recommend(cities, [visit('Paris', 'FR', 5), visit('Lyon', 'FR', 1)], [], { limit: 10 })
      const penalised = recs.find((r) => r.breakdown.some((p) => p.key === 'dislike'))
      expect(penalised).toBeDefined()
      expect(penalised!.breakdown.find((p) => p.key === 'dislike')!.value).toBeLessThan(0)
    })
  })

  describe('cost', () => {
    const logPriceGap = (recs: ReturnType<typeof recommend>, level: number) =>
      recs.reduce((s, r) => s + Math.abs(Math.log((r.country.priceLevel ?? level) / level)), 0) / recs.length

    it('leans toward similarly priced countries', () => {
      // A budget traveller in Southeast Asia (Thailand ~31% of US prices).
      const history = [visit('Bangkok', 'TH', 5), visit('Chiang Mai', 'TH', 5)]
      const withCost = recommend(cities, history, [], { explore: 0.4, limit: 12 })
      const noCost = recommend(cities, history, [], {
        explore: 0.4,
        limit: 12,
        params: { weights: { ...DEFAULT_PARAMS.weights, prices: 0, spend: 0 } },
      })
      expect(logPriceGap(withCost, 0.309)).toBeLessThanOrEqual(logPriceGap(noCost, 0.309))
    })

    it('works for places with no cost data', () => {
      // Taiwan has no World Bank figures.
      expect(countryByCode.get('TW')?.priceLevel).toBeNull()
      const recs = recommend(cities, [visit('Taipei', 'TW', 5)], [], { limit: 3 })
      expect(recs).toHaveLength(3)
      for (const r of recs) expect(Number.isFinite(r.score)).toBe(true)
    })
  })

  it('leaves out hidden cities and countries', () => {
    const first = recommend(cities, westernEurope, [], { limit: 3 })
    const hidden = recommend(cities, westernEurope, [], {
      limit: 3,
      exclude: new Set([first[0].city.id]),
      excludeCountries: new Set([first[1].country.code]),
    })
    expect(hidden.map((r) => r.city.id)).not.toContain(first[0].city.id)
    for (const r of hidden) expect(r.country.code).not.toBe(first[1].country.code)
  })

  it('never suggests a visited city or its immediate suburbs', () => {
    const recs = recommend(cities, westernEurope, [], { explore: 0, limit: 30 })
    const names = recs.map((r) => r.city.name)
    expect(names).not.toContain('Paris')
    expect(names).not.toContain('Boulogne-Billancourt') // ~8 km from Paris
  })

  it('spreads picks across countries', () => {
    const recs = recommend(cities, westernEurope, [], { explore: 0, limit: 6 })
    expect(new Set(recs.map((r) => r.country.code)).size).toBeGreaterThan(1)
  })

  it('pushes away from places like ones rated poorly', () => {
    const loved = recommend(cities, [visit('Lyon', 'FR', 5), visit('Tokyo', 'JP', 5)], [], {
      explore: 0,
      limit: 60,
    })
    const disliked = recommend(cities, [visit('Lyon', 'FR', 1), visit('Tokyo', 'JP', 5)], [], {
      explore: 0,
      limit: 60,
    })
    const frenchLoved = loved.filter((r) => r.country.code === 'FR').length
    const frenchDisliked = disliked.filter((r) => r.country.code === 'FR').length
    expect(frenchLoved).toBeGreaterThan(0)
    expect(frenchDisliked).toBeLessThan(frenchLoved)
  })

  it('uses only country-level features for a country logged without a city', () => {
    const recs = recommend(cities, [], [countryOnly('JP', 5)], { explore: 0, limit: 6 })
    expect(recs[0].closest?.label).toBe('Japan')
    for (const r of recs) {
      expect(r.reasons.map((x) => x.title).join(' ')).not.toMatch(/Similar size|well-known|capital/)
      expect(countryByCode.get(r.country.code)?.continent).toBe('AS')
    }
  })

  it('uses the city’s own features when a city is logged', () => {
    // A small regional town and a capital in the same country should lead to different suggestions.
    const small = recommend(cities, [visit('Annecy', 'FR', 5)], [], { explore: 0, limit: 6 })
    const capital = recommend(cities, [visit('Paris', 'FR', 5)], [], { explore: 0, limit: 6 })
    const avgPop = (rs: typeof small) => rs.reduce((s, r) => s + Math.log10(r.city.population), 0) / rs.length
    expect(avgPop(capital)).toBeGreaterThan(avgPop(small))
  })

  it('suggests famous cities when there is no history', () => {
    const recs = recommend(cities, [], [], { limit: 6 })
    expect(recs).toHaveLength(6)
    for (const r of recs) expect(r.city.prominence).toBeGreaterThan(50)
  })

  it('ranks held-out cities in the top 10 for about half of sample travellers’ trips', () => {
    // Hide each city in turn and see if the model, given the rest, suggests it.
    // 34,000 candidates and a 10-slot list makes this a demanding test; ~55% with
    // the tuned defaults. Guard against regressions, not for a perfect score.
    const trip = (country: string, names: string[]) => names.map((n) => visit(n, country, 5))
    const personas = {
      italy: trip('IT', ['Rome', 'Florence', 'Venice', 'Milan', 'Naples', 'Bologna']),
      euroCapitals: [
        ...trip('FR', ['Paris']),
        ...trip('GB', ['London']),
        ...trip('NL', ['Amsterdam']),
        ...trip('DE', ['Berlin']),
        ...trip('CZ', ['Prague']),
        ...trip('AT', ['Vienna']),
        ...trip('HU', ['Budapest']),
        ...trip('PT', ['Lisbon']),
      ],
      seAsia: [
        ...trip('TH', ['Bangkok', 'Chiang Mai']),
        ...trip('VN', ['Hanoi', 'Ho Chi Minh City']),
        ...trip('MY', ['Kuala Lumpur']),
        ...trip('KH', ['Phnom Penh']),
        ...trip('LA', ['Vientiane']),
      ],
      latam: [
        ...trip('MX', ['Mexico City']),
        ...trip('CO', ['Bogotá', 'Medellín']),
        ...trip('PE', ['Lima', 'Cusco']),
        ...trip('AR', ['Buenos Aires']),
        ...trip('CL', ['Santiago']),
      ],
      usa: trip('US', ['New York City', 'Boston', 'Chicago', 'San Francisco', 'Los Angeles', 'Seattle', 'Austin']),
    }
    const rates = Object.entries(personas).map(([name, v]) => [name, leaveOneOutHitRate(cities, v, [], 10)] as const)
    const mean = rates.reduce((s, [, r]) => s + r, 0) / rates.length
    process.stderr.write(
      `leave-one-out hit rate @10: ${rates.map(([n, r]) => `${n} ${Math.round(r * 100)}%`).join(', ')} | mean ${Math.round(mean * 100)}%\n`,
    )
    expect(mean).toBeGreaterThanOrEqual(0.45)
  }, 120_000)

  it('explains each similar pick with what it shares with a past trip', () => {
    const recs = recommend(cities, westernEurope, [], { limit: 6 })
    for (const r of recs) {
      expect(r.reasons.some((x) => x.kind === 'match')).toBe(true)
      expect(r.closest!.similarity).toBeGreaterThan(0.4)
    }
    expect(rankOf(recs, 'Paris')).toBe(-1)
  })
})
