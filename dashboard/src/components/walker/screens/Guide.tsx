// D4 Guiding · D5 Obstacle alert · D6 Read text · D7 Settings · D8 Trip summary
import { useEffect, useRef, useState } from 'react'
import { DEMO } from '../demo'
import { HarnessPairing } from '../Pairing'
import { icons } from '../icons'
import { errorText, grabFrame } from '../session'
import { useApp } from '../state'
import { ActionBar, Button, Chip, Gap, Hero, ListRow, Mascot, NavHeader, Screen, StatTile, Toggle, VoiceBars, cx } from '../ui'
import { useLiveTranscript } from '../transcribe'
import { buzz, spellOut, useAutoRead, useVoiceCommands, voice } from '../voice'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
/** 252 → "4 minutes and 12 seconds" */
function spokenTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (!m) return plural(sec, 'second')
  return sec ? `${plural(m, 'minute')} and ${plural(sec, 'second')}` : plural(m, 'minute')
}

function useSeconds(from: number | null, until: number | null = null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  return from ? Math.max(0, Math.round(((until ?? now) - from) / 1000)) : 0
}

/** Camera feed: the live camera when allowed, otherwise the prototype's street illustration. */
function CameraFeed({ className, demoDetection }: { className?: string; demoDetection?: boolean }) {
  const { session } = useApp()
  return (
    <div className={cx('relative min-h-[200px] flex-1 overflow-hidden rounded-[28px] bg-[#efeff3]', className)}>
      {session.hasCamera ? (
        <video ref={session.attachVideo} playsInline muted autoPlay aria-hidden className="absolute inset-0 size-full object-cover" />
      ) : (
        <img src={icons.scene} alt="" className="absolute inset-x-0 bottom-0 h-[260px] w-full object-cover object-bottom" />
      )}
      {demoDetection && !session.hasCamera && (
        <div className="absolute bottom-16 left-[63.16%] right-[10.53%] h-[58px] rounded-xl border-[2.5px] border-dashed border-black">
          <span className="t-caption absolute -top-[16.5px] left-[1.5px] whitespace-nowrap rounded-full bg-gs-ink px-2.5 py-1 text-white">Bench · 3 m</span>
        </div>
      )}
      {!session.hasCamera && !DEMO && (
        <p className="t-caption absolute left-3 top-3 rounded-full bg-white/85 px-3 py-1">Camera is off</p>
      )}
    </div>
  )
}

const GUIDE_INTRO = 'Sighty is now seeing your surroundings. Tap the screen to ask a question, then tap again to send. ' +
  'Double-tap the screen to end the walk.'
/** Two taps closer together than this are a double-tap (which ends the walk). */
const DOUBLE_TAP_MS = 320

type Ask = { phase: 'idle' } | { phase: 'recording' } | { phase: 'sending'; question: string }
  | { phase: 'answered'; question: string; answer: string }

