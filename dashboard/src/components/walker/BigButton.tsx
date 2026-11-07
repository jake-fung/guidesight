// Large, high-contrast controls: most walkers use VoiceOver/TalkBack, so buttons get real
// <button> semantics, visible labels and generous touch targets.
import type { ButtonHTMLAttributes } from 'react'

const VARIANTS = {
  primary: 'bg-amber-400 text-zinc-950 active:bg-amber-300',
  secondary: 'bg-zinc-800 text-white active:bg-zinc-700',
  danger: 'bg-red-500 text-white active:bg-red-400',
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof VARIANTS }

export default function BigButton({ variant = 'primary', className = '', ...rest }: Props) {
  return (
    <button
      type="button"
      className={`min-h-16 w-full select-none rounded-2xl px-4 py-4 text-xl font-bold disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}
