'use client'

import { useEffect } from 'react'

const SERVICE_WORKER_PATH = '/sw.js'

function canRegisterServiceWorker() {
  if (typeof window === 'undefined') return false
  if (!('serviceWorker' in navigator)) return false
  return window.location.protocol === 'https:' || window.location.hostname === 'localhost'
}

export function PwaRegister() {
  useEffect(() => {
    if (!canRegisterServiceWorker()) return

    let cancelled = false

    window.addEventListener('load', () => {
      if (cancelled) return
      navigator.serviceWorker
        .register(SERVICE_WORKER_PATH)
        .catch(err => {
          console.warn('[pwa] service worker registration failed:', err)
        })
    }, { once: true })

    return () => {
      cancelled = true
    }
  }, [])

  return null
}
