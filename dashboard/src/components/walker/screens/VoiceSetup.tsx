// Track 1 — Blind: Sighty sets everything up by voice and moves on by itself (V1 … V7).
import { useEffect, useState, type ReactNode } from 'react'
import { icons } from '../icons'
import { useApp } from '../state'
import {
  CodeBoxes, Gap, IconBadge, Mascot, Radar, Screen, SightyReplied, SightySays, SunRings, VoiceBars, VoiceHint, YouSaid, cx,
} from '../ui'
import { buzz, firstWord, spellEmail, spellOut, spokenToDigits, spokenToEmail, useAutoRead, useListen, useVoiceCommands, voice } from '../voice'

const STEPS = 6

function VoiceHeader({ step }: { step: number | 'done' }) {
  const { go } = useApp()
  const n = step === 'done' ? STEPS : step
  return (
    <>
      <div className="flex shrink-0 items-start justify-between">
        <div>
          <p className="t-overline text-gs-brand">Voice setup</p>
          <p className="t-label-m">{step === 'done' ? 'Complete' : `Step ${step} of ${STEPS}`}</p>
        </div>
        <button type="button" onClick={() => go('b1')} className="t-label-m rounded-full bg-gs-tint px-3.5 py-2 text-gs-brand active:bg-gs-line">
          Type instead
        </button>
      </div>
      <Gap h={10} />
      <div className="flex shrink-0 gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={n} aria-label="Voice setup progress">
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={cx('h-[5px] flex-1 rounded-[3px]', i < n ? 'bg-gs-action' : 'bg-gs-line')} />
        ))}
      </div>
      <Gap h={16} />
    </>
  )
}

/** Big "double-tap anywhere" zone used for the mic and camera permission prompts (V1, V5). */
function PermissionStep({ step, says, kind, next }: { step: number; says: string; kind: 'audio' | 'video'; next: () => void }) {
  const { session } = useApp()
  const [failed, setFailed] = useState(false)
  useAutoRead(`${says} Double-tap anywhere, then double-tap Allow.`)
  useVoiceCommands({ repeat: () => voice.replay() })

  async function allow() {
    voice.stop()
    const ok = await session.requestMedia(kind === 'video' ? { video: true } : { audio: true })
    if (ok) {
      buzz(60)
      next()
    } else {
      setFailed(true)
      voice.say('I couldn’t get permission. Check your browser settings, then double-tap to try again.')
    }
  }

  return (
    <Screen>
      <VoiceHeader step={step} />
      <SightySays>{says}</SightySays>
      <Gap h={12} />
      {/* VoiceOver and TalkBack turn a double-tap into a click, so a plain button is the double-tap target. */}
      <button type="button" onClick={allow}
        className="relative flex min-h-[300px] flex-1 flex-col items-center justify-center overflow-hidden rounded-[28px] border-2 border-dashed border-gs-ink bg-gs-yellow py-9"
        style={{ containerType: 'size' }}>
        <SunRings outer="bg-gs-yellow-2" inner="bg-gs-yellow-3" />
        <span className="relative flex flex-col items-center gap-2.5">
          <img src={icons.hand44} alt="" className="size-11" />
          <span className="t-title-l">Double-tap anywhere</span>
          <span className="t-body-m">{failed ? 'then try “Allow” again' : 'then double-tap “Allow”'}</span>
        </span>
      </button>
      <Gap h={14} />
      <VoiceHint>Say “repeat” to hear it again</VoiceHint>
    </Screen>
  )
}

export function V1Mic() {
  const { go } = useApp()
  return <PermissionStep step={1} kind="audio" next={() => go('v2')}
    says="First, I need your microphone so you can answer out loud." />
}

export function V5Camera() {
  const { go } = useApp()
  return <PermissionStep step={5} kind="video" next={() => go('v6')}
    says="Last permission: the camera, so I can see what’s ahead of you." />
}

/** Beige panel with Sighty listening and a voice-level meter (V2, V3). */
function ListeningState({ label = 'Listening…', heard }: { label?: string; heard?: string }) {
  return (
    <div className="relative flex min-h-[220px] flex-1 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[28px] bg-gs-tint py-4">
      <span aria-hidden className="absolute -bottom-[110px] -left-[70px] size-[220px] rounded-full bg-white/16" />
      <span aria-hidden className="absolute -right-5 -top-6 size-[90px] rounded-full bg-white/20" />
      <Mascot mood="Listening" size={124} />
      <VoiceBars heights={[8, 18, 30, 22, 36, 24, 14, 30, 20, 10]} width={4} gap={4} color="bg-gs-action" />
      <p className="t-label-m text-gs-brand" role="status">{heard ? `“${heard}”` : label}</p>
    </div>
  )
}

