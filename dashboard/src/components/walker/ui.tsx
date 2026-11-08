// Components from the Figma file's component set (v6 · Headspace style). Each one notes its Figma name.
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react'
import { dogFrames, icons } from './icons'
import { useSpeech, voice } from './voice'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** Page frame: full height on the phone, 24px side margins, safe-area aware. */
export function Screen({ children, className, bg = 'bg-gs-surface' }: { children: ReactNode; className?: string; bg?: string }) {
  return (
    <main
      className={cx('mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 pb-4', bg, className)}
      style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
    >
      {children}
    </main>
  )
}

export const Gap = ({ h }: { h: number }) => <div aria-hidden style={{ height: h, flexShrink: 0 }} />

// ---- Button (Type=Primary | Secondary | Ghost) ------------------------------------------------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }
export function Button({ variant = 'primary', className, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      className={cx(
        't-label-l flex h-14 w-full shrink-0 select-none items-center justify-center gap-2 rounded-full px-5 transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-gs-action text-white active:bg-gs-action-pressed',
        variant === 'secondary' && 'bg-gs-tint text-gs-ink active:bg-gs-line',
        variant === 'ghost' && 'text-gs-brand active:bg-gs-tint',
        className,
      )}
      {...rest}
    />
  )
}

// ---- Chip ---------------------------------------------------------------------------------------
export function Chip({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx('t-label-m shrink-0 rounded-full border-[1.5px] border-gs-line bg-gs-surface px-4 py-2.5 text-gs-ink active:bg-gs-tint', className)}
      {...rest}
    />
  )
}

// ---- Toggle (State=On | Off) ---------------------------------------------------------------------
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx('relative h-8 w-[52px] shrink-0 rounded-full transition-colors', on ? 'bg-gs-action' : 'bg-gs-line')}
    >
      <span
        className="absolute top-[3px] size-[26px] rounded-full bg-white transition-[left]"
        style={{ left: on ? 23 : 3, boxShadow: '0 2px 4px rgba(13, 26, 64, 0.18)' }}
      />
    </button>
  )
}

// ---- Option Card (Selected=Yes | No) ----------------------------------------------------------
export function OptionCard({ title, description, selected, onClick }: { title: string; description: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-4 rounded-[20px] text-left',
        selected ? 'border-[3px] border-gs-action bg-gs-selected p-[17px]' : 'border-2 border-gs-line bg-gs-surface p-[18px]',
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="t-option">{title}</span>
        <span className="t-body-m text-gs-muted">{description}</span>
      </span>
      {selected ? (
        <img src={icons.radioOn} alt="" className="size-7 shrink-0" />
      ) : (
        <span className="size-7 shrink-0 rounded-full border-2 border-gs-line" />
      )}
    </button>
  )
}

// ---- Nav row: Back (48px) + overline title -----------------------------------------------------
export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label}
      className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-gs-line bg-gs-surface active:bg-gs-tint">
      <img src={icons.chevLeft} alt="" className="size-[22px]" />
    </button>
  )
}

export function NavHeader({ title, onBack, centered, icon }: { title: string; onBack?: () => void; centered?: boolean; icon?: 'back' | 'close' }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3.5">
      {onBack && (icon === 'close' ? (
        <button type="button" onClick={onBack} aria-label="Cancel"
          className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-gs-line bg-gs-surface active:bg-gs-tint">
          <img src={icons.x22} alt="" className="size-[22px]" />
        </button>
      ) : <BackButton onClick={onBack} />)}
      <h1 className={cx('t-overline text-gs-brand', centered && 'flex-1 text-center')}>{title}</h1>
      {centered && <span className="size-12 shrink-0" />}
    </div>
  )
}

// ---- Step Header (Step=1..3) --------------------------------------------------------------------
export function StepHeader({ step, of = 3, onBack, onA11y }: { step: number; of?: number; onBack: () => void; onA11y: () => void }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3.5">
      <BackButton onClick={onBack} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={of} aria-valuenow={step} aria-label={`Step ${step} of ${of}`}>
        {Array.from({ length: of }, (_, i) => (
          <span key={i} className={cx('h-1.5 flex-1 rounded-[3px]', i < step ? 'bg-gs-action' : 'bg-gs-line')} />
        ))}
      </div>
      <span className="t-label-m shrink-0 text-gs-muted" aria-hidden>{step} of {of}</span>
      <A11yButton onClick={onA11y} />
    </div>
  )
}

