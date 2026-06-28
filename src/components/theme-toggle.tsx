'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0)
    return () => window.clearTimeout(id)
  }, [])

  if (!mounted) {
    return (
      <button
        className="inline-flex h-9 w-9 items-center justify-center rounded-full opacity-0"
        aria-label="Toggle theme"
      />
    )
  }

  const isDark = (resolvedTheme ?? theme) === 'dark'

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="group relative inline-flex h-9 w-9 items-center justify-center rounded-full
                 bg-slate-100/80 hover:bg-slate-200/80
                 dark:bg-white/5 dark:hover:bg-white/10
                 border border-slate-200/60 dark:border-white/10
                 transition-all duration-300 ease-out
                 hover:scale-105 active:scale-95"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      <Sun
        className={`h-4 w-4 text-amber-500 transition-all duration-300 ${
          isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'
        } absolute`}
      />
      <Moon
        className={`h-4 w-4 text-blue-600 transition-all duration-300 ${
          isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'
        } absolute`}
      />
    </button>
  )
}
