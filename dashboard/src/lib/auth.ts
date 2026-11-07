import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { useEffect, useState } from 'react'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
}

/** No Firebase config -> dev mode against the mock-mode Flask server. */
export const DEV_MODE = !config.apiKey
const auth = DEV_MODE ? null : getAuth(initializeApp(config))

/** Firebase ID token for `Authorization: Bearer ...`. The Flask server verifies it. */
export async function getIdToken() {
  if (!auth) return 'dev-token'
  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('Not signed in')
  return token
}

export const login = (email: string, password: string) =>
  auth ? signInWithEmailAndPassword(auth, email, password) : Promise.resolve()
export const register = (email: string, password: string) =>
  auth ? createUserWithEmailAndPassword(auth, email, password) : Promise.resolve()
export const logout = () => (auth ? signOut(auth) : Promise.resolve())

/** undefined = still loading, null = signed out. Dev mode is always "signed in". */
export function useUser(): User | null | undefined | 'dev' {
  const [user, setUser] = useState<User | null | undefined>(auth ? undefined : null)
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), [])
  return DEV_MODE ? 'dev' : user
}
