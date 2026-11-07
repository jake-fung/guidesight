import { useCallback, useEffect, useState } from 'react'
import { api, type Summary } from '../lib/api'
import { DEV_MODE, logout } from '../lib/auth'
import StopMap from './StopMap'

export default function Dashboard() {
  const [data, setData] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api.summary().then(setData).catch((e) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const totals = data && {
    walks: data.walks.length,
    stops: data.walks.reduce((n, w) => n + w.stops, 0),
    pulls: data.walks.reduce((n, w) => n + w.pulls, 0),
    obstacles: data.walks.reduce((n, w) => n + w.obstacles, 0),
    hotspots: data.hotspots.length,
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-xl font-bold">GuideSight · Walk Dashboard</h1>
        <div className="flex gap-2">
          <a href="/walk" className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-300">
            Start a walk
          </a>
          {DEV_MODE && (
            <button onClick={() => api.seedDemo().then(load)}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
              Load demo data
            </button>
          )}
          {!DEV_MODE && (
            <button onClick={logout} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
              Sign out
            </button>
          )}
        </div>
      </header>

      {error && <p className="m-6 rounded-lg bg-red-950 p-4 text-red-300">Couldn't load data: {error}</p>}

      {data && totals && (
        <main className="grid gap-6 p-6 lg:grid-cols-3">
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-5 lg:col-span-3">
            <Stat label="Walks" value={totals.walks} />
            <Stat label="Obstacles" value={totals.obstacles} />
            <Stat label="Dog stops" value={totals.stops} />
            <Stat label="Pulls" value={totals.pulls} />
            <Stat label="Route hotspots" value={totals.hotspots} />
          </section>

          <section className="h-[28rem] lg:col-span-2">
            <StopMap stops={data.stops} hotspots={data.hotspots} />
          </section>

          <section className="rounded-2xl bg-zinc-900 p-4">
            <h2 className="mb-3 font-semibold">Dog activity & fatigue</h2>
            {data.walks.length === 0 && <p className="text-sm text-zinc-400">No walks yet.</p>}
            <ul className="space-y-3">
              {data.walks.map((w) => (
                <li key={w.id} className="text-sm">
                  <div className="flex justify-between">
                    <span>{new Date(w.started_at).toLocaleDateString()}</span>
                    <span className="text-zinc-400">{w.minutes} min · {w.obstacles} obstacles · {w.stops} stops · {w.pulls} pulls</span>
                  </div>
                  <FatigueBar value={w.fatigue} />
                </li>
              ))}
            </ul>
          </section>
        </main>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-zinc-900 p-4">
      <div className="text-sm text-zinc-400">{label}</div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
    </div>
  )
}

function FatigueBar({ value }: { value: number | null }) {
  if (value === null) return <div className="mt-1 text-xs text-zinc-500">Fatigue: not enough data</div>
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-2 flex-1 rounded bg-zinc-800">
        <div className="h-2 rounded bg-amber-400" style={{ width: `${value * 100}%` }} />
      </div>
      <span className="w-20 text-xs text-zinc-400">fatigue {Math.round(value * 100)}%</span>
    </div>
  )
}
