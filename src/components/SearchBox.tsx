import { useId, useMemo, useState } from 'react'
import type { City, Country } from '../types'
import { searchCities, type IndexedCity } from '../lib/cities'
import { countryByCode, searchCountries } from '../lib/countries'
import { formatCompact } from '../lib/format'
import { Flag } from './Flag'

type Result =
  | { kind: 'country'; key: string; country: Country; via?: string }
  | { kind: 'city'; key: string; city: City }

interface Props {
  cities: IndexedCity[] | null
  loadError: string | null
  visitedIds: Set<number>
  visitedCountries: Set<string>
  onAdd: (city: City) => void
  onAddCountry: (country: Country) => void
}

export function SearchBox({ cities, loadError, visitedIds, visitedCountries, onAdd, onAddCountry }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [open, setOpen] = useState(false)
  const listId = useId()

  const results = useMemo<Result[]>(() => {
    if (!cities) return []
    // Text after a comma narrows cities ("paris, france"), so only match countries without one.
    const countryResults: Result[] = query.includes(',')
      ? []
      : searchCountries(query).map((m) => ({ kind: 'country', key: `c-${m.country.code}`, ...m }))
    const cityResults: Result[] = searchCities(cities, query, 8 - countryResults.length).map((city) => ({
      kind: 'city',
      key: `p-${city.id}`,
      city,
    }))
    return [...countryResults, ...cityResults]
  }, [cities, query])

  const choose = (r: Result) => {
    if (r.kind === 'city') onAdd(r.city)
    else onAddCountry(r.country)
    setQuery('')
    setActive(0)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault()
      choose(results[active])
    } else if (e.key === 'Escape') {
      setQuery('')
      e.currentTarget.blur()
    }
  }

  const showList = open && query.trim().length > 0
  const placeholder = loadError
    ? 'City list failed to load'
    : cities
      ? 'Add a city or country you’ve been to…'
      : 'Loading 34,000 cities…'

  return (
    <div className="search">
      <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
        value={query}
        disabled={!cities}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList && (
        <ul className="search-results" id={listId} role="listbox">
          {results.length === 0 && <li className="search-empty">No cities or countries match “{query}”</li>}
          {results.map((r, i) => (
            <li
              key={r.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : undefined}
              onMouseEnter={() => setActive(i)}
              // mousedown, not click, so it fires before the input blurs
              onMouseDown={(e) => {
                e.preventDefault()
                choose(r)
              }}
            >
              {r.kind === 'country' ? (
                <CountryOption country={r.country} via={r.via} visited={visitedCountries.has(r.country.code)} />
              ) : (
                <CityOption city={r.city} visited={visitedIds.has(r.city.id)} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CountryOption({ country, via, visited }: { country: Country; via?: string; visited: boolean }) {
  return (
    <>
      <Flag code={country.code} />
      <span className="search-name">
        <strong>{country.name}</strong>
        <small>{via ? `Matches “${via}” · ` : ''}Add the country without a city</small>
      </span>
      <span className="search-meta">
        {visited ? <span className="badge">Visited</span> : <span className="kind-tag">Country</span>}
      </span>
    </>
  )
}

function CityOption({ city, visited }: { city: City; visited: boolean }) {
  const country = countryByCode.get(city.country)
  return (
    <>
      <Flag code={city.country} />
      <span className="search-name">
        <strong>{city.name}</strong>
        <small>{[city.region, country?.name].filter(Boolean).join(', ')}</small>
      </span>
      <span className="search-meta">
        {visited ? <span className="badge">Visited</span> : formatCompact(city.population)}
      </span>
    </>
  )
}
