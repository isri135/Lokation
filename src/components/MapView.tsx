import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  Tooltip,
  ZoomControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import worldTopo from 'world-atlas/countries-50m.json'
import type { City, CountryVisit, Rating, Visit } from '../types'
import { nearestCity } from '../lib/cities'
import { countryByCode, countryByNumeric, countryCodeByShapeName } from '../lib/countries'
import { formatCompact } from '../lib/format'
import { flagText } from '../lib/flags'
import type { Recommendation, RecommendMode } from '../lib/recommend'
import { Flag } from './Flag'
import { StarRating } from './StarRating'

type ShapeProps = { name: string }

const topology = worldTopo as unknown as Topology<{ countries: GeometryCollection<ShapeProps> }>
const shapes = unwrapAntimeridian(
  feature(topology, topology.objects.countries) as FeatureCollection<Geometry, ShapeProps>,
)

/**
 * Leaflet draws a ring that jumps from 180° to -180° as a band across the whole
 * map (Russia, Alaska, Fiji). Shift such rings east so they stay contiguous.
 * Antarctica legitimately spans every longitude, so it's left alone.
 */
function unwrapAntimeridian<T extends FeatureCollection<Geometry, ShapeProps>>(fc: T): T {
  const fixRing = (ring: number[][]) => {
    const crosses = ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180)
    const polar = ring.some((p) => p[1] < -80)
    return crosses && !polar ? ring.map(([lng, lat]) => [lng < 0 ? lng + 360 : lng, lat]) : ring
  }
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === 'Polygon') g.coordinates = g.coordinates.map(fixRing)
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((poly) => poly.map(fixRing))
  }
  return fc
}

function shapeCountryCode(f: Feature<Geometry, ShapeProps>): string | undefined {
  return f.id !== undefined
    ? countryByNumeric.get(String(f.id))?.code
    : countryCodeByShapeName[f.properties.name]
}

/** Matches the legend dots in the Where next? panel. */
const SUGGESTION_COLORS: Record<RecommendMode, string> = { similar: '#7cc8ff', different: '#d4a5ff' }

const ATTRIBUTION =
  'Shapes: <a href="https://www.naturalearthdata.com/">Natural Earth</a> · Cities: <a href="https://www.geonames.org/">GeoNames</a>'

const WORLD_VIEW = L.latLngBounds([-55, -170], [75, 190])

/** Faint lines every 30° so the empty ocean still reads as a globe. */
const graticule: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    ...[-60, -30, 0, 30, 60].map((lat) => line(Array.from({ length: 37 }, (_, i) => [-180 + i * 10, lat]))),
    ...Array.from({ length: 13 }, (_, i) => -180 + i * 30).map((lng) =>
      line(Array.from({ length: 17 }, (_, i) => [lng, -80 + i * 10])),
    ),
  ],
}

function line(coordinates: number[][]): Feature {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } }
}

export type FocusTarget =
  | { kind: 'point'; lat: number; lng: number; nonce: number } // nonce lets the same place be focused twice
  | { kind: 'country'; code: string; nonce: number }

/** Bounds of a country's shape, for zooming to it. */
function countryBounds(code: string): L.LatLngBounds | null {
  const features = shapes.features.filter((f) => shapeCountryCode(f) === code)
  return features.length ? L.geoJSON({ type: 'FeatureCollection', features } as FeatureCollection).getBounds() : null
}

interface Props {
  visits: Visit[]
  countryVisits: CountryVisit[]
  cities: City[] | null
  focus: FocusTarget | null
  onAdd: (city: City) => void
  onRemove: (id: number) => void
  onAddCountry: (code: string) => void
  onRemoveCountry: (code: string) => void
  onRateCity: (id: number, rating: Rating | undefined) => void
  onRateCountry: (code: string, rating: Rating | undefined) => void
  suggestions: Recommendation[]
}

