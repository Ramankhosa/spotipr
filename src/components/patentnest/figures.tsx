'use client'

// Animated patent figures — the visual language for feature graphics on the
// /patentnest landing page and its feature detail pages. Every schematic is
// drawn like a figure from a patent application (ink line work, brass accents,
// mono reference labels) and animates the way a draftsperson would draw it:
// strokes trace in via pathLength, nodes stamp in staggered, and a quiet
// dash-flow loop keeps pipelines feeling alive. All motion is gated behind
// prefers-reduced-motion (static figure, still legible).
//
// Eight primitives cover all feature stories; each is parameterized by labels
// so detail pages and homepage glyphs reuse the same component at any size
// (SVG viewBox scales). Keep new feature art inside this vocabulary.

import { motion, useReducedMotion } from 'framer-motion'

const INK = '#1e293b' // ai-graphite-800
const SOFT = '#94a3b8' // ai-graphite-400
const BRASS = '#8a6a1f'
const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }

/** Shared viewport config: draw once, slightly before fully visible. */
const VIEW = { once: true, margin: '-60px' } as const

function useFig() {
  const reduce = useReducedMotion()
  return {
    reduce,
    // stroke that traces itself in
    draw: (delay = 0, dur = 0.9) => ({
      initial: { pathLength: reduce ? 1 : 0, opacity: reduce ? 1 : 0 },
      whileInView: { pathLength: 1, opacity: 1 },
      viewport: VIEW,
      transition: { duration: reduce ? 0 : dur, ease: EASE, delay: reduce ? 0 : delay },
    }),
    // element that stamps/fades in
    pop: (delay = 0) => ({
      initial: { opacity: 0, scale: reduce ? 1 : 0.85 },
      whileInView: { opacity: 1, scale: 1 },
      viewport: VIEW,
      transition: { duration: 0.35, ease: EASE, delay: reduce ? 0 : delay },
    }),
    fade: (delay = 0) => ({
      initial: { opacity: 0 },
      whileInView: { opacity: 1 },
      viewport: VIEW,
      transition: { duration: 0.4, ease: EASE, delay: reduce ? 0 : delay },
    }),
  }
}

/** Quiet dash-flow: a dashed line whose dashes drift, reading as throughput. */
function FlowLine({ d, delay = 0 }: { d: string; delay?: number }) {
  const reduce = useReducedMotion()
  return (
    <>
      <motion.path
        d={d}
        fill="none"
        stroke={SOFT}
        strokeWidth="1"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 0.5 }}
        viewport={VIEW}
        transition={{ duration: 0.4, delay }}
      />
      {!reduce && (
        <motion.path
          d={d}
          fill="none"
          stroke={BRASS}
          strokeWidth="1.2"
          strokeDasharray="3 9"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 0.9 }}
          viewport={VIEW}
          animate={{ strokeDashoffset: [0, -48] }}
          transition={{
            // slow, continuous drift — throughput, not spectacle
            strokeDashoffset: { repeat: Infinity, duration: 3.2, ease: 'linear' },
            opacity: { duration: 0.4, delay: delay + 0.2 },
          }}
        />
      )}
    </>
  )
}

function FigLabel({ x, y, children, anchor = 'middle', brass = false, size = 8.5 }: {
  x: number; y: number; children: string; anchor?: 'start' | 'middle' | 'end'; brass?: boolean; size?: number
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} letterSpacing="0.08em" fill={brass ? BRASS : SOFT} style={mono}>
      {children.toUpperCase()}
    </text>
  )
}

