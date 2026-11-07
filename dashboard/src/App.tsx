import Dashboard from './components/Dashboard'
import Login from './components/Login'
import { useUser } from './lib/auth'

export default function App() {
  const user = useUser()
  if (user === undefined) return <div className="min-h-screen bg-zinc-950" />
  return user ? <Dashboard /> : <Login />
}