export function MapView({
  visits,
  countryVisits,
  cities,
  focus,
  onAdd,
  onRemove,
  onAddCountry,
  onRemoveCountry,
  onRateCity,
  onRateCountry,
  suggestions,
}: Props) {
  const countryRatings = useMemo(() => new Map(countryVisits.map((c) => [c.code, c.rating])), [countryVisits])

  // Visited countries -> number of cities logged there (0 for country-only visits).
  const cityCountByCountry = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of countryVisits) counts.set(c.code, 0)
    for (const v of visits) counts.set(v.country, (counts.get(v.country) ?? 0) + 1)
    return counts
  }, [visits, countryVisits])

  // Set by a country shape's click handler, which Leaflet runs just before the map's.
  const clickedCountry = useRef<string | null>(null)
  const setClickedCountry = useCallback((code: string | null) => {
    clickedCountry.current = code
  }, [])
  const takeClickedCountry = useCallback(() => {
    const code = clickedCountry.current
    clickedCountry.current = null
    return code
  }, [])

  return (
    <MapContainer
      className="map"
      bounds={WORLD_VIEW}
      maxBounds={[
        [-85, -200],
        [85, 200],
      ]}
      maxBoundsViscosity={1}
      zoomControl={false}
      // The page scrolls to the stats, so the wheel must not be captured by the map.
      scrollWheelZoom={false}
      zoomSnap={0.25}
      maxZoom={10}
    >
      <GeoJSON
        data={graticule}
        interactive={false}
        attribution={ATTRIBUTION}
        style={{ color: '#ffffff', weight: 0.5, opacity: 0.05 }}
      />
      <CountryHighlights cityCountByCountry={cityCountByCountry} onCountryClick={setClickedCountry} />
      {visits.map((v) => (
        <CircleMarker
          key={v.id}
          center={[v.lat, v.lng]}
          radius={5}
          className="visit-marker"
          bubblingMouseEvents={false}
          pathOptions={{ color: '#1a1206', weight: 1.5, fillColor: '#ffc46b', fillOpacity: 1 }}
        >
          <Tooltip permanent direction="right" offset={[8, 0]} className="city-label">
            {v.name}
          </Tooltip>
          <Popup>
            <CityPopup city={v}>
              <StarRating value={v.rating} onChange={(r) => onRateCity(v.id, r)} label={v.name} />
              <button className="btn btn-ghost" onClick={() => onRemove(v.id)}>
                Remove
              </button>
            </CityPopup>
          </Popup>
        </CircleMarker>
      ))}
      {suggestions.map((r) => (
        <CircleMarker
          key={`s-${r.city.id}`}
          center={[r.city.lat, r.city.lng]}
          radius={6}
          className={`suggest-marker suggest-${r.mode}`}
          bubblingMouseEvents={false}
          pathOptions={{
            color: SUGGESTION_COLORS[r.mode],
            weight: 2,
            dashArray: '3 3',
            fillColor: SUGGESTION_COLORS[r.mode],
            fillOpacity: 0.15,
          }}
        >
          <Tooltip permanent direction="right" offset={[8, 0]} className={`city-label suggest-label suggest-label-${r.mode}`}>
            {r.city.name}?
          </Tooltip>
          <Popup>
            <CityPopup city={r.city}>
              <span className="popup-why">
                <strong>{r.mode === 'similar' ? 'Like your trips' : 'Something different'}:</strong>{' '}
                {r.reasons.map((x) => x.title).join(' · ')}
              </span>
              <button className="btn" onClick={() => onAdd(r.city)}>
                + I’ve been here
              </button>
            </CityPopup>
          </Popup>
        </CircleMarker>
      ))}
      <ClickToAdd
        cities={cities}
        visits={visits}
        cityCountByCountry={cityCountByCountry}
        countryRatings={countryRatings}
        onRateCountry={onRateCountry}
        takeClickedCountry={takeClickedCountry}
        onAdd={onAdd}
        onAddCountry={onAddCountry}
        onRemoveCountry={onRemoveCountry}
      />
      <FitToVisitsOnce visits={visits} countryVisits={countryVisits} />
      <FlyTo focus={focus} />
      <ModifierWheelZoom />
      <ResponsiveMinZoom />
      <ZoomClass />
      <ZoomControl position="bottomright" />
    </MapContainer>
  )
}