export function A11yButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Accessibility shortcut"
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gs-ink active:opacity-80">
      <img src={icons.a11yWhite} alt="" className="size-6" />
    </button>
  )
}

// ---- Hero: coloured panel with two "sun rings" ------------------------------------------------
const HERO = {
  yellow: ['bg-gs-yellow', 'bg-gs-yellow-2', 'bg-gs-yellow-3'],
  orange: ['bg-gs-orange', 'bg-gs-orange-2', 'bg-gs-orange-3'],
  green: ['bg-gs-green', 'bg-gs-green-2', 'bg-gs-green-3'],
} as const
export type HeroTone = keyof typeof HERO

export function Hero({ tone, children, className, radius = 28, style }: { tone: HeroTone; children?: ReactNode; className?: string; radius?: number; style?: CSSProperties }) {
  const [bg, outer, inner] = HERO[tone]
  return (
    <div className={cx('relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden', bg, className)}
      style={{ borderRadius: radius, containerType: 'size', ...style }}>
      <SunRings outer={outer} inner={inner} />
      <div className="relative flex flex-col items-center">{children}</div>
    </div>
  )
}

/** Outer ring is 95% of the panel's long side (max 360px), inner ring 66% of that. */
export function SunRings({ outer, inner }: { outer: string; inner: string }) {
  return (
    <>
      <span aria-hidden className={cx('absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full', outer)}
        style={{ width: 'min(95cqmax, 360px)', height: 'min(95cqmax, 360px)' }} />
      <span aria-hidden className={cx('absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full', inner)}
        style={{ width: 'calc(min(95cqmax, 360px) * 0.66)', height: 'calc(min(95cqmax, 360px) * 0.66)' }} />
    </>
  )
}

/** White circle with an icon in the middle of a hero. */
export function IconBadge({ src, size = 104, icon = 44 }: { src: string; size?: number; icon?: number }) {
  return (
    <span className="flex items-center justify-center rounded-full bg-white" style={{ width: size, height: size }}>
      <img src={src} alt="" style={{ width: icon, height: icon }} />
    </span>
  )
}

// ---- Mascot / Sighty ------------------------------------------------------------------------------
export type Mood = keyof typeof dogFrames
export function Mascot({ mood = 'Happy', size = 200, animate = true, className }: { mood?: Mood; size?: number; animate?: boolean; className?: string }) {
  const s = size / 200
  const frames = dogFrames[mood]
  return (
    <span aria-hidden className={cx('relative block shrink-0', className)} style={{ width: size, height: size, ['--gs-phase' as string]: mood === 'Alert' ? '0.24s' : '1.2s' }}>
      {frames.map((f, i) => (
        <img key={i} src={f.src} alt="" draggable={false}
          className={cx('absolute max-w-none', animate ? (i === 0 ? 'gs-phase-a' : 'gs-phase-b') : i === 1 && 'hidden')}
          style={{ left: f.left * s, top: f.top * s, width: f.w * s, height: f.h * s }} />
      ))}
    </span>
  )
}

export function Radar({ size = 260 }: { size?: number }) {
  return (
    <span aria-hidden className="relative block shrink-0" style={{ width: size, height: size, ['--gs-phase' as string]: '1.6s' }}>
      <img src={icons.radar1} alt="" className="gs-phase-a absolute inset-0 size-full" />
      <img src={icons.radar2} alt="" className="gs-phase-b absolute inset-0 size-full" />
    </span>
  )
}

// ---- Voice level bars -------------------------------------------------------------------------------
export function VoiceBars({ heights, width = 5, gap = 5, color = 'bg-gs-ink', active = true }: { heights: number[]; width?: number; gap?: number; color?: string; active?: boolean }) {
  return (
    <span aria-hidden className="flex items-center" style={{ gap, height: Math.max(...heights) }}>
      {heights.map((h, i) => (
        <span key={i} className={cx('rounded-[2px]', color, active && 'gs-bar')}
          style={{ width, height: h, animationDelay: `${(i * 0.13) % 0.9}s` }} />
      ))}
    </span>
  )
}

