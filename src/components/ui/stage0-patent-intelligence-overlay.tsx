'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
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
  disclosureText?: string
  startedAt: number | Date | null
  status: Stage0PatentIntelligenceStatus
  errorMessage?: string
  onRetry: () => void
  onReturnToEditor: () => void
}

const PHASES = [
  'Reading your invention disclosure',
  'Separating stated facts from assumptions',
  'Identifying the inventive architecture',
  'Extracting elements and relationships',
  'Mapping technical support signals',
  'Preserving claim-support evidence',
  'Detecting patent type and category',
  'Planning claims, figures, and description',
  'Validating structure integrity',
  'Finalizing invention record',
]

const INSIGHTS = [
  'Every claim needs traceable support — Stage 0 maps it now so drafting stays grounded.',
  'PatentNest distinguishes what you stated from what it infers, keeping your disclosure honest.',
  'This structured record feeds into claims, figures, and descriptions — built once, used everywhere.',
  'Longer disclosures yield richer element graphs, which means stronger downstream claims.',
  'Classification signals are being detected to guide prior-art search in later stages.',
  'The AI is building a dependency map between your components, inputs, and outputs.',
]

const ACTIVITY_LINES = [
  'Parsing disclosure paragraphs into logical sections',
  'Indexing technical vocabulary and synonyms',
  'Cross-referencing component dependencies',
  'Building element-to-claim support matrix',
  'Tagging CPC/IPC classification candidates',
  'Mapping inputs → processing → outputs',
  'Scoring novelty signals from terminology',
  'Structuring abstract from key statements',
  'Validating completeness of element coverage',
  'Generating search-ready terminology graph',
  'Resolving ambiguous component references',
  'Detecting compositional vs. process claims',
  'Aligning figure signals with component tree',
  'Deduplicating overlapping element definitions',
  'Normalizing measurement units and ranges',
]

/* ---------- Invention-aware key-phrase extraction ---------- */
function extractKeyPhrases(title: string, text: string): string[] {
  const phrases: string[] = []
  const seen = new Set<string>()

  const add = (p: string) => {
    const norm = p.toLowerCase().trim()
    if (norm.length < 4 || norm.length > 50 || seen.has(norm)) return
    seen.add(norm)
    phrases.push(p.trim())
  }

  if (title && title.length >= 4) add(title)

  const src = text || ''

  const systemPatterns = [
    /\b(?:a|an|the)\s+([\w][\w\s]{2,30}?\s+(?:system|device|apparatus|method|process|mechanism|module|platform|network|framework|engine|circuit|assembly|unit|sensor|controller|interface|algorithm))\b/gi,
    /\b([\w][\w\s]{2,30}?\s+(?:for|of)\s+[\w][\w\s]{2,25}?)\b(?=[\s,;.])/gi,
  ]

  for (const pat of systemPatterns) {
    let m: RegExpExecArray | null
    while ((m = pat.exec(src)) !== null && phrases.length < 5) {
      add(m[1])
    }
  }

  const compoundNounPat = /\b([A-Z][\w-]+(?:\s+[A-Za-z][\w-]+){1,3})\b/g
  let m: RegExpExecArray | null
  while ((m = compoundNounPat.exec(src)) !== null && phrases.length < 5) {
    const candidate = m[1]
    if (!/\b(?:The|This|That|These|Those|When|Where|Which|With|From|Into|Also|Such|Each|After|Before)\b/i.test(candidate.split(/\s/)[0])) {
      add(candidate)
    }
  }

  return phrases.slice(0, 4)
}

function personalizePhases(phrases: string[]): string[] {
  if (!phrases.length) return PHASES
  const p = phrases[0]
  const short = p.length > 35 ? p.slice(0, 32) + '…' : p
  return [
    `Reading your disclosure for ${short}`,
    'Separating stated facts from assumptions',
    'Identifying the inventive architecture',
    `Extracting elements from ${short}`,
    phrases[1] ? `Mapping technical support for ${phrases[1]}` : 'Mapping technical support signals',
    'Preserving claim-support evidence',
    'Detecting patent type and category',
    phrases[2] ? `Planning claims around ${phrases[2]}` : 'Planning claims, figures, and description',
    'Validating structure integrity',
    `Finalizing record for ${short}`,
  ]
}

