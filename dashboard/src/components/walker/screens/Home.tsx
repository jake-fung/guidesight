// D1 Home · D2 Speak (listening) · D3 Speak (answer) · S Accessibility Shortcut sheet
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { icons } from '../icons'
import { useApp, type Exchange } from '../state'
import { errorText } from '../session'
import { Button, Chip, Gap, Mascot, NavHeader, Screen, Toggle, VoiceBars, cx } from '../ui'
import { canListen, useAutoRead, useListen, voice } from '../voice'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function D1Home() {
  const { go, profile, setExchange, session } = useApp()
  const hello = `${greeting()}${profile.name ? `, ${profile.name}` : ''}`
  useAutoRead(`${hello}. Ask Sighty anything, or pick Guide me, Read text, Describe, or Find things.`)

  function describe() {
    setExchange({ question: 'What’s around me?', answer: null })
    go('d3')
    session.ask('Describe what’s around me.')
      .then((r) => setExchange({ question: 'What’s around me?', answer: r.alert.speak }))
      .catch((e) => setExchange({ question: 'What’s around me?', answer: null, error: errorText(e) }))
  }

  const categories = [
    { label: 'Guide me', icon: icons.catGuide, onClick: () => go('d4') },
    { label: 'Read text', icon: icons.catRead, onClick: () => go('d6') },
    { label: 'Describe', icon: icons.catDescribe, onClick: describe },
    { label: 'Find things', icon: icons.catFind, onClick: () => go('d2') },
  ]

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-gs-surface">
      <main className="flex flex-1 flex-col px-6 pb-4" style={{ paddingTop: 'max(6px, env(safe-area-inset-top))' }}>
        <div className="flex items-center justify-between gap-3">
          <h1 className="t-display-l">{greeting()},{profile.name && <><br />{profile.name}</>}</h1>
          <button type="button" onClick={() => go('d7')} aria-label="Settings"
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gs-tint active:bg-gs-line">
            <img src={icons.sliders} alt="" className="size-[22px]" />
          </button>
        </div>
        <Gap h={16} />
        <div className="flex items-center gap-3 rounded-full bg-gs-tint py-2 pl-[18px] pr-2">
          <img src={icons.search} alt="" className="size-[22px]" />
          <button type="button" onClick={() => { setExchange(null); go('d3') }} className="t-body-l flex-1 text-left text-gs-muted">
            Ask Sighty anything
          </button>
          <button type="button" onClick={() => go('d2')} aria-label="Speak to Sighty"
            className="flex size-11 items-center justify-center rounded-full bg-gs-action active:bg-gs-action-pressed">
            <img src={icons.mic22White} alt="" className="size-[22px]" />
          </button>
        </div>
        <Gap h={14} />
        <div className="grid grid-cols-2 gap-2.5">
          {categories.map((c) => (
            <button key={c.label} type="button" onClick={c.onClick}
              className="t-label-l flex min-w-0 items-center gap-3 whitespace-nowrap rounded-[20px] bg-gs-tint px-4 py-[18px] text-left active:bg-gs-line">
              <img src={c.icon} alt="" className="size-7 shrink-0" />{c.label}
            </button>
          ))}
        </div>
        <Gap h={20} />
        <h2 className="t-title-l">For you</h2>
        <Gap h={10} />
        <Banner tone="bg-gs-green" circle="bg-gs-green-2" title="Walk to the bus stop" sub="Saved route · 6 min" mood="Happy" onClick={() => go('d4')} />
        <Gap h={10} />
        <Banner tone="bg-gs-yellow" circle="bg-gs-yellow-2" title="Practice a crossing" sub="With Sighty · 5 min" mood="Listening" onClick={() => go('d4')} />
      </main>
      <nav aria-label="Main" className="sticky bottom-0 flex border-t-[1.5px] border-gs-line bg-gs-surface pt-2.5"
        style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom))' }}>
        <Tab icon={icons.tabToday} label="Today" current />
        <Tab icon={icons.tabGuide} label="Guide" onClick={() => go('d4')} />
        <Tab icon={icons.tabAsk} label="Ask" onClick={() => go('d2')} />
        <Tab icon={icons.tabYou} label="You" onClick={() => go('d7')} />
      </nav>
    </div>
  )
}

