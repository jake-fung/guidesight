// D2 Where to? — say (or type) a place, hear what Google Maps found, tap to start guiding there.
import { useEffect, useRef, useState } from 'react'
import { api, type Route } from '../../../lib/api'
import { DEMO, demoRoute } from '../demo'
import { askCompass, routeSummary, shortDistance } from '../navigation'
import { errorText } from '../session'
import { useApp } from '../state'
import { useTaps } from '../taps'
import { useLiveTranscript } from '../transcribe'
import { Button, Gap, Hero, Mascot, NavHeader, Screen, TextField, VoiceBars, cx } from '../ui'
import { buzz, voice } from '../voice'

const INTRO = 'Where would you like to go? Tap the screen, say a place or an address, then tap again. ' +
  'To walk without a destination, double-tap.'
const FOUND_HINT = 'Tap the screen to start, or double-tap to choose somewhere else.'

type Phase =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'searching'; query: string }
  | { kind: 'found'; route: Route }
  | { kind: 'error'; message: string }

export function D2Destination() {
  const { go, back, session } = useApp()
  const live = useLiveTranscript()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [typed, setTyped] = useState('')
  // True while Sighty says "Where to?", before the mic starts (so the words aren't recorded).
  const [preparing, setPreparing] = useState(false)
  /** Bumped whenever the screen moves on, so a slow mic start or search that's no longer wanted is dropped. */
  const run = useRef(0)

  useEffect(() => {
    void voice.say(INTRO, { force: true })
    return () => voice.stop()
  }, [])

  // A mic that fails goes back to the start (the card shows why).
  const shown: Phase = phase.kind === 'recording' && live.error ? { kind: 'error', message: live.error } : phase

  async function record() {
    const id = ++run.current
    buzz(30)
    setPhase({ kind: 'recording' })
    setPreparing(true)
    await voice.say('Where to?', { force: true })
    if (id !== run.current) return
    setPreparing(false)
    live.start()
  }

  async function finishRecording() {
    buzz(40)
    const query = (await live.finish()).trim()
    if (query) return search(query)
    setPhase({ kind: 'idle' })
    voice.say('I didn’t catch that. Tap the screen to try again.', { force: true })
  }

  async function search(query: string) {
    const id = ++run.current
    live.cancel()
    setPhase({ kind: 'searching', query })
    void voice.say(`Looking for ${query}.`, { force: true })
    try {
      const route = DEMO ? demoRoute(query) : await api.route(query, await session.locate())
      if (id !== run.current) return
      setPhase({ kind: 'found', route })
      buzz([40, 60, 40])
      void voice.say(`${routeSummary(route)} ${FOUND_HINT}`, { force: true })
    } catch (e) {
      if (id !== run.current) return
      const message = errorText(e)
      setPhase({ kind: 'error', message })
      voice.say(`${message} Tap the screen to try again.`, { force: true })
    }
  }

  function startGuiding(route: Route | null) {
    run.current++
    live.cancel()
    voice.stop()
    buzz(40)
    session.setRoute(route)
    go('d4')
  }

  function chooseAgain() {
    run.current++
    live.cancel()
    setPhase({ kind: 'idle' })
    void record()
  }

  const tap = useTaps(
    () => {
      if (shown.kind === 'recording') {
        if (!preparing && !live.starting) void finishRecording()
      } else if (shown.kind === 'found') startGuiding(shown.route)
      else if (shown.kind !== 'searching') void record()
    },
    () => {
      if (shown.kind === 'found') chooseAgain()
      else if (shown.kind === 'recording') {
        run.current++
        live.cancel()
        setPreparing(false)
        setPhase({ kind: 'idle' })
        voice.say('Cancelled. Tap the screen to say a place.', { force: true })
      } else if (shown.kind !== 'searching') startGuiding(null)
    },
  )

  /** Buttons and the text box keep their own taps. */
  const own = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <Screen>
      <NavHeader title="Where to?" onBack={back} />
      <Gap h={12} />
      {/* The compass permission (iPhone) has to be asked inside the tap itself. */}
      <div className="flex min-h-0 flex-1 cursor-pointer select-none flex-col" onClick={() => { askCompass(); tap() }}>
        <Hero tone={shown.kind === 'found' ? 'green' : 'yellow'} radius={32} className="min-h-[150px] flex-1">
          <Mascot mood={shown.kind === 'recording' ? 'Listening' : shown.kind === 'error' ? 'Alert' : 'Happy'} size={120} />
        </Hero>
        <Gap h={14} />
        <section className={cx('flex shrink-0 flex-col gap-2 rounded-[22px] border-2 bg-gs-surface p-4',
          shown.kind === 'recording' ? 'border-dashed border-gs-action' : 'border-gs-line')} aria-live="polite">
          {shown.kind === 'recording' ? (
            <>
              <p className="t-caption flex items-center gap-2 text-gs-stop">
                <span className="size-2 rounded-full bg-gs-stop" />
                <span className="flex-1">{preparing || live.starting ? 'Starting the microphone…' : 'Listening… tap anywhere when you’re done'}</span>
                <VoiceBars heights={[6, 12, 18, 10, 16, 8, 14, 6]} width={3} gap={3} color="bg-gs-action" active={!preparing && !live.starting} />
              </p>
              <p className={cx('t-title-l break-words', !live.text && 'text-gs-muted')}>{live.text || 'Say a place or an address'}</p>
            </>
          ) : shown.kind === 'searching' ? (
            <p className="t-title-l">Looking for “{shown.query}”…</p>
          ) : shown.kind === 'found' ? (
            <>
              <p className="t-overline text-gs-muted">Found</p>
              <p className="t-title-l">{shown.route.destination.name}</p>
              {shown.route.destination.address && <p className="t-body-m text-gs-muted">{shown.route.destination.address}</p>}
              <p className="t-label-l">
                {shortDistance(shown.route.distance_m)} · {Math.max(1, Math.round(shown.route.duration_s / 60))} min walk
              </p>
            </>
          ) : shown.kind === 'error' ? (
            <p className="t-title-m" role="alert">{shown.message}</p>
          ) : (
            <p className="t-title-l">Tap anywhere and say where you’d like to go.</p>
          )}
        </section>
        <Gap h={14} />
        {shown.kind !== 'found' && shown.kind !== 'recording' && (
          <form id="destination" className="shrink-0 cursor-auto" onClick={own}
            onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void search(typed.trim()) }}>
            <TextField label="Or type a place" value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder="Library, 123 Main St…" enterKeyHint="search" autoComplete="off" />
          </form>
        )}
        <Gap h={14} />
        <div className="flex shrink-0 gap-2.5" onClick={own}>
          {shown.kind === 'found' ? (
            <>
              <Button variant="secondary" className="flex-1" onClick={chooseAgain}>Change</Button>
              <Button className="flex-1" onClick={() => startGuiding(shown.route)}>Start</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" className="flex-1" onClick={() => startGuiding(null)}>Just walk</Button>
              {shown.kind !== 'recording' && (
                <Button type="submit" form="destination" className="flex-1" disabled={!typed.trim() || shown.kind === 'searching'}>Search</Button>
              )}
            </>
          )}
        </div>
      </div>
    </Screen>
  )
}
