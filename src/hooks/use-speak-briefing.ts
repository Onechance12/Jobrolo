'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export function sanitizeSpeakableBriefing(text: string) {
  return text
    .replace(/\b(?:claim|policy)\s*#?:?\s*[A-Z0-9-]{4,}\b/gi, 'claim details are available on screen')
    .replace(/\$\s?\d[\d,]*(?:\.\d{2})?/g, 'a dollar amount shown on screen')
    .replace(/\b(?:deductible|RCV|ACV|depreciation|mortgage)\b[^.]*\./gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function useSpeakBriefing() {
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [supported] = useState(() => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window)

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  const stop = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    setIsSpeaking(false)
    setIsPaused(false)
  }, [supported])

  const speak = useCallback((text: string) => {
    if (!supported || !text.trim()) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(sanitizeSpeakableBriefing(text))
    utterance.rate = 1
    utterance.pitch = 1
    utterance.onstart = () => { setIsSpeaking(true); setIsPaused(false) }
    utterance.onend = () => { setIsSpeaking(false); setIsPaused(false) }
    utterance.onerror = () => { setIsSpeaking(false); setIsPaused(false) }
    window.speechSynthesis.speak(utterance)
  }, [supported])

  const pause = useCallback(() => {
    if (!supported || !window.speechSynthesis.speaking) return
    window.speechSynthesis.pause()
    setIsPaused(true)
  }, [supported])

  const resume = useCallback(() => {
    if (!supported) return
    window.speechSynthesis.resume()
    setIsPaused(false)
  }, [supported])

  return useMemo(() => ({ supported, isSpeaking, isPaused, speak, stop, pause, resume }), [supported, isSpeaking, isPaused, speak, stop, pause, resume])
}
