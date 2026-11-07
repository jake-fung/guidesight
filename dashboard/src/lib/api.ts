import { getIdToken } from './auth'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5001'

export type StopPoint = { walk_id: string; type: 'stop' | 'pull'; at: string; lat: number; lng: number }
export type Hotspot = { lat: number; lng: number; count: number }
export type WalkStat = {
  id: string
  started_at: string
  minutes: number
  stops: number
  pulls: number
  fatigue: number | null
}
export type Summary = { walks: WalkStat[]; stops: StopPoint[]; hotspots: Hotspot[] }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}/api${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await getIdToken()}`, ...init.headers },
  })
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`)
  return res.json()
}

export const api = {
  summary: () => request<Summary>('/dashboard/summary'),
  /** Mock-mode server only: generates demo walks. */
  seedDemo: () => request('/dev/seed', { method: 'POST' }),
}
