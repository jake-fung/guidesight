/**
 * Auth0 login. Sign-in and sign-up happen on Auth0's hosted page (where passkeys can be turned on),
 * then Auth0 redirects back here. The server checks the access token (server/app/auth.py).
 */
import { Auth0Client } from '@auth0/auth0-spa-js'
import { useEffect, useState } from 'react'

const domain = import.meta.env.VITE_AUTH0_DOMAIN ?? ''
const clientId = import.meta.env.VITE_AUTH0_CLIENT_ID ?? ''
const audience = import.meta.env.VITE_AUTH0_AUDIENCE ?? ''

/** No Auth0 config -> dev mode against the mock-mode Flask server. */
export const DEV_MODE = !domain

const client = DEV_MODE
  ? null
  : new Auth0Client({
      domain,
      clientId,
      authorizationParams: { audience, redirect_uri: window.location.origin },
      // Refresh tokens in localStorage keep people signed in on Safari, which blocks the
      // cookie-based silent login. Needs Refresh Token Rotation on in the Auth0 app settings.
      useRefreshTokens: true,
      cacheLocation: 'localstorage',
    })

type AppState = { returnTo?: string }
let authError: string | null = null

/** Finishes a login redirect if this page load is one, then reports whether someone is signed in. */
async function init(c: Auth0Client): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)
  if (params.has('state') && (params.has('code') || params.has('error'))) {
    try {
      const { appState } = await c.handleRedirectCallback<AppState>()
      window.history.replaceState(null, '', appState?.returnTo ?? '/')
    } catch (e) {
      authError = e instanceof Error ? e.message : 'Sign-in failed'
      window.history.replaceState(null, '', '/')
    }
  } else {
    await c.checkSession().catch(() => {})
  }
  return c.isAuthenticated()
}

const ready: Promise<boolean> = client ? init(client) : Promise.resolve(true)

/** Access token for `Authorization: Bearer ...`. */
export async function getToken(): Promise<string> {
  if (!client) return 'dev-token'
  await ready
  const token = await client.getTokenSilently()
  if (!token) throw new Error('Not signed in')
  return token
}

/** The signed-in person's email from their Auth0 profile (null in dev mode). */
export async function getEmail(): Promise<string | null> {
  if (!client) return null
  await ready
  return (await client.getUser())?.email ?? null
}

/** Why the last sign-in failed, if it did. */
export const getAuthError = () => authError

const redirect = (screen: 'login' | 'signup') =>
  client?.loginWithRedirect<AppState>({
    appState: { returnTo: window.location.pathname },
    authorizationParams: { screen_hint: screen },
  }) ?? Promise.resolve()

export const login = () => redirect('login')
export const register = () => redirect('signup')
export const logout = () =>
  client?.logout({ logoutParams: { returnTo: window.location.origin } }) ?? Promise.resolve()

/** undefined = still loading. Dev mode is always signed in. */
export function useSignedIn(): boolean | undefined {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(DEV_MODE ? true : undefined)
  useEffect(() => {
    if (!DEV_MODE) ready.then(setSignedIn, () => setSignedIn(false))
  }, [])
  return signedIn
}