/** Never let the world shrink narrower than the screen. */
function ResponsiveMinZoom() {
  const map = useMap()
  useEffect(() => {
    const update = () => {
      const width = map.getSize().x
      map.setMinZoom(Math.max(1, Math.floor(Math.log2(width / 256) * 4) / 4))
    }
    update()
    map.on('resize', update)
    return () => {
      map.off('resize', update)
    }
  }, [map])
  return null
}

/** City labels only appear once zoomed in far enough for them not to collide. */
function ZoomClass() {
  const map = useMap()
  useEffect(() => {
    const update = () => map.getContainer().classList.toggle('show-labels', map.getZoom() >= 4)
    update()
    map.on('zoomend', update)
    return () => {
      map.off('zoomend', update)
    }
  }, [map])
  return null
}

function CityPopup({ city, children }: { city: City; children: React.ReactNode }) {
  const country = countryByCode.get(city.country)
  return (
    <div className="popup">
      <div className="popup-title">
        <Flag code={city.country} /> {city.name}
      </div>
      <div className="popup-sub">
        {[city.region, country?.name].filter(Boolean).join(', ')}
        {city.population > 0 && ` · pop. ${formatCompact(city.population)}`}
      </div>
      <div className="popup-actions">{children}</div>
    </div>
  )
}

function CountryHighlights({
  cityCountByCountry,
  onCountryClick,
}: {
  cityCountByCountry: Map<string, number>
  onCountryClick: (code: string | null) => void
}) {
  const ref = useRef<L.GeoJSON>(null)
  const countsRef = useRef(cityCountByCountry)

  const styleFor = (f?: Feature<Geometry, ShapeProps>): L.PathOptions => {
    const code = f && shapeCountryCode(f)
    const cityCount = code === undefined ? undefined : countsRef.current.get(code)
    if (cityCount === undefined) {
      return { color: '#3a414c', weight: 0.6, opacity: 1, dashArray: undefined, fillColor: '#1f242c', fillOpacity: 1 }
    }
    // Visited without a city logged: same highlight, dashed edge.
    return {
      color: '#ffb547',
      weight: 1,
      opacity: 0.9,
      dashArray: cityCount === 0 ? '3 3' : undefined,
      fillColor: '#ff9f1c',
      fillOpacity: cityCount === 0 ? 0.3 : 0.38,
    }
  }

  // GeoJSON's `style` prop is only read on mount, so restyle when visits change.
  useEffect(() => {
    countsRef.current = cityCountByCountry
    ref.current?.eachLayer((layer) => {
      const path = layer as L.Path & { feature?: Feature<Geometry, ShapeProps> }
      path.setStyle(styleFor(path.feature))
    })
  }, [cityCountByCountry])

  return (
    <GeoJSON
      ref={ref}
      data={shapes}
      style={styleFor}
      onEachFeature={(f: Feature<Geometry, ShapeProps>, layer) => {
        const code = shapeCountryCode(f)
        const country = code ? countryByCode.get(code) : undefined
        layer.on('click', () => {
          onCountryClick(code ?? null)
        })
        layer.bindTooltip(
          () => {
            const n = code === undefined ? undefined : countsRef.current.get(code)
            const name = `${flagText(code ?? '')} ${country?.name ?? f.properties.name}`
            if (n === undefined) return name
            const detail = n === 0 ? 'Visited · no cities logged' : `${n} ${n === 1 ? 'city' : 'cities'} visited`
            return `<strong>${name}</strong><br>${detail}`
          },
          { sticky: true, direction: 'top', offset: [0, -8], className: 'country-tooltip' },
        )
      }}
    />
  )
}

