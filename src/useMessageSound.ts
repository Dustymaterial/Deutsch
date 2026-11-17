import { useCallback, useEffect, useRef, useState } from 'react'

const preferenceKey = 'deutsch-message-sound-enabled'
const soundInterval = 1500

export function useMessageSound(accountId: string | null) {
  const [preference, setPreference] = useState(() => {
    try { return { enabled: localStorage.getItem(preferenceKey) !== 'false', error: null as string | null } }
    catch { return { enabled: false, error: 'Could not read the message sound preference on this device.' } }
  })
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting')
  const [audioProblem, setAudioProblem] = useState<string | null>(null)
  const audio = useRef<AudioContext | null>(null)
  const lastSound = useRef(0)

  const unlock = useCallback(() => {
    if (!window.AudioContext) {
      setAudioProblem('Message sounds are not supported by this browser.')
      return
    }
    try {
      const context = audio.current ?? new AudioContext()
      audio.current = context
      if (context.state === 'running') { setAudioProblem(null); return }
      void context.resume().then(() => {
        if (context.state === 'running') setAudioProblem(null)
        else setAudioProblem('Tap the app to enable message sounds.')
      }).catch((error: unknown) => {
        console.error('Could not enable message sounds:', error)
        setAudioProblem('Could not enable message sounds in this browser.')
      })
    } catch (error) {
      console.error('Could not initialize message sounds:', error)
      setAudioProblem('Could not initialize message sounds in this browser.')
    }
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(preferenceKey, String(enabled))
      setPreference({ enabled, error: null })
      if (enabled && accountId) unlock()
    } catch {
      setPreference((current) => ({ ...current, error: 'Could not save the message sound preference on this device.' }))
    }
  }, [accountId, unlock])

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === preferenceKey) setPreference({ enabled: event.newValue !== 'false', error: null })
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  useEffect(() => {
    if (!accountId || !preference.enabled) return
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [accountId, preference.enabled, unlock])

  useEffect(() => {
    if (!accountId || !preference.enabled) return
    const source = new EventSource('/api/companions/message-sounds/live')
    const opened = () => setConnection('connected')
    const disconnected = () => setConnection('offline')
    const play = () => {
      const context = audio.current
      if (!context || context.state !== 'running') {
        setAudioProblem('Tap the app to enable message sounds.')
        return
      }
      const now = Date.now()
      if (now - lastSound.current < soundInterval) return
      lastSound.current = now
      try {
        const tone = context.createOscillator()
        const volume = context.createGain()
        const start = context.currentTime
        tone.type = 'sine'
        tone.frequency.setValueAtTime(392, start)
        tone.frequency.exponentialRampToValueAtTime(370, start + 0.23)
        volume.gain.setValueAtTime(0.0001, start)
        volume.gain.exponentialRampToValueAtTime(0.035, start + 0.025)
        volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.25)
        tone.connect(volume)
        volume.connect(context.destination)
        tone.start(start)
        tone.stop(start + 0.26)
      } catch (error) {
        console.error('Could not play the message sound:', error)
        setAudioProblem('Could not play the message sound in this browser.')
      }
    }
    source.addEventListener('open', opened)
    source.addEventListener('error', disconnected)
    source.addEventListener('message', play)
    return () => source.close()
  }, [accountId, preference.enabled])

  useEffect(() => () => {
    const context = audio.current
    if (context && context.state !== 'closed') {
      void context.close().catch((error: unknown) => console.error('Could not close message audio:', error))
    }
  }, [])

  return { enabled: preference.enabled, setEnabled, error: preference.error ?? audioProblem, connection }
}
