// Pair the UNO R4 harness by its HARNESS_ID (firmware/uno_r4/arduino_secrets.h) and test the buzzer.
import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { errorText } from './session'
import { useApp } from './state'
import { Chip, StatusPill } from './ui'

export function HarnessPairing({ compact }: { compact?: boolean }) {
  const { link } = useApp()
  const [id, setId] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => { setId(s.harness_id ?? ''); setSaved(s.harness_id) }).catch(() => {})
  }, [])

  async function save(e: FormEvent) {
    e.preventDefault()
    try {
      const s = await api.saveSettings({ harness_id: id.trim() || null })
      setSaved(s.harness_id)
      await link.refresh().catch(() => {})
      setMessage(null)
    } catch (err) {
      setMessage(`Couldn’t save: ${errorText(err)}`)
    }
  }

  async function testBuzz() {
    try {
      const { delivered } = await api.buzz('double')
      setMessage(delivered ? 'Buzz sent to the sensor.' : 'The sensor is offline.')
    } catch (err) {
      setMessage(`Buzz failed: ${errorText(err)}`)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={save} className="flex items-center gap-2">
        <label htmlFor="harness-id" className="sr-only">Sensor ID</label>
        <input id="harness-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="Sensor ID, e.g. gs-7f3k9q"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className="t-body-l h-12 min-w-0 flex-1 rounded-[14px] border-2 border-gs-line bg-gs-surface px-4 outline-none focus:border-gs-action" />
        <button type="submit" className="t-label-m h-12 rounded-full bg-gs-action px-5 text-white">Save</button>
      </form>
      {!compact && saved && (
        <div className="flex items-center justify-between gap-2">
          <StatusPill status={link.harnessOnline ? 'clear' : 'caution'}>{link.harnessOnline ? `${saved} connected` : `${saved} offline`}</StatusPill>
          <Chip onClick={testBuzz}>Test buzz</Chip>
        </div>
      )}
      {message && <p className="t-caption text-gs-muted" role="status">{message}</p>}
    </div>
  )
}
