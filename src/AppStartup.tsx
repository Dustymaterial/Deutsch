import { useEffect, useState } from 'react'
import App from './App.tsx'
import { loadDeck, type LoadedDeck } from './starterDeck'

export default function AppStartup() {
  const [deck, setDeck] = useState<LoadedDeck | null>(null)
  const [failure, setFailure] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashLeaving, setSplashLeaving] = useState(false)

  useEffect(() => {
    let active = true
    void loadDeck().then((loaded) => {
      if (active) setDeck(loaded)
    }).catch((error: unknown) => {
      if (!active) return
      console.error('Could not load the starter vocabulary.', error)
      setFailure(true)
      setSplashVisible(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!deck) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      const timer = window.setTimeout(() => setSplashVisible(false), 0)
      return () => window.clearTimeout(timer)
    }
    const frame = window.requestAnimationFrame(() => setSplashLeaving(true))
    const removeTimer = window.setTimeout(() => setSplashVisible(false), 300)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(removeTimer)
    }
  }, [deck])

  return (
    <>
      <div inert={splashVisible && !splashLeaving}>
        {deck ? <App initialDeck={deck} /> : failure && <main className="app-shell empty-state" role="alert">
          <p>Could not load the starter vocabulary. Check your connection and reload the app to try again.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload app</button>
        </main>}
      </div>
      {splashVisible && (
        <div className={`startup-splash${splashLeaving ? ' startup-splash-leaving' : ''}`} role="status" aria-label="Loading Deutsch Deck" aria-hidden={splashLeaving || undefined}>
          <div className="startup-logo" aria-hidden="true">d</div>
          <div className="startup-name" aria-hidden="true">deutsch deck</div>
        </div>
      )}
    </>
  )
}
