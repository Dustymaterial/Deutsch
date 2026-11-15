import { useEffect, useState } from 'react'
import App from './App.tsx'

export default function AppStartup() {
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashLeaving, setSplashLeaving] = useState(false)

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const leaveTimer = window.setTimeout(() => setSplashLeaving(true), reducedMotion ? 150 : 1000)
    const removeTimer = window.setTimeout(() => setSplashVisible(false), reducedMotion ? 150 : 1250)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(removeTimer)
    }
  }, [])

  return (
    <>
      <div inert={splashVisible}>
        <App />
      </div>
      {splashVisible && (
        <div className={`startup-splash${splashLeaving ? ' startup-splash-leaving' : ''}`} role="status" aria-label="Loading Deutsch Deck">
          <div className="startup-logo" aria-hidden="true">d</div>
          <div className="startup-name" aria-hidden="true">deutsch deck</div>
        </div>
      )}
    </>
  )
}
