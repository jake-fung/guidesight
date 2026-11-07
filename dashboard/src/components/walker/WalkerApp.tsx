// Phone app for the walker: Setup (pair harness, preferences) -> Live Walk.
import { useState } from 'react'
import { useLiveLink } from '../../lib/live'
import Setup from './Setup'
import Walk from './Walk'

export default function WalkerApp() {
  const link = useLiveLink() // one socket shared by both screens
  const [walking, setWalking] = useState(false)

  return walking
    ? <Walk link={link} onEnd={() => setWalking(false)} />
    : <Setup link={link} onStart={() => setWalking(true)} />
}
