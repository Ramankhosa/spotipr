'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  Beaker,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileSearch,
  FileText,
  FlaskConical,
  GitBranch,
  Layers3,
  Network,
  RefreshCw,
  Route,
  Scale,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import AnimatedLogo from '@/components/ui/animated-logo'
import { Button } from '@/components/ui/button'

export type Stage0PatentIntelligenceStatus = 'running' | 'success' | 'error'
export type Stage0PatentIntelligenceMode = 'enhance' | 'preserve'

interface Stage0PatentIntelligenceOverlayProps {
  open: boolean
  mode: Stage0PatentIntelligenceMode
  title: string
  disclosureLength: number
  startedAt: number | Date | null
  status: Stage0PatentIntelligenceStatus
  errorMessage?: string
  onRetry: () => void
  onReturnToEditor: () => void
}

const PHASES = [
  { label: 'Reading invention disclosure', icon: FileSearch },
  { label: 'Separating source-stated facts from assumptions', icon: ShieldCheck },
  { label: 'Identifying the core inventive architecture', icon: Network },
  { label: 'Extracting elements, materials, steps, and relationships', icon: Layers3 },
  { label: 'Mapping technical, compositional, or process support', icon: FlaskConical },
  { label: 'Preserving claim-support facts', icon: Scale },
  { label: 'Detecting patent type and drafting category', icon: BookOpen },
  { label: 'Planning claim, figure, and description signals', icon: Route },
  { label: 'Validating review-ready structure', icon: CheckCircle2 },
  { label: 'Finalizing normalized invention record', icon: FileText },
]

const TRUST_NOTES = [
  'This step helps prevent unsupported claim language.',
  'PatentNest is separating source-stated facts from inferred structure.',
  'The normalized structure is reused by claims, figures, and drafting.',
  'Longer disclosures require deeper element and support mapping.',
]

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setPrefersReducedMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return prefersReducedMotion
}

function estimateDurationMs(disclosureLength: number) {
  if (disclosureLength < 1800) return 50000
  if (disclosureLength < 7500) return 75000
  return 115000
}

function durationMessage(disclosureLength: number) {
  if (disclosureLength < 1800) return 'This usually takes less than a minute.'
  if (disclosureLength < 7500) return 'Detailed normalization may take around 1 minute.'
  return 'Long disclosures may take 1-2 minutes because facts, relationships, and claim-support signals are being structured.'
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  if (minutes <= 0) return `${remaining}s`
  return `${minutes}m ${String(remaining).padStart(2, '0')}s`
}

function startTimeMs(startedAt: number | Date | null) {
  if (!startedAt) return Date.now()
  return startedAt instanceof Date ? startedAt.getTime() : startedAt
}

