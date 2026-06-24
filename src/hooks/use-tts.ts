'use client'
import { useState, useRef, useEffect } from 'react'
export function useTTS(options: { autoPlay?: boolean } = {}) {
  const { autoPlay = true } = options
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [currentText, setCurrentText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    audioRef.current = new Audio()
    const a = audioRef.current
    a.addEventListener('playing', () => setIsPlaying(true))
    a.addEventListener('pause', () => setIsPlaying(false))
    a.addEventListener('ended', () => { setIsPlaying(false); setCurrentText(null) })
    a.addEventListener('error', () => { setIsPlaying(false); setIsLoading(false); setCurrentText(null) })
    return () => { a.pause(); audioRef.current = null }
  }, [])

  const stop = () => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    setIsPlaying(false); setCurrentText(null)
  }

  const speak = async (text: string, opts?: { voice?: string; speed?: number }) => {
    if (!text?.trim()) return
    setError(null)
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    setCurrentText(text); setIsLoading(true)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: opts?.voice ?? 'tongtong', speed: opts?.speed ?? 1.0 }),
      })
      if (!res.ok) {
        // TTS service unavailable (429 rate limit, 500, etc.) — fail silently
        // Don't throw, don't log to console — just don't play audio
        setIsLoading(false)
        setCurrentText(null)
        return
      }
      const data = await res.json()
      if (!data.url) { setIsLoading(false); setCurrentText(null); return }
      if (audioRef.current) {
        audioRef.current.src = data.url
        if (autoPlay) {
          try { await audioRef.current.play() } catch {}
        }
      }
    } catch {
      // Network error or other failure — fail silently
      setCurrentText(null)
    } finally {
      setIsLoading(false)
    }
  }

  return { speak, stop, isPlaying, isLoading, currentText, error }
}
