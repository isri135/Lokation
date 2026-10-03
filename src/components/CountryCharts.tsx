import type { Country } from '../types'
import { worldMedian, worldRank } from '../lib/countries'
import { formatCompact, formatNumber } from '../lib/format'
import { Flag } from './Flag'

interface Props {
  countries: Country[] // countries you've been to
  cityCounts: Map<string, number>
}

type Field = 'population' | 'area' | 'priceLevel' | 'visitorSpend'

interface ChartSpec {
  field: Field
  title: string
  subtitle: string
  scale: 'log' | 'linear'
  format: (v: number) => string
  /** Extra reference lines besides the world median. */
  refs?: { value: number; label: string }[]
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const usd = (v: number) => `US$${formatCompact(v)}`

const CHARTS: ChartSpec[] = [
  {
    field: 'population',
    title: 'Population',
    subtitle: 'People, log scale',
    scale: 'log',
    format: formatCompact,
  },
  {
    field: 'area',
    title: 'Area',
    subtitle: 'km², log scale',
    scale: 'log',
    format: (v) => `${formatCompact(v)} km²`,
  },
  {
    field: 'priceLevel',
    title: 'Price level',
    subtitle: 'Everyday prices as a % of US prices · World Bank',
    scale: 'linear',
    format: pct,
    refs: [{ value: 1, label: 'US' }],
  },
  {
    field: 'visitorSpend',
    title: 'Typical visitor spend',
    subtitle: 'US$ per international visitor per trip, 2015–19 · World Bank',
    scale: 'linear',
    format: usd,
  },
]

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function CountryCharts({ countries, cityCounts }: Props) {
  const sorted = [...countries].sort((a, b) => a.name.localeCompare(b.name))
  if (sorted.length === 0) {
    return <p className="muted">Charts comparing the countries you visit will appear here.</p>
  }
  return (
    <>
      <div className="cc-grid">
        {CHARTS.map((spec) => (
          <FeatureChart key={spec.field} spec={spec} countries={sorted} />
        ))}
      </div>
      <FeatureTable countries={sorted} cityCounts={cityCounts} />
    </>
  )
}

function FeatureChart({ spec, countries }: { spec: ChartSpec; countries: Country[] }) {
  const median = worldMedian(spec.field)
  const values = countries.map((c) => c[spec.field]).filter((v): v is number => v !== null)
  const refs = [{ value: median, label: 'World median' }, ...(spec.refs ?? [])]

  // Domain covers your countries and the reference lines.
  const all = [...values, ...refs.map((r) => r.value)]
  let lo: number, hi: number, ticks: number[]
  if (spec.scale === 'log') {
    lo = Math.pow(10, Math.floor(Math.log10(Math.max(Math.min(...all), 1))))
    hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...all))))
    ticks = []
    for (let t = lo; t <= hi; t *= 10) ticks.push(t)
  } else {
    lo = 0
    hi = Math.max(...all) * 1.08
    ticks = []
  }
  const pos = (v: number) =>
    spec.scale === 'log'
      ? ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100
      : (v / hi) * 100

  return (
    <figure className={`cc-chart cc-${spec.scale}`}>
      <figcaption>
        <strong>{spec.title}</strong>
        <span>{spec.subtitle}</span>
      </figcaption>
      <div className="cc-plot">
        {/* Gridlines and reference lines sit behind the rows. */}
        <div className="cc-guides" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="cc-grid-line" style={{ left: `${pos(t)}%` }}>
              <span className="cc-tick">{formatCompact(t)}</span>
            </span>
          ))}
          {refs.map((r) => (
            <span key={r.label} className="cc-ref" style={{ left: `${pos(r.value)}%` }}>
              <span className="cc-ref-label">
                {r.label} {spec.format(r.value)}
              </span>
            </span>
          ))}
        </div>
        <ul className="cc-rows">
          {countries.map((c) => {
            const v = c[spec.field]
            const rank = v === null ? null : worldRank(spec.field, v)
            const vsMedian = v === null ? '' : v >= median ? 'above' : 'below'
            const description =
              v === null
                ? `${c.name}: no data`
                : `${c.name}: ${spec.format(v)}, ${ordinal(rank!.rank)} of ${rank!.of} countries, ${vsMedian} the world median of ${spec.format(median)}`
            return (
              <li key={c.code} className="cc-row" tabIndex={0} aria-label={description}>
                <span className="cc-name">
                  <Flag code={c.code} /> {c.name}
                </span>
                <span className="cc-track" aria-hidden="true">
                  {v === null ? (
                    <span className="cc-nodata">no data</span>
                  ) : spec.scale === 'log' ? (
                    <span className="cc-dot" style={{ left: `${pos(v)}%` }} />
                  ) : (
                    <span className="cc-bar" style={{ width: `max(${pos(v)}%, 2px)` }} />
                  )}
                </span>
                <span className="cc-value">{v === null ? '—' : spec.format(v)}</span>
                {v !== null && (
                  <span className="viz-tip" role="tooltip">
                    <strong>{spec.format(v)}</strong> {c.name}
                    <span>
                      {ordinal(rank!.rank)} of {rank!.of} countries · {vsMedian} the world median ({spec.format(median)})
                    </span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </figure>
  )
}

/** Every feature the recommender uses for a country, as a table (also the charts' table view). */
function FeatureTable({ countries, cityCounts }: Props) {
  return (
    <details className="cc-table-wrap">
      <summary>All country features as a table</summary>
      <div className="table-scroll">
        <table className="cc-table">
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Cities logged</th>
              <th scope="col">Region</th>
              <th scope="col">Languages</th>
              <th scope="col">Currency</th>
              <th scope="col">Coastline</th>
              <th scope="col">Neighbours</th>
              <th scope="col" className="num">Population</th>
              <th scope="col" className="num">Area (km²)</th>
              <th scope="col" className="num">Price level</th>
              <th scope="col" className="num">Visitor spend</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((c) => (
              <tr key={c.code}>
                <th scope="row">
                  <Flag code={c.code} /> {c.name}
                </th>
                <td className="num">{cityCounts.get(c.code) ?? 0}</td>
                <td>{c.subregion}</td>
                <td>{c.languages.join(', ') || '—'}</td>
                <td>{c.currencies.join(', ') || '—'}</td>
                <td>{c.landlocked ? 'Landlocked' : 'Coastal'}</td>
                <td className="num">{c.borders.length}</td>
                <td className="num">{formatNumber(c.population)}</td>
                <td className="num">{formatNumber(c.area)}</td>
                <td className="num">{c.priceLevel === null ? '—' : pct(c.priceLevel)}</td>
                <td className="num">{c.visitorSpend === null ? '—' : usd(c.visitorSpend)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
