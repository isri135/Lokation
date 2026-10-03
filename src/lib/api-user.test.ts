import { describe, expect, it } from 'vitest'
import { createHandler, storeFromEnv } from '../../api/user'

describe('storeFromEnv', () => {
  it('uses Upstash’s HTTP API with the names Vercel’s integration sets', () => {
    const r = storeFromEnv({ KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 't' })
    expect('kind' in r && r.kind).toBe('upstash-rest')
  })

  it('accepts Upstash’s own variable names', () => {
    const r = storeFromEnv({ UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' })
    expect('kind' in r && r.kind).toBe('upstash-rest')
  })

  it('accepts a custom prefix chosen when connecting the database', () => {
    const r = storeFromEnv({
      LOKATION_KV_REST_API_URL: 'https://example.upstash.io',
      LOKATION_KV_REST_API_TOKEN: 't',
    })
    expect('kind' in r && r.kind).toBe('upstash-rest')
  })

  it('falls back to a Redis server URL', () => {
    const r = storeFromEnv({ REDIS_URL: 'rediss://default:pw@example.com:6379' })
    expect('kind' in r && r.kind).toBe('redis-url')
  })

  it('does not treat a read-only token as enough, and names what it found', () => {
    const r = storeFromEnv({ KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_READ_ONLY_TOKEN: 't' })
    expect('error' in r && r.error).toMatch(/found KV_REST_API_URL, KV_REST_API_READ_ONLY_TOKEN/)
  })

  it('explains what to do when nothing is set, without leaking values', async () => {
    const r = storeFromEnv({ PATH: '/usr/bin', SECRET_THING: 'hunter2' })
    expect('error' in r && r.error).toMatch(/no database settings found/)
    expect('error' in r && r.error).not.toMatch(/hunter2|SECRET/)

    const res = await createHandler(() => r)(new Request('http://localhost/api/user?name=Alex'))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/connect an Upstash for Redis database/)
  })
})