export function D4Guiding() {
  const { go, session, link } = useApp()
  const seconds = useSeconds(session.startedAt, session.active ? null : session.endedAt)
  const { start, onAlert, obstacle } = session
  const live = useLiveTranscript()
  const [askState, setAsk] = useState<Ask>({ phase: 'idle' })
  // A failed mic goes back to idle (the card shows why).
  const ask: Ask = askState.phase === 'recording' && live.error ? { phase: 'idle' } : askState
  // Routine scene updates stay quiet during the intro and while a question is being asked or answered.
  const introPlaying = useRef(true)
  const asking = useRef(false)
  // True while Sighty says "Listening", before the mic starts (so the word isn't recorded).
  const [preparing, setPreparing] = useState(false)
  /** Bumped on cancel/end, so a mic start still waiting on "Listening" is dropped. */
  const askRun = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current) }, [])

  useEffect(() => {
    introPlaying.current = true
    void voice.say(GUIDE_INTRO, { force: true }).then(() => { introPlaying.current = false })
  }, [])

  useEffect(() => {
    start()
    // Urgent alerts always speak; routine ones wait while the person is asking something.
    onAlert((a) => {
      if (!(introPlaying.current || asking.current) || a.urgency === 'high') voice.say(a.speak, { force: true })
    })
    return () => onAlert(null)
  }, [start, onAlert])

  // An obstacle from the harness takes over the screen.
  useEffect(() => {
    if (obstacle) {
      buzz([200, 100, 200])
      go('d5')
    }
  }, [obstacle, go])

  async function startAsking() {
    const id = ++askRun.current
    asking.current = true
    buzz(30)
    setAsk({ phase: 'recording' })
    setPreparing(true)
    await voice.say('Listening', { force: true })
    if (id !== askRun.current) return // cancelled or ended while speaking
    setPreparing(false)
    live.start()
  }

  async function send() {
    buzz(40)
    const question = (await live.finish()).trim()
    if (!question) {
      setAsk({ phase: 'idle' })
      asking.current = false
      voice.say('I didn’t catch that. Tap the screen to try again.', { force: true })
      return
    }
    setAsk({ phase: 'sending', question })
    voice.say('Let me look.', { force: true })
    let answer: string
    try {
      // session.ask sends the question with the camera's current frame.
      answer = (await session.ask(question)).alert.speak
    } catch (e) {
      answer = `Sorry, I couldn’t answer that: ${errorText(e)}`
    }
    setAsk({ phase: 'answered', question, answer })
    await voice.say(answer, { force: true })
    asking.current = false
  }

  function cancel() {
    askRun.current++
    setPreparing(false)
    voice.stop()
    live.cancel()
    setAsk({ phase: 'idle' })
    asking.current = false
  }

  /** The whole screen is the tap target: one tap records, the next sends; a double-tap ends the walk. */
  function singleTap() {
    if (ask.phase === 'recording') {
      if (!preparing && !live.starting) void send()
    } else if (ask.phase !== 'sending') void startAsking()
  }

  function tap() {
    if (tapTimer.current) {
      clearTimeout(tapTimer.current)
      tapTimer.current = null
      void end()
      return
    }
    // Wait briefly to see whether a second tap follows.
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null
      singleTap()
    }, DOUBLE_TAP_MS)
  }

  useVoiceCommands(
    { 'hey sighty': () => void startAsking(), 'what is ahead': () => session.describe('manual'), 'end walk': () => end() },
    ask.phase === 'idle' || ask.phase === 'answered',
  )

  async function end() {
    askRun.current++
    buzz([40, 60, 40])
    live.cancel()
    voice.stop()
    await session.end()
    go('d8')
  }

  const narration = DEMO
    ? 'Path is clear. Keep going straight — the bench is 3 metres ahead on your right.'
    : session.lastAlert ?? session.status ?? 'Sighty describes what’s ahead every few seconds, and right away when the harness feels something.'

  // The harness sensor or the latest camera look can each make the path unsafe.
  const path = DEMO ? 'Clear'
    : obstacle || session.urgency === 'high' ? 'Stop'
    : session.urgency === 'medium' ? 'Caution'
    : 'Clear'

  return (
    <Screen>
      <div className="flex min-h-0 flex-1 cursor-pointer select-none flex-col" onClick={tap}>
        <div className="flex shrink-0 flex-col gap-0.5">
          <p className="t-overline text-gs-muted">Guiding</p>
          <h1 className="t-title-l">{DEMO ? 'Walking to the bench' : 'Guide mode'}</h1>
        </div>
        <Gap h={14} />
        <CameraFeed demoDetection={DEMO} />
        <Gap h={14} />
        <div className="flex shrink-0 gap-2.5">
          <StatTile tone="blue" label="Path" value={path} />
          {DEMO ? <StatTile tone="yellow" label="Bench" value="3 m" /> : (
            <StatTile tone="yellow" label="Harness" value={link.harnessOnline ? 'On' : 'Off'} />
          )}
          <StatTile tone="green" label="Time" value={DEMO ? '0:42' : clock(seconds)} />
        </div>
        <Gap h={14} />
        {ask.phase === 'recording' ? (
          <section className="flex shrink-0 flex-col gap-2 rounded-[22px] border-2 border-dashed border-gs-action bg-gs-surface p-4" role="status">
            <p className="t-caption flex items-center gap-2 text-gs-stop">
              <span className="size-2 rounded-full bg-gs-stop" />
              <span className="flex-1">{preparing || live.starting ? 'Starting the microphone…' : 'Listening… tap anywhere to send'}</span>
              <VoiceBars heights={[6, 12, 18, 10, 16, 8, 14, 6]} width={3} gap={3} color="bg-gs-action" active={!preparing && !live.starting} />
            </p>
            <p className={cx('t-title-m break-words', !live.text && 'text-gs-muted')}>
              {live.text || (live.live === false ? 'Speak now. Your words show up when you send.' : 'Ask me anything about what’s ahead')}
            </p>
          </section>
        ) : (
          <section className="flex shrink-0 flex-col gap-2.5 rounded-[22px] border-2 border-gs-line bg-gs-surface p-4" aria-live="polite">
            {(ask.phase === 'sending' || ask.phase === 'answered') && (
              <p className="t-body-m text-gs-muted"><span className="sr-only">You asked: </span>“{ask.question}”</p>
            )}
            <p className="t-caption flex items-center gap-2 text-gs-muted"><img src={icons.volume18Black} alt="" className="size-[18px]" />Sighty says</p>
            <p className="t-title-m" role={live.error && ask.phase === 'idle' ? 'alert' : undefined}>
              {ask.phase === 'sending' ? 'Let me look…'
                : ask.phase === 'answered' ? ask.answer
                : live.error ?? narration}
            </p>
          </section>
        )}
        <Gap h={14} />
        <div className="flex shrink-0 gap-2.5">
          {ask.phase === 'recording' ? (
            <>
              <Button variant="secondary" className="flex-1" onClick={(e) => { e.stopPropagation(); cancel() }}>Cancel</Button>
              {/* No handler: the tap reaches the screen, which sends. */}
              <Button className="flex-1">Send</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" className="flex-1" onClick={(e) => { e.stopPropagation(); void end() }}>End</Button>
              <Button className="flex-1" disabled={ask.phase === 'sending'}>{ask.phase === 'sending' ? 'Asking…' : 'Speak'}</Button>
            </>
          )}
        </div>
      </div>
    </Screen>
  )
}

