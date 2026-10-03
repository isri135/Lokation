import type { ScorePart } from '../lib/recommend'

interface Props {
  parts: ScorePart[]
  total: number
  /** Shared across the cards in a column so their bars are comparable. */
  scale: { pos: number; neg: number }
  label: string // accessible name, e.g. "Score breakdown for Marseille"
}

const fmt = (v: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2)

/**
 * Rounds each part to hundredths so the shown parts add up to the shown total
 * (largest-remainder method); plain rounding can drift by a few hundredths.
 */
function roundToTotal(values: number[], total: number): number[] {
  const target = Math.round(total * 100)
  const floors = values.map((v) => Math.floor(v * 100))
  let shortfall = target - floors.reduce((a, b) => a + b, 0)
  const order = values
    .map((v, i) => ({ i, rem: v * 100 - floors[i] }))
    .sort((a, b) => b.rem - a.rem)
  const cents = [...floors]
  for (let j = 0; shortfall > 0 && j < order.length; j++, shortfall--) cents[order[j].i] += 1
  return cents.map((c) => c / 100)
}

/**
 * Horizontal contribution bars from a shared zero line. Each row is focusable and
 * shows its detail on hover/focus; values are always visible at the right.
 */
export function BreakdownChart({ parts, total, scale, label }: Props) {
  const span = scale.pos + scale.neg || 1
  const zero = (scale.neg / span) * 100
  const shown = roundToTotal(
    parts.map((p) => p.value),
    total,
  )
  return (
    <div className="bd" role="list" aria-label={label}>
      {parts.map((part, i) => {
        const p = { ...part, value: shown[i] }
        const width = (Math.abs(p.value) / span) * 100
        const left = p.value >= 0 ? zero : zero - width
        return (
          <div
            key={p.key}
            className={p.value >= 0 ? 'bd-row' : 'bd-row bd-neg'}
            role="listitem"
            tabIndex={0}
            aria-label={`${p.label}: ${fmt(p.value)}. ${p.detail}`}
          >
            <span className="bd-label">{p.label}</span>
            <span className="bd-track" aria-hidden="true">
              <span className="bd-zero" style={{ left: `${zero}%` }} />
              <span className="bd-bar" style={{ left: `${left}%`, width: `max(${width}%, 2px)` }} />
            </span>
            <span className="bd-value">{fmt(p.value)}</span>
            <span className="viz-tip" role="tooltip">
              <strong>{fmt(p.value)}</strong> {p.label}
              <span>{p.detail}</span>
            </span>
          </div>
        )
      })}
      <div className="bd-row bd-total" role="listitem">
        <span className="bd-label">Score</span>
        <span className="bd-track" aria-hidden="true" />
        <span className="bd-value">{total.toFixed(2)}</span>
      </div>
    </div>
  )
}
