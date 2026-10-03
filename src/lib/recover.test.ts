import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTravelLog } from './useVisits'

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  }
}

const city = (id: number, name: string) => ({
  id,
  name,
  lat: 0,
  lng: 0,
  country: 'FR',
  region: '',
  population: 1,
  addedAt: '2026-01-01T00:00:00Z',
})

const cache = (...names: string[]) =>
  JSON.stringify({ visits: names.map((n, i) => city(i + 1, n)), countries: [], hidden: {}, unsaved: true })

describe('loadTravelLog', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()))

  it('reads the browser’s saved list', () => {
    localStorage.setItem('lokation.visits.v1', JSON.stringify([city(1, 'Paris')]))
    expect(loadTravelLog().visits.map((v) => v.name)).toEqual(['Paris'])
  })

  it('recovers the last signed-in person’s map left by the sign-in version', () => {
    localStorage.setItem('lokation.user', 'Alex')
    localStorage.setItem('lokation.cache.alex', cache('Paris', 'Tokyo'))
    localStorage.setItem('lokation.cache.sam', cache('Lima'))
    expect(loadTravelLog().visits.map((v) => v.name)).toEqual(['Paris', 'Tokyo'])
  })

  it('recovers the only cached map when no one is signed in', () => {
    localStorage.setItem('lokation.cache.sam', cache('Lima'))
    expect(loadTravelLog().visits.map((v) => v.name)).toEqual(['Lima'])
  })

  it('doesn’t guess between several cached maps', () => {
    localStorage.setItem('lokation.cache.alex', cache('Paris'))
    localStorage.setItem('lokation.cache.sam', cache('Lima'))
    expect(loadTravelLog().visits).toEqual([])
  })

  it('respects a list that was deliberately emptied', () => {
    localStorage.setItem('lokation.visits.v1', '[]')
    localStorage.setItem('lokation.countries.v1', '[]')
    localStorage.setItem('lokation.cache.sam', cache('Lima'))
    expect(loadTravelLog().visits).toEqual([])
  })
})