export function D5Obstacle() {
  const { go, back, session, prefs } = useApp()
  const o = session.obstacle
  // The server's alert sentence when it has arrived; otherwise the harness distance.
  const metres = o?.cm ? (o.cm / 100).toFixed(1).replace(/\.0$/, '') : null
  const what = DEMO ? 'Pole 0.5 m ahead, slightly to your left.' : o?.speak ?? (metres ? `Something ${metres} m ahead.` : 'Something is close ahead.')
  const tip = DEMO ? 'Step to the right to pass.' : 'Wait until it’s clear.'
  useAutoRead(`Stop. ${what} ${tip}`)

  useEffect(() => {
    if (!prefs.vibration) return
    const t = setInterval(() => buzz([200, 100, 200]), 1500)
    return () => clearInterval(t)
  }, [prefs.vibration])

  function clear() {
    session.clearObstacle()
    if (session.active) back()
    else go('d4')
  }

  useVoiceCommands({ clear: clear })

  return (
    <Screen bg="bg-gs-yellow">
      <div className="flex shrink-0 items-center justify-between">
        <p className="t-overline rounded-full bg-gs-ink px-3.5 py-2 text-white">Obstacle</p>
        {prefs.vibration && <p className="t-label-m flex items-center gap-1.5"><img src={icons.vibrate} alt="" className="size-5" />Vibrating</p>}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Mascot mood="Alert" size={324} className="max-h-full max-w-full" />
      </div>
      <h1 className="t-display-stop text-center" role="alert">Stop.</h1>
      <Gap h={8} />
      <p className="t-title-l text-center">{what}</p>
      <Gap h={8} />
      <p className="t-body-l text-center">{tip}</p>
      <Gap h={28} />
      <Button onClick={clear}>I’m clear</Button>
    </Screen>
  )
}

