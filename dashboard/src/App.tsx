import { useEffect, useState } from 'react'
import Login from './components/Login'
import Onboarding from './components/onboarding/Onboarding'
import WalkerApp from './components/walker/WalkerApp'
import { api, type Me } from './lib/api'
import { useSignedIn } from './lib/auth'

const blank = <div className="min-h-dvh bg-zinc-950" />

export default function App() {
  const signedIn = useSignedIn()
  if (signedIn === undefined) return blank
  if (!signedIn) return <Login />
  return <SignedIn />
}

/** New accounts go through setup first (the server says which step is next), then the walk app. */
function SignedIn() {
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.me().then(setMe, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-zinc-950 p-6 text-center text-xl text-white">
        <p role="alert">Can't reach GuideSight: {error}</p>
      </main>
    )
  }
  if (!me) return blank
  return me.next_step ? <Onboarding me={me} onChange={setMe} /> : <WalkerApp />
}
