import Dashboard from './components/Dashboard'
import Login from './components/Login'
import WalkerApp from './components/walker/WalkerApp'
import { useUser } from './lib/auth'

/** /walk = the walker's phone app, everything else = the caregiver dashboard. */
const IS_WALKER_APP = window.location.pathname.startsWith('/walk')

export default function App() {
  const user = useUser()
  if (user === undefined) return <div className="min-h-dvh bg-zinc-950" />
  if (!user) return <Login />
  return IS_WALKER_APP ? <WalkerApp /> : <Dashboard />
}