export function D6ReadText() {
  const { back, session } = useApp()
  const [shot, setShot] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement | null>(null)
  const { requestMedia, hasCamera } = session

  useEffect(() => {
    if (!hasCamera && !DEMO) requestMedia({ video: true })
  }, [hasCamera, requestMedia])

  async function read() {
    setBusy(true)
    setText(null)
    const canvas = grabFrame(video.current)
    setShot(canvas?.toDataURL('image/jpeg', 0.7) ?? null)
    try {
      const res = await session.ask('Read any text you can see, word for word. Then add one short helpful note.')
      setText(res.alert.speak)
      voice.say(`It says: ${res.alert.speak}`, { force: true })
    } catch (e) {
      setText(`Couldn’t read that: ${errorText(e)}`)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (DEMO) read()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Screen>
      <NavHeader title="Read text" onBack={back} />
      <Gap h={20} />
      <div className="relative flex min-h-[200px] flex-1 items-center justify-center overflow-hidden rounded-[24px] border-2 border-gs-line bg-gs-tint">
        {shot ? <img src={shot} alt="" className="absolute inset-0 size-full object-cover" />
          : session.hasCamera ? (
            <video ref={(el) => { video.current = el; session.attachVideo(el) }} playsInline muted autoPlay aria-hidden className="absolute inset-0 size-full object-cover" />
          ) : null}
        {DEMO && (
          <div className="relative flex flex-col items-center gap-0.5 rounded-[10px] bg-gs-ink px-[22px] py-3 text-white">
            <span className="t-label-l">BUS STOP 14</span>
            <span className="t-caption">DOWNTOWN via MAIN ST</span>
          </div>
        )}
      </div>
      <Gap h={24} />
      <p className="t-overline text-gs-muted">It says</p>
      <Gap h={8} />
      <p className={cx(text && text.length > 90 ? 't-title-l' : 't-display-l')} aria-live="polite">
        {busy ? 'Reading…' : text ?? 'Point the camera at a sign, a menu or a letter, then tap Read.'}
      </p>
      <Gap h={18} />
      {text && (
        <div className="flex gap-2">
          <Chip onClick={() => voice.replay()}>Replay</Chip>
          <Chip onClick={() => voice.slower()}>Slower</Chip>
          <Chip onClick={() => voice.say(spellOut(text.replace(/[^\w\s]/g, '').split(/\s+/).slice(0, 4).join(' ')), { force: true })}>Spell it</Chip>
        </div>
      )}
      <Gap h={18} />
      <Button onClick={() => { setShot(null); read() }} disabled={busy}>{text ? 'Read something else' : 'Read'}</Button>
    </Screen>
  )
}

const TEXT_SIZES = [
  { v: 0.9, label: 'Small' }, { v: 1, label: 'Default' }, { v: 1.15, label: 'Large' }, { v: 1.3, label: 'Extra large' },
]

export function D7Settings() {
  const { back, go, prefs, setPrefs, profile, setProfile } = useApp()
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith('en')) ?? [])
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])
  const sizeIndex = Math.max(0, TEXT_SIZES.findIndex((s) => s.v >= prefs.textSize))
  const language = new Intl.DisplayNames([navigator.language], { type: 'language' }).of(navigator.language) ?? 'English'

  /** Forgets the name, email and setup on this phone, then starts setup again. */
  function startOver() {
    setProfile({ name: '', email: '', track: null, signedIn: false })
    go('a0')
  }

  return (
    <Screen>
      <NavHeader title="Settings" onBack={back} />
      <Gap h={6} />
      <h1 className="t-display-l">Make it yours</h1>

      <SectionLabel>Seeing</SectionLabel>
      <Card>
        <SliderRow label="Text size" value={TEXT_SIZES[sizeIndex].label} min={0} max={TEXT_SIZES.length - 1} step={1} current={sizeIndex}
          onChange={(i) => setPrefs({ textSize: TEXT_SIZES[i].v })} />
        <ToggleRow label="High contrast" on={prefs.contrast} onChange={(v) => setPrefs({ contrast: v })} />
      </Card>

      <SectionLabel>Hearing &amp; feeling</SectionLabel>
      <Card>
        <SliderRow label="Speech speed" value={`${prefs.speechRate.toFixed(1)}×`} min={0.6} max={2} step={0.1} current={prefs.speechRate}
          onChange={(v) => setPrefs({ speechRate: Math.round(v * 10) / 10 })} onCommit={() => voice.say('This is how fast I talk.', { force: true })} />
        <ToggleRow label="Vibration alerts" on={prefs.vibration} onChange={(v) => setPrefs({ vibration: v })} />
      </Card>

      <SectionLabel>Voice</SectionLabel>
      <Card>
        <label className="relative flex min-h-12 items-center gap-2 px-4 py-3">
          <span className="t-label-l flex-1">Sighty’s voice</span>
          <span className="t-label-l text-gs-muted">{prefs.voice?.split(/[\s(]/)[0] ?? 'Default'}</span>
          <img src={icons.chevRight} alt="" className="size-[18px]" />
          <select aria-label="Sighty’s voice" value={prefs.voice ?? ''} className="absolute inset-0 opacity-0"
            onChange={(e) => { setPrefs({ voice: e.target.value || null }); setTimeout(() => voice.say('Hi, I’m Sighty.', { force: true }), 50) }}>
            <option value="">Default</option>
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </label>
        <div className="flex min-h-12 items-center gap-2 border-t-2 border-gs-line px-4 py-3">
          <span className="t-label-l flex-1">Language</span>
          <span className="t-label-l text-gs-muted">{language}</span>
        </div>
      </Card>

      <SectionLabel>Sensor</SectionLabel>
      <Card><div className="p-4"><HarnessPairing /></div></Card>

      <SectionLabel>Account</SectionLabel>
      <Card>
        <div className="flex items-center gap-3 px-4 py-3">
          <img src={icons.user22} alt="" className="size-[22px]" />
          <div className="min-w-0 flex-1">
            <p className="t-label-l">{profile.name || 'Guest'}</p>
            {profile.email && <p className="t-label-m truncate font-normal text-gs-muted">{profile.email}</p>}
          </div>
          <button type="button" onClick={startOver} className="t-label-m">Start over</button>
        </div>
      </Card>
    </Screen>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h2 className="t-overline flex h-8 shrink-0 items-center px-1 text-gs-muted">{children}</h2>
)
const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="shrink-0 overflow-hidden rounded-[22px] border-2 border-gs-line bg-gs-surface">{children}</div>
)

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 border-t-2 border-gs-line px-4 py-3">
      <span className="t-label-l flex-1">{label}</span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  )
}