function ClickToAdd({
  cities,
  visits,
  cityCountByCountry,
  countryRatings,
  onRateCountry,
  takeClickedCountry,
  onAdd,
  onAddCountry,
  onRemoveCountry,
}: {
  cities: City[] | null
  visits: Visit[]
  cityCountByCountry: Map<string, number>
  countryRatings: Map<string, Rating | undefined>
  onRateCountry: (code: string, rating: Rating | undefined) => void
  takeClickedCountry: () => string | null
  onAdd: (city: City) => void
  onAddCountry: (code: string) => void
  onRemoveCountry: (code: string) => void
}) {
  const [candidate, setCandidate] = useState<{
    city: City | null
    countryCode: string | null
    at: L.LatLng
  } | null>(null)
  const map = useMapEvents({
    click(e) {
      const countryCode = takeClickedCountry()
      const at = e.latlng.wrap()
      const city = cities ? nearestCity(cities, at.lat, at.lng) : null
      if (!cities && !countryCode) return
      setCandidate({ city, countryCode, at: e.latlng })
    },
  })

  if (!candidate) return null
  const { city, at } = candidate
  // Prefer the shape that was clicked; the nearest city can be across a border.
  const countryCode = candidate.countryCode ?? city?.country ?? null
  const country = countryCode ? countryByCode.get(countryCode) : undefined
  const cityVisited = city !== null && visits.some((v) => v.id === city.id)
  const countryCities = countryCode ? cityCountByCountry.get(countryCode) : undefined
  const close = () => {
    setCandidate(null)
    map.closePopup()
  }

  let countryAction: React.ReactNode = null
  if (country && countryCities === undefined) {
    countryAction = (
      <button
        className={city ? 'btn btn-ghost' : 'btn'}
        onClick={() => {
          onAddCountry(country.code)
          close()
        }}
      >
        {city ? `Just ${country.name}` : `+ I’ve been to ${country.name}`}
      </button>
    )
  } else if (country && countryCities === 0) {
    countryAction = (
      <>
        <span className="badge">Country visited</span>
        <StarRating
          value={countryRatings.get(country.code)}
          onChange={(r) => onRateCountry(country.code, r)}
          label={country.name}
        />
        <button
          className="btn btn-ghost"
          onClick={() => {
            onRemoveCountry(country.code)
            close()
          }}
        >
          Remove country
        </button>
      </>
    )
  }

  return (
    <Popup position={at} eventHandlers={{ remove: () => setCandidate(null) }}>
      {city ? (
        <CityPopup city={city}>
          {cityVisited ? (
            <span className="badge">Already visited</span>
          ) : (
            <button
              className="btn"
              onClick={() => {
                onAdd(city)
                close()
              }}
            >
              + I’ve been here
            </button>
          )}
          {!cityVisited && countryAction}
        </CityPopup>
      ) : country ? (
        <div className="popup">
          <div className="popup-title">
            <Flag code={country.code} /> {country.name}
          </div>
          <div className="popup-sub">No city with 15,000+ people nearby, but you can add the country.</div>
          <div className="popup-actions">{countryAction ?? <span className="badge">Already visited</span>}</div>
        </div>
      ) : (
        <div className="popup popup-sub">No city with 15,000+ people nearby. Try searching instead.</div>
      )}
    </Popup>
  )
}

function FitToVisitsOnce({ visits, countryVisits }: { visits: Visit[]; countryVisits: CountryVisit[] }) {
  const map = useMap()
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    const points: L.LatLngTuple[] = visits.map((v) => [v.lat, v.lng])
    for (const c of countryVisits) {
      const country = countryByCode.get(c.code)
      if (country) points.push([country.lat, country.lng])
    }
    if (points.length === 0) return
    const bounds = L.latLngBounds(points)
    map.fitBounds(bounds, { padding: [80, 80], maxZoom: 6 })
  }, [map, visits, countryVisits])
  return null
}

function FlyTo({ focus }: { focus: FocusTarget | null }) {
  const map = useMap()
  useEffect(() => {
    if (!focus) return
    if (focus.kind === 'point') {
      map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 5), { duration: 1.2 })
      return
    }
    const bounds = countryBounds(focus.code)
    if (bounds) map.flyToBounds(bounds, { padding: [60, 60], maxZoom: 6, duration: 1.2 })
  }, [map, focus])
  return null
}

/** Ctrl/⌘ + wheel zooms the map; a plain wheel keeps scrolling the page. */
function ModifierWheelZoom() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const point = map.mouseEventToContainerPoint(e)
      map.setZoomAround(point, map.getZoom() - Math.sign(e.deltaY) * 0.5)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [map])
  return null
}