/**
 * Ask → hear → spell back → "yes"/"no". Used for the name (V2) and email (V3).
 * `parse` turns what was heard into the value; `spell` is what Sighty reads back.
 */
function ConfirmStep({ step, says, hint, parse, spell, display, onConfirmed }: {
  step: number
  says: string
  hint: string
  parse: (heard: string) => string
  spell: (value: string) => string
  display?: (heard: string, value: string) => ReactNode
  onConfirmed: (value: string) => void
}) {
  const [heard, setHeard] = useState<string | null>(null)
  const [value, setValue] = useState<string | null>(null)
  const [answer, setAnswer] = useState<string | null>(null)
  useAutoRead(says)

  const { heard: live } = useListen(true, (text) => {
    if (!value) {
      const v = parse(text)
      if (!v) return
      setHeard(text)
      setValue(v)
      voice.say(`${spell(v)}. Say “yes” if that’s right.`)
      return
    }
    const t = text.toLowerCase()
    if (/\b(yes|yeah|yep|correct|right)\b/.test(t)) {
      setAnswer('Yes')
      buzz(60)
      setTimeout(() => onConfirmed(value), 700)
    } else if (/\b(no|nope|wrong)\b/.test(t)) {
      setHeard(null)
      setValue(null)
      voice.say('Okay, let’s try again. ' + says)
    } else if (t.includes('spell')) {
      voice.say('Go ahead, one letter at a time.')
    } else if (t.includes('repeat')) {
      voice.replay()
    }
  })

  return (
    <Screen>
      <VoiceHeader step={step} />
      <SightySays>{says}</SightySays>
      {heard && value && (
        <>
          <Gap h={6} />
          <YouSaid sub={display?.(heard, value)}>“{display ? heard : value}”</YouSaid>
          <Gap h={6} />
          <SightyReplied>{spell(value)}. {answer ? '' : 'Say “yes” if that’s right.'}</SightyReplied>
        </>
      )}
      {answer && (<><Gap h={6} /><YouSaid>“{answer}”</YouSaid></>)}
      <Gap h={12} />
      <ListeningState heard={live.interim || undefined} />
      <Gap h={6} />
      <VoiceHint>{hint}</VoiceHint>
    </Screen>
  )
}

