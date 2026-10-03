/**
 * A version of the app with sign-in kept each person's map in this browser under
 * `lokation.cache.<name>`, and moved the original lists there. This finds that copy
 * so returning to browser-only storage doesn't lose anything.
 */

const CACHE_PREFIX = 'lokation.cache.'
const SESSION_KEY = 'lokation.user'

export interface RecoveredCopy {
  visits?: unknown
  countries?: unknown
  hidden?: unknown
}

/**
 * The map of the person last signed in on this browser, or, failing that, the
 * only cached map here. Null if there's nothing (or more than one to choose from).
 */
export function recoverSignedInCopy(): RecoveredCopy | null {
  try {
    const parse = (key: string): RecoveredCopy | null => {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as RecoveredCopy) : null
    }
    const name = localStorage.getItem(SESSION_KEY)
    if (name) {
      const mine = parse(CACHE_PREFIX + name.toLocaleLowerCase())
      if (mine) return mine
    }
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(CACHE_PREFIX)) keys.push(key)
    }
    return keys.length === 1 ? parse(keys[0]) : null
  } catch {
    return null
  }
}
