// A0 Tap anywhere · A1 How much can you see? · A2 Sign in (email) · A3 Sign in (code)
import { useEffect, useState, type ReactNode } from 'react'
import { icons } from '../icons'
import { useApp, type Track } from '../state'
import {
  Button, CodeBoxes, Gap, Hero, IconBadge, ListeningPill, Mascot, NavHeader, OptionCard, Screen, SpeakingBanner, TextField,
} from '../ui'
import { buzz, spokenToEmail, useAutoRead, usePhrases, useSpeech, useVoiceCommands, voice } from '../voice'

const WELCOME = 'Hi, I’m Sighty. How much can you see? Say “blind”, “low vision” or “I can see”.'

export function A0Tap() {
  const { go } = useApp()
  function start() {
    voice.unlock() // this tap is what lets the page talk from now on
    buzz(80)
    go('v1') // the setup chat asks "How much can you see?" itself
  }
  return (
    <Screen>
      <button type="button" onClick={start} aria-label="Tap anywhere to start. The whole screen is one big button."
        className="mt-3 flex min-h-0 flex-1 flex-col items-center justify-center rounded-[32px] border-2 border-dashed border-gs-action bg-gs-caution-bg px-6">
        <Mascot size={220} />
        <Gap h={28} />
        <span className="t-display-xl text-center">Tap anywhere to start</span>
        <Gap h={40} />
        <span className="t-label-m flex items-center gap-2"><img src={icons.hand20} alt="" className="size-5" />The whole screen is one big button</span>
      </button>
    </Screen>
  )
}

const CHOICES: { track: Track; title: string; description: string }[] = [
  { track: 'blind', title: 'I’m blind', description: 'Set up everything by voice.' },
  { track: 'low-vision', title: 'I have low vision', description: 'Big text + read-aloud shortcut.' },
  { track: 'sighted', title: 'I can see', description: 'Standard setup.' },
]

export function A1HowMuch() {
  const { go, setProfile, setPrefs, profile } = useApp()
  const [picked, setPicked] = useState<Track | null>(profile.track)
  useAutoRead(WELCOME)

  function choose(track: Track) {
    setPicked(track)
    setProfile({ track })
    voice.stop()
    if (track === 'blind') setPrefs({ readAloud: true })
    if (track === 'low-vision') setPrefs({ readAloud: true, textSize: 1.15 })
    if (track === 'sighted') setPrefs({ readAloud: false })
    // Short pause so the selected state is visible (and announced) before moving on.
    setTimeout(() => go(track === 'blind' ? 'v1' : 'b1'), 350)
  }

  const speech = useSpeech()
  const mic = useVoiceCommands({
    'low vision': () => choose('low-vision'),
    'can see': () => choose('sighted'),
    blind: () => choose('blind'),
    'sign in': () => go('a2'),
    repeat: () => voice.replay(),
  })

  return (
    <Screen>
      <p className="t-label-l text-gs-brand">GuideSight</p>
      <Gap h={10} />
      <SpeakingBanner fallback={WELCOME} />
      <Gap h={16} />
      <h1 className="t-display-l">How much can you see?</h1>
      <Gap h={4} />
      <p className="t-body-l text-gs-muted">Tap one, or just say it.</p>
      <Gap h={14} />
      <div role="radiogroup" aria-label="How much can you see?" className="flex flex-col gap-3">
        {CHOICES.map((c) => (
          <OptionCard key={c.track} title={c.title} description={c.description} selected={picked === c.track} onClick={() => choose(c.track)} />
        ))}
      </div>
      <div className="min-h-4 flex-1" />
      <p className="t-body-m flex justify-center gap-1.5 text-gs-muted">
        Already have an account?
        <button type="button" onClick={() => go('a2')} className="t-label-m text-gs-brand underline-offset-2 active:underline">Sign in</button>
      </p>
      <Gap h={10} />
      <ListeningPill>
        {mic.error ?? (mic.listening ? 'Listening for “blind”, “low vision” or “I can see”'
          : speech.status === 'speaking' ? 'I’ll listen when Sighty finishes' : 'Starting the microphone…')}
      </ListeningPill>
    </Screen>
  )
}

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export function A2SignInEmail() {
  const { go, back, profile, setProfile } = useApp()
  const [email, setEmail] = useState(profile.email)
  const [dictating, setDictating] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useAutoRead('Sign in. What’s your email? Tap the mic to say it.')

  usePhrases(dictating, (text) => {
    const value = spokenToEmail(text)
    setEmail(value)
    setDictating(false)
    voice.say(`I heard ${value.split('').join(' ')}`)
  }, { silenceMs: 1500, maxMs: 15_000 })

  function send() {
    if (!isEmail(email)) return setNote('That doesn’t look like an email yet.')
    setProfile({ email })
    go('a3')
  }

  return (
    <Screen>
      <NavHeader title="Sign in" onBack={back} />
      <Gap h={16} />
      <Hero tone="yellow" className="min-h-[150px]"><Mascot size={120} /></Hero>
      <Gap h={20} />
      <h1 className="t-display-l">What’s your email?</h1>
      <Gap h={38} />
      <TextField label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="name@email.com"
        value={email} onChange={(e) => setEmail(e.target.value)} onMic={() => { voice.stop(); setDictating((d) => !d) }} micActive={dictating}
        onKeyDown={(e) => e.key === 'Enter' && send()} />
      <Gap h={14} />
      <p className="t-body-m flex items-center gap-2.5 rounded-2xl bg-gs-tint px-3.5 py-3">
        <img src={icons.mic20} alt="" className="size-5 shrink-0" />
        {dictating ? 'Listening… say your email.' : 'Tap the mic to say it. Sighty spells it back before sending.'}
      </p>
      {note && <p role="alert" className="t-label-m mt-2 text-gs-stop">{note}</p>}
      <Gap h={20} />
      <Button onClick={send}>Send code</Button>
      <Gap h={14} />
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-[1.5px] flex-1 bg-gs-line" /><span className="t-caption text-gs-muted">or</span><span className="h-[1.5px] flex-1 bg-gs-line" />
      </div>
      <Gap h={14} />
      <Button variant="secondary" onClick={() => setNote('Apple sign-in isn’t set up yet. Use your email for now.')}>Continue with Apple</Button>
    </Screen>
  )
}

