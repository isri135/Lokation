import { useEffect, useRef, useState } from 'react'
import type { CountryVisit, Visit } from '../types'
import { clearLegacyHidden, loadLegacyHidden, NO_HIDDEN, sanitizeHidden, type Hidden } from './useHidden'
import { clearLegacyLog, loadLegacyLog, sanitizeTravelLog } from './useVisits'

/** Everything stored for one person. */
export interface UserData {
  visits: Visit[]
  countries: CountryVisit[]
  hidden: Hidden
}

export interface Account {
  name: string // as they first typed it; matching is case-insensitive
  data: UserData
}

export interface SignInResult {
  account: Account
  /** Data that exists only locally so far (a first upload, or offline edits). */
  unsaved: boolean
  /** The server couldn't be reached; showing this browser's cached copy. */
  offline: boolean
}

const SESSION_KEY = 'lokation.user'
const cacheKey = (name: string) => `lokation.cache.${name.toLocaleLowerCase()}`

const EMPTY: UserData = { visits: [], countries: [], hidden: NO_HIDDEN }

function sanitizeUserData(raw: unknown): UserData {
  const d = (raw ?? {}) as Partial<UserData>
  return { ...sanitizeTravelLog(d), hidden: sanitizeHidden(d.hidden) }
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const savedName = () => storage()?.getItem(SESSION_KEY) ?? null

export function forgetSession() {
  storage()?.removeItem(SESSION_KEY)
}

function readCache(name: string): (UserData & { unsaved?: boolean }) | null {
  try {
    const raw = storage()?.getItem(cacheKey(name))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { ...sanitizeUserData(parsed), unsaved: parsed.unsaved === true }
  } catch {
    return null
  }
}

function writeCache(name: string, data: UserData, unsaved: boolean) {
  try {
    storage()?.setItem(cacheKey(name), JSON.stringify({ ...data, unsaved }))
  } catch {
    // A full or blocked cache only affects offline use.
  }
}

/** Whether a different name has a cached map in this browser, i.e. has signed in here. */
function someoneElseSignedInHere(name: string): boolean {
  const s = storage()
  if (!s) return false
  const mine = cacheKey(name)
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i)
    if (key?.startsWith('lokation.cache.') && key !== mine) return true
  }
  return false
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body?.error === 'string') return body.error
  } catch {
    // fall through
  }
  return `The server responded with ${res.status}.`
}

/**
 * Opens a person's map. A brand-new name picks up any map this browser kept
 * before sign-in existed, so nothing is lost when accounts arrive. If the server
 * can't be reached, falls back to the cached copy from a previous visit.
 */
export async function signIn(rawName: string): Promise<SignInResult> {
  const typed = rawName.trim().replace(/\s+/g, ' ')
  if (!typed) throw new Error('Enter your name.')

  let res: Response
  try {
    res = await fetch(`/api/user?name=${encodeURIComponent(typed)}`, { cache: 'no-store' })
  } catch {
    res = new Response(null, { status: 599 }) // network failure
  }

  if (!res.ok) {
    const cached = readCache(typed)
    if (cached && res.status >= 500) {
      storage()?.setItem(SESSION_KEY, typed)
      return { account: { name: typed, data: cached }, unsaved: cached.unsaved ?? false, offline: true }
    }
    throw new Error(res.status === 599 ? 'Can’t reach the server. Check your connection.' : await errorMessage(res))
  }

  const body = (await res.json()) as { name: string; data: unknown }
  let data: UserData
  let unsaved = false
  if (body.data === null) {
    const pending = readCache(body.name)
    if (pending?.unsaved) {
      // This person's first upload hasn't reached the server yet; keep trying with it.
      data = pending
      unsaved = true
    } else if (someoneElseSignedInHere(body.name)) {
      // An earlier version handed the pre-sign-in map to every new name and never
      // cleared it. If anyone has signed in on this browser before, it's been claimed.
      clearLegacyLog()
      clearLegacyHidden()
      data = EMPTY
    } else {
      // The map this browser kept before sign-in existed goes to the first name that
      // signs in here, and only that one: it's cleared so later names start empty.
      const log = loadLegacyLog()
      const hidden = loadLegacyHidden()
      data = { ...(log ?? EMPTY), hidden: hidden ?? NO_HIDDEN }
      unsaved = log !== null || hidden !== null
      if (unsaved) {
        writeCache(body.name, data, true) // keep a copy before clearing the originals
        clearLegacyLog()
        clearLegacyHidden()
      }
    }
  } else {
    data = sanitizeUserData(body.data)
    // Edits made offline last time win over the server copy.
    const cached = readCache(body.name)
    if (cached?.unsaved) {
      data = cached
      unsaved = true
    }
  }

  storage()?.setItem(SESSION_KEY, body.name)
  writeCache(body.name, data, unsaved)
  return { account: { name: body.name, data }, unsaved, offline: false }
}

async function push(name: string, data: UserData, keepalive = false) {
  const res = await fetch('/api/user', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data }),
    keepalive,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
}

export type SyncStatus = 'saved' | 'saving' | 'error'

const SAVE_DELAY_MS = 800

/**
 * Saves `data` to the server shortly after each change, caching it locally first
 * so nothing is lost if the tab closes or the network drops. Failed saves retry
 * with backoff; a pending save is flushed when the page is hidden.
 */
export function useCloudSync(name: string, data: UserData, startUnsaved: boolean): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(startUnsaved ? 'saving' : 'saved')
  const latest = useRef({ data, pending: startUnsaved })
  // The exact data last known to be on the server (the initial data, unless it's new).
  const saved = useRef<UserData | null>(startUnsaved ? null : data)

  useEffect(() => {
    if (data === saved.current) return
    latest.current = { data, pending: true }
    writeCache(name, data, true)
    setStatus('saving')

    let attempt = 0
    let timer: ReturnType<typeof setTimeout>
    const save = async () => {
      try {
        await push(name, data)
        saved.current = data
        if (latest.current.data === data) latest.current.pending = false
        writeCache(name, data, false)
        setStatus('saved')
      } catch {
        setStatus('error')
        attempt++
        timer = setTimeout(save, Math.min(30_000, 2_000 * 2 ** attempt))
      }
    }
    timer = setTimeout(save, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [name, data])

  useEffect(() => {
    const flush = () => {
      if (latest.current.pending) void push(name, latest.current.data, true).catch(() => {})
    }
    const onVisibility = () => document.visibilityState === 'hidden' && flush()
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [name])

  return status
}