function SliderRow({ label, value, min, max, step, current, onChange, onCommit }: {
  label: string; value: string; min: number; max: number; step: number; current: number; onChange: (v: number) => void; onCommit?: () => void
}) {
  const pct = ((current - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-2.5 px-4 pb-3.5 pt-3.5">
      <div className="flex items-baseline justify-between">
        <span className="t-label-l">{label}</span>
        <span className="t-label-m font-medium text-gs-muted">{value}</span>
      </div>
      <input type="range" aria-label={label} aria-valuetext={value} min={min} max={max} step={step} value={current}
        onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit}
        className="gs-range h-7 w-full cursor-pointer appearance-none bg-transparent"
        style={{ ['--pct' as string]: `${pct}%` }} />
    </div>
  )
}

export function D8Summary() {
  const { go, session } = useApp()
  const [saveRoute, setSaveRoute] = useState(false)
  const [daily, setDaily] = useState(false)
  const seconds = DEMO ? 252 : session.startedAt && session.endedAt ? Math.round((session.endedAt - session.startedAt) / 1000) : 0
  const alerts = DEMO ? 1 : session.alerts
  const walked = DEMO ? 180 : Math.round(session.walked)
  const spotted = DEMO ? ['Crosswalk', 'Bus stop 14', 'Pole', 'Bench'] : session.spotted
  const title = DEMO ? 'You made it to the bench!' : 'Nice walk!'

  // Always spoken (like Guide mode), so the summary works without looking.
  const summary = `${title} You walked for ${spokenTime(seconds)}, covered ${plural(walked, 'metre')}, ` +
    `and had ${alerts ? plural(alerts, 'alert') : 'no alerts'}. ` +
    `${spotted.length ? `Sighty spotted ${spotted.join(', ')}. ` : ''}Tap the screen to go back home.`
  useEffect(() => {
    void voice.say(summary, { force: true })
    return () => voice.stop()
  }, [summary])

  function home() {
    buzz(40)
    go('d1')
  }

  return (
    <Screen>
      {/* The whole screen is one tap target that goes home; the route toggles keep their own taps. */}
      <div className="flex min-h-0 flex-1 cursor-pointer select-none flex-col" onClick={home}>
        <Hero tone="yellow" radius={32} className="max-h-[200px] min-h-[150px]"><Mascot size={144} /></Hero>
        <Gap h={16} />
        <h1 className="t-display-l text-center">{title}</h1>
        <Gap h={14} />
        {spotted.length > 0 && (
          <>
            <section className="flex shrink-0 flex-col items-center gap-2.5 rounded-[20px] bg-gs-pink p-3">
              <h2 className="t-overline text-tile-pink-fg normal-case tracking-normal">Sighty spotted</h2>
              <ul className="flex flex-wrap justify-center gap-1.5">
                {spotted.map((s) => <li key={s} className="t-label-m rounded-full bg-white px-3 py-1.5">{s}</li>)}
              </ul>
            </section>
            <Gap h={10} />
          </>
        )}
        <div className="flex shrink-0 gap-2.5">
          <StatTile tone="blue" label="Time" value={clock(seconds)} />
          <StatTile tone="yellow" label="Alerts" value={String(alerts)} />
          <StatTile tone="green" label="Walked" value={`${walked} m`} />
        </div>
        <Gap h={10} />
        {/* TODO(server): saved routes and reminders aren't stored yet; these only toggle locally. */}
        <div className="flex shrink-0 cursor-auto flex-col gap-2" onClick={(e) => e.stopPropagation()}>
          <ListRow title="Save this route?" subtitle="Walk it again any time." done={saveRoute} onAction={() => setSaveRoute((v) => !v)} />
          <ListRow title="Turn on daily walks?" subtitle="Sighty reminds you at 9 am." done={daily} onAction={() => setDaily((v) => !v)} />
        </div>
        <div className="min-h-2 flex-1" />
      </div>
      <ActionBar label="Done" onClose={home} onPrimary={home} />
    </Screen>
  )
}
