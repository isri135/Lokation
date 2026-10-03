import { useCallback, useEffect, useState } from 'react'
import { recoverSignedInCopy } from './recover'

const STORAGE_KEY = 'lokation.hidden.v1'

/** Suggestions the user said "not for me" to: individual cities or whole countries. */
export interface Hidden {
  cities: { id: number; name: string }[]
  countries: { code: string; name: string }[]
}

const NO_HIDDEN: Hidden = { cities: [], countries: [] }

/** Cleans stored hides, dropping anything malformed. */
function sanitizeHidden(data: unknown): Hidden {
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

/** Loads saved hides, recovering them from a sign-in version's cache if needed. */
function load(): Hidden {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null ? sanitizeHidden(recoverSignedInCopy()?.hidden) : sanitizeHidden(JSON.parse(raw))
  } catch {
    return NO_HIDDEN
  }
}

export function useHidden() {
  const [hidden, setHidden] = useState<Hidden>(load)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(hidden))
    } catch {
      // Unavailable storage just means hides last for this session.
    }
  }, [hidden])

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
