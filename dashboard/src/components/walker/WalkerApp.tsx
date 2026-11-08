// Phone app for the walker (/walk). Screens follow the Figma file "GuideSight — Mobile Web Prototype":
//   A0–A3 start and sign in · V1–V7 voice setup (blind) · B1–C4 visual setup (low vision / sighted)
//   D1–D8 the app itself · S accessibility shortcut sheet.
import type { ComponentType } from 'react'
import { A11ySheet, D1Home, D2Listening, D3Answer } from './screens/Home'
import { D4Guiding, D5Obstacle, D6ReadText, D7Settings, D8Summary } from './screens/Guide'
import { B1Name, B2Email, B3Code, C1Camera, C2Mic, C3Sensor, C4AllSet } from './screens/Register'
import { A0Tap, A1HowMuch, A2SignInEmail, A3SignInCode } from './screens/Start'
import { V1Mic, V2Name, V3Email, V4Code, V5Camera, V6Sensor, V7AllSet } from './screens/VoiceSetup'
import { AppProvider, useApp, type ScreenId } from './state'
import { useListen } from './voice'

const SCREENS: Record<ScreenId, ComponentType> = {
  a0: A0Tap, a1: A1HowMuch, a2: A2SignInEmail, a3: A3SignInCode,
  v1: V1Mic, v2: V2Name, v3: V3Email, v4: V4Code, v5: V5Camera, v6: V6Sensor, v7: V7AllSet,
  b1: B1Name, b2: B2Email, b3: B3Code, c1: C1Camera, c2: C2Mic, c3: C3Sensor, c4: C4AllSet,
  d1: D1Home, d2: D2Listening, d3: D3Answer, d4: D4Guiding, d5: D5Obstacle, d6: D6ReadText, d7: D7Settings, d8: D8Summary,
}

export default function WalkerApp() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}

function Shell() {
  const { screen, prefs } = useApp()
  const Screen = SCREENS[screen]
  useVoiceControl(prefs.voiceControl)
  return (
    <div
      className={`gs-app min-h-dvh ${prefs.contrast ? 'gs-contrast' : ''}`}
      style={{ ['--gs-text' as string]: prefs.textSize, zoom: prefs.zoom ? 1.25 : undefined }}
    >
      <Screen key={screen} />
      <A11ySheet />
    </div>
  )
}

/** "Voice control" setting: say "tap Continue" to press the button labelled Continue. */
function useVoiceControl(on: boolean) {
  useListen(on, (text) => {
    const m = text.toLowerCase().match(/^(?:tap|press|click)\s+(.+)$/)
    if (!m) return
    const target = m[1].trim()
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="switch"]'))
    const name = (el: HTMLElement) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().toLowerCase()
    const hit = buttons.find((b) => name(b) === target) ?? buttons.find((b) => name(b).includes(target))
    hit?.click()
  })
}