export function V2Name() {
  const { go, setProfile } = useApp()
  return (
    <ConfirmStep step={2} says="What should I call you? Say your first name."
      hint="Say “spell it” to spell your name letter by letter"
      parse={(t) => firstWord(t.replace(/\b(my name is|i'm|i am|call me)\b/gi, ''))}
      spell={(v) => `${v} — ${spellOut(v)}`}
      onConfirmed={(name) => { setProfile({ name }); go('v3') }} />
  )
}

export function V3Email() {
  const { go, setProfile } = useApp()
  return (
    <ConfirmStep step={3} says="What’s your email? Say it normally — I’ll spell it back."
      hint="Say “no” to try again"
      parse={(t) => { const e = spokenToEmail(t); return e.includes('@') ? e : '' }}
      spell={(v) => `${spellEmail(v)}. Right?`}
      display={(_, v) => <p className="t-label-l text-gs-brand">→ {v}</p>}
      onConfirmed={(email) => { setProfile({ email }); go('v4') }} />
  )
}

export function V4Code() {
  const { go, setProfile } = useApp()
  const [code, setCode] = useState('')
  const [heard, setHeard] = useState('')
  const ok = code.length === 6
  useAutoRead('I emailed you a 6-digit code. Read it out, or say “check my email”.')

  useListen(!ok, (text) => {
    if (text.toLowerCase().includes('check my email')) {
      // TODO: read the newest GuideSight email aloud once a mail connector exists.
      voice.say('I can’t open your email yet. Please read me the code.')
      return
    }
    const digits = spokenToDigits(text).slice(0, 6)
    if (!digits) return
    setHeard(text)
    setCode(digits)
  })

  useEffect(() => {
    if (!ok) return
    // TODO(server): verify the code. Any 6 digits pass until the backend sends real codes.
    voice.say('Code accepted. Your account is ready.')
    setProfile({ signedIn: true })
    buzz([60, 80, 60])
    const t = setTimeout(() => go('v5'), 2500)
    return () => clearTimeout(t)
  }, [ok, go, setProfile])

  return (
    <Screen>
      <VoiceHeader step={4} />
      <SightySays>I emailed you a 6-digit code. Read it out, or say “check my email”.</SightySays>
      {heard && (
        <>
          <Gap h={10} />
          <YouSaid sub={<div className="mt-1"><CodeBoxes value={code} size="sm" /></div>}>“{code.split('').join(' ')}”</YouSaid>
        </>
      )}
      {ok && (<><Gap h={10} /><SightyReplied>Code accepted. Your account is ready.</SightyReplied></>)}
      <Gap h={12} />
      {ok ? (
        <div className="relative flex min-h-[220px] flex-1 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[28px] bg-gs-green" style={{ containerType: 'size' }}>
          <SunRings outer="bg-gs-green-2" inner="bg-gs-green-3" />
          <span className="relative flex flex-col items-center gap-2.5">
            <IconBadge src={icons.check44} size={96} />
            <span className="t-title-m">Account ready</span>
          </span>
        </div>
      ) : <ListeningState />}
      <Gap h={14} />
      <VoiceHint>Say “check my email” and Sighty reads it for you</VoiceHint>
    </Screen>
  )
}

export function V6Sensor() {
  const { go, link } = useApp()
  useAutoRead('Switch on your GuideSight sensor and hold it near your phone. I’ll tell you when I find it.')
  useVoiceCommands({ skip: () => go('v7'), repeat: () => voice.replay() })
  useEffect(() => {
    if (link.harnessOnline) go('v7')
  }, [link.harnessOnline, go])

  return (
    <Screen>
      <VoiceHeader step={6} />
      <SightySays>Switch on your GuideSight sensor and hold it near your phone. I’ll tell you when I find it.</SightySays>
      <Gap h={12} />
      <div className="relative flex min-h-[260px] flex-1 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[28px] bg-gs-tint">
        <span aria-hidden className="absolute -bottom-[110px] -left-[70px] size-[220px] rounded-full bg-white/16" />
        <span aria-hidden className="absolute -right-5 -top-6 size-[90px] rounded-full bg-white/20" />
        <Radar size={221} />
        <p className="t-label-m text-gs-brand" role="status">Searching…</p>
      </div>
      <Gap h={14} />
      <button type="button" onClick={() => go('v7')} className="mx-auto"><VoiceHint>Say “skip” to set it up later</VoiceHint></button>
    </Screen>
  )
}

export function V7AllSet() {
  const { go, profile, link } = useApp()
  const [count, setCount] = useState(3)
  const found = !!link.harnessOnline
  const says = `${found ? 'Found it! ' : ''}You’re all set${profile.name ? `, ${profile.name}` : ''}. Hold your phone at chest height and say “Hey Sighty” any time.`
  useAutoRead(says)

  useEffect(() => {
    if (count <= 0) {
      go('d4')
      return
    }
    const t = setTimeout(() => setCount((c) => c - 1), voice.get().status === 'speaking' ? 2000 : 1000)
    return () => clearTimeout(t)
  }, [count, go])

  return (
    <Screen>
      <VoiceHeader step="done" />
      <SightySays>{says}</SightySays>
      {found && (<><Gap h={10} /><SightyReplied>Sensor connected</SightyReplied></>)}
      <Gap h={12} />
      <div className="relative flex min-h-[260px] flex-1 flex-col items-center justify-center gap-2.5 overflow-hidden rounded-[28px] bg-gs-green" style={{ containerType: 'size' }}>
        <SunRings outer="bg-gs-green-2" inner="bg-gs-green-3" />
        <span className="relative flex flex-col items-center gap-2.5">
          <Mascot size={170} />
          <span className="t-label-m flex items-center gap-2 rounded-full bg-gs-clear-bg px-3.5 py-2" role="status">
            <img src={icons.checkGreen} alt="" className="size-4" />Starting guide mode in {Math.max(count, 1)}…
          </span>
        </span>
      </div>
      <Gap h={14} />
      <VoiceHint>Say “Hey Sighty” any time</VoiceHint>
    </Screen>
  )
}
