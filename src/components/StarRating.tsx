import { useState } from 'react'
import type { Rating } from '../types'

const LABELS: Record<Rating, string> = {
  1: 'Didn’t enjoy it',
  2: 'It was okay',
  3: 'Liked it',
  4: 'Really liked it',
  5: 'Loved it',
}

interface Props {
  value: Rating | undefined
  onChange: (rating: Rating | undefined) => void
  label: string // what is being rated, for screen readers
}

/** Five-star rating. Clicking the current rating clears it. */
export function StarRating({ value, onChange, label }: Props) {
  const [hover, setHover] = useState<Rating | null>(null)
  const shown = hover ?? value ?? 0
  return (
    <span
      className="stars"
      role="radiogroup"
      aria-label={`Rate ${label}`}
      onMouseLeave={() => setHover(null)}
      title={value ? `${LABELS[value]} · click again to clear` : 'Rate it'}
    >
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}: ${LABELS[n]}`}
          className={shown >= n ? 'star on' : 'star'}
          onMouseEnter={() => setHover(n)}
          onFocus={() => setHover(n)}
          onBlur={() => setHover(null)}
          onClick={() => onChange(value === n ? undefined : n)}
        >
          ★
        </button>
      ))}
    </span>
  )
}
