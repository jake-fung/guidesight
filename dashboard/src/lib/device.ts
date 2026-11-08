/**
 * There's no login: each phone or browser makes a random id the first time it opens the app and
 * sends it as `Authorization: Bearer <id>`. The server treats that id as the user (server/app/auth.py).
 * Clearing the site's data starts over as a new user.
 */
const KEY = 'gs.device'

function newId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  // Older browsers (and plain-http pages, where randomUUID is missing): 16 random bytes as hex.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
}

let id: string | null = null

/** This device's id, made on first use. Kept in memory too, in case storage is blocked. */
export function deviceId(): string {
  if (id) return id
  try {
    id = localStorage.getItem(KEY)
    if (!id) {
      id = newId()
      localStorage.setItem(KEY, id)
    }
  } catch {
    id ??= newId() // private mode / storage blocked: a fresh user for this visit
  }
  return id
}

/** Token for `Authorization: Bearer ...` and the live socket. */
export const getToken = async () => deviceId()
