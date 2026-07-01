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

    const register = () => {
      if (cancelled) return
      navigator.serviceWorker
        .register(SERVICE_WORKER_PATH)
        .then(registration => {
          registration.update().catch(() => undefined)
        })
        .catch(err => {
          console.warn('[pwa] service worker registration failed:', err)
        })
    }

    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
    }

    return () => {
      cancelled = true
      window.removeEventListener('load', register)
    }
  }, [])

  return null
}
