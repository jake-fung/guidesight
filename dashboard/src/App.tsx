import Dashboard from './components/Dashboard'
import Login from './components/Login'
import WalkerApp from './components/walker/WalkerApp'
import { useUser } from './lib/auth'

/** /walk = the walker's phone app, everything else = the caregiver dashboard. */
const IS_WALKER_APP = window.location.pathname.startsWith('/walk')

export default function App() {
  // The walker app has its own welcome and sign-in screens (A0–A3, B1–B3).
  // TODO: connect those screens to Firebase auth; in dev mode (no Firebase config) the API needs no login.
  if (IS_WALKER_APP) return <WalkerApp />
  return <CaregiverApp />
}

function CaregiverApp() {
  const user = useUser()
  if (user === undefined) return <div className="min-h-dvh bg-zinc-950" />
  if (!user) return <Login />
  return <Dashboard />
}
