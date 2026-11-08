// Track 2 — Low vision & sighted: B1–B3 register, C1–C4 setup. The ♿ button opens the accessibility sheet.
import { useEffect, useState } from 'react'
import { icons } from '../icons'
import { useApp } from '../state'
import { Button, Gap, Hero, IconBadge, Mascot, Radar, Screen, StatusPill, StepCard, StepHeader, TextField } from '../ui'
import { buzz, firstWord, spellOut, spokenToEmail, useAutoRead, usePhrases, voice } from '../voice'
import { CodeEntry } from './Start'
import { HarnessPairing } from '../Pairing'

function useStepHeader(step: number) {
  const { back, setSheetOpen } = useApp()
  return <StepHeader step={step} onBack={back} onA11y={() => setSheetOpen(true)} />
}

export function B1Name() {
  const { go, profile, setProfile } = useApp()
  const header = useStepHeader(1)
  const [name, setName] = useState(profile.name)
  const [dictating, setDictating] = useState(false)
  const [heard, setHeard] = useState<string | null>(null)
  useAutoRead('What should Sighty call you? Type your name, or tap the mic and say it.')

  const mic = usePhrases(dictating, (text) => {
    const n = firstWord(text.replace(/\b(my name is|i'm|i am|call me)\b/gi, ''))
    if (!n) return
    setName(n)
    setHeard(n)
    setDictating(false)
  }, { silenceMs: 1000 })

  function next() {
    if (!name.trim()) return
    setProfile({ name: name.trim() })
    go('b2')
  }

  return (
    <Screen>
      {header}
      <Gap h={16} />
      <Hero tone="yellow" className="min-h-[150px]"><Mascot size={120} /></Hero>
      <Gap h={20} />
      <h1 className="t-display-l max-w-[260px]">What should Sighty call you?</h1>
      <Gap h={38} />
      <TextField label="Your name" autoComplete="given-name" placeholder="First name" value={name}
        onChange={(e) => { setName(e.target.value); setHeard(null) }} onMic={() => { voice.stop(); setDictating((d) => !d) }} micActive={dictating}
        onKeyDown={(e) => e.key === 'Enter' && next()} />
      {(heard || dictating) && (
        <>
          <Gap h={14} />
          <div className="flex items-center gap-3 rounded-2xl bg-gs-tint py-3.5 pl-4 pr-4" role="status">
            <img src={icons.mic20} alt="" className="size-[22px]" />
            <div className="min-w-0 flex-1">
              <p className="t-caption text-gs-muted">{!dictating ? 'Sighty heard' : mic.error ?? (mic.listening ? 'Sighty is listening… say your first name.' : 'Starting the microphone…')}</p>
              {heard && <p className="t-label-l">“{heard}” — {spellOut(heard)}</p>}
            </div>
            {heard && <button type="button" className="t-label-m text-gs-brand" onClick={() => document.getElementById('f-yourname')?.focus()}>Edit</button>}
          </div>
        </>
      )}
      <Gap h={20} />
      <Button onClick={next} disabled={!name.trim()}>Continue</Button>
    </Screen>
  )
}

export function B2Email() {
  const { go, profile, setProfile } = useApp()
  const header = useStepHeader(2)
  const [email, setEmail] = useState(profile.email)
  const [dictating, setDictating] = useState(false)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  useAutoRead(`What’s your email${profile.name ? `, ${profile.name}` : ''}? You’ll get a code each time you sign in.`)
  usePhrases(dictating, (text) => { setEmail(spokenToEmail(text)); setDictating(false) }, { silenceMs: 1500, maxMs: 15_000 })

  function next() {
    if (!valid) return
    setProfile({ email })
    go('b3')
  }

  return (
    <Screen>
      {header}
      <Gap h={16} />
      <Hero tone="green" className="min-h-[150px]"><IconBadge src={icons.mail44} /></Hero>
      <Gap h={20} />
      <h1 className="t-display-l">What’s your email{profile.name ? `, ${profile.name}` : ''}?</h1>
      <Gap h={10} />
      <p className="t-body-l text-gs-muted">You’ll get a code each time you sign in.</p>
      <Gap h={28} />
      <TextField label="Email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="name@email.com"
        value={email} onChange={(e) => setEmail(e.target.value)} onMic={() => { voice.stop(); setDictating((d) => !d) }} micActive={dictating}
        onKeyDown={(e) => e.key === 'Enter' && next()} />
      <Gap h={20} />
      <Button onClick={next} disabled={!valid}>Continue</Button>
    </Screen>
  )
}

export function B3Code() {
  const { go, setProfile } = useApp()
  const header = useStepHeader(3)
  return <CodeEntry header={header} cta="Continue" onDone={() => { setProfile({ signedIn: true }); go('c1') }} />
}

/** C1 / C2: hero + title + description + Allow / Not now. */
function PermissionScreen({ step, tone, icon, title, body, allow, kind, next }: {
  step: number; tone: 'yellow' | 'orange'; icon: string; title: string; body: string; allow: string; kind: 'video' | 'audio'; next: () => void
}) {
  const { session } = useApp()
  const header = useStepHeader(step)
  const [error, setError] = useState(false)
  useAutoRead(`${title}. ${body}`)

  async function onAllow() {
    const ok = await session.requestMedia(kind === 'video' ? { video: true } : { audio: true })
    if (ok) next()
    else setError(true)
  }

  return (
    <Screen>
      {header}
      <Gap h={16} />
      <Hero tone={tone} radius={32} className="min-h-[200px]"><IconBadge src={icon} size={148} icon={60} /></Hero>
      <Gap h={28} />
      <h1 className="t-display-l text-center">{title}</h1>
      <Gap h={10} />
      <p className="t-body-m text-center text-gs-muted">{body}</p>
      {error && <p role="alert" className="t-label-m mt-2 text-center text-gs-stop">Permission wasn’t given. You can allow it in your browser settings.</p>}
      <Gap h={12} />
      <Button onClick={onAllow}>{allow}</Button>
      <Gap h={6} />
      <Button variant="ghost" onClick={next}>Not now</Button>
    </Screen>
  )
}

export function C1Camera() {
  const { go } = useApp()
  return <PermissionScreen step={1} tone="yellow" icon={icons.camera60} kind="video" allow="Allow camera" next={() => go('c2')}
    title="Let Sighty see ahead" body="Your camera is only used while you’re guiding. Nothing is recorded or saved." />
}

export function C2Mic() {
  const { go } = useApp()
  return <PermissionScreen step={2} tone="orange" icon={icons.mic60} kind="audio" allow="Allow microphone" next={() => go('c3')}
    title="Talk to Sighty" body="Ask questions out loud. Your words appear on screen as you speak, so you can check them." />
}

export function C3Sensor() {
  const { go, link } = useApp()
  const header = useStepHeader(3)
  const online = !!link.harnessOnline
  const [pairing, setPairing] = useState(false)
  useAutoRead('Connect your sensor. Switch on the GuideSight sensor and keep it near your phone.')

  useEffect(() => {
    if (!online) return
    buzz(80)
    const t = setTimeout(() => go('c4'), 1500)
    return () => clearTimeout(t)
  }, [online, go])

  return (
    <Screen>
      {header}
      <Gap h={16} />
      <Hero tone="green" radius={32} className="min-h-[280px]"><Radar size={260} /></Hero>
      <Gap h={20} />
      <h1 className="t-display-l text-center">Connect your sensor</h1>
      <Gap h={10} />
      <p className="t-body-m text-center text-gs-muted">Switch on the GuideSight sensor and keep it near your phone.</p>
      <Gap h={20} />
      <div className="flex justify-center">
        {online ? <StatusPill status="clear">Sensor connected</StatusPill> : <StatusPill status="caution">Searching…</StatusPill>}
      </div>
      {pairing && !online && (<><Gap h={12} /><HarnessPairing compact /></>)}
      <Gap h={12} />
      {!online && !pairing ? (
        <div className="flex">
          <Button variant="ghost" className="flex-1" onClick={() => setPairing(true)}>Enter sensor ID</Button>
          <Button variant="ghost" className="flex-1" onClick={() => go('c4')}>Skip for now</Button>
        </div>
      ) : <Button variant="ghost" onClick={() => go('c4')}>{online ? 'Continue' : 'Skip for now'}</Button>}
    </Screen>
  )
}

export function C4AllSet() {
  const { go, profile } = useApp()
  const title = `You’re all set${profile.name ? `, ${profile.name}` : ''}`
  useAutoRead(`${title}. Here’s how to use Sighty. One: hold your phone at chest height, camera facing forward. Two: tap Speak, or say “Hey Sighty”, and ask anything. Three: feel a buzz? Stop. Sighty will tell you what’s ahead.`)
  return (
    <Screen>
      <Hero tone="green" radius={32} className="min-h-[200px]"><Mascot size={160} /></Hero>
      <Gap h={20} />
      <h1 className="t-display-l text-center">{title}</h1>
      <Gap h={6} />
      <p className="t-body-l text-center text-gs-muted">Here’s how to use Sighty.</p>
      <Gap h={18} />
      <ol className="flex flex-col gap-2.5">
        <StepCard n={1}>Hold your phone at chest height, camera facing forward.</StepCard>
        <StepCard n={2}>Tap Speak — or say “Hey Sighty” — and ask anything.</StepCard>
        <StepCard n={3}>Feel a buzz? Stop. Sighty will tell you what’s ahead.</StepCard>
      </ol>
      <Gap h={16} />
      <Button onClick={() => go('d1')}>Done</Button>
    </Screen>
  )
}
