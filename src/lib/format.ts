const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat()

export const formatCompact = (n: number) => compact.format(n)
export const formatNumber = (n: number) => whole.format(Math.round(n))

/** Percentages that stay meaningful when tiny: 0.04% rather than 0%. */
export function formatPercent(share: number): string {
  const pct = share * 100
  if (pct === 0) return '0%'
  if (pct < 0.1) return '<0.1%'
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}