/* ------------------------------------------------------------------ 1 ---- */
/** Scattered sparks converge into a structured outline — ideation. */
export function SparkStructureFig({ compact = false }: { compact?: boolean }) {
  const f = useFig()
  const dots = [
    [36, 52], [70, 96], [30, 130], [88, 40], [58, 150], [96, 128], [48, 92], [84, 72],
  ]
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label="Scattered idea fragments organized into a structured disclosure outline">
      {dots.map(([x, y], i) => (
        <motion.circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 3 : 2}
          fill={i % 3 === 0 ? BRASS : SOFT} {...f.pop(0.08 * i)} />
      ))}
      <FlowLine d="M 118 96 C 150 96 156 96 186 96" delay={0.5} />
      <motion.path d="M 186 92 l 8 4 l -8 4 z" fill={BRASS} {...f.fade(0.7)} />
      {/* structured outline */}
      <motion.rect x={212} y={34} width={158} height={132} rx={8} fill="none" stroke={INK} strokeWidth="1.5" {...f.draw(0.6)} />
      {[
        { y: 58, w: 92, label: 'problem' },
        { y: 84, w: 118, label: 'mechanism' },
        { y: 110, w: 104, label: 'advantage' },
        { y: 136, w: 76, label: 'claims seed' },
      ].map((r, i) => (
        <g key={r.label}>
          <motion.line x1={230} y1={r.y} x2={230 + r.w} y2={r.y} stroke={SOFT} strokeWidth="3" strokeLinecap="round" {...f.draw(0.9 + i * 0.12, 0.5)} />
          {!compact && <FigLabel x={230} y={r.y - 8} anchor="start">{r.label}</FigLabel>}
        </g>
      ))}
      <motion.circle cx={212} cy={34} r={4} fill={BRASS} {...f.pop(1.5)} />
      {!compact && (
        <>
          <FigLabel x={64} y={182}>raw fragments</FigLabel>
          <FigLabel x={291} y={182} brass>structured disclosure</FigLabel>
        </>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ 2 ---- */
/** Staged pipeline with flowing connector; optional loop-back arc. */
export function PipelineFig({ stages, loopback, compact = false }: {
  stages: string[]; loopback?: { from: number; to: number; label: string }; compact?: boolean
}) {
  const f = useFig()
  const n = stages.length
  const w = 400
  const boxW = Math.min(76, (w - 40 - (n - 1) * 26) / n)
  const gap = (w - 40 - n * boxW) / Math.max(1, n - 1)
  const y = 84
  const xs = stages.map((_, i) => 20 + i * (boxW + gap))
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label={`Pipeline: ${stages.join(', ')}`}>
      {xs.map((x, i) => (
        <g key={stages[i]}>
          {i < n - 1 && <FlowLine d={`M ${x + boxW} ${y + 20} L ${xs[i + 1]} ${y + 20}`} delay={0.3 + i * 0.15} />}
          <motion.rect x={x} y={y} width={boxW} height={40} rx={7}
            fill={i === n - 1 ? '#f6f1e4' : 'none'}
            stroke={i === n - 1 ? BRASS : INK} strokeWidth="1.5" {...f.draw(0.15 * i, 0.6)} />
          <motion.g {...f.fade(0.15 * i + 0.25)}>
            <FigLabel x={x + boxW / 2} y={y + 24} brass={i === n - 1} size={compact ? 8 : 8.5}>{stages[i]}</FigLabel>
          </motion.g>
          <motion.g {...f.fade(0.15 * i + 0.3)}>
            <FigLabel x={x + boxW / 2} y={y - 10} size={7.5}>{`${i + 1}0${i + 1}`.slice(0, 3)}</FigLabel>
          </motion.g>
        </g>
      ))}
      {loopback && (
        <>
          <motion.path
            d={`M ${xs[loopback.from] + boxW / 2} ${y + 40} C ${xs[loopback.from] + boxW / 2} ${y + 88}, ${xs[loopback.to] + boxW / 2} ${y + 88}, ${xs[loopback.to] + boxW / 2} ${y + 44}`}
            fill="none" stroke={BRASS} strokeWidth="1.2" strokeDasharray="4 4" {...f.draw(1.0)} />
          <motion.path d={`M ${xs[loopback.to] + boxW / 2 - 4} ${y + 50} l 4 -8 l 4 8 z`} fill={BRASS} {...f.fade(1.6)} />
          {!compact && (
            <motion.g {...f.fade(1.4)}>
              <FigLabel x={(xs[loopback.from] + xs[loopback.to]) / 2 + boxW / 2} y={y + 100} brass>{loopback.label}</FigLabel>
            </motion.g>
          )}
        </>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ 3 ---- */
/** Feature × reference disclosure matrix — the examiner's table, animated. */
export function MatrixFig({ compact = false }: { compact?: boolean }) {
  const f = useFig()
  const features = ['F1', 'F2', 'F3', 'F4']
  const refs = ['D1', 'D2', 'D3']
  // ● disclosed · ◐ partial · — absent  (row F3 = the novel one)
  const marks: ('full' | 'part' | 'none')[][] = [
    ['full', 'part', 'none'],
    ['full', 'full', 'part'],
    ['none', 'none', 'none'],
    ['part', 'none', 'full'],
  ]
  const x0 = 120, y0 = 44, cw = 62, ch = 30
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label="Feature-to-prior-art disclosure matrix highlighting the novel feature">
      {refs.map((r, j) => (
        <motion.g key={r} {...f.fade(0.1 + j * 0.1)}>
          <FigLabel x={x0 + cw * j + cw / 2} y={y0 - 12}>{r}</FigLabel>
        </motion.g>
      ))}
      {features.map((ft, i) => (
        <g key={ft}>
          <motion.g {...f.fade(0.1 + i * 0.1)}>
            <FigLabel x={x0 - 16} y={y0 + ch * i + ch / 2 + 3} anchor="end" brass={i === 2}>
              {compact ? ft : ft + (i === 2 ? ' · novel' : '')}
            </FigLabel>
          </motion.g>
          {refs.map((_, j) => {
            const m = marks[i][j]
            const cx = x0 + cw * j + cw / 2
            const cy = y0 + ch * i + ch / 2
            const d = 0.4 + (i * refs.length + j) * 0.09
            return (
              <g key={j}>
                <motion.rect x={x0 + cw * j} y={y0 + ch * i} width={cw} height={ch} fill={i === 2 ? '#f6f1e4' : 'none'} stroke={SOFT} strokeWidth="0.6" opacity={0.6} {...f.fade(d - 0.15)} />
                {m === 'full' && <motion.circle cx={cx} cy={cy} r={4.5} fill={INK} {...f.pop(d)} />}
                {m === 'part' && <motion.circle cx={cx} cy={cy} r={4.5} fill="none" stroke={INK} strokeWidth="1.4" {...f.pop(d)} />}
                {m === 'none' && (
                  <motion.line x1={cx - 4} y1={cy} x2={cx + 4} y2={cy} stroke={SOFT} strokeWidth="1.4" {...f.draw(d, 0.3)} />
                )}
              </g>
            )
          })}
        </g>
      ))}
      {/* verdict callout on the novel row */}
      <motion.path d={`M ${x0 + cw * 3 + 8} ${y0 + ch * 2 + ch / 2} h 26`} stroke={BRASS} strokeWidth="1.2" {...f.draw(1.5, 0.4)} />
      <motion.g {...f.fade(1.7)}>
        <FigLabel x={x0 + cw * 3 + 40} y={y0 + ch * 2 + ch / 2 + 3} anchor="start" brass>{compact ? 'clear' : 'not disclosed'}</FigLabel>
      </motion.g>
      {!compact && (
        <motion.g {...f.fade(1.9)}>
          <FigLabel x={200} y={186}>● disclosed · ○ partial · — absent</FigLabel>
        </motion.g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ 4 ---- */
/** One source fanning into parallel tracks, each completing — parallelism. */
export function FanOutFig({ branches, sourceLabel = 'one disclosure', stacked = false, compact = false }: {
  branches: string[]; sourceLabel?: string; stacked?: boolean; compact?: boolean
}) {
  const f = useFig()
  const n = branches.length
  const y0 = 100
  const bx = 190
  const spacing = Math.min(40, 150 / Math.max(1, n - 1))
  const yStart = y0 - ((n - 1) * spacing) / 2
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label={`One source processed in parallel across: ${branches.join(', ')}`}>
      {/* source document (optionally a stack, for batch) */}
      {(stacked ? [10, 5, 0] : [0]).map((off, k) => (
        <motion.rect key={k} x={30 + off} y={y0 - 30 + off * 0.6} width={64} height={56} rx={6}
          fill="#faf9f7" stroke={INK} strokeWidth="1.4" {...f.draw(k * 0.12, 0.5)} />
      ))}
      {[0, 1, 2].map((i) => (
        <motion.line key={i} x1={42} y1={y0 - 16 + i * 12} x2={42 + 40 - i * 8} y2={y0 - 16 + i * 12}
          stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" {...f.draw(0.3 + i * 0.1, 0.4)} />
      ))}
      <motion.g {...f.fade(0.5)}>
        <FigLabel x={62 + (stacked ? 5 : 0)} y={y0 + 44}>{sourceLabel}</FigLabel>
      </motion.g>

      {branches.map((b, i) => {
        const by = yStart + i * spacing
        return (
          <g key={b}>
            <FlowLine d={`M 104 ${y0 - 2} C 140 ${y0 - 2}, 146 ${by}, ${bx} ${by}`} delay={0.5 + i * 0.12} />
            <motion.rect x={bx} y={by - 11} width={58} height={22} rx={5} fill="none" stroke={INK} strokeWidth="1.3" {...f.draw(0.6 + i * 0.12, 0.5)} />
            <motion.g {...f.fade(0.75 + i * 0.12)}>
              <FigLabel x={bx + 29} y={by + 3.5}>{b}</FigLabel>
            </motion.g>
            {/* parallel progress bars completing */}
            <motion.line x1={bx + 70} y1={by} x2={bx + 116} y2={by} stroke={SOFT} strokeWidth="3" strokeLinecap="round" opacity={0.35} {...f.fade(0.8 + i * 0.12)} />
            <motion.line x1={bx + 70} y1={by} x2={bx + 116} y2={by} stroke={BRASS} strokeWidth="3" strokeLinecap="round" {...f.draw(0.9 + i * 0.1, 0.8)} />
            <motion.path d={`M ${bx + 124} ${by} l 4 4 l 7 -8`} fill="none" stroke={BRASS} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...f.draw(1.7 + i * 0.08, 0.3)} />
          </g>
        )
      })}
      {!compact && (
        <motion.g {...f.fade(1.9)}>
          <FigLabel x={262} y={30} brass>drafted in parallel</FigLabel>
        </motion.g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ 5 ---- */
/** A sketch being scanned; callouts extracted with reference numerals. */
export function ScanReadFig({ compact = false }: { compact?: boolean }) {
  const f = useFig()
  const reduce = useReducedMotion()
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label="An uploaded sketch is read by AI and annotated with reference numerals">
      {/* uploaded sketch frame */}
      <motion.rect x={36} y={30} width={150} height={140} rx={8} fill="#faf9f7" stroke={INK} strokeWidth="1.5" {...f.draw(0, 0.6)} />
      {/* crude device sketch inside */}
      <motion.rect x={66} y={64} width={54} height={38} rx={4} fill="none" stroke={SOFT} strokeWidth="1.4" {...f.draw(0.3, 0.5)} />
      <motion.circle cx={148} cy={83} r={14} fill="none" stroke={SOFT} strokeWidth="1.4" {...f.draw(0.45, 0.5)} />
      <motion.path d="M 120 83 L 134 83" stroke={SOFT} strokeWidth="1.4" {...f.draw(0.55, 0.3)} />
      <motion.path d="M 93 102 L 93 132 L 148 132 L 148 97" fill="none" stroke={SOFT} strokeWidth="1.4" {...f.draw(0.65, 0.5)} />
      {/* scanline sweep */}
      {!reduce && (
        <motion.line x1={40} x2={182} y1={34} y2={34} stroke={BRASS} strokeWidth="1.5" opacity={0.85}
          initial={{ y: 0 }} animate={{ y: [0, 132, 0] }}
          transition={{ repeat: Infinity, duration: 4.4, ease: 'easeInOut' }} />
      )}
      <motion.g {...f.fade(0.5)}>
        <FigLabel x={111} y={186}>your sketch</FigLabel>
      </motion.g>

      {/* extracted callouts, patent-style leader lines */}
      {[
        { from: [120, 76], to: [236, 56], num: '10', label: 'housing' },
        { from: [162, 83], to: [236, 96], num: '12', label: 'sensor head' },
        { from: [148, 132], to: [236, 136], num: '14', label: 'conduit' },
      ].map((c, i) => (
        <g key={c.num}>
          <motion.path d={`M ${c.from[0]} ${c.from[1]} L ${c.to[0]} ${c.to[1]}`} stroke={BRASS} strokeWidth="1" {...f.draw(1.0 + i * 0.25, 0.5)} />
          <motion.circle cx={c.to[0]} cy={c.to[1]} r={2} fill={BRASS} {...f.pop(1.2 + i * 0.25)} />
          <motion.g {...f.fade(1.3 + i * 0.25)}>
            <text x={c.to[0] + 8} y={c.to[1] + 3.5} fontSize={10} fill={INK} style={mono}>{c.num}</text>
            {!compact && <FigLabel x={c.to[0] + 26} y={c.to[1] + 3.5} anchor="start">{c.label}</FigLabel>}
          </motion.g>
        </g>
      ))}
      {!compact && (
        <motion.g {...f.fade(2.1)}>
          <FigLabel x={294} y={186} brass>numbered · captioned · claim-mapped</FigLabel>
        </motion.g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ 6 ---- */
/** One disclosure, three voices — persona writing styles. */
export function StyleSwitchFig({ compact = false }: { compact?: boolean }) {
  const f = useFig()
  const personas = [
    { label: 'concise', lines: [86, 52, 68] },
    { label: 'litigation-hard', lines: [96, 88, 92] },
    { label: 'academic', lines: [78, 94, 60] },
  ]
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label="The same disclosure rendered in three writing personas">
      <motion.rect x={30} y={62} width={70} height={76} rx={7} fill="#faf9f7" stroke={INK} strokeWidth="1.4" {...f.draw(0, 0.5)} />
      {[0, 1, 2, 3].map((i) => (
        <motion.line key={i} x1={42} y1={78 + i * 14} x2={42 + 46 - (i % 2) * 12} y2={78 + i * 14} stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" {...f.draw(0.2 + i * 0.08, 0.35)} />
      ))}
      <motion.g {...f.fade(0.4)}>
        <FigLabel x={65} y={154}>one disclosure</FigLabel>
      </motion.g>

      {personas.map((p, i) => {
        const y = 40 + i * 52
        return (
          <g key={p.label}>
            <FlowLine d={`M 100 100 C 136 100, 142 ${y + 20}, 172 ${y + 20}`} delay={0.4 + i * 0.15} />
            <motion.rect x={172} y={y} width={196} height={40} rx={7} fill={i === 1 ? '#f6f1e4' : 'none'} stroke={i === 1 ? BRASS : SOFT} strokeWidth="1.2" {...f.draw(0.6 + i * 0.15, 0.5)} />
            {p.lines.map((w, j) => (
              <motion.line key={j} x1={186} y1={y + 12 + j * 9} x2={186 + w} y2={y + 12 + j * 9}
                stroke={i === 1 ? BRASS : SOFT} strokeWidth="2.2" strokeLinecap="round" opacity={i === 1 ? 0.85 : 0.6}
                {...f.draw(0.8 + i * 0.15 + j * 0.06, 0.4)} />
            ))}
            {!compact && (
              <motion.g {...f.fade(1.0 + i * 0.15)}>
                <FigLabel x={368} y={y + 24} anchor="end" brass={i === 1}>{p.label}</FigLabel>
              </motion.g>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/* ------------------------------------------------------------------ 7 ---- */
/** A claim under review: pass marks accrue, one edit is applied — refinement. */
export function RefineLoopFig({ checks, compact = false }: { checks: string[]; compact?: boolean }) {
  const f = useFig()
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label={`A claim iteratively checked: ${checks.join(', ')}`}>
      {/* claim block */}
      <motion.rect x={40} y={48} width={180} height={104} rx={8} fill="#faf9f7" stroke={INK} strokeWidth="1.5" {...f.draw(0, 0.6)} />
      <motion.g {...f.fade(0.25)}>
        <FigLabel x={56} y={68} anchor="start" brass>claim 1</FigLabel>
      </motion.g>
      {[[56, 84, 148], [56, 98, 132], [56, 112, 150], [56, 126, 96]].map(([x, y, w], i) => (
        <motion.line key={i} x1={x} y1={y} x2={x + w} y2={y} stroke={SOFT} strokeWidth="2.5" strokeLinecap="round" {...f.draw(0.3 + i * 0.1, 0.4)} />
      ))}
      {/* an applied refinement: one line replaced in brass */}
      <motion.line x1={56} y1={126} x2={152} y2={126} stroke={BRASS} strokeWidth="2.5" strokeLinecap="round" {...f.draw(1.6, 0.5)} />
      <motion.circle cx={44} cy={126} r={2.2} fill={BRASS} {...f.pop(1.8)} />

      {/* revolving review arc */}
      <motion.path d="M 232 60 C 268 44, 300 52, 314 84" fill="none" stroke={BRASS} strokeWidth="1.2" strokeDasharray="4 4" {...f.draw(0.6)} />
      <motion.path d="M 314 116 C 300 148, 266 156, 232 140" fill="none" stroke={BRASS} strokeWidth="1.2" strokeDasharray="4 4" {...f.draw(0.8)} />
      <motion.path d="M 236 136 l -8 2 l 5 7 z" fill={BRASS} {...f.fade(1.3)} />

      {/* checks accruing */}
      {checks.slice(0, 3).map((c, i) => {
        const y = 66 + i * 30
        return (
          <g key={c}>
            <motion.path d={`M 336 ${y} l 4 4 l 7 -8`} fill="none" stroke={BRASS} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...f.draw(1.0 + i * 0.2, 0.3)} />
            {!compact && (
              <motion.g {...f.fade(1.1 + i * 0.2)}>
                <FigLabel x={352} y={y + 1} anchor="start">{c}</FigLabel>
              </motion.g>
            )}
          </g>
        )
      })}
      {!compact && (
        <motion.g {...f.fade(1.9)}>
          <FigLabel x={130} y={182}>revised in place — nothing rewritten behind your back</FigLabel>
        </motion.g>
      )}
    </svg>
  )
}

/* ------------------------------------------------------------------ 8 ---- */
/** Draft resolves into sealed deliverables — export. */
export function ExportFig({ formats = ['docx', 'pdf'], compact = false }: { formats?: string[]; compact?: boolean }) {
  const f = useFig()
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img" aria-label={`A finished draft exported as ${formats.join(' and ')}`}>
      <motion.rect x={44} y={44} width={110} height={112} rx={8} fill="#faf9f7" stroke={INK} strokeWidth="1.5" {...f.draw(0, 0.6)} />
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.line key={i} x1={60} y1={66 + i * 18} x2={60 + 78 - (i % 3) * 14} y2={66 + i * 18} stroke={SOFT} strokeWidth="2.4" strokeLinecap="round" {...f.draw(0.2 + i * 0.08, 0.35)} />
      ))}
      <motion.g {...f.fade(0.5)}>
        <FigLabel x={99} y={172}>validated draft</FigLabel>
      </motion.g>

      <FlowLine d="M 154 100 L 216 100" delay={0.6} />
      <motion.path d="M 216 96 l 8 4 l -8 4 z" fill={BRASS} {...f.fade(0.9)} />

      {formats.map((fmt, i) => {
        const y = 52 + i * 62
        return (
          <g key={fmt}>
            <motion.rect x={244} y={y} width={92} height={44} rx={7} fill="none" stroke={INK} strokeWidth="1.4" {...f.pop(1.0 + i * 0.2)} />
            <motion.path d={`M 316 ${y} l 0 10 l 10 0`} fill="none" stroke={SOFT} strokeWidth="1" {...f.fade(1.1 + i * 0.2)} />
            <motion.g {...f.fade(1.15 + i * 0.2)}>
              <text x={258} y={y + 27} fontSize={12} fill={INK} style={mono}>.{fmt.toUpperCase()}</text>
            </motion.g>
            {/* brass seal dot */}
            <motion.circle cx={328} cy={y + 34} r={5} fill="none" stroke={BRASS} strokeWidth="1.2" {...f.pop(1.4 + i * 0.2)} />
            <motion.circle cx={328} cy={y + 34} r={1.8} fill={BRASS} {...f.pop(1.5 + i * 0.2)} />
          </g>
        )
      })}
      {!compact && (
        <motion.g {...f.fade(1.8)}>
          <FigLabel x={290} y={186} brass>formatted for filing</FigLabel>
        </motion.g>
      )}
    </svg>
  )
}