// ---- Speaking Banner (State=Speaking | Paused) -----------------------------------------------------
/** Captions = speech. Spoken words are white, words still to come are 38% white. */
export function SpeakingBanner({ fallback }: { fallback: string }) {
  const speech = useSpeech()
  const text = speech.text || fallback
  const spokenTo = speech.text ? speech.spokenTo : 0
  const paused = speech.status === 'paused'
  const speaking = speech.status === 'speaking'
  return (
    <section aria-label="Sighty" className="flex w-full shrink-0 flex-col gap-3 rounded-[22px] bg-gs-ink px-[18px] py-4 text-white">
      <div className="flex items-center gap-2">
        <img src={icons.volume18White} alt="" className="size-[18px]" />
        <p className="t-caption flex-1">{paused ? 'Paused' : 'Sighty is reading this screen'}</p>
        {paused ? (
          <span aria-hidden className="flex gap-1">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="size-[3px] rounded-full bg-white" />)}</span>
        ) : (
          <VoiceBars heights={[6, 14, 20, 10, 16, 8]} width={3} gap={3} color="bg-white" active={speaking} />
        )}
      </div>
      <p className="t-title-m" aria-live="polite">
        <span>{text.slice(0, spokenTo)}</span>
        <span className="text-white/40">{text.slice(spokenTo)}</span>
      </p>
      <div className="flex gap-2">
        <BannerControl onClick={() => (paused ? voice.resume() : speaking ? voice.pause() : voice.replay())}>
          {paused ? 'Resume' : 'Pause'}
        </BannerControl>
        <BannerControl onClick={() => voice.replay()}>Replay</BannerControl>
        <BannerControl onClick={() => voice.slower()} aria-pressed={voice.isSlower}>Slower</BannerControl>
      </div>
    </section>
  )
}
function BannerControl(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="t-label-m rounded-full border-[1.5px] border-white px-4 py-2.5 active:bg-white/15" {...props} />
}

// ---- Voice-setup conversation pieces --------------------------------------------------------------
export function SightySays({ children }: { children: ReactNode }) {
  return (
    <section className="flex shrink-0 flex-col gap-2 rounded-[22px] bg-gs-ink px-[18px] py-4 text-white" aria-live="polite">
      <p className="t-caption flex items-center gap-2"><img src={icons.volume16White} alt="" className="size-4" />Sighty says</p>
      <p className="t-title-m">{children}</p>
    </section>
  )
}

export function YouSaid({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex shrink-0 justify-end">
      <div className="flex max-w-[85%] flex-col gap-1 rounded-[20px] rounded-br-[6px] bg-gs-tint px-4 py-3">
        <p className="t-caption flex items-center gap-1.5 text-gs-muted"><img src={icons.mic14} alt="" className="size-3.5" />You said</p>
        <p className="t-label-l">{children}</p>
        {sub}
      </div>
    </div>
  )
}

export function SightyReplied({ children }: { children: ReactNode }) {
  return (
    <p className="t-body-m flex shrink-0 items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gs-clear-bg"><img src={icons.checkGreen} alt="" className="size-4" /></span>
      {children}
    </p>
  )
}

export function VoiceHint({ children }: { children: ReactNode }) {
  return (
    <p className="t-caption flex shrink-0 items-center justify-center gap-2 text-gs-muted">
      <img src={icons.mic16} alt="" className="size-4" />{children}
    </p>
  )
}

export function ListeningPill({ children }: { children: ReactNode }) {
  return (
    <p className="t-caption flex shrink-0 items-center justify-center gap-2 rounded-full bg-gs-tint py-2.5">
      <img src={icons.mic18Blue} alt="" className="size-[18px]" />{children}
    </p>
  )
}

