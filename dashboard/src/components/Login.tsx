import { useState, type FormEvent } from 'react'
import { login } from '../lib/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-4 text-zinc-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-zinc-900 p-8">
        <h1 className="text-2xl font-bold">GuideSight</h1>
        <p className="text-sm text-zinc-400">Sign in to review your walks.</p>
        <input className="w-full rounded-lg bg-zinc-800 px-4 py-3" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded-lg bg-zinc-800 px-4 py-3" type="password" placeholder="Password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="w-full rounded-lg bg-amber-400 py-3 font-semibold text-zinc-950 hover:bg-amber-300">
          Sign in
        </button>
      </form>
    </main>
  )
}
