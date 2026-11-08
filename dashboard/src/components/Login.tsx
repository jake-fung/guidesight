import { useState } from 'react'
import { getAuthError, login, register } from '../lib/auth'

export default function Login() {
  const [error, setError] = useState(getAuthError)
  const [busy, setBusy] = useState(false)

  async function go(action: typeof login) {
    setBusy(true)
    setError(null)
    try {
      await action() // leaves the page for Auth0's sign-in page
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-zinc-950 px-4 text-zinc-100">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-zinc-900 p-8">
        <h1 className="text-3xl font-bold">GuideSight</h1>
        <p className="text-lg text-zinc-300">Sign in or create an account to start walking with Sighty.</p>
        {error && <p className="text-red-400" role="alert">{error}</p>}
        <button type="button" disabled={busy} onClick={() => go(login)}
          className="min-h-14 w-full rounded-xl bg-amber-400 text-xl font-bold text-zinc-950 hover:bg-amber-300 disabled:opacity-50">
          Sign in
        </button>
        <button type="button" disabled={busy} onClick={() => go(register)}
          className="min-h-14 w-full rounded-xl bg-zinc-800 text-xl font-bold hover:bg-zinc-700 disabled:opacity-50">
          Create account
        </button>
      </div>
    </main>
  )
}
