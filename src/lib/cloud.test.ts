import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signIn } from './cloud'

/** A minimal in-memory localStorage. */
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

/** A fake /api/user backed by a Map, like the real one keyed by lowercased name. */
function fakeServer(options: { failGets?: boolean } = {}) {
  const db = new Map<string, { displayName: string; data: unknown }>()
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    if (!init?.method || init.method === 'GET') {
      if (options.failGets) throw new TypeError('network down')
      const name = url.searchParams.get('name')!.trim()
      const row = db.get(name.toLowerCase())
      return Response.json({ name: row?.displayName ?? name, data: row?.data ?? null })
    }
    const body = JSON.parse(String(init.body))
    const key = body.name.toLowerCase()
    db.set(key, { displayName: db.get(key)?.displayName ?? body.name, data: body.data })
    return Response.json({ ok: true })
  })
  return { db, fetchMock }
}

const paris = {
  id: 2988507,
  name: 'Paris',
  lat: 48.853,
  lng: 2.349,
  country: 'FR',
  region: 'Île-de-France',
  population: 2138551,
  addedAt: '2026-01-01T00:00:00Z',
}

describe('signIn', () => {
  beforeEach(() => {
    const storage = memoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    vi.stubGlobal('localStorage', storage)
  })

  it('gives this browser’s pre-sign-in map to the first new name only', async () => {
    localStorage.setItem('lokation.visits.v1', JSON.stringify([paris]))
    vi.stubGlobal('fetch', fakeServer().fetchMock)

    const alex = await signIn('Alex')
    expect(alex.account.data.visits.map((v) => v.name)).toEqual(['Paris'])
    expect(alex.unsaved).toBe(true)

    const sam = await signIn('Sam')
    expect(sam.account.data.visits).toEqual([])
    expect(sam.unsaved).toBe(false)
  })

  it('doesn’t hand out the old map again in a browser where someone already signed in', async () => {
    // The state an earlier version left behind: the old map still stored, plus a
    // cached account for the first person who signed in.
    localStorage.setItem('lokation.visits.v1', JSON.stringify([paris]))
    localStorage.setItem('lokation.cache.alex', JSON.stringify({ visits: [paris], countries: [], hidden: {} }))
    vi.stubGlobal('fetch', fakeServer().fetchMock)

    const sam = await signIn('Sam')
    expect(sam.account.data.visits).toEqual([])
    expect(localStorage.getItem('lokation.visits.v1')).toBeNull()
  })

  it('keeps a first upload that never reached the server for that person', async () => {
    localStorage.setItem('lokation.visits.v1', JSON.stringify([paris]))
    vi.stubGlobal('fetch', fakeServer().fetchMock)
    await signIn('Alex') // upload pending; nothing saved on the server yet

    vi.stubGlobal('fetch', fakeServer().fetchMock) // server still has no "alex"
    const again = await signIn('alex')
    expect(again.account.data.visits.map((v) => v.name)).toEqual(['Paris'])
    expect(again.unsaved).toBe(true)
  })

  it('matches names case-insensitively and keeps people apart', async () => {
    const { db, fetchMock } = fakeServer()
    vi.stubGlobal('fetch', fetchMock)
    db.set('alex', { displayName: 'Alex', data: { visits: [paris], countries: [], hidden: { cities: [], countries: [] } } })

    const alex = await signIn('  aLeX ')
    expect(alex.account.name).toBe('Alex')
    expect(alex.account.data.visits).toHaveLength(1)
    expect((await signIn('Sam')).account.data.visits).toEqual([])
  })

  it('falls back to this browser’s copy when the server is unreachable', async () => {
    const online = fakeServer()
    online.db.set('alex', { displayName: 'Alex', data: { visits: [paris], countries: [], hidden: { cities: [], countries: [] } } })
    vi.stubGlobal('fetch', online.fetchMock)
    await signIn('Alex')

    vi.stubGlobal('fetch', fakeServer({ failGets: true }).fetchMock)
    const offline = await signIn('Alex')
    expect(offline.offline).toBe(true)
    expect(offline.account.data.visits).toHaveLength(1)
    await expect(signIn('Nobody')).rejects.toThrow(/reach the server/)
  })
})
