import { useCallback, useState } from 'react'

// Where this browser stored hides before sign-in existed (read once, for migration).
const LEGACY_KEY = 'lokation.hidden.v1'

/** Suggestions the user said "not for me" to: individual cities or whole countries. */
export interface Hidden {
  cities: { id: number; name: string }[]
  countries: { code: string; name: string }[]
}

export const NO_HIDDEN: Hidden = { cities: [], countries: [] }

/** Cleans hides that came from the server or a cache, dropping anything malformed. */
export function sanitizeHidden(data: unknown): Hidden {
  const h = (data ?? {}) as Partial<Hidden>
  return {
    cities: Array.isArray(h.cities)
      ? h.cities.filter((c) => typeof c?.id === 'number' && typeof c?.name === 'string')
      : [],
    countries: Array.isArray(h.countries)
      ? h.countries.filter((c) => typeof c?.code === 'string' && typeof c?.name === 'string')
      : [],
  }
}

export function loadLegacyHidden(): Hidden | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return null
    const h = sanitizeHidden(JSON.parse(raw))
    return h.cities.length || h.countries.length ? h : null
  } catch {
    return null
  }
}

/** The signed-in person's hides. Saving is handled by the caller (see useCloudSync). */
export function useHidden(initial: Hidden) {
  const [hidden, setHidden] = useState<Hidden>(initial)

  const hideCity = useCallback((id: number, name: string) => {
    setHidden((h) => (h.cities.some((c) => c.id === id) ? h : { ...h, cities: [...h.cities, { id, name }] }))
  }, [])

  const hideCountry = useCallback((code: string, name: string) => {
    setHidden((h) =>
      h.countries.some((c) => c.code === code) ? h : { ...h, countries: [...h.countries, { code, name }] },
    )
  }, [])

  const unhideAll = useCallback(() => setHidden(NO_HIDDEN), [])

  return { hidden, hideCity, hideCountry, unhideAll }
}

/** Called once the pre-sign-in hides have been given to an account. */
export function clearLegacyHidden() {
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