function Banner({ tone, circle, title, sub, mood, onClick }: { tone: string; circle: string; title: string; sub: string; mood: 'Happy' | 'Listening'; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('relative min-h-[124px] w-full shrink-0 overflow-hidden rounded-[24px] text-left', tone)}>
      <span aria-hidden className={cx('absolute -top-5 left-[200px] size-[180px] rounded-full', circle)} />
      <span className="relative flex w-[220px] flex-col gap-1 py-[30px] pl-5">
        <span className="t-title-m">{title}</span>
        <span className="t-caption">{sub}</span>
      </span>
      <Mascot mood={mood} size={100} className="!absolute left-[236px] top-10" />
    </button>
  )
}

function Tab({ icon, label, current, onClick }: { icon: string; label: string; current?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={current ? 'page' : undefined}
      className={cx('t-caption flex flex-1 flex-col items-center gap-[3px]', current ? 'text-gs-ink' : 'text-gs-muted')}>
      <img src={icon} alt="" className="size-6" />{label}
    </button>
  )
}

/** Sends a question and fills in the answer on D3. */
function useAsk() {
  const { session, setExchange } = useApp()
  return (question: string, payload: Blob | string) => {
    setExchange({ question, answer: null })
    session.ask(payload)
      .then((r) => setExchange({ question: r.transcript || question, answer: r.alert.speak }))
      .catch((e) => setExchange({ question, answer: null, error: errorText(e) }))
  }
}

export function D2Listening() {
  const { back, go, session } = useApp()
  const ask = useAsk()
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const [error, setError] = useState<string | null>(null)
  const finished = useRef(false)

  useEffect(() => {
    voice.stop() // don't record Sighty talking
    let rec: MediaRecorder | null = null
    let cancelled = false
    session.micStream()
      .then((stream) => {
        if (cancelled || typeof MediaRecorder === 'undefined') return
        rec = new MediaRecorder(stream)
        chunks.current = []
        rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
        rec.start()
        recorder.current = rec
      })
      .catch((e) => setError(`Microphone not available: ${errorText(e)}`))
    return () => {
      cancelled = true
      if (rec && rec.state !== 'inactive') rec.stop()
      rec?.stream.getTracks().forEach((t) => t.stop())
    }
  }, [session])

  const latest = useRef('')

  async function finish(text = latest.current) {
    if (finished.current) return
    finished.current = true
    const rec = recorder.current
    let audio: Blob | null = null
    if (rec && rec.state !== 'inactive') {
      await new Promise((r) => { rec.onstop = r; rec.stop() })
      audio = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
    }
    // Prefer the words the user just saw on screen; fall back to the recording for server-side STT.
    const payload = text.trim() || (audio?.size ? audio : null)
    if (!payload) {
      finished.current = false
      setError('I didn’t catch that. Try again.')
      return
    }
    ask(text.trim() || 'Your question', payload)
    go('d3')
  }

  // The browser's own recogniser gives the live transcript, and ends on a pause ("or just pause").
  const { heard } = useListen(true, (text) => finish(text))
  useEffect(() => {
    latest.current = heard.final || heard.interim
  }, [heard])

  const said = heard.final || ''
  const hearing = heard.interim
  return (
    <Screen>
      <NavHeader title="Listening" onBack={back} centered icon="close" />
      <Gap h={14} />
      <div className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-[18px] rounded-[28px] bg-gs-tint">
        <Mascot mood="Listening" size={180} />
        <VoiceBars heights={[10, 22, 36, 28, 44, 30, 18, 40, 26, 14, 8]} />
      </div>
      <Gap h={14} />
      <div className="flex shrink-0 flex-col gap-2 rounded-[24px] border border-gs-line bg-gs-tint px-5 py-[18px]" aria-live="polite">
        <p className="t-overline text-gs-muted">You’re saying</p>
        <p className="t-title-l">
          {said}{said && hearing ? ' ' : ''}<span className="text-gs-muted">{hearing || (!said ? '…' : '')}</span>
        </p>
        <p className="t-caption text-gs-muted">
          {error ?? (canListen ? 'Grey words are still being heard' : 'Live captions aren’t supported in this browser — your recording is sent when you tap.')}
        </p>
      </div>
      <Gap h={20} />
      <button type="button" onClick={() => finish()} aria-label="Done speaking"
        className="mx-auto flex size-[88px] shrink-0 items-center justify-center rounded-full bg-gs-action active:bg-gs-action-pressed">
        <span className="size-[26px] rounded-[7px] bg-white" />
      </button>
      <Gap h={10} />
      <p className="t-body-m text-center text-gs-muted">Tap when you’re done — or just pause</p>
    </Screen>
  )
}