function AnalysisCanvas({ reducedMotion, phaseIndex }: { reducedMotion: boolean; phaseIndex: number }) {
  const animation = reducedMotion
    ? {}
    : {
        y: [0, -4, 0],
        opacity: [0.82, 1, 0.82],
      }

  const chipDelay = reducedMotion ? 0 : 0.18

  return (
    <div className="relative min-h-[300px] overflow-hidden rounded-lg border border-sky-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(14,165,233,0.07)_1px,transparent_1px),linear-gradient(to_bottom,rgba(14,165,233,0.07)_1px,transparent_1px)] bg-[size:28px_28px]" />
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400" />
      <div className="relative space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">Analysis Workbench</p>
            <p className="mt-1 text-sm text-slate-700">Source-faithful invention structure</p>
          </div>
          <motion.div
            animate={animation}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700 shadow-sm"
          >
            Reviewing
          </motion.div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { label: 'Elements', value: 'claims-ready terms', icon: Layers3, color: 'border-sky-100 bg-sky-50 text-sky-700' },
            { label: 'Materials', value: 'composition support', icon: Beaker, color: 'border-emerald-100 bg-emerald-50 text-emerald-700' },
            { label: 'Steps', value: 'process sequence', icon: GitBranch, color: 'border-amber-100 bg-amber-50 text-amber-700' },
            { label: 'Support facts', value: 'source ledger', icon: ShieldCheck, color: 'border-blue-100 bg-blue-50 text-blue-700' },
          ].map((item, index) => {
            const Icon = item.icon
            return (
              <motion.div
                key={item.label}
                initial={reducedMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * chipDelay, duration: 0.32 }}
                className={`rounded-lg border p-3 ${item.color}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">{item.label}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-700">{item.value}</p>
              </motion.div>
            )
          })}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white/90 p-3 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <Sparkles className="h-3.5 w-3.5 text-blue-500" />
            Routing signals
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ['Claim scope', 'claim-ready'],
              ['Figure relevance', 'visual signals'],
              ['Description', 'draft routes'],
            ].map(([label, value], index) => (
              <motion.div
                key={label}
                animate={reducedMotion ? {} : { opacity: phaseIndex >= index + 5 ? 1 : 0.55 }}
                className="rounded-md border border-slate-200 bg-slate-50/90 px-2 py-2"
              >
                <p className="text-slate-500">{label}</p>
                <p className="mt-1 font-semibold text-slate-800">{value}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/90 p-3 shadow-sm">
          {[0, 1, 2, 3].map((line) => (
            <motion.div
              key={line}
              className="h-2 rounded-full bg-gradient-to-r from-blue-100 via-sky-200 to-emerald-100"
              style={{ width: `${88 - line * 13}%` }}
              animate={reducedMotion ? {} : { opacity: [0.35, 0.8, 0.35] }}
              transition={{ duration: 2.2, repeat: Infinity, delay: line * 0.2 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Stage0PatentIntelligenceOverlay({
  open,
  mode,
  title,
  disclosureLength,
  startedAt,
  status,
  errorMessage,
  onRetry,
  onReturnToEditor,
}: Stage0PatentIntelligenceOverlayProps) {
  const reducedMotion = usePrefersReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [noteIndex, setNoteIndex] = useState(0)
  const estimatedDuration = useMemo(() => estimateDurationMs(disclosureLength), [disclosureLength])

  useEffect(() => {
    if (!open) return
    containerRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const started = startTimeMs(startedAt)
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    }, 1000)
    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    return () => window.clearInterval(timer)
  }, [open, startedAt])

  useEffect(() => {
    if (!open || status !== 'running') return
    const timer = window.setInterval(() => {
      setNoteIndex((index) => (index + 1) % TRUST_NOTES.length)
    }, 6200)
    return () => window.clearInterval(timer)
  }, [open, status])

  if (!open) return null

  const elapsedMs = elapsedSeconds * 1000
  const runningReadiness = Math.min(94, 8 + Math.round((Math.min(elapsedMs, estimatedDuration) / estimatedDuration) * 86))
  const readiness = status === 'success' ? 100 : status === 'error' ? Math.min(runningReadiness, 94) : runningReadiness
  const phaseRatio = Math.min(1, elapsedMs / estimatedDuration)
  const activePhaseIndex = status === 'success'
    ? PHASES.length
    : status === 'error'
      ? Math.min(PHASES.length - 1, Math.floor(phaseRatio * PHASES.length))
      : Math.min(PHASES.length - 1, Math.floor(phaseRatio * PHASES.length))
  const isTakingLonger = status === 'running' && elapsedMs > estimatedDuration
  const currentPhase = isTakingLonger
    ? 'Still validating claim-support structure...'
    : status === 'success'
      ? 'Structure ready.'
      : status === 'error'
        ? 'Normalization needs attention.'
        : PHASES[activePhaseIndex]?.label || 'Finalizing source-faithful structure...'

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) || []
    ).filter(element => !element.hasAttribute('disabled') && element.offsetParent !== null)

    if (focusable.length === 0) {
      event.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage0-overlay-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1000] overflow-y-auto bg-[linear-gradient(135deg,rgba(248,250,252,0.97),rgba(255,255,255,0.98)_52%,rgba(240,253,250,0.96))] px-4 py-6 text-slate-900 outline-none backdrop-blur-sm sm:px-6"
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl items-center">
        <div className="w-full rounded-lg border border-sky-100 bg-white shadow-2xl shadow-blue-100/70">
          <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <AnimatedLogo size="lg" useKishoFallback autoPlayDuration={reducedMotion ? 1 : 4500} />
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Patent Intelligence</p>
                  <h2 id="stage0-overlay-title" className="mt-1 truncate text-xl font-semibold text-slate-950 sm:text-2xl">
                    Structuring your invention
                  </h2>
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {title || 'Untitled invention'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">
                <Clock3 className="h-4 w-4 text-blue-600" />
                <span>Elapsed {formatElapsed(elapsedSeconds)}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-5 lg:grid-cols-[0.95fr_1.05fr] sm:p-6">
            <div className="space-y-5">
              <div className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Estimated analysis progress</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Final validation completes when the model response returns.
                    </p>
                  </div>
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                    {mode === 'preserve' ? 'Preserve mode' : 'Structure mode'}
                  </span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400"
                    initial={false}
                    animate={{ width: `${readiness}%` }}
                    transition={reducedMotion ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
                  />
                </div>
                <p className="mt-3 text-sm text-slate-600">{durationMessage(disclosureLength)}</p>
                {isTakingLonger && (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    This disclosure is taking longer than usual. PatentNest is still finalizing the structure.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-sky-100 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <p className="text-sm font-semibold text-slate-900">Current phase</p>
                  <p className="text-xs text-slate-500" aria-live="polite">{currentPhase}</p>
                </div>
                <div className="space-y-2.5">
                  {PHASES.map((phase, index) => {
                    const Icon = phase.icon
                    const complete = status === 'success' || index < activePhaseIndex
                    const active = status === 'running' && index === activePhaseIndex
                    return (
                      <div
                        key={phase.label}
                        className={[
                          'flex items-center gap-3 rounded-md border px-3 py-2 transition-colors',
                          complete
                            ? 'border-blue-100 bg-blue-50 text-blue-900'
                            : active
                              ? 'border-sky-200 bg-sky-50 text-sky-900'
                              : 'border-slate-200 bg-white text-slate-500',
                        ].join(' ')}
                      >
                        <div className={[
                          'flex h-7 w-7 items-center justify-center rounded-full',
                          complete ? 'bg-blue-600 text-white' : active ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400',
                        ].join(' ')}>
                          {complete ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                        </div>
                        <span className="min-w-0 flex-1 text-sm">{phase.label}</span>
                        {active && !reducedMotion && <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" aria-hidden="true" />}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-lg border border-sky-100 bg-sky-50/70 p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Why this matters</p>
                <div className="mt-2 min-h-[44px] text-sm text-slate-700" aria-live="polite">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={TRUST_NOTES[noteIndex]}
                      initial={reducedMotion ? false : { opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reducedMotion ? undefined : { opacity: 0, y: -5 }}
                      transition={{ duration: 0.22 }}
                    >
                      {TRUST_NOTES[noteIndex]}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <AnalysisCanvas reducedMotion={reducedMotion} phaseIndex={activePhaseIndex} />

              {status === 'error' && (
                <div className="rounded-lg border border-red-100 bg-red-50 p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-red-900">Stage 0 could not be completed</p>
                      <p className="mt-1 text-sm text-red-700">
                        {errorMessage || 'The invention structure was not saved. Your original disclosure is still preserved in the editor.'}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button onClick={onRetry} className="bg-blue-600 text-white hover:bg-blue-700">
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Retry
                        </Button>
                        <Button onClick={onReturnToEditor} variant="outline" className="border-red-200 bg-white text-red-700 hover:bg-red-50">
                          <ArrowLeft className="mr-2 h-4 w-4" />
                          Return to editor
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {status === 'success' && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-900 shadow-sm">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-blue-600" />
                    <p className="font-semibold">Structure ready</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
