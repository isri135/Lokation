import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapView, type FocusTarget } from './components/MapView'
import { SearchBox } from './components/SearchBox'
import { StatsSection } from './components/StatsSection'
import { WhereNext } from './components/WhereNext'
import { loadCities, type IndexedCity } from './lib/cities'
import { recommend } from './lib/recommend'
import { useHidden } from './lib/useHidden'
import { useVisits } from './lib/useVisits'
import type { City, Country } from './types'

export default function App() {
  const {
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
  } = useVisits()
  const [cities, setCities] = useState<IndexedCity[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  const { hidden, hideCity, hideCountry, unhideAll } = useHidden()

  useEffect(() => {
    loadCities().then(setCities, (err: Error) => setLoadError(err.message))
  }, [])

  const visitedIds = useMemo(() => new Set(visits.map((v) => v.id)), [visits])
  const visitedCountries = useMemo(
    () => new Set([...visits.map((v) => v.country), ...countryVisits.map((c) => c.code)]),
    [visits, countryVisits],
  )
  const countryCount = visitedCountries.size
  const hasHistory = visits.length + countryVisits.length > 0

  const recommendations = useMemo(() => {
    if (!cities || !hasHistory) return null
    const opts = {
      limit: 3,
      exclude: new Set(hidden.cities.map((c) => c.id)),
      excludeCountries: new Set(hidden.countries.map((c) => c.code)),
    }
    const similar = recommend(cities, visits, countryVisits, { ...opts, mode: 'similar' })
    // Never show the same city in both columns.
    for (const r of similar) opts.exclude.add(r.city.id)
    const different = recommend(cities, visits, countryVisits, { ...opts, mode: 'different' })
    return { similar, different }
  }, [cities, hasHistory, visits, countryVisits, hidden])

  const focusOnCity = useCallback((c: City) => {
    setFocus({ kind: 'point', lat: c.lat, lng: c.lng, nonce: Date.now() })
  }, [])

  const focusOnCountry = useCallback((code: string) => {
    setFocus({ kind: 'country', code, nonce: Date.now() })
  }, [])

  const addAndFocus = useCallback(
    (c: City) => {
      add(c)
      focusOnCity(c)
    },
    [add, focusOnCity],
  )

  const addCountryAndFocus = useCallback(
    (c: Country) => {
      addCountry(c.code)
      focusOnCountry(c.code)
    },
    [addCountry, focusOnCountry],
  )

  const scrollToMap = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  return (
    <>
      <div className="map-screen">
        <MapView
          visits={visits}
          countryVisits={countryVisits}
          cities={cities}
          focus={focus}
          onAdd={add}
          onRemove={remove}
          onAddCountry={addCountry}
          onRemoveCountry={removeCountry}
          onRateCity={rateCity}
          onRateCountry={rateCountry}
          suggestions={recommendations ? [...recommendations.similar, ...recommendations.different] : []}
        />

        <header className="topbar">
          <h1 className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Lokation
          </h1>
          <SearchBox
            cities={cities}
            loadError={loadError}
            visitedIds={visitedIds}
            visitedCountries={visitedCountries}
            onAdd={addAndFocus}
            onAddCountry={addCountryAndFocus}
          />
          <div className="tally" aria-live="polite">
            <strong>{visits.length}</strong> {visits.length === 1 ? 'city' : 'cities'}
            <span className="dot" aria-hidden="true">·</span>
            <strong>{countryCount}</strong> {countryCount === 1 ? 'country' : 'countries'}
          </div>
        </header>

        <a className="scroll-cue" href="#stats">
          <span>Your stats</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </a>
        <div className="map-legend" aria-label="Map legend">
          <span><i className="key key-visited" aria-hidden="true" />Visited</span>
          <span><i className="key key-similar" aria-hidden="true" />Like your trips</span>
          <span><i className="key key-different" aria-hidden="true" />Something different</span>
        </div>
        <p className="map-hint">Click the map to add a place · Ctrl + scroll to zoom</p>
      </div>

      <StatsSection
        visits={visits}
        countryVisits={countryVisits}
        onRemove={remove}
        onRemoveCountry={removeCountry}
        onRateCity={rateCity}
        onRateCountry={rateCountry}
        whereNext={
          <WhereNext
            similar={recommendations?.similar ?? null}
            different={recommendations?.different ?? null}
            hasHistory={hasHistory}
            hidden={hidden}
            onHideCity={hideCity}
            onHideCountry={hideCountry}
            onUnhideAll={unhideAll}
            onShow={(c) => {
              focusOnCity(c)
              scrollToMap()
            }}
            onAdd={add}
          />
        }
        onFocusCity={(c) => {
          focusOnCity(c)
          scrollToMap()
        }}
        onFocusCountry={(code) => {
          focusOnCountry(code)
          scrollToMap()
        }}
        onImport={importLog}
        onClear={clear}
      />
    </>
  )
}
