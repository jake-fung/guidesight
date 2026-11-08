// D1 Home · S Accessibility Shortcut sheet
import { useEffect, useRef, useState } from 'react'
import { icons } from '../icons'
import { useApp } from '../state'
import { Button, Gap, Hero, Mascot, Screen, Toggle, cx, type HeroTone, type Mood } from '../ui'
import { buzz, useVoiceCommands, voice } from '../voice'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/**
 * Home, built for people who can't see the screen (like Guide mode): Sighty speaks the choices as the
 * screen opens, the two choices fill the screen so they're easy to hit, and voice commands work too.
 */
export function D1Home() {
  const { go, profile, session } = useApp()
  const [finding, setFinding] = useState(false)
  const hello = `${greeting()}${profile.name ? `, ${profile.name}` : ''}`

  // Always spoken, even with read-aloud off, so the screen can be used without looking.
  useEffect(() => {
    void voice.say(
      `${hello}. Tap the top half of the screen to go somewhere, or the bottom half to read text. ` +
      'You can also say guide me, read text, where am I, or settings.',
      { force: true },
    )
    return () => voice.stop()
  }, [hello])

  function open(to: 'd2' | 'd6' | 'd7') {
    buzz(40)
    voice.stop()
    go(to)
  }

  async function tellWhere() {
    if (finding) return
    buzz(40)
    setFinding(true)
    voice.stop()
    const text = await session.whereAmI()
    setFinding(false)
    void voice.say(text, { force: true })
  }

  useVoiceCommands({
    'guide me': () => open('d2'), 'take me': () => open('d2'), 'read text': () => open('d6'), settings: () => open('d7'),
    'where am i': () => void tellWhere(),
  })

  return (
    <Screen className="h-dvh">
      <h1 className="t-title-l shrink-0">{hello}</h1>
      <Gap h={14} />
      <BigChoice tone="green" mood="Happy" title="Guide me" sub="Say where, Sighty takes you there" onClick={() => open('d2')} />
      <Gap h={12} />
      <BigChoice tone="yellow" mood="Listening" title="Read text" sub="Signs, labels and letters" onClick={() => open('d6')} />
      <Gap h={14} />
      <div className="flex shrink-0 gap-3">
        <Button variant="secondary" className="flex-1" onClick={() => void tellWhere()} aria-busy={finding}>
          {finding ? 'Finding you…' : 'Where am I?'}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => open('d7')}>
          <img src={icons.sliders} alt="" className="size-[22px]" />Settings
        </Button>
      </div>
    </Screen>
  )
}

/** One of the two big Home choices: fills half the screen so it's easy to find by touch. */
function BigChoice({ tone, mood, title, sub, onClick }: { tone: HeroTone; mood: Mood; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-0 flex-1 select-none flex-col active:opacity-85">
      <Hero tone={tone} radius={32} className="w-full">
        <Mascot mood={mood} size={120} />
        <span className="t-display-l mt-3">{title}</span>
        <span className="t-body-l mt-1">{sub}</span>
      </Hero>
    </button>
  )
}

export function A11ySheet() {
  const { sheetOpen, setSheetOpen, prefs, setPrefs } = useApp()
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sheetOpen) return
    sheet.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSheetOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen, setSheetOpen])
  if (!sheetOpen) return null

  const rows: { label: string; sub?: string; on: boolean; set: (v: boolean) => void }[] = [
    { label: 'Read screen aloud', sub: 'Like VoiceOver — Sighty reads everything', on: prefs.readAloud, set: (v) => setPrefs({ readAloud: v }) },
    { label: 'Larger text', on: prefs.textSize > 1, set: (v) => setPrefs({ textSize: v ? 1.15 : 1 }) },
    { label: 'Increase contrast', on: prefs.contrast, set: (v) => setPrefs({ contrast: v }) },
    { label: 'Zoom', on: prefs.zoom, set: (v) => setPrefs({ zoom: v }) },
    { label: 'Voice control', sub: 'Say “tap Continue”', on: prefs.voiceControl, set: (v) => setPrefs({ voiceControl: v }) },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setSheetOpen(false)}>
      <div ref={sheet} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="a11y-title" onClick={(e) => e.stopPropagation()}
        className="gs-sheet-in w-full max-w-[430px] rounded-t-[28px] bg-gs-surface px-5 pt-2.5 outline-none"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        <span aria-hidden className="mx-auto block h-[5px] w-10 rounded-full bg-gs-line" />
        <Gap h={14} />
        <h2 id="a11y-title" className="t-title-m flex items-center justify-center gap-2.5">
          <img src={icons.a11yBlue} alt="" className="size-[26px]" />Accessibility Shortcut
        </h2>
        <Gap h={14} />
        <p className="t-body-m text-center text-gs-muted">
          Same as iPhone: triple-click the side button, or tap the accessibility button at the top of any screen.
        </p>
        <Gap h={14} />
        <div className="overflow-hidden rounded-2xl bg-gs-tint">
          {rows.map((r, i) => (
            <div key={r.label} className={cx('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-gs-line')}>
              <div className="min-w-0 flex-1">
                <p className="t-label-l">{r.label}</p>
                {r.sub && <p className="t-caption text-gs-muted">{r.sub}</p>}
              </div>
              <Toggle on={r.on} onChange={r.set} label={r.label} />
            </div>
          ))}
        </div>
        <Gap h={14} />
        <Button onClick={() => setSheetOpen(false)}>Done</Button>
      </div>
    </div>
  )
}