/** Turns an answer into follow-up suggestions, e.g. "Guide me to the bench". */
function suggestions(ex: Exchange | null) {
  const things = ['bench', 'bus stop', 'crosswalk', 'door', 'stairs', 'exit', 'elevator', 'seat']
  const thing = ex?.answer ? things.find((t) => ex.answer!.toLowerCase().includes(t)) : undefined
  return [thing ? `Guide me to the ${thing}` : 'Guide me', 'What else is around?']
}

export function D3Answer() {
  const { back, go, exchange } = useApp()
  const ask = useAsk()
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const answer = exchange?.answer

  useEffect(() => {
    if (answer) voice.say(answer, { force: true })
    else if (exchange?.error) voice.say('Sorry, I couldn’t answer that. ' + exchange.error)
  }, [answer, exchange?.error])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    ask(text.trim(), text.trim())
    setText('')
    setTyping(false)
  }

  return (
    <Screen>
      <NavHeader title="Ask Sighty" onBack={back} />
      <Gap h={12} />
      <div className="flex flex-1 flex-col gap-3" aria-live="polite">
        {exchange ? (
          <>
            <div className="ml-auto flex max-w-[242px] flex-col gap-1 rounded-[22px] rounded-br-[6px] bg-gs-line px-[18px] py-3.5">
              <p className="t-caption text-gs-muted">You said</p>
              <p className="t-body-l">{exchange.question}</p>
            </div>
            <div className="flex items-start gap-2.5">
              <Mascot size={48} animate={false} />
              <div className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-[22px] rounded-tl-[6px] border-2 border-gs-line bg-gs-surface p-4">
                <p className="t-title-m">
                  {answer ?? (exchange.error ? 'Sorry, I couldn’t reach GuideSight. Check your connection and try again.' : 'Looking…')}
                </p>
                {answer && (
                  <div className="flex gap-2">
                    <Chip onClick={() => voice.stop()}>Stop</Chip>
                    <Chip onClick={() => voice.replay()}>Replay</Chip>
                  </div>
                )}
              </div>
            </div>
            {answer && (
              <div className="flex flex-col items-start gap-2">
                {suggestions(exchange).map((s) => (
                  <Chip key={s} onClick={() => (s.startsWith('Guide me') ? go('d4') : ask(s, s))}>{s}</Chip>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Mascot size={120} />
            <p className="t-title-m">What would you like to know?</p>
          </div>
        )}
      </div>
      <Gap h={12} />
      {/* Composer */}
      <form onSubmit={submit} className="flex shrink-0 flex-col gap-3.5 rounded-[24px] border border-gs-line bg-gs-tint pb-3 pl-5 pr-3 pt-[18px]">
        {typing ? (
          <>
            <label htmlFor="ask-input" className="sr-only">Type your question</label>
            <input id="ask-input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask Sighty anything…"
              className="t-body-l bg-transparent outline-none placeholder:text-gs-muted" enterKeyHint="send" />
          </>
        ) : <p className="t-body-l text-gs-muted">Ask Sighty anything…</p>}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setTyping((t) => !t)} aria-label={typing ? 'Close keyboard' : 'Type instead'} aria-pressed={typing}
            className="flex size-[52px] items-center justify-center rounded-full border-[1.5px] border-gs-line bg-gs-surface">
            <img src={icons.keyboard} alt="" className="size-[22px]" />
          </button>
          {typing && text.trim() ? (
            <button type="submit" className="t-label-l flex h-[52px] items-center rounded-full bg-gs-action px-6 text-white">Send</button>
          ) : (
            <button type="button" onClick={() => go('d2')} className="t-label-l flex h-[52px] items-center gap-2 rounded-full bg-gs-action pl-6 pr-[26px] text-white active:bg-gs-action-pressed">
              <img src={icons.mic22White} alt="" className="size-[22px]" />Speak
            </button>
          )}
        </div>
      </form>
    </Screen>
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
