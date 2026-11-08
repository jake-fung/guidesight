// App-wide state for the walker app: which screen is showing, the user's profile and preferences.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../lib/api'
import { useLiveLink, type LiveLink } from '../../lib/live'
import { useWalkSession, type WalkSession } from './session'
import { voice } from './voice'

/** Screen ids match the Figma frame names (A0 … D8, S = accessibility sheet). v1 = the voice setup chat (C0–C6). */
export type ScreenId =
  | 'a0' | 'a1' | 'a2' | 'a3'
  | 'v1'
  | 'b1' | 'b2' | 'c1' | 'c2' | 'c3' | 'c4'
  | 'd1' | 'd4' | 'd5' | 'd6' | 'd7' | 'd8'

export const SCREENS: ScreenId[] = ['a0', 'a1', 'a2', 'a3', 'v1', 'b1', 'b2', 'c1', 'c2', 'c3', 'c4', 'd1', 'd4', 'd5', 'd6', 'd7', 'd8']

export type Track = 'blind' | 'low-vision' | 'sighted'

export { DEMO } from './demo'

export type Prefs = {
  /** Multiplies every font size. 1 = design size. */
  textSize: number
  contrast: boolean
  readAloud: boolean
  vibration: boolean
  speechRate: number
  voice: string | null
  zoom: boolean
  voiceControl: boolean
}

export type Profile = { name: string; email: string; track: Track | null; signedIn: boolean }

const DEFAULT_PREFS: Prefs = {
  textSize: 1, contrast: false, readAloud: true, vibration: true, speechRate: 1, voice: null, zoom: false, voiceControl: false,
}
const DEFAULT_PROFILE: Profile = { name: '', email: '', track: null, signedIn: false }

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // private mode / storage full: settings just won't persist
  }
}

type Ctx = {
  screen: ScreenId
  go: (to: ScreenId) => void
  back: () => void
  sheetOpen: boolean
  setSheetOpen: (v: boolean) => void
  prefs: Prefs
  setPrefs: (p: Partial<Prefs>) => void
  profile: Profile
  setProfile: (p: Partial<Profile>) => void
  link: LiveLink
  session: WalkSession
}

const AppContext = createContext<Ctx | null>(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside <AppProvider>')
  return ctx
}

const fromHash = (): ScreenId | null => {
  const id = window.location.hash.replace(/^#\/?/, '') as ScreenId
  return SCREENS.includes(id) ? id : null
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile>(() => load('gs.profile', DEFAULT_PROFILE))
  const [prefs, setPrefsState] = useState<Prefs>(() => load('gs.prefs', DEFAULT_PREFS))
  // Returning, signed-in users land on Home; everyone else starts at "Tap anywhere".
  const [history, setHistory] = useState<ScreenId[]>(() => [fromHash() ?? (profile.signedIn ? 'd1' : 'a0')])
  const [sheetOpen, setSheetOpen] = useState(false)
  const link = useLiveLink()
  const session = useWalkSession(link)
  const screen = history[history.length - 1]

  const go = useCallback((to: ScreenId) => setHistory((h) => [...h, to]), [])
  const back = useCallback(() => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)), [])

  // Keep the URL in step so a refresh (or a link like /walk#d4) opens the same screen.
  useEffect(() => {
    if (fromHash() !== screen) window.history.replaceState(null, '', `#${screen}`)
    window.scrollTo(0, 0)
  }, [screen])
  useEffect(() => {
    const onHash = () => {
      const id = fromHash()
      if (id) setHistory((h) => (h[h.length - 1] === id ? h : [...h, id]))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const setProfile = useCallback((p: Partial<Profile>) => {
    setProfileState((cur) => {
      const next = { ...cur, ...p }
      save('gs.profile', next)
      return next
    })
  }, [])

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p }
      save('gs.prefs', next)
      return next
    })
    // Mirror the settings the server also uses (speech rate in alerts, harness buzz).
    const server: Record<string, unknown> = {}
    if (p.speechRate !== undefined) server.speech_rate = p.speechRate
    if (p.vibration !== undefined) server.haptics_enabled = p.vibration
    if (Object.keys(server).length) api.saveSettings(server).catch(() => {})
  }, [])

  useEffect(() => {
    voice.configure({ rate: prefs.speechRate, voice: prefs.voice, enabled: prefs.readAloud })
  }, [prefs.speechRate, prefs.voice, prefs.readAloud])

  const value = useMemo<Ctx>(() => ({
    screen, go, back, sheetOpen, setSheetOpen, prefs, setPrefs, profile, setProfile, link, session,
  }), [screen, go, back, sheetOpen, prefs, setPrefs, profile, setProfile, link, session])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
