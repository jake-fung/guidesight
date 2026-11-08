// Track 1 — Conversational setup (Figma "C0 … C6 Chat"). Starts right after A0.
// Sighty asks one question at a time out loud. Tap the screen to record, tap again to confirm;
// double-tap while recording to say it again. Words show up live while you talk.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { icons } from '../icons'
import { useApp, type Track } from '../state'
import { Gap, Mascot, Screen, VoiceBars, cx } from '../ui'
import { useLiveTranscript } from '../transcribe'
import { buzz, firstWord, spellEmail, spellOut, spokenToEmail, useVoiceCommands, voice } from '../voice'

type Turn = 'mic' | 'how' | 'name' | 'email' | 'camera' | 'sensor' | 'done'
const STEP: Record<Turn, number> = { mic: 1, how: 2, name: 3, email: 4, camera: 5, sensor: 6, done: 6 }
const STEPS = 6

const TAP_TO_ANSWER = 'Tap the screen to record, then tap again to confirm.'
const TAP_TO_ALLOW = 'Tap the screen, then tap Allow.'
const HOW = 'How much can you see? Say “I’m blind”, “low vision”, or “I can see”.'
const NAME = 'What should I call you?'
const EMAIL = 'What’s your email? Just say it normally.'
/** Two taps closer together than this are a double-tap. */
const DOUBLE_TAP_MS = 320

type Line = { text: string; spoken: string }
type Entry = { id: number; who: 'sighty' | 'you' | 'done'; text: string }

/** What a turn says. `before` is said first, e.g. Sighty reading back the last answer. */
function lineFor(turn: Turn, before = ''): Line {
  const t = (text: string, tail: string) => ({ text: `${before}${text}`, spoken: `${before}${text} ${tail}`.trim() })
  switch (turn) {
    case 'mic': return t('Hi, I’m Sighty! Let’s set things up by chatting. First, I need your microphone.', TAP_TO_ALLOW)
    case 'how': return t(HOW, TAP_TO_ANSWER)
    case 'name': return t(NAME, TAP_TO_ANSWER)
    case 'email': return t(EMAIL, TAP_TO_ANSWER)
    case 'camera': return t('Last permission: can I use your camera to see what’s ahead of you?', TAP_TO_ALLOW)
    case 'sensor': return t('Now switch on your GuideSight sensor and hold it near your phone.', 'Say “skip” to set it up later.')
    case 'done': return t('', '')
  }
}

