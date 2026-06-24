'use client'
import { motion, AnimatePresence } from 'framer-motion'
import { Loader2, CheckCircle2, FileText, Brain, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface UploadProgress { fileName: string; fileType: string; status: 'uploading' | 'analyzing' | 'done' | 'failed'; message?: string }
export function UploadProgressIndicator({ uploads }: { uploads: UploadProgress[] }) {
  if (!uploads.length) return null
  return <div className="px-4 py-2 space-y-2"><AnimatePresence>{uploads.map((u, i) => <motion.div key={i} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className={cn('flex items-center gap-3 px-3 py-2.5 rounded-lg border', u.status === 'done' ? 'bg-blue-50 border-blue-200' : u.status === 'failed' ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200')}><div className="flex-shrink-0">{u.status === 'analyzing' && <Brain className="w-4 h-4 text-amber-500 animate-pulse" />}{u.status === 'done' && <CheckCircle2 className="w-4 h-4 text-blue-600" />}{u.status === 'failed' && <AlertCircle className="w-4 h-4 text-rose-500" />}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-1.5"><FileText className="w-3 h-3 text-slate-400" /><span className="text-sm font-medium text-slate-800 truncate">{u.fileName}</span></div><div className="text-xs text-slate-500 mt-0.5">{u.status === 'analyzing' ? (u.message || 'AI analyzing…') : u.status === 'done' ? 'Complete' : u.status === 'failed' ? (u.message || 'Failed') : 'Uploading…'}</div></div>{u.status === 'analyzing' && <div className="flex-shrink-0 w-20 h-1.5 bg-amber-200 rounded-full overflow-hidden"><motion.div className="h-full bg-amber-500" initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 60, ease: 'linear' }} /></div>}</motion.div>)}</AnimatePresence></div>
}