function personalizeActivity(phrases: string[]): string[] {
  if (!phrases.length) return ACTIVITY_LINES
  const p0 = phrases[0]?.length > 30 ? phrases[0].slice(0, 27) + '…' : phrases[0]
  const p1 = phrases[1] ? (phrases[1].length > 30 ? phrases[1].slice(0, 27) + '…' : phrases[1]) : null
  const p2 = phrases[2] ? (phrases[2].length > 30 ? phrases[2].slice(0, 27) + '…' : phrases[2]) : null

  return [
    `Parsing disclosure paragraphs for ${p0}`,
    'Indexing technical vocabulary and synonyms',
    p1 ? `Cross-referencing dependencies in ${p1}` : 'Cross-referencing component dependencies',
    `Building element-to-claim matrix for ${p0}`,
    'Tagging CPC/IPC classification candidates',
    p2 ? `Mapping inputs → outputs for ${p2}` : 'Mapping inputs → processing → outputs',
    'Scoring novelty signals from terminology',
    `Structuring abstract from ${p0} disclosure`,
    'Validating completeness of element coverage',
    'Generating search-ready terminology graph',
    p1 ? `Resolving references in ${p1}` : 'Resolving ambiguous component references',
    'Detecting compositional vs. process claims',
    'Aligning figure signals with component tree',
    'Deduplicating overlapping element definitions',
    'Normalizing measurement units and ranges',
  ]
}

function usePrefersReducedMotion() {
  const [v, setV] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const u = () => setV(q.matches)
    u()
    q.addEventListener('change', u)
    return () => q.removeEventListener('change', u)
  }, [])
  return v
}

function estimateDurationMs(len: number) {
  if (len < 1800) return 50_000
  if (len < 7500) return 75_000
  return 115_000
}

function sizeInfo(len: number) {
  if (len < 1800) return { tag: 'Compact', time: 'under a minute', color: 'text-emerald-600' }
  if (len < 7500) return { tag: 'Detailed', time: 'about 1 minute', color: 'text-lamp-600' }
  return { tag: 'Extended', time: '1–2 minutes', color: 'text-amber-600' }
}

function formatElapsed(s: number) {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m <= 0 ? `${r}s` : `${m}m ${String(r).padStart(2, '0')}s`
}

function startMs(v: number | Date | null) {
  if (!v) return Date.now()
  return v instanceof Date ? v.getTime() : v
}