function trackFrom(text: string): Track | null {
  const t = text.toLowerCase()
  if (/low[\s-]?vision|partial|some vision|a little/.test(t)) return 'low-vision'
  if (/\bblind\b|can'?t see|cannot see/.test(t)) return 'blind'
  if (/can see|sighted|see fine|see well|i see/.test(t)) return 'sighted'
  return null
}
const nameFrom = (text: string) => firstWord(text.replace(/\b(my name is|i'm|i am|call me|it's|it is)\b/gi, ''))
const emailFrom = (text: string) => {
  const e = spokenToEmail(text.replace(/^(my email is|it's|it is)\s+/i, '')).replace(/[.,!?]+$/, '')
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : ''
}
const TRACK_SAID: Record<Track, string> = { blind: 'I’m blind', 'low-vision': 'Low vision', sighted: 'I can see' }

export function VoiceChat() {
  const { go, profile, setProfile, setPrefs, session, link } = useApp()
  const [turn, setTurn] = useState<Turn>('mic')
  const [line, setLine] = useState<Line>(() => lineFor('mic'))
  const [history, setHistory] = useState<Entry[]>([])
  const [phaseState, setPhase] = useState<'ask' | 'record' | 'saving'>('ask')
  const [count, setCount] = useState(3)
  const live = useLiveTranscript()
  const phase = phaseState === 'record' && live.error ? 'ask' : phaseState
  const nextId = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordingSince = useRef(0)

  // Say each new line; stop talking when the screen closes.
  useEffect(() => {
    if (line.spoken) voice.say(line.spoken, { force: true }) // voice setup always talks
  }, [line])
  useEffect(() => () => {
    voice.stop()
    if (tapTimer.current) clearTimeout(tapTimer.current)
  }, [])

  const log = useCallback((...entries: Omit<Entry, 'id'>[]) => {
    setHistory((h) => [...h, ...entries.map((e) => ({ ...e, id: nextId.current++ }))])
  }, [])

  /** Moves to `to`, filing the current question (and the answer to it) into the history above. */
  const advance = useCallback((to: Turn, answer: Omit<Entry, 'id'>[], before = '') => {
    log({ who: 'sighty', text: line.text }, ...answer)
    setTurn(to)
    setPhase('ask')
    setLine(lineFor(to, before))
  }, [line.text, log])

  /** Same turn again, with Sighty explaining what went wrong. */
  const retry = useCallback((why: string, question: string) => {
    setPhase('ask')
    setLine({ text: `${why} ${question}`, spoken: `${why} ${question} ${TAP_TO_ANSWER}` })
  }, [])

  // ---- Permission turns (mic, camera) -------------------------------------------------------------
  async function allow(kind: 'audio' | 'video') {
    voice.stop()
    const ok = await session.requestMedia(kind === 'video' ? { video: true } : { audio: true })
    if (!ok) {
      setLine({
        text: 'I couldn’t get permission. Check your browser settings, then tap to try again.',
        spoken: 'I couldn’t get permission. Check your browser settings, then tap the screen to try again.',
      })
      return
    }
    buzz(60)
    if (kind === 'audio') advance('how', [{ who: 'done', text: 'Microphone on' }])
    else advance('sensor', [{ who: 'done', text: 'Camera on' }])
  }

  // ---- Answer turns (how, name, email) ------------------------------------------------------------
  async function confirm() {
    setPhase('saving')
    buzz(40)
    const heard = (await live.finish()).trim()
    const question = turn === 'how' ? HOW : turn === 'name' ? NAME : EMAIL
    if (!heard) return retry('I didn’t hear anything.', question)

    if (turn === 'how') {
      const track = trackFrom(heard)
      if (!track) return retry(`I heard “${heard}”, but I’m not sure what you meant.`, question)
      setProfile({ track })
      if (track !== 'blind') {
        // Low vision and sighted people finish setup on screen.
        setPrefs(track === 'low-vision' ? { readAloud: true, textSize: 1.15 } : { readAloud: false })
        voice.stop()
        go('b1')
        return
      }
      setPrefs({ readAloud: true })
      advance('name', [{ who: 'you', text: TRACK_SAID[track] }], 'Got it — I’ll guide you by voice. ')
    } else if (turn === 'name') {
      const name = nameFrom(heard)
      if (!name) return retry('I didn’t catch your name.', question)
      setProfile({ name })
      advance('email', [{ who: 'you', text: name }], `${name}, ${spellOut(name)}. Nice to meet you, ${name}! `)
    } else if (turn === 'email') {
      const email = emailFrom(heard)
      if (!email) return retry(`I heard “${heard}”, which isn’t an email.`, `${question} For example, “donna at u b c dot c a”.`)
      // No email code yet: the server doesn't send real codes, so the account counts as ready here.
      setProfile({ email, signedIn: true })
      advance('camera', [{ who: 'you', text: email }], `Got it: ${spellEmail(email)}. Thanks! `)
    }
  }

  function startRecording() {
    voice.stop()
    buzz(30)
    recordingSince.current = Date.now()
    setPhase('record')
    live.start()
  }

  // If the mic fails mid-answer, say why; the screen goes back to "tap to answer".
  useEffect(() => {
    if (live.error) voice.say(live.error, { force: true })
  }, [live.error])

  function tap() {
    if (turn === 'mic') return void allow('audio')
    if (turn === 'camera') return void allow('video')
    if (turn !== 'how' && turn !== 'name' && turn !== 'email') return
    if (phase === 'ask') return startRecording()
    if (phase !== 'record') return
    // Ignore the tail of the tap that started recording (a quick double-tap on "answer").
    if (Date.now() - recordingSince.current < DOUBLE_TAP_MS) return
    if (tapTimer.current) {
      // Double-tap: throw this answer away and listen again.
      clearTimeout(tapTimer.current)
      tapTimer.current = null
      buzz([30, 60, 30])
      recordingSince.current = Date.now()
      live.start()
      return
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null
      void confirm()
    }, DOUBLE_TAP_MS)
  }

  // ---- Sensor and finish ------------------------------------------------------------------------------
  const finish = useCallback((found: boolean) => {
    const name = profile.name ? `, ${profile.name}` : ''
    const text = `${found ? 'Found it! ' : ''}You’re all set${name}. Say “Hey Sighty” any time.`
    log({ who: 'sighty', text: lineFor('sensor').text }, ...(found ? [{ who: 'done' as const, text: 'Sensor connected' }] : []))
    setTurn('done')
    setLine({ text, spoken: `${text} Hold your phone at chest height. Starting guide mode.` })
  }, [log, profile.name])

  useVoiceCommands({ skip: () => finish(false), repeat: () => voice.replay() }, turn === 'sensor')
  useEffect(() => {
    if (turn === 'sensor' && link.harnessOnline) {
      buzz(80)
      finish(true)
    }
  }, [turn, link.harnessOnline, finish])

  useEffect(() => {
    if (turn !== 'done') return
    if (count <= 0) return go('d4')
    // Count down slower while Sighty is still talking.
    const t = setTimeout(() => setCount((c) => c - 1), voice.get().status === 'speaking' ? 2000 : 1000)
    return () => clearTimeout(t)
  }, [turn, count, go])

  // ---- Layout -----------------------------------------------------------------------------------------
  const answering = turn === 'how' || turn === 'name' || turn === 'email'
  const recording = answering && phase !== 'ask'
  return (
    // Fixed to the viewport height so the chat history scrolls instead of pushing the page past the screen.
    <Screen className="h-dvh">
      <ChatHeader step={turn === 'done' ? 'done' : STEP[turn]} onType={() => { voice.stop(); go('b1') }} />
      {/* The whole area below the header is one tap target; the big button is its visible, focusable part. */}
      <div className="flex min-h-0 flex-1 cursor-pointer select-none flex-col" onClick={tap}>
        <History entries={history} />
        <Gap h={12} />
        <div className="flex shrink-0 justify-center"><Mascot mood={recording ? 'Listening' : 'Happy'} size={recording ? 72 : 96} /></div>
        <Gap h={10} />
        <Bubble>{line.text}</Bubble>
        {recording && (
          <>
            <Gap h={12} />
            <LiveCard turn={turn} text={live.text} starting={live.starting} saving={phase === 'saving'} />
          </>
        )}
        <Gap h={16} />
        <ActionButton turn={turn} phase={phase} count={count} />
        <Gap h={10} />
        <p className="t-caption shrink-0 text-center text-gs-muted" role={live.error ? 'alert' : undefined}>
          {hintFor(turn, phase, live.error)}
        </p>
        {turn === 'sensor' && (
          <button type="button" onClick={(e) => { e.stopPropagation(); finish(false) }}
            className="t-label-m mx-auto mt-2 rounded-full px-4 py-2 text-gs-brand active:bg-gs-tint">
            Skip for now
          </button>
        )}
      </div>
    </Screen>
  )
}

function hintFor(turn: Turn, phase: 'ask' | 'record' | 'saving', error: string | null) {
  if (error && phase === 'ask') return error
  switch (turn) {
    case 'mic': return 'Everything I say is read out loud'
    case 'camera': return 'I only look while you’re walking'
    case 'sensor': return 'Say “skip” to set it up later'
    case 'done': return 'Hold your phone at chest height'
    default: return phase === 'ask' ? 'Tap once, then talk' : 'Not right? Double-tap to say it again'
  }
}

function ChatHeader({ step, onType }: { step: number | 'done'; onType: () => void }) {
  const n = step === 'done' ? STEPS : step
  return (
    <>
      <div className="flex shrink-0 items-start justify-between">
        <div>
          <p className="t-overline text-gs-brand">Voice setup</p>
          <p className="t-label-m">{step === 'done' ? 'Complete' : `Step ${step} of ${STEPS}`}</p>
        </div>
        <button type="button" onClick={onType} className="t-label-m rounded-full bg-gs-tint px-3.5 py-2 text-gs-brand active:bg-gs-line">
          Type instead
        </button>
      </div>
      <Gap h={10} />
      <div className="flex shrink-0 gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={n} aria-label="Voice setup progress">
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={cx('h-[5px] flex-1 rounded-[3px]', i < n ? 'bg-gs-action' : 'bg-gs-line')} />
        ))}
      </div>
      <Gap h={12} />
    </>
  )
}

