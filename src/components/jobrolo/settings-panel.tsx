'use client'

import { useState } from 'react'
import { Settings, X, Volume2, Mic, Bell } from 'lucide-react'
import { cn } from '@/lib/utils'

const SETTINGS_KEY = 'jobrolo-settings'

interface JobroloSettings {
  autoTTS: boolean
  voice: string
  speed: number
  pushToTalk: boolean
}

const DEFAULT_SETTINGS: JobroloSettings = {
  autoTTS: false,
  voice: 'tongtong',
  speed: 1.0,
  pushToTalk: true,
}

const VOICES = [
  { id: 'tongtong', label: 'Tongtong — warm, friendly' },
  { id: 'chuichui', label: 'Chuichui — lively' },
  { id: 'xiaochen', label: 'Xiaochen — professional' },
  { id: 'jam', label: 'Jam — British gentleman' },
  { id: 'kazi', label: 'Kazi — clear, standard' },
  { id: 'douji', label: 'Douji — natural' },
  { id: 'luodo', label: 'Luodo — expressive' },
]

export function SettingsButton() {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<JobroloSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS
  })

  const update = (updates: Partial<JobroloSettings>) => {
    const next = { ...settings, ...updates }
    setSettings(next)
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    } catch {
      // ignore
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-2 rounded-md hover:bg-slate-100 text-slate-600"
        aria-label="Settings"
      >
        <Settings className="w-5 h-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            className="relative z-10 bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Settings</h2>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-md hover:bg-slate-100 text-slate-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-5">
              {/* Voice output section */}
              <section>
                <div className="flex items-center gap-2 mb-3 text-slate-900 font-medium">
                  <Volume2 className="w-4 h-4" />
                  Voice Output
                </div>

                <div className="space-y-3">
                  <ToggleRow
                    label="Auto-play AI responses"
                    description="Speak AI replies aloud automatically (good for hands-free)"
                    checked={settings.autoTTS}
                    onChange={(v) => update({ autoTTS: v })}
                  />

                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">
                      Voice
                    </label>
                    <select
                      value={settings.voice}
                      onChange={(e) => update({ voice: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 dark:text-slate-100"
                    >
                      {VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">
                      Speed: {settings.speed.toFixed(1)}x
                    </label>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={settings.speed}
                      onChange={(e) =>
                        update({ speed: parseFloat(e.target.value) })
                      }
                      className="w-full accent-blue-600"
                    />
                  </div>
                </div>
              </section>

              {/* Voice input section */}
              <section>
                <div className="flex items-center gap-2 mb-3 text-slate-900 font-medium">
                  <Mic className="w-4 h-4" />
                  Voice Input
                </div>
                <ToggleRow
                  label="Push to talk"
                  description="Hold mic button to record, release to send. Off = tap to start/stop."
                  checked={settings.pushToTalk}
                  onChange={(v) => update({ pushToTalk: v })}
                />
              </section>

              {/* Notifications */}
              <section>
                <div className="flex items-center gap-2 mb-3 text-slate-900 font-medium">
                  <Bell className="w-4 h-4" />
                  Notifications
                </div>
                <p className="text-xs text-slate-500">
                  Push notifications coming soon — for now Jobrolo is quiet.
                </p>
              </section>

              <div className="pt-4 border-t border-slate-200 text-xs text-slate-400 text-center">
                Jobrolo · v1.0 · Built for the field
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        {description && (
          <div className="text-xs text-slate-500 mt-0.5">{description}</div>
        )}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'flex-shrink-0 w-11 h-6 rounded-full transition-colors relative',
          checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
        )}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-5'
          )}
        />
      </button>
    </div>
  )
}