/* ---------- Progress Ring (SVG) ---------- */
function ProgressRing({
  progress,
  isSuccess,
  reducedMotion,
}: {
  progress: number
  isSuccess: boolean
  reducedMotion: boolean
}) {
  const size = 180
  const stroke = 5
  const r = (size - stroke) / 2
  const c = r * 2 * Math.PI
  const offset = c - (progress / 100) * c

  return (
    <div className="relative inline-flex items-center justify-center">
      {/* Soft glow behind the ring */}
      {!reducedMotion && (
        <div className="absolute inset-[-20%] rounded-full bg-lamp-400/[0.06] blur-2xl" />
      )}

      <svg
        width={size}
        height={size}
        className="-rotate-90"
        aria-hidden="true"
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          className="text-slate-100"
        />
        {/* Fill */}
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#s0ring)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: offset }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.9, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id="s0ring" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="60%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {isSuccess ? (
          <motion.div
            initial={{ scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
          </motion.div>
        ) : (
          <>
            <span className="text-4xl font-semibold tabular-nums text-slate-800">
              {progress}
              <span className="text-2xl text-slate-400">%</span>
            </span>
            <span className="mt-1 text-[11px] font-medium uppercase tracking-widest text-slate-400">
              analyzed
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Floating activity feed ---------- */
function ActivityFeed({
  phaseIndex,
  reducedMotion,
  activityLines,
}: {
  phaseIndex: number
  reducedMotion: boolean
  activityLines: string[]
}) {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    setLines([activityLines[0]])
    let idx = 1
    const iv = setInterval(() => {
      setLines((prev) => {
        const next = [activityLines[idx % activityLines.length], ...prev].slice(0, 3)
        idx++
        return next
      })
    }, 2800)
    return () => clearInterval(iv)
  }, [phaseIndex, activityLines])

  return (
    <div className="w-full space-y-1.5" aria-hidden="true">
      <AnimatePresence initial={false}>
        {lines.map((line, i) => (
          <motion.div
            key={line}
            layout
            initial={reducedMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: i === 0 ? 0.7 : 0.35, y: 0 }}
            exit={reducedMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-2 text-[13px] text-slate-500"
          >
            <span className={`inline-block h-1 w-1 rounded-full flex-shrink-0 ${i === 0 ? 'bg-lamp-400' : 'bg-slate-300'}`} />
            <span className="truncate">{line}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ========== Main overlay ========== */
export default function Stage0PatentIntelligenceOverlay({
  open,
  mode,
  title,
  disclosureLength,
  disclosureText,
  startedAt,
  status,
  errorMessage,
  onRetry,
  onReturnToEditor,
}: Stage0PatentIntelligenceOverlayProps) {
  const reduced = usePrefersReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const [insightIdx, setInsightIdx] = useState(0)
  const est = useMemo(() => estimateDurationMs(disclosureLength), [disclosureLength])
  const size = sizeInfo(disclosureLength)

  const keyPhrases = useMemo(
    () => extractKeyPhrases(title || '', disclosureText || ''),
    [title, disclosureText]
  )
  const phases = useMemo(() => personalizePhases(keyPhrases), [keyPhrases])
  const activityLines = useMemo(() => personalizeActivity(keyPhrases), [keyPhrases])

  // Focus trap
  useEffect(() => {
    if (open) containerRef.current?.focus()
  }, [open])

  // Elapsed timer
  useEffect(() => {
    if (!open) return
    const s = startMs(startedAt)
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - s) / 1000)))
    tick()
    const iv = setInterval(tick, 1000)
    return () => clearInterval(iv)
  }, [open, startedAt])

  // Insight rotation
  useEffect(() => {
    if (!open || status !== 'running') return
    const iv = setInterval(() => setInsightIdx((i) => (i + 1) % INSIGHTS.length), 5500)
    return () => clearInterval(iv)
  }, [open, status])

  if (!open) return null

  const ms = elapsed * 1000
  const runPct = Math.min(94, 8 + Math.round((Math.min(ms, est) / est) * 86))
  const pct = status === 'success' ? 100 : status === 'error' ? Math.min(runPct, 94) : runPct
  const ratio = Math.min(1, ms / est)
  const phaseIdx =
    status === 'success'
      ? phases.length
      : Math.min(phases.length - 1, Math.floor(ratio * phases.length))
  const takingLonger = status === 'running' && ms > est

  const phaseText =
    takingLonger
      ? 'Deep-validating claim-support structure…'
      : status === 'success'
        ? 'Structure ready — loading workspace'
        : status === 'error'
          ? 'Normalization needs attention'
          : phases[phaseIdx]

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const els = Array.from(
      containerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) || []
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)
    if (!els.length) { e.preventDefault(); return }
    const first = els[0], last = els[els.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="s0-title"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1000] flex items-center justify-center overflow-y-auto bg-white/[0.97] px-4 py-8 outline-none backdrop-blur-md sm:px-6"
    >
      {/* Subtle background decoration */}
      {!reduced && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-lamp-50 via-lamp-50/40 to-transparent blur-3xl" />
          <div className="absolute bottom-0 right-1/4 h-[400px] w-[400px] rounded-full bg-gradient-to-tl from-emerald-50/60 to-transparent blur-3xl" />
        </div>
      )}

      <div className="relative z-10 flex w-full max-w-xl flex-col items-center text-center">

        {/* ---- Header ---- */}
        <div className="mb-2 flex items-center gap-3">
          <AnimatedLogo
            size="md"
            useKishoFallback
            autoPlayDuration={reduced ? 1 : 4500}
          />
          <div className="text-left">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-lamp-600">
              Stage 0 · Patent Intelligence
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {mode === 'preserve' ? 'Preserve mode' : 'Structure mode'}
            </p>
          </div>
        </div>

        {/* ---- Title ---- */}
        <h2
          id="s0-title"
          className="mt-6 text-xl font-semibold text-slate-900 sm:text-2xl"
        >
          Structuring your invention
        </h2>
        <p className="mt-2 max-w-sm truncate text-sm text-slate-500">
          {title || 'Untitled invention'}
        </p>

        {/* ---- Progress Ring ---- */}
        <div className="mt-10">
          <ProgressRing
            progress={pct}
            isSuccess={status === 'success'}
            reducedMotion={reduced}
          />
        </div>

        {/* ---- Current Phase ---- */}
        <div className="mt-8 min-h-[28px]" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.p
              key={phaseText}
              initial={reduced ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="text-[15px] font-medium text-slate-700"
            >
              {phaseText}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* ---- Phase Dots ---- */}
        <div className="mt-4 flex items-center gap-1.5" aria-label={`Phase ${Math.min(phaseIdx + 1, phases.length)} of ${phases.length}`}>
          {phases.map((_, i) => {
            const done = status === 'success' || i < phaseIdx
            const active = status === 'running' && i === phaseIdx
            return (
              <motion.span
                key={i}
                className={[
                  'block rounded-full transition-colors duration-300',
                  done
                    ? 'h-1.5 w-1.5 bg-lamp-500'
                    : active
                      ? 'h-2 w-2 bg-lamp-500'
                      : 'h-1.5 w-1.5 bg-slate-200',
                ].join(' ')}
                animate={active && !reduced ? { scale: [1, 1.4, 1] } : {}}
                transition={active ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : {}}
              />
            )
          })}
        </div>

        {/* ---- Taking Longer Notice ---- */}
        {takingLonger && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-5 rounded-lg border border-amber-200/60 bg-amber-50/80 px-4 py-2.5 text-sm text-amber-700"
          >
            Taking a little longer than usual — still finalizing the structure.
          </motion.p>
        )}

        {/* ---- Activity Feed ---- */}
        {status === 'running' && (
          <div className="mt-8 w-full max-w-md">
            <ActivityFeed phaseIndex={phaseIdx} reducedMotion={reduced} activityLines={activityLines} />
          </div>
        )}

        {/* ---- Insight Card ---- */}
        {status === 'running' && (
          <div className="mt-8 w-full max-w-md rounded-xl border border-slate-100 bg-slate-50/70 px-5 py-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Did you know
            </p>
            <div className="min-h-[40px] text-[13px] leading-relaxed text-slate-600">
              <AnimatePresence mode="wait">
                <motion.p
                  key={insightIdx}
                  initial={reduced ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? undefined : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }}
                >
                  {INSIGHTS[insightIdx]}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* ---- Error State ---- */}
        {status === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 w-full max-w-md rounded-xl border border-red-200/60 bg-red-50/80 px-5 py-5 text-left"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-red-900">
                  Could not complete Stage 0
                </p>
                <p className="mt-1.5 text-sm text-red-700">
                  {errorMessage ||
                    'The invention structure was not saved. Your original disclosure is preserved in the editor.'}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    onClick={onRetry}
                    className="bg-lamp-600 text-white hover:bg-lamp-700"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Retry
                  </Button>
                  <Button
                    onClick={onReturnToEditor}
                    variant="outline"
                    className="border-red-200 text-red-700 hover:bg-red-50"
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Return to editor
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* ---- Success State ---- */}
        {status === 'success' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-8 w-full max-w-md rounded-xl border border-emerald-200/60 bg-emerald-50/80 px-5 py-4 text-emerald-800"
          >
            <div className="flex items-center justify-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <p className="font-semibold">Structure ready — entering workspace</p>
            </div>
          </motion.div>
        )}

        {/* ---- Footer: Timing + Content Size ---- */}
        <div className="mt-10 flex flex-col items-center gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <span className="tabular-nums">
              Elapsed {formatElapsed(elapsed)}
            </span>
            <span className="h-3 w-px bg-slate-200" />
            <span>
              {size.tag} disclosure · est. {size.time}
            </span>
          </div>
          <p className="max-w-xs text-center text-slate-400/80">
            Larger disclosures and file attachments require deeper analysis and take more time to process.
          </p>
        </div>
      </div>
    </div>
  )
}
