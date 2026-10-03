import { countryByCode } from './countries'

/**
 * Windows has no flag emoji font and draws them as two plain letters.
 * Detect that once by rendering a flag in black and checking for colour.
 */
export const supportsFlagEmoji = (() => {
  try {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.canvas.width = ctx.canvas.height = 24
    ctx.font = '20px sans-serif'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#000'
    ctx.fillText('🇫🇷', 0, 0)
    const data = ctx.getImageData(0, 0, 24, 24).data
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0 && (data[i] !== data[i + 1] || data[i + 1] !== data[i + 2])) return true
    }
    return false
  } catch {
    return false
  }
})()

/** Plain-text version for Leaflet tooltips, which take HTML strings. */
export const flagText = (code: string) => (supportsFlagEmoji ? (countryByCode.get(code)?.flag ?? '') : '')