// ---- Text Field (State=Default | Focused | Filled) ------------------------------------------------
type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; onMic?: () => void; micActive?: boolean }
export function TextField({ label, onMic, micActive, id, ...rest }: FieldProps) {
  const inputId = id ?? `f-${label.replace(/\W/g, '').toLowerCase()}`
  return (
    <div className="flex w-full shrink-0 flex-col gap-2">
      <label htmlFor={inputId} className="t-label-m">{label}</label>
      <div className="flex h-16 items-center gap-3 rounded-[18px] border-2 border-gs-line bg-gs-surface pl-5 pr-2.5 focus-within:border-[3px] focus-within:border-gs-action focus-within:pl-[19px] focus-within:pr-[9px]">
        <input id={inputId} className="t-title-m min-w-0 flex-1 bg-transparent font-normal outline-none placeholder:text-gs-muted" {...rest} />
        {onMic && (
          <button type="button" onClick={onMic} aria-label={micActive ? 'Stop listening' : 'Speak instead of typing'} aria-pressed={micActive}
            className={cx('flex size-11 shrink-0 items-center justify-center rounded-full', micActive ? 'bg-gs-selected ring-2 ring-gs-action' : 'bg-gs-tint')}>
            <img src={icons.mic20} alt="" className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}

// ---- Code Digit row -------------------------------------------------------------------------------
export function CodeBoxes({ value, size = 'lg' }: { value: string; size?: 'lg' | 'sm' }) {
  const focus = Math.min(value.length, 5)
  return (
    <div aria-hidden className={cx('flex', size === 'lg' ? 'gap-1.5' : 'gap-1.5')}>
      {Array.from({ length: 6 }, (_, i) => {
        const filled = i < value.length
        const focused = size === 'lg' && i === focus && value.length < 6
        return (
          <span key={i} className={cx(
            'flex items-center justify-center bg-gs-surface font-semibold',
            size === 'lg' ? 'h-[60px] w-12 rounded-[14px] text-[28px]' : 'h-[50px] w-[38px] rounded-[12px] text-[24px]',
            focused ? 'border-[3px] border-gs-action' : 'border-2 border-gs-line',
          )}>
            {filled ? value[i] : focused ? <span className="h-7 w-0.5 bg-gs-action" /> : null}
          </span>
        )
      })}
    </div>
  )
}

// ---- Status Pill (Status=Clear | Caution | Stop) ---------------------------------------------------
export function StatusPill({ status, children }: { status: 'clear' | 'caution' | 'stop'; children: ReactNode }) {
  const bg = { clear: 'bg-gs-clear-bg', caution: 'bg-gs-caution-bg', stop: 'bg-gs-stop-bg' }[status]
  const dot = { clear: 'bg-gs-clear', caution: 'bg-gs-caution', stop: 'bg-gs-stop' }[status]
  return (
    <p role="status" className={cx('t-label-m inline-flex items-center gap-2 rounded-full py-2 pl-3 pr-3.5', bg)}>
      <span className={cx('size-2.5 rounded-full', dot)} />{children}
    </p>
  )
}

// ---- Stat Tile (Tone=Blue | Yellow | Green | Pink) ------------------------------------------------
const TILE = {
  blue: 'bg-tile-blue text-tile-blue-fg',
  yellow: 'bg-tile-yellow text-gs-ink',
  green: 'bg-tile-green text-tile-green-fg',
  pink: 'bg-tile-pink text-tile-pink-fg',
}
export function StatTile({ label, value, tone }: { label: string; value: string; tone: keyof typeof TILE }) {
  return (
    <div className={cx('flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-[18px] px-3.5 py-3', TILE[tone])}>
      <span className="t-overline">{label}</span>
      <span className="t-title-l whitespace-nowrap">{value}</span>
    </div>
  )
}

// ---- Step Card ------------------------------------------------------------------------------------------
export function StepCard({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-center gap-4 rounded-[18px] bg-gs-tint py-4 pl-5 pr-[18px]">
      <span className="t-display-l">{n}</span>
      <span className="t-label-m flex-1">{children}</span>
    </li>
  )
}

// ---- List Row (State=Default | Done) ----------------------------------------------------------------
export function ListRow({ title, subtitle, done, onAction, action = 'Sure!' }: { title: string; subtitle: string; done: boolean; onAction: () => void; action?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-gs-tint px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="t-label-m">{title}</p>
        <p className="t-caption text-gs-muted">{subtitle}</p>
      </div>
      <button type="button" onClick={onAction} aria-pressed={done} aria-label={`${title} ${done ? 'Done' : action}`}
        className={cx('t-label-m flex shrink-0 items-center gap-1.5 rounded-full border-2 px-4 py-[7px] transition-colors',
          done ? 'border-gs-action bg-gs-action text-white' : 'border-gs-action bg-gs-surface text-gs-brand')}>
        {done && <img src={icons.checkWhite} alt="" className="size-4" />}
        {done ? 'Done' : action}
      </button>
    </div>
  )
}

// ---- Action Bar --------------------------------------------------------------------------------------
export function ActionBar({ label, onClose, onPrimary }: { label: string; onClose: () => void; onPrimary: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <button type="button" onClick={onClose} aria-label="Close" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gs-tint active:bg-gs-line">
        <img src={icons.x22} alt="" className="size-[22px]" />
      </button>
      <Button onClick={onPrimary} className="flex-1">{label}</Button>
    </div>
  )
}

export { cx }