/** Earlier messages, newest at the bottom. Scrolls when they don't fit, and follows new messages. */
function History({ entries }: { entries: Entry[] }) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length])
  return (
    // No justify-end: it would make overflowing messages unreachable. The first item's mt-auto
    // keeps short histories at the bottom instead.
    <ol ref={list} aria-label="Conversation so far" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain">
      {entries.map((e, i) => (
        <li key={e.id} className={cx('flex shrink-0', i === 0 && 'mt-auto', e.who === 'you' ? 'justify-end' : e.who === 'done' ? 'justify-center' : 'justify-start')}>
          {e.who === 'sighty' && (
            <div className="max-w-[80%] rounded-[16px] rounded-tl-[6px] bg-gs-tint px-3.5 py-2.5">
              <p className="t-caption text-gs-muted">Sighty</p>
              <p className="t-body-m">{e.text}</p>
            </div>
          )}
          {e.who === 'you' && (
            <p className="t-label-m flex max-w-[80%] items-center gap-1.5 break-all rounded-[16px] rounded-br-[6px] bg-gs-action px-3.5 py-2.5 text-white">
              <span className="sr-only">You said: </span>{e.text}<img src={icons.checkWhite} alt="" className="size-4 shrink-0" />
            </p>
          )}
          {e.who === 'done' && (
            <p className="t-caption flex items-center gap-1.5 rounded-full bg-gs-clear-bg px-3 py-1.5">
              <img src={icons.checkGreen} alt="" className="size-3.5" />{e.text}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Sighty's current question: dark speech bubble pointing up at Sighty. */
function Bubble({ children }: { children: ReactNode }) {
  return (
    <section className="relative flex shrink-0 flex-col gap-2 rounded-[22px] bg-gs-ink px-[18px] py-4 text-white" aria-live="polite">
      <span aria-hidden className="absolute -top-1.5 left-1/2 size-4 -translate-x-1/2 rotate-45 rounded-[3px] bg-gs-ink" />
      <p className="t-caption flex items-center gap-2"><img src={icons.volume16White} alt="" className="size-4" />Sighty says</p>
      <p className="t-title-m">{children}</p>
    </section>
  )
}

/** Live words while recording, with what Sighty will make of them (name spelled out, email address). */
function LiveCard({ turn, text, starting, saving }: { turn: Turn; text: string; starting: boolean; saving: boolean }) {
  const value = turn === 'name' ? nameFrom(text) : turn === 'email' ? emailFrom(text) : ''
  const sub = turn === 'name' && value ? spellOut(value) : value
  return (
    <div className="flex shrink-0 flex-col gap-1.5 rounded-[18px] border-2 border-dashed border-gs-action bg-white px-4 py-3" role="status">
      <div className="flex items-center gap-2">
        <span className={cx('size-2 rounded-full', saving ? 'bg-gs-muted' : 'bg-gs-stop')} />
        <p className="t-caption flex-1 text-gs-stop">{saving ? 'Checking…' : starting ? 'Starting the microphone…' : 'Listening…'}</p>
        <VoiceBars heights={[6, 12, 18, 10, 16, 8, 14, 6]} width={3} gap={3} color="bg-gs-action" active={!saving && !starting} />
      </div>
      <p className={cx('t-title-m break-words', !text && 'text-gs-muted')}>{text || (starting ? '…' : 'Go ahead, I’m listening')}</p>
      {sub && <p className="t-label-m break-all text-gs-brand">→ {sub}</p>}
    </div>
  )
}

/** The big button at the bottom. It does nothing itself: the tap goes to the whole area. */
function ActionButton({ turn, phase, count }: { turn: Turn; phase: 'ask' | 'record' | 'saving'; count: number }) {
  let tone = 'bg-gs-action text-white'
  let icon: ReactNode = <img src={icons.mic22White} alt="" className="size-5" />
  let label = 'Tap anywhere to answer'
  if (turn === 'mic' || turn === 'camera') {
    icon = <img src={icons.hand20} alt="" className="size-5 brightness-0 invert" />
    label = 'Tap anywhere, then tap Allow'
  } else if (turn === 'sensor') {
    tone = 'bg-gs-tint text-gs-ink'
    icon = <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-gs-muted border-t-transparent" />
    label = 'Looking for your sensor…'
  } else if (turn === 'done') {
    tone = 'bg-gs-clear text-white'
    icon = <img src={icons.checkWhite} alt="" className="size-4" />
    label = `Starting guide mode in ${Math.max(count, 1)}…`
  } else if (phase === 'record') {
    tone = 'bg-gs-ink text-white'
    icon = <img src={icons.checkWhite} alt="" className="size-4" />
    label = 'Tap anywhere to confirm'
  } else if (phase === 'saving') {
    tone = 'bg-gs-ink text-white'
    icon = <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
    label = 'Hold on…'
  }
  const passive = turn === 'sensor' || turn === 'done'
  return (
    <button type="button" aria-disabled={passive || phase === 'saving'}
      className={cx('t-label-l flex h-14 w-full shrink-0 items-center justify-center gap-2 rounded-full px-5 transition-colors', tone)}>
      {icon}{label}
    </button>
  )
}
