import { useEffect, useRef, useState } from 'react'
import { AudioLines } from 'lucide-react'
import type { Card } from './deckImport'
import { getRecording } from './pronunciation'

export function WordAudio({ card }: { card: Card }) {
  const [message, setMessage] = useState<string | null>(null)
  const recordingRef = useRef<HTMLAudioElement | null>(null)
  const activeRef = useRef(true)
  const recording = getRecording(card)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      recordingRef.current?.pause()
      recordingRef.current = null
      if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  const speak = (fallback = false) => {
    if (!activeRef.current) return
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setMessage(fallback ? 'The recording could not play and device speech is unavailable.' : 'Pronunciation is unavailable on this device.')
      return
    }
    const voice = window.speechSynthesis.getVoices().find((item) => /^de(?:-|$)/i.test(item.lang))
    if (!voice) {
      setMessage(fallback ? 'The recording could not play and no German device voice is available.' : 'No German device voice is available. Check your device language and speech settings.')
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(card.prompt)
    utterance.lang = voice.lang
    utterance.voice = voice
    utterance.onerror = (event) => {
      if (activeRef.current && event.error !== 'interrupted' && event.error !== 'canceled') setMessage('The device could not play pronunciation.')
    }
    setMessage(fallback ? 'The recording could not play; using your device’s German voice.' : 'Using your device’s German voice.')
    window.speechSynthesis.speak(utterance)
  }

  const play = () => {
    if (!recording) {
      speak()
      return
    }
    recordingRef.current?.pause()
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    const audio = new Audio(recording.url)
    audio.preload = 'none'
    recordingRef.current = audio
    setMessage('Playing the word-only recording from Wikimedia Commons.')
    let failed = false
    const fallback = () => {
      if (!activeRef.current || recordingRef.current !== audio || failed) return
      failed = true
      speak(true)
    }
    audio.onerror = fallback
    audio.play().catch(fallback)
  }

  return (
    <div className="pronunciation">
      <button type="button" className="quiet-button pronunciation-button" onClick={play} aria-label={`Hear ${card.prompt}`}><AudioLines size={16} aria-hidden="true" /> Listen</button>
      {recording && <p className="pronunciation-credit">External word-only audio: <a href={recording.source} target="_blank" rel="noreferrer">{recording.author} / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a> · unchanged</p>}
      {message && <p className="pronunciation-message" role="status">{message}</p>}
    </div>
  )
}