/** Email code entry, shared by A3 (sign in) and B3 (register). */
export function CodeEntry({ header, onDone, cta }: { header: ReactNode; onDone: () => void; cta: string }) {
  const { profile } = useApp()
  const [code, setCode] = useState('')
  const [seconds, setSeconds] = useState(42)
  const masked = profile.email ? `${profile.email[0]}•••@${profile.email.split('@')[1] ?? ''}` : 'your email'
  useAutoRead(`Enter your code. We sent 6 digits to ${profile.email || 'your email'}.`)

  useEffect(() => {
    if (seconds <= 0) return
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  // TODO(server): the backend signs in with Firebase email + password today. Swap this for
  // Firebase email-link / OTP verification when the server supports it; any 6 digits pass for now.
  const done = code.length === 6

  return (
    <Screen>
      {header}
      <Gap h={16} />
      <Hero tone="orange" className="min-h-[150px]"><IconBadge src={icons.chat44} /></Hero>
      <Gap h={20} />
      <h1 className="t-display-l">Enter your code</h1>
      <Gap h={10} />
      <p className="t-body-l text-gs-muted">We sent 6 digits to {masked}. Sighty can read your messages aloud if you allow it.</p>
      <Gap h={28} />
      <label className="relative block">
        <span className="sr-only">6-digit code</span>
        <CodeBoxes value={code} />
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
          className="absolute inset-0 opacity-0" onKeyDown={(e) => e.key === 'Enter' && done && onDone()} />
      </label>
      <Gap h={20} />
      <p className="t-body-m flex items-center gap-2 text-gs-muted">
        <img src={icons.msg18} alt="" className="size-[18px]" />
        {seconds > 0 ? `Didn’t get it? Resend in 0:${String(seconds).padStart(2, '0')}` : (
          <button type="button" className="t-label-m text-gs-brand" onClick={() => setSeconds(42)}>Resend code</button>
        )}
      </p>
      <Gap h={20} />
      <Button onClick={onDone} disabled={!done}>{cta}</Button>
    </Screen>
  )
}

export function A3SignInCode() {
  const { go, back, setProfile } = useApp()
  return (
    <CodeEntry header={<NavHeader title="Sign in" onBack={back} />} cta="Sign in"
      onDone={() => { setProfile({ signedIn: true }); go('d1') }} />
  )
}
