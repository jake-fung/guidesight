// First run after sign-up: name -> camera -> microphone -> sensor -> "You're all set".
// The server decides the step (GET /api/me -> next_step), so setup resumes where it left off.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api, type Me, type SensorSearch } from '../../lib/api'
import { getEmail } from '../../lib/auth'
import BigButton from '../walker/BigButton'

const SEARCH_EVERY_MS = 2000

type StepProps = { me: Me; onChange: (me: Me) => void }

export default function Onboarding({ me, onChange }: StepProps) {
  switch (me.next_step) {
    case 'name':
      return <NameStep me={me} onChange={onChange} />
    case 'camera':
      return (
        <PermissionStep key="camera" step="camera" n={1} onChange={onChange}
          title="Let Sighty see ahead"
          body="Your camera is only used while you're guiding. Nothing is recorded or saved."
          allowLabel="Allow camera" constraints={{ video: { facingMode: 'environment' } }} />
      )
    case 'microphone':
      return (
        <PermissionStep key="microphone" step="microphone" n={2} onChange={onChange}
          title="Talk to Sighty"
          body="Ask questions out loud. Your words appear on screen as you speak, so you can check them."
          allowLabel="Allow microphone" constraints={{ audio: true }} />
      )
    case 'sensor':
      return <SensorStep me={me} onChange={onChange} />
    default:
      return <FinishStep me={me} onChange={onChange} />
  }
}

/** Shared layout. The heading takes focus on each new screen so screen readers announce it. */
function Screen({ progress, title, children }: { progress?: string; title: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [title])
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 bg-zinc-950 p-6 text-white">
      {progress && <p className="text-zinc-400">{progress}</p>}
      <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold outline-none">{title}</h1>
      {children}
    </main>
  )
}

function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-lg text-amber-300" role="alert">{error}</p> : null
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function NameStep({ me, onChange }: StepProps) {
  const [name, setName] = useState(me.profile.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmed = name.trim()

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!trimmed) return setError('Please type your name.')
    setBusy(true)
    setError(null)
    try {
      const email = me.profile.email ?? (await getEmail().catch(() => null))
      onChange(await api.saveProfile({ name: trimmed, ...(email ? { email } : {}) }))
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  return (
    <Screen title="What should Sighty call you?">
      <form onSubmit={save} className="flex flex-1 flex-col gap-4">
        <label htmlFor="name" className="text-lg">Your name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name"
          maxLength={60} className="min-h-16 rounded-xl bg-zinc-800 px-4 text-2xl" />
        {/* Spelled out so a misheard dictation is easy to catch. */}
        {trimmed && <p className="text-lg text-zinc-300" aria-live="polite">
          “{trimmed}”: {trimmed.toUpperCase().split('').filter((c) => c !== ' ').join('-')}
        </p>}
        <ErrorText error={error} />
        <BigButton type="submit" disabled={busy} className="mt-auto">Continue</BigButton>
      </form>
    </Screen>
  )
}

type PermissionProps = {
  step: 'camera' | 'microphone'
  n: number
  title: string
  body: string
  allowLabel: string
  constraints: MediaStreamConstraints
  onChange: (me: Me) => void
}

function PermissionStep({ step, n, title, body, allowLabel, constraints, onChange }: PermissionProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function answer(status: 'allowed' | 'skipped') {
    setBusy(true)
    setError(null)
    try {
      onChange(await api.answerSetup(step, status))
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  async function allow() {
    setBusy(true)
    setError(null)
    try {
      // Asking once here shows the browser's prompt; the stream itself isn't needed yet.
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      setError(`The ${step} is blocked. You can turn it on later in your browser settings.`)
      setBusy(false)
      return
    }
    await answer('allowed')
  }

  return (
    <Screen progress={`Step ${n} of 3`} title={title}>
      <p className="text-lg text-zinc-300">{body}</p>
      <ErrorText error={error} />
      <div className="mt-auto flex flex-col gap-3">
        <BigButton onClick={allow} disabled={busy}>{allowLabel}</BigButton>
        <BigButton variant="secondary" onClick={() => answer('skipped')} disabled={busy}>Not now</BigButton>
      </div>
    </Screen>
  )
}

function SensorStep({ onChange }: StepProps) {
  const [search, setSearch] = useState<SensorSearch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoTried = useRef(new Set<string>())

  // Poll for switched-on sensors while this screen is open.
  useEffect(() => {
    let stopped = false
    async function poll() {
      try {
        const result = await api.findSensor()
        if (!stopped) setSearch(result)
      } catch (e) {
        if (!stopped) setError(message(e))
      }
    }
    poll()
    const timer = setInterval(poll, SEARCH_EVERY_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [])

  // A sensor this account already paired, or else the unpaired ones the server found.
  const candidates = search
    ? search.harness_id && search.online ? [search.harness_id] : search.nearby.map((h) => h.id)
    : []

  async function pair(id: string) {
    setBusy(true)
    setError(null)
    try {
      onChange((await api.pairSensor(id)).me)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  async function skip() {
    setBusy(true)
    try {
      onChange(await api.answerSetup('sensor', 'skipped'))
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  // Exactly one sensor found: connect it without asking (once per sensor).
  const only = candidates.length === 1 ? candidates[0] : null
  useEffect(() => {
    if (only && !busy && !autoTried.current.has(only)) {
      autoTried.current.add(only)
      pair(only)
    }
  }, [only, busy]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Screen progress="Step 3 of 3" title="Connect your sensor">
      <p className="text-lg text-zinc-300">Switch on the GuideSight sensor and keep it near your phone.</p>
      <p className="text-lg" role="status">
        {busy ? 'Connecting…' : candidates.length > 1 ? `Found ${candidates.length} sensors. Pick yours:` : 'Searching…'}
      </p>
      {candidates.length > 1 && (
        <div className="flex flex-col gap-3">
          {candidates.map((id) => (
            <BigButton key={id} variant="secondary" disabled={busy} onClick={() => pair(id)}>{id}</BigButton>
          ))}
        </div>
      )}
      <ErrorText error={error} />
      <BigButton variant="secondary" onClick={skip} disabled={busy} className="mt-auto">Skip for now</BigButton>
    </Screen>
  )
}

const TIPS = [
  'Hold your phone at chest height, camera facing forward.',
  'Tap Speak and ask anything.',
  "Feel a buzz? Stop. Sighty will tell you what's ahead.",
]

function FinishStep({ me, onChange }: StepProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function done() {
    setBusy(true)
    setError(null)
    try {
      onChange(await api.completeSetup())
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <Screen title={`You're all set, ${me.profile.name}`}>
      <p className="text-lg text-zinc-300">Here's how to use Sighty.</p>
      <ol className="flex flex-col gap-3">
        {TIPS.map((tip, i) => (
          <li key={tip} className="flex gap-4 rounded-xl bg-zinc-900 p-4 text-lg">
            <span className="font-bold" aria-hidden>{i + 1}</span>
            {tip}
          </li>
        ))}
      </ol>
      <ErrorText error={error} />
      <BigButton onClick={done} disabled={busy} className="mt-auto">Done</BigButton>
    </Screen>
  )
}
