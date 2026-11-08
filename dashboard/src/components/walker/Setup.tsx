import { useEffect, useState, type FormEvent } from 'react'
import { api, type Settings } from '../../lib/api'
import { DEV_MODE, logout } from '../../lib/auth'
import type { LiveLink } from '../../lib/live'
import { unlockSpeech } from '../../lib/speech'
import BigButton from './BigButton'

const RATES = [0.8, 1.0, 1.2, 1.5]

export default function Setup({ link, onStart }: { link: LiveLink; onStart: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [harnessId, setHarnessId] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        setSettings(s)
        setHarnessId(s.harness_id ?? '')
      })
      .catch((e) => setMessage(`Server unreachable: ${e.message}`))
  }, [])

  async function update(patch: Partial<Settings>) {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    try {
      setSettings(await api.saveSettings(patch))
    } catch (e) {
      setMessage(`Couldn't save: ${e instanceof Error ? e.message : e}`)
    }
  }

  async function saveHarness(e: FormEvent) {
    e.preventDefault()
    await update({ harness_id: harnessId.trim() || null })
    await link.refresh().catch(() => {})
  }

  async function testBuzz() {
    try {
      const { delivered } = await api.buzz('double')
      setMessage(delivered ? 'Buzz sent to the harness.' : 'The harness is offline.')
    } catch (e) {
      setMessage(`Buzz failed: ${e instanceof Error ? e.message : e}`)
    }
  }

  function start() {
    unlockSpeech() // must run inside this tap so the walk screen can speak later
    onStart()
  }

  const harnessText = !settings?.harness_id
    ? 'No harness paired'
    : link.harnessOnline === null
      ? 'Checking…'
      : link.harnessOnline
        ? `${settings.harness_id} connected`
        : `${settings.harness_id} offline. Is it powered on and on Wi-Fi?`

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col gap-5 bg-zinc-950 p-6 text-white">
      <h1 className="text-3xl font-bold">Setup</h1>

      <section className="space-y-3" aria-labelledby="harness-heading">
        <h2 id="harness-heading" className="text-xl font-bold">Harness</h2>
        <p className="text-lg text-zinc-300" aria-live="polite">{harnessText}</p>
        <form onSubmit={saveHarness} className="flex gap-2">
          <label className="sr-only" htmlFor="harness-id">Harness ID</label>
          <input id="harness-id" value={harnessId} onChange={(e) => setHarnessId(e.target.value)}
            placeholder="Harness ID, e.g. gs-7f3k9q" autoCapitalize="none" autoCorrect="off"
            className="min-w-0 flex-1 rounded-xl bg-zinc-800 px-4 text-xl" />
          <button type="submit" className="rounded-xl bg-zinc-800 px-5 text-xl font-bold active:bg-zinc-700">
            Save
          </button>
        </form>
        <BigButton variant="secondary" onClick={testBuzz} disabled={!settings?.harness_id}>Test buzz</BigButton>
      </section>

      {settings && (
        <section className="space-y-3" aria-labelledby="voice-heading">
          <h2 id="voice-heading" className="text-xl font-bold">Voice and alerts</h2>
          <p className="text-lg" id="rate-label">Speech rate: {settings.speech_rate}×</p>
          <div className="flex gap-2" role="group" aria-labelledby="rate-label">
            {RATES.map((r) => (
              <BigButton key={r} aria-pressed={settings.speech_rate === r}
                variant={settings.speech_rate === r ? 'primary' : 'secondary'}
                onClick={() => update({ speech_rate: r })}>
                {r}×
              </BigButton>
            ))}
          </div>
          <Toggle label="Detailed alerts" checked={settings.alert_verbosity === 'detailed'}
            onChange={(v) => update({ alert_verbosity: v ? 'detailed' : 'short' })} />
          <Toggle label="Buzz the harness with alerts" checked={settings.haptics_enabled}
            onChange={(v) => update({ haptics_enabled: v })} />
          <Toggle label="Describe what's ahead on obstacles and stops" checked={settings.auto_describe_on_stop}
            onChange={(v) => update({ auto_describe_on_stop: v })} />
        </section>
      )}

      {message && <p className="text-lg text-amber-300" role="status">{message}</p>}

      <BigButton onClick={start} className="mt-auto min-h-24 text-2xl">Start walk</BigButton>
      {!DEV_MODE && <BigButton variant="secondary" onClick={logout}>Sign out</BigButton>}
    </main>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-14 items-center justify-between gap-4 text-lg">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="size-7 shrink-0 accent-amber-400" />
    </label>
  )
}
