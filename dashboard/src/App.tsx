import Dashboard from './components/Dashboard'
import Login from './components/Login'
import WalkerApp from './components/walker/WalkerApp'
import { useSignedIn } from './lib/auth'

export default function App() {
  const signedIn = useSignedIn()
  if (signedIn === undefined) return <div className="min-h-dvh bg-zinc-950" />
  if (!signedIn) return <Login />
  // /walk = the walker's phone app, everything else = the caregiver dashboard.
  // Read on render: returning from Auth0 restores the path after this module loads.
  return window.location.pathname.startsWith('/walk') ? <WalkerApp /> : <Dashboard />
}
