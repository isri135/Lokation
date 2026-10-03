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
import postgres from 'postgres'
import { createClient } from 'redis'

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

export function createHandler(getStore: () => StoreResult) {
  return async (request: Request): Promise<Response> => {
    const result = getStore()
    if ('error' in result) return json({ error: result.error }, 503)
    const { store } = result

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

const makeRedisClient = (url: string) => createClient({ url })
type RedisClient = ReturnType<typeof makeRedisClient>

/** Either a usable store or a message explaining what's missing. */
export type StoreResult = { store: UserStore; kind: string } | { error: string }

type Env = Record<string, string | undefined>

/**
 * Finds a variable by name, allowing the custom prefix Vercel lets you set when
 * connecting a database (e.g. LOKATION_KV_REST_API_URL).
 */
function findEnv(env: Env, names: string[]): string | undefined {
  for (const name of names) if (env[name]) return env[name]
  for (const [key, value] of Object.entries(env)) {
    if (value && names.some((name) => key.endsWith(`_${name}`))) return value
  }
  return undefined
}

const TABLE = 'lokation_users'

/**
 * Postgres, e.g. Supabase. The table is created on first use, so there's no SQL to
 * run by hand. Row-level security is switched on with no policies, so Supabase's
 * public data API can't read it; this function connects as the table's owner,
 * which RLS doesn't apply to.
 */
/**
 * Drops the query string from a connection URL. Supabase's (via Vercel) carries
 * extras like `?sslmode=require&supa=base-pooler.x`, and the driver would pass
 * unknown ones to the server, which rejects them. SSL is set explicitly instead.
 */
export function cleanPostgresUrl(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return url
  }
}

export function postgresStore(rawUrl: string): UserStore {
  const url = cleanPostgresUrl(rawUrl)
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
  const sql = postgres(url, {
    ssl: local ? false : 'require',
    prepare: false, // required by Supabase's connection pooler (transaction mode)
    max: 1, // one connection per serverless instance
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {}, // "relation already exists" notices from the setup below
  })

  let ready: Promise<void> | null = null
  const ensureTable = () =>
    (ready ??= (async () => {
      await sql`
        create table if not exists ${sql(TABLE)} (
          key text primary key,
          value jsonb not null,
          updated_at timestamptz not null default now()
        )`
      await sql`alter table ${sql(TABLE)} enable row level security`
    })().catch((err) => {
      ready = null
      throw err
    }))

  return {
    get: async (key) => {
      await ensureTable()
      const rows = await sql`select value from ${sql(TABLE)} where key = ${key}`
      return rows[0]?.value ?? null
    },
    set: async (key, value) => {
      await ensureTable()
      await sql`
        insert into ${sql(TABLE)} (key, value, updated_at)
        values (${key}, ${sql.json(value as postgres.JSONValue)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()`
    },
  }
}

/**
 * Picks the database from the environment, first match wins:
 * - Postgres (POSTGRES_URL / DATABASE_URL / SUPABASE_DB_URL), which Vercel's
 *   Supabase integration provides;
 * - Upstash's HTTP API (KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_*),
 *   which Vercel's "Upstash for Redis" integration provides;
 * - any Redis server URL (REDIS_URL / KV_URL), e.g. Vercel's "Redis" integration.
 */
export function storeFromEnv(env: Env): StoreResult {
  const postgresUrl = findEnv(env, ['POSTGRES_URL', 'DATABASE_URL', 'SUPABASE_DB_URL', 'POSTGRES_URL_NON_POOLING'])
  if (postgresUrl) return { kind: 'postgres', store: postgresStore(postgresUrl) }

  const restUrl = findEnv(env, ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'])
  const restToken = findEnv(env, ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'])
  if (restUrl && restToken) {
    const redis = new Redis({ url: restUrl, token: restToken })
    return {
      kind: 'upstash-rest',
      store: {
        get: (key) => redis.get(key),
        set: async (key, value) => {
          await redis.set(key, value)
        },
      },
    }
  }

  const redisUrl = findEnv(env, ['REDIS_URL', 'KV_URL'])
  if (redisUrl) {
    // One connection, reused while the function instance stays warm.
    let client: Promise<RedisClient> | null = null
    const connect = () =>
      (client ??= makeRedisClient(redisUrl)
        .on('error', (err) => console.error('redis error', err))
        .connect()
        .catch((err) => {
          client = null
          throw err
        }))
    return {
      kind: 'redis-url',
      store: {
        get: async (key) => {
          const raw = await (await connect()).get(key)
          return raw ? JSON.parse(raw) : null
        },
        set: async (key, value) => {
          await (await connect()).set(key, JSON.stringify(value))
        },
      },
    }
  }

  // Names only, never values: they're what's needed to tell what went wrong.
  const seen = Object.keys(env).filter((k) => /SUPABASE|POSTGRES|DATABASE_URL|REDIS|UPSTASH|(^|_)KV_/i.test(k))
  return {
    error: seen.length
      ? `The database is not configured: found ${seen.join(', ')}, but no connection string. ` +
        'In Vercel, reconnect the Supabase database to this project (or add POSTGRES_URL), then redeploy.'
      : 'The database is not configured: no database settings found. In Vercel, open Storage, connect a ' +
        'Supabase database to this project for all environments, then redeploy.',
  }
}

let cached: StoreResult | undefined
const handler = createHandler(() => {
  // Retry after a failure so a fixed configuration is picked up by warm instances.
  if (!cached || 'error' in cached) cached = storeFromEnv(process.env)
  return cached
})

export const GET = handler
export const PUT = handler
