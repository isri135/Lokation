import { useMemo, useRef, useState } from 'react'
import type { CountryVisit, Rating, Visit } from '../types'
import { computeStats } from '../lib/stats'
import { continentNames } from '../lib/countries'
import { EARTH_CIRCUMFERENCE_KM } from '../lib/geo'
import { formatCompact, formatNumber, formatPercent } from '../lib/format'
import { parseTravelLog, type TravelLog } from '../lib/useVisits'
import { CountryCharts } from './CountryCharts'
import { Flag } from './Flag'
import { StarRating } from './StarRating'

interface Props {
  visits: Visit[]
  countryVisits: CountryVisit[]
  whereNext: React.ReactNode
  onRemove: (id: number) => void
  onRemoveCountry: (code: string) => void
  onRateCity: (id: number, rating: Rating | undefined) => void
  onRateCountry: (code: string, rating: Rating | undefined) => void
  onFocusCity: (visit: Visit) => void
  onFocusCountry: (code: string) => void
  onImport: (log: TravelLog) => void
  onClear: () => void
}

export function StatsSection({
  visits,
  countryVisits,
  whereNext,
  onRemove,
  onRemoveCountry,
  onRateCity,
  onRateCountry,
  onFocusCity,
  onFocusCountry,
  onImport,
  onClear,
}: Props) {
  const stats = useMemo(() => computeStats(visits, countryVisits), [visits, countryVisits])
  const countryRatings = useMemo(() => new Map(countryVisits.map((c) => [c.code, c.rating])), [countryVisits])
  const empty = visits.length === 0 && countryVisits.length === 0

  return (
    <section className="stats" id="stats" aria-labelledby="stats-title">
      <header className="stats-head">
        <p className="eyebrow">Your world, so far</p>
        <h2 id="stats-title">
          {empty ? (
            'Nothing on the map yet'
          ) : (
            <>
              You’ve explored <em>{formatPercent(stats.areaShare)}</em> of the world’s land
            </>
          )}
        </h2>
        {empty && (
          <p className="lede">
            Search for a city or country above, or click anywhere on the map to start. Your stats
            will build up here as you go.
          </p>
        )}
      </header>

      <div className="hero-grid">
        <HeroStat
          value={formatNumber(stats.cityCount)}
          label={stats.cityCount === 1 ? 'city' : 'cities'}
          note={
            stats.countryOnlyCount > 0
              ? `+ ${stats.countryOnlyCount} ${stats.countryOnlyCount === 1 ? 'country' : 'countries'} with no city logged`
              : undefined
          }
        />
        <HeroStat
          value={formatNumber(stats.sovereignVisited)}
          total={stats.sovereignTotal}
          label="countries"
          note={
            stats.countryCount > stats.sovereignVisited
              ? `+ ${stats.countryCount - stats.sovereignVisited} territories`
              : undefined
          }
        />
        <HeroStat value={String(stats.continentsVisited)} total={7} label="continents" />
        <HeroStat
          value={formatPercent(stats.populationShare)}
          label="of humanity lives in a country you’ve visited"
        />
      </div>

      <div className="panel-grid">
        <Panel title="Share of the world">
          <Meter
            label="Countries"
            share={stats.sovereignVisited / stats.sovereignTotal}
            detail={`${stats.sovereignVisited} of ${stats.sovereignTotal} UN-recognised states`}
          />
          <Meter
            label="Land area"
            share={stats.areaShare}
            detail="Total area of the countries you’ve visited"
          />
          <Meter
            label="World population"
            share={stats.populationShare}
            detail="People living in the countries you’ve visited"
          />
          <p className="panel-foot">
            The cities themselves are home to <strong>{formatCompact(stats.cityPopulation)}</strong>{' '}
            people.
          </p>
        </Panel>

        <Panel title="Continents">
          <ul className="continents">
            {stats.continents.map((c) => (
              <li key={c.code} className={c.cities > 0 ? 'on' : undefined}>
                <div className="continent-row">
                  <span className="continent-name">{continentNames[c.code]}</span>
                  <span className="continent-count">
                    {c.visitedCountries}/{c.totalCountries}
                    {c.code === 'AN' ? ' territories' : ''}
                  </span>
                </div>
                <Bar share={c.totalCountries ? c.visitedCountries / c.totalCountries : 0} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Records">
          {stats.extremes ? (
            <dl className="records">
              {stats.farthestPair && (
                <RecordRow
                  label="Farthest apart"
                  value={`${formatNumber(stats.farthestPair.km)} km`}
                  place={`${stats.farthestPair.a.name} ↔ ${stats.farthestPair.b.name}`}
                  note={`${formatPercent(stats.farthestPair.km / (EARTH_CIRCUMFERENCE_KM / 2))} of the greatest distance possible on Earth`}
                />
              )}
              <RecordRow label="Northernmost" visit={stats.extremes.north} value={lat(stats.extremes.north.lat)} />
              <RecordRow label="Southernmost" visit={stats.extremes.south} value={lat(stats.extremes.south.lat)} />
              <RecordRow label="Easternmost" visit={stats.extremes.east} value={lng(stats.extremes.east.lng)} />
              <RecordRow label="Westernmost" visit={stats.extremes.west} value={lng(stats.extremes.west.lng)} />
              {stats.largestCity && (
                <RecordRow
                  label="Biggest city"
                  visit={stats.largestCity}
                  value={formatCompact(stats.largestCity.population)}
                />
              )}
              {stats.smallestCity && stats.smallestCity !== stats.largestCity && (
                <RecordRow
                  label="Smallest city"
                  visit={stats.smallestCity}
                  value={formatCompact(stats.smallestCity.population)}
                />
              )}
            </dl>
          ) : (
            <p className="muted">Add a few cities to unlock your records.</p>
          )}
          <Hemispheres {...stats.hemispheres} />
        </Panel>
      </div>

      {whereNext}

      <Panel title={`Countries${stats.countryCount ? ` · ${stats.countryCount}` : ''}`} wide>
        {stats.countries.length === 0 ? (
          <p className="muted">Countries you visit will be listed here.</p>
        ) : (
          <ul className="country-list">
            {stats.countries.map(({ country, cities }) => (
              <li key={country.code}>
                <div className="country-head">
                  <Flag code={country.code} />
                  <button
                    className="country-name"
                    onClick={() => onFocusCountry(country.code)}
                    title="Show on map"
                  >
                    {country.name}
                  </button>
                  <span className="country-count">
                    {cities.length === 0
                      ? 'no city logged'
                      : `${cities.length} ${cities.length === 1 ? 'city' : 'cities'}`}
                  </span>
                </div>
                <ul className="places">
                  {cities.length === 0 && (
                    <li className="place place-country">
                      <span className="place-name">Country only</span>
                      <StarRating
                        value={countryRatings.get(country.code)}
                        onChange={(r) => onRateCountry(country.code, r)}
                        label={country.name}
                      />
                      <button
                        className="place-remove"
                        onClick={() => onRemoveCountry(country.code)}
                        aria-label={`Remove ${country.name}`}
                        title="Remove"
                      >
                        ×
                      </button>
                    </li>
                  )}
                  {cities.map((c) => (
                    <li key={c.id} className="place">
                      <button className="place-name" onClick={() => onFocusCity(c)} title="Show on map">
                        {c.name}
                      </button>
                      <StarRating value={c.rating} onChange={(r) => onRateCity(c.id, r)} label={c.name} />
                      <button
                        className="place-remove"
                        onClick={() => onRemove(c.id)}
                        aria-label={`Remove ${c.name}`}
                        title="Remove"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Your countries compared" wide>
        <CountryCharts
          countries={stats.countries.map((c) => c.country)}
          cityCounts={new Map(stats.countries.map((c) => [c.country.code, c.cities.length]))}
        />
      </Panel>

      <DataControls visits={visits} countryVisits={countryVisits} onImport={onImport} onClear={onClear} />

      <footer className="credits">
        City and country data from GeoNames (CC BY
        4.0). Cost figures from the World Bank (CC BY 4.0). Country shapes from Natural Earth. Your map is saved online under your name.
      </footer>
    </section>
  )
}

const lat = (n: number) => `${Math.abs(n).toFixed(1)}°${n >= 0 ? 'N' : 'S'}`
const lng = (n: number) => `${Math.abs(n).toFixed(1)}°${n >= 0 ? 'E' : 'W'}`

function HeroStat({ value, total, label, note }: { value: string; total?: number; label: string; note?: string }) {
  return (
    <div className="hero-stat">
      <div className="hero-value">
        {value}
        {total !== undefined && <span className="hero-total">/{total}</span>}
      </div>
      <div className="hero-label">{label}</div>
      {note && <div className="hero-note">{note}</div>}
    </div>
  )
}

function Panel({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'panel panel-wide' : 'panel'}>
      <h3>{title}</h3>
      {children}
    </div>
  )
}

function Bar({ share }: { share: number }) {
  const pct = Math.min(1, Math.max(0, share)) * 100
  return (
    <div className="bar" role="presentation">
      {/* A visited-but-tiny share still shows a sliver */}
      <div className="bar-fill" style={{ width: pct > 0 ? `max(${pct}%, 4px)` : 0 }} />
    </div>
  )
}

function Meter({ label, share, detail }: { label: string; share: number; detail: string }) {
  return (
    <div className="meter">
      <div className="meter-row">
        <span>{label}</span>
        <strong>{formatPercent(share)}</strong>
      </div>
      <Bar share={share} />
      <div className="meter-detail">{detail}</div>
    </div>
  )
}

function RecordRow({
  label,
  value,
  visit,
  place,
  note,
}: {
  label: string
  value: string
  visit?: Visit
  place?: string
  note?: string
}) {
  return (
    <div className="record">
      <dt>{label}</dt>
      <dd>
        <span className="record-place">
          {visit ? (
            <>
              <Flag code={visit.country} /> {visit.name}
            </>
          ) : (
            place
          )}
        </span>
        <span className="record-value">{value}</span>
      </dd>
      {note && <dd className="record-note">{note}</dd>}
    </div>
  )
}

function Hemispheres(props: Record<'north' | 'south' | 'east' | 'west', boolean>) {
  const sides = [
    ['north', 'Northern'],
    ['south', 'Southern'],
    ['east', 'Eastern'],
    ['west', 'Western'],
  ] as const
  const count = sides.filter(([key]) => props[key]).length
  return (
    <div className="hemispheres">
      <div className="hemi-pills">
        {sides.map(([key, name]) => (
          <span key={key} className={props[key] ? 'hemi on' : 'hemi'}>
            {name}
          </span>
        ))}
      </div>
      <p className="muted">
        {count} of 4 hemispheres{count === 4 ? ' — all of them.' : '.'}
      </p>
    </div>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function DataControls({
  visits,
  countryVisits,
  onImport,
  onClear,
}: {
  visits: Visit[]
  countryVisits: CountryVisit[]
  onImport: (log: TravelLog) => void
  onClear: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const nothing = visits.length === 0 && countryVisits.length === 0
  const everything = [
    visits.length > 0 && plural(visits.length, 'city', 'cities'),
    countryVisits.length > 0 && plural(countryVisits.length, 'country', 'countries'),
  ]
    .filter(Boolean)
    .join(' and ')

  const exportVisits = () => {
    const log = { app: 'lokation', version: 2, visits, countries: countryVisits }
    const blob = new Blob([JSON.stringify(log, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lokation-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importFile = async (file: File) => {
    try {
      const log = parseTravelLog(await file.text())
      onImport(log)
      setMessage(
        `Imported ${plural(log.visits.length, 'city', 'cities')}` +
          (log.countries.length ? ` and ${plural(log.countries.length, 'country', 'countries')}.` : '.'),
      )
    } catch (err) {
      setMessage(`Couldn’t import that file: ${(err as Error).message}`)
    }
  }

  return (
    <div className="data-controls">
      <button className="btn btn-ghost" onClick={exportVisits} disabled={nothing}>
        Export
      </button>
      <button className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
        Import
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importFile(file)
          e.target.value = ''
        }}
      />
      {confirmClear ? (
        <span className="confirm">
          Remove {everything}?
          <button
            className="btn btn-danger"
            onClick={() => {
              onClear()
              setConfirmClear(false)
            }}
          >
            Yes, clear
          </button>
          <button className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button className="btn btn-ghost" onClick={() => setConfirmClear(true)} disabled={nothing}>
          Clear all
        </button>
      )}
      {message && <span className="muted">{message}</span>}
    </div>
  )
}
