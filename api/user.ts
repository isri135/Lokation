/**
 * GET  /api/user?name=Alex        → { name, data } (data is null for a new user)
 * PUT  /api/user  { name, data }  → { ok: true, updatedAt }
 *
 * One JSON document per user, keyed by the lowercased name. There are no
 * passwords: the name is the login, as intended for sharing with a few friends.
 *
 * Self-contained on purpose (no relative imports) so Vercel can bundle it as is.
 */
import { Redis } from '@upstash/redis'

export interface UserStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

interface StoredUser {
  displayName: string
  data: UserData
  updatedAt: string
}

interface UserData {
  visits: unknown[]
  countries: unknown[]
  hidden: { cities: unknown[]; countries: unknown[] }
}

const MAX_BODY_BYTES = 512 * 1024
const MAX_VISITS = 5000
const MAX_COUNTRIES = 400

/** Trims and collapses spaces; null if empty or too long. */
export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.normalize('NFKC').trim().replace(/\s+/g, ' ')
  return name.length >= 1 && name.length <= 40 ? name : null
}

const keyFor = (name: string) => `user:${name.toLocaleLowerCase()}`

function isUserData(d: unknown): d is UserData {
  if (typeof d !== 'object' || d === null) return false
  const o = d as Record<string, unknown>
  const hidden = o.hidden as Record<string, unknown> | undefined
  return (
    Array.isArray(o.visits) &&
    o.visits.length <= MAX_VISITS &&
    Array.isArray(o.countries) &&
    o.countries.length <= MAX_COUNTRIES &&
    typeof hidden === 'object' &&
    hidden !== null &&
    Array.isArray(hidden.cities) &&
    Array.isArray(hidden.countries)
  )
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export function createHandler(getStore: () => UserStore | null) {
  return async (request: Request): Promise<Response> => {
    const store = getStore()
    if (!store) return json({ error: 'The database is not configured.' }, 503)

    try {
      if (request.method === 'GET') {
        const name = normalizeName(new URL(request.url).searchParams.get('name'))
        if (!name) return json({ error: 'Enter a name of 1–40 characters.' }, 400)
        const stored = (await store.get(keyFor(name))) as StoredUser | null
        return json({ name: stored?.displayName ?? name, data: stored?.data ?? null })
      }

      if (request.method === 'PUT') {
        const text = await request.text()
        if (text.length > MAX_BODY_BYTES) return json({ error: 'Too much data.' }, 413)
        let body: { name?: unknown; data?: unknown }
        try {
          body = JSON.parse(text)
        } catch {
          return json({ error: 'Invalid JSON.' }, 400)
        }
        const name = normalizeName(body.name)
        if (!name) return json({ error: 'Enter a name of 1–40 characters.' }, 400)
        if (!isUserData(body.data)) return json({ error: 'Invalid data.' }, 400)

        // Keep the capitalisation the person first signed up with.
        const existing = (await store.get(keyFor(name))) as StoredUser | null
        const updatedAt = new Date().toISOString()
        const record: StoredUser = { displayName: existing?.displayName ?? name, data: body.data, updatedAt }
        await store.set(keyFor(name), record)
        return json({ ok: true, updatedAt })
      }

      return json({ error: 'Method not allowed.' }, 405)
    } catch (err) {
      console.error('api/user failed', err)
      return json({ error: 'Something went wrong on the server.' }, 500)
    }
  }
}

/**
 * Upstash Redis, created from the Vercel dashboard (Storage → Upstash Redis).
 * The integration may inject either naming of the variables.
 */
function redisStore(): UserStore | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  const redis = new Redis({ url, token })
  return {
    get: (key) => redis.get(key),
    set: async (key, value) => {
      await redis.set(key, value)
    },
  }
}

let cached: UserStore | null | undefined
const handler = createHandler(() => (cached ??= redisStore()))

export const GET = handler
export const PUT = handler
