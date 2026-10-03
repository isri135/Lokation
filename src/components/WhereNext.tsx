import { useState } from 'react'
import type { City } from '../types'
import { breakdownScale, type Reason, type Recommendation, type RecommendMode } from '../lib/recommend'
import type { Hidden } from '../lib/useHidden'
import { formatCompact } from '../lib/format'
import { BreakdownChart } from './BreakdownChart'
import { Flag } from './Flag'

interface Props {
  similar: Recommendation[] | null // null while cities load
  different: Recommendation[] | null
  hasHistory: boolean
  hidden: Hidden
  onShow: (city: City) => void
  onAdd: (city: City) => void
  onHideCity: (id: number, name: string) => void
  onHideCountry: (code: string, name: string) => void
  onUnhideAll: () => void
}

const COLUMNS: Record<RecommendMode, { title: string; blurb: string }> = {
  similar: {
    title: 'Like your trips',
    blurb: 'Places that share the most with the ones you rated highly.',
  },
  different: {
    title: 'Something different',
    blurb: 'Well-known places unlike anywhere you’ve logged.',
  },
}

export function WhereNext({ similar, different, hasHistory, hidden, onUnhideAll, ...actions }: Props) {
  const hiddenCount = hidden.cities.length + hidden.countries.length
  return (
    <div className="panel panel-wide where-next">
      <div className="where-head">
        <h3>Where next?</h3>
        <p className="muted where-sub">
          Suggestions from the cities and countries you’ve logged. Rate places to sharpen them.
        </p>
      </div>

      {!hasHistory ? (
        <p className="muted">Add a few cities or countries you’ve been to, and suggestions will appear here.</p>
      ) : (
        <div className="where-columns">
          {(['similar', 'different'] as const).map((mode) => {
            const recs = mode === 'similar' ? similar : different
            return (
              <section key={mode} className={`where-col where-col-${mode}`} aria-labelledby={`where-${mode}`}>
                <header className="where-col-head">
                  <h4 id={`where-${mode}`}>
                    <span className="legend-dot" aria-hidden="true" />
                    {COLUMNS[mode].title}
                  </h4>
                  <p className="muted">{COLUMNS[mode].blurb}</p>
                </header>
                {recs === null ? (
                  <p className="muted">Loading cities…</p>
                ) : recs.length === 0 ? (
                  <p className="muted">Nothing to suggest right now.</p>
                ) : (
                  <ol className="rec-list">
                    {recs.map((r) => (
                      <RecCard
                        key={r.city.id}
                        rec={r}
                        scale={breakdownScale(recs.map((x) => x.breakdown))}
                        {...actions}
                      />
                    ))}
                  </ol>
                )}
              </section>
            )
          })}
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="hidden-note muted">
          Hiding{' '}
          {[...hidden.cities.map((c) => c.name), ...hidden.countries.map((c) => `all of ${c.name}`)].join(', ')}.{' '}
          <button className="link-btn" onClick={onUnhideAll}>
            Show again
          </button>
        </p>
      )}
    </div>
  )
}

function RecCard({
  rec: r,
  scale,
  onShow,
  onAdd,
  onHideCity,
  onHideCountry,
}: { rec: Recommendation; scale: { pos: number; neg: number } } & Pick<
  Props,
  'onShow' | 'onAdd' | 'onHideCity' | 'onHideCountry'
>) {
  const [hiding, setHiding] = useState(false)
  return (
    <li className="rec">
      <div className="rec-title">
        <Flag code={r.country.code} />
        <span>
          <strong>{r.city.name}</strong>
          <small>
            {[r.city.region, r.country.name].filter(Boolean).join(', ')} · pop. {formatCompact(r.city.population)}
          </small>
        </span>
      </div>

      <Lead rec={r} />

      <ul className="why" aria-label={`Why ${r.city.name}`}>
        {r.reasons.map((reason) => (
          <ReasonRow key={reason.title} reason={reason} />
        ))}
      </ul>

      <details className="breakdown" open>
        <summary>Score breakdown</summary>
        <p className="breakdown-note">
          How each feature adds to the score of {r.score.toFixed(2)}. Bars share a scale across this column.
        </p>
        <BreakdownChart
          parts={r.breakdown}
          total={r.score}
          scale={scale}
          label={`Score breakdown for ${r.city.name}`}
        />
      </details>

      {hiding ? (
        <div className="rec-actions hide-confirm">
          <button
            className="btn btn-ghost"
            onClick={() => onHideCity(r.city.id, r.city.name)}
          >
            Hide {r.city.name}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => onHideCountry(r.country.code, r.country.name)}
          >
            Hide all of {r.country.name}
          </button>
          <button className="link-btn" onClick={() => setHiding(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="rec-actions">
          <button className="btn btn-ghost" onClick={() => onShow(r.city)}>
            Show on map
          </button>
          <button className="btn btn-ghost" onClick={() => onAdd(r.city)}>
            + Been there
          </button>
          <button className="link-btn" onClick={() => setHiding(true)}>
            Not for me
          </button>
        </div>
      )}
    </li>
  )
}

/** One line on what drove the pick, with the strength of the (dis)similarity. */
function Lead({ rec: r }: { rec: Recommendation }) {
  if (!r.closest) return null
  const pct = Math.round(r.closest.similarity * 100)
  if (r.mode === 'similar') {
    const loved = r.closest.rating !== undefined && r.closest.rating >= 4
    return (
      <p className="rec-lead">
        <span className="match-pill">{pct}% match</span>
        <span>
          {loved ? 'Because you loved' : 'Like'} <strong>{r.closest.label}</strong>
          {r.closest.rating !== undefined && (
            <span className="rec-stars" aria-label={`${r.closest.rating} stars`}>
              {' '}
              {'★'.repeat(r.closest.rating)}
            </span>
          )}
        </span>
      </p>
    )
  }
  // For far-flung places the similarity bottoms out near zero, so a percentage
  // would look precise without saying anything; name the nearest match instead.
  return (
    <p className="rec-lead">
      <span className="match-pill">Very different</span>
      <span>
        Even your closest trip, <strong>{r.closest.label}</strong>, has little in common
      </span>
    </p>
  )
}

const ICONS: Record<Reason['kind'], { glyph: string; label: string }> = {
  match: { glyph: '✓', label: 'In common' },
  new: { glyph: '✦', label: 'A first' },
  contrast: { glyph: '⇄', label: 'Different' },
}

function ReasonRow({ reason }: { reason: Reason }) {
  const icon = ICONS[reason.kind]
  return (
    <li className={`why-row why-${reason.kind}`}>
      <span className="why-icon" title={icon.label}>
        <span aria-hidden="true">{icon.glyph}</span>
        <span className="sr-only">{icon.label}: </span>
      </span>
      <span className="why-text">
        <strong>{reason.title}</strong>
        {reason.detail && <span className="why-detail">{reason.detail}</span>}
      </span>
    </li>
  )
}
