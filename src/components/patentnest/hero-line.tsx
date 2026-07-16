'use client'

// The hero figure: ONE unbroken pen line from disclosure to grant, v2.
// Seven stages of patent preparation, each drawn with its own symbol and its
// own ink color — the line changes color at stage boundaries like a metro
// line crossing zones, and it CIRCLES (loops) wherever the work is genuinely
// iterative: the search lens, claim refinement, the review pass.
//   I    DISCLOSE   ink     — the scribble
//   II   SEARCH     blue    — the line loops into a magnifying lens, then
//                             passes the brass relevance gate
//   III  DRAWINGS   violet  — the mechanism resolves, numerals 10/12/14
//   IV   CLAIMS     brass   — a refinement curl, then the claim's underline
//                             with its antecedent thread
//   V    SPEC       wax     — the line becomes handwriting on a page
//   VI   REVIEW     green   — a double loop-the-loop, then the check
//   VII  FILED →    ink     — through the FILED stamp...
//        GRANTED    brass   — ...and coils into the ribbon of the seal
// Segments share exact endpoints — visually one pen that never lifts.
// Reduced motion renders the completed drawing.

import { motion, useReducedMotion } from 'framer-motion'
import { useFig } from './figures'
import { BLUE, BRASS, INK, LAMP, SOFT, VIOLET, WAX } from '@/lib/patentnest/palette'


const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
const serif = { fontFamily: 'var(--font-cormorant), Georgia, serif' }
const VIEW = { once: true, margin: '-80px' } as const

// The pen — each stroke starts exactly where the previous ended.
const STROKES: { d: string; color: string; delay: number; dur: number }[] = [
  // I — DISCLOSE: the scribble (ink)
  {
    d: 'M 30 150 C 56 92, 86 202, 66 132 C 51 82, 116 102, 96 162 C 84 207, 136 182, 122 130 C 114 100, 146 130, 130 160',
    color: INK, delay: 0.3, dur: 1.1,
  },
  // II — SEARCH: the magnifier loop, then through the gate (blue)
  {
    d: 'M 130 160 L 158 176 L 178 196 C 162 216, 176 244, 200 240 C 222 236, 226 208, 206 200 C 192 194, 180 206, 186 220 L 210 216 L 240 194 L 262 178 L 286 170',
    color: BLUE, delay: 1.6, dur: 1.5,
  },
  // III — DRAWINGS: the mechanism silhouette (violet)
  {
    d: 'M 286 170 L 304 170 L 304 138 L 348 138 L 348 118 A 12 12 0 0 1 372 118 L 372 138 L 412 138 L 412 176 L 432 176',
    color: VIOLET, delay: 3.4, dur: 1.4,
  },
  // IV — CLAIMS: a refinement curl, then the underline (brass)
  {
    d: 'M 432 176 L 452 176 C 458 156, 482 154, 484 170 C 485 184, 464 188, 462 174 C 461 166, 470 162, 476 166 L 492 176 L 620 176',
    color: BRASS, delay: 5.1, dur: 1.5,
  },
  // V — SPEC: the line becomes handwriting, then descends (wax)
  {
    d: 'M 620 176 C 628 166, 632 186, 640 176 C 648 166, 652 186, 660 176 C 668 166, 672 186, 680 176 L 690 186 C 696 196, 704 194, 708 200',
    color: WAX, delay: 6.9, dur: 1.2,
  },
  // VI — REVIEW: the double loop-the-loop (lamp green)
  {
    d: 'M 708 200 C 698 224, 722 240, 738 226 C 749 216, 738 198, 725 205 C 715 211, 719 227, 733 228 L 754 234',
    color: LAMP, delay: 8.3, dur: 1.2,
  },
  // VII-a — to the FILED stamp (ink)
  { d: 'M 754 234 L 778 246 L 798 258', color: INK, delay: 9.7, dur: 0.5 },
  // VII-b — the seal's ribbon coil (brass)
  {
    d: 'M 798 258 C 812 270, 826 282, 836 292 C 852 304, 868 296, 864 282 C 860 270, 846 268, 840 280 C 836 290, 846 298, 858 301 L 872 307',
    color: BRASS, delay: 10.5, dur: 1.3,
  },
]

const CAPTIONS: { x: number; t: string; color?: string; delay: number }[] = [
  { x: 82, t: 'A ROUGH DISCLOSURE', delay: 1.5 },
  { x: 212, t: 'SEARCH · 30M+ PATENTS', color: BLUE, delay: 3.1 },
  { x: 356, t: 'FIGURES · NUMERALS ONCE', color: VIOLET, delay: 4.9 },
  { x: 530, t: 'CLAIMS · VERIFIED', color: BRASS, delay: 6.6 },
  { x: 652, t: 'SPEC · 12 OFFICES', color: WAX, delay: 8.1 },
  { x: 742, t: 'EXAMINER REVIEW', color: LAMP, delay: 9.5 },
  { x: 845, t: 'FILED → GRANTED', color: BRASS, delay: 12.0 },
]

export function UnbrokenLineFig() {
  const f = useFig()
  const reduce = useReducedMotion()

  return (
    <svg viewBox="0 0 900 400" className="h-auto w-full" role="img"
      aria-label="One unbroken pen line through seven stages of patent preparation, changing color at each stage: a scribbled disclosure, a magnifying-lens search loop through the relevance gate, a numbered mechanism drawing, a claim refined and underlined, a handwritten specification, an examiner review loop with its check — then through the FILED stamp and into the coiled ribbon of the GRANTED seal">

      {/* the one line, changing ink at each stage */}
      {STROKES.map((s, i) => (
        <motion.path key={i} d={s.d} fill="none" stroke={s.color} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" {...f.draw(s.delay, s.dur)} />
      ))}

      {/* II — the relevance gate the searched line passes through */}
      <motion.line x1={251} y1={158} x2={251} y2={178} stroke={BRASS} strokeWidth="2" {...f.draw(2.7, 0.25)} />
      <motion.line x1={251} y1={194} x2={251} y2={214} stroke={BRASS} strokeWidth="2" {...f.draw(2.75, 0.25)} />
      {reduce ? (
        <circle cx={251} cy={186} r={3} fill={BRASS} />
      ) : (
        <motion.circle cx={251} cy={186} r={3} fill={BRASS}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0, 1, 0.45, 1] }}
          viewport={VIEW}
          transition={{ delay: 3.0, duration: 2.6, repeat: Infinity, repeatDelay: 0.4 }}
        />
      )}

      {/* III — reference numerals with leader ticks */}
      {([
        { nx: 286, ny: 124, lx1: 294, ly1: 128, lx2: 304, ly2: 138, n: '10' },
        { nx: 360, ny: 92, lx1: 360, ly1: 96, lx2: 360, ly2: 104, n: '12' },
        { nx: 430, ny: 128, lx1: 424, ly1: 132, lx2: 414, ly2: 140, n: '14' },
      ]).map((m, i) => (
        <g key={m.n}>
          <motion.line x1={m.lx1} y1={m.ly1} x2={m.lx2} y2={m.ly2} stroke={SOFT} strokeWidth="0.9" {...f.fade(4.5 + i * 0.15)} />
          <motion.text x={m.nx} y={m.ny} textAnchor="middle" fontSize="10" fill={INK} style={serif} fontStyle="italic" {...f.fade(4.55 + i * 0.15)}>
            {m.n}
          </motion.text>
        </g>
      ))}

      {/* IV — the claim being underlined, and its antecedent thread */}
      <motion.text x={498} y={163} fontSize="13" fill={INK} style={serif} fontStyle="italic" {...f.fade(5.9)}>
        … wherein the sensor array (12) …
      </motion.text>
      <motion.text x={508} y={128} fontSize="8" letterSpacing="0.08em" fill={SOFT} style={mono} {...f.fade(6.3)}>
        A SENSOR ARRAY
      </motion.text>
      <motion.path d="M 548 154 C 538 144, 530 138, 522 133" fill="none" stroke={BRASS} strokeWidth="1" {...f.draw(6.35, 0.4)} />
      <motion.path d="M 578 125 l 3 3.4 l 6 -6.8" fill="none" stroke={LAMP} strokeWidth="1.4" strokeLinecap="round" {...f.draw(6.55, 0.3)} />

      {/* V — the page the specification is written on */}
      <motion.rect x={612} y={152} width={92} height={58} rx={3} fill="none" stroke={INK} strokeWidth="0.7" opacity={0.28} {...f.fade(6.8)} />

      {/* VI — the review's verdict */}
      <motion.path d="M 748 208 l 4 4.6 l 8.5 -9.6" fill="none" stroke={LAMP} strokeWidth="1.8" strokeLinecap="round" {...f.draw(9.3, 0.35)} />

      {/* VII — the FILED stamp the line passes through */}
      <motion.g
        initial={{ opacity: 0, scale: reduce ? 1 : 1.25, rotate: reduce ? -4 : 0 }}
        whileInView={{ opacity: 1, scale: 1, rotate: -4 }}
        viewport={VIEW}
        transition={{ delay: reduce ? 0 : 10.0, duration: 0.3, ease: 'easeOut' }}
        style={{ transformOrigin: '788px 236px' }}
      >
        <rect x={752} y={252} width={74} height={26} rx={4} fill="none" stroke={INK} strokeWidth="1.6"
          transform="rotate(-8 789 265)" />
        <text x={789} y={263} textAnchor="middle" fontSize="10" letterSpacing="0.22em" fill={INK} style={mono}
          transform="rotate(-8 789 265)">
          FILED
        </text>
        <text x={789} y={273} textAnchor="middle" fontSize="5.4" letterSpacing="0.12em" fill={SOFT} style={mono}
          transform="rotate(-8 789 265)">
          16 JUL 2026
        </text>
      </motion.g>

      {/* VII — the seal stamps over the coil */}
      <motion.circle cx={849} cy={288} r={13} fill="none" stroke={BRASS} strokeWidth="1.6" {...f.pop(11.7)} />
      <motion.circle cx={849} cy={288} r={8.6} fill="none" stroke={BRASS} strokeWidth="0.9" strokeDasharray="1.6 1.8" {...f.fade(11.85)} />
      {reduce ? null : (
        <motion.circle cx={849} cy={288} r={13} fill="none" stroke={BRASS} strokeWidth="1"
          initial={{ opacity: 0, scale: 1 }}
          whileInView={{ opacity: [0, 0.5, 0], scale: [1, 1.5, 1.9] }}
          viewport={VIEW}
          transition={{ delay: 12.2, duration: 2.8, repeat: Infinity, repeatDelay: 1.2 }}
          style={{ transformOrigin: '849px 288px' }}
        />
      )}
      <motion.text x={849} y={330} textAnchor="middle" fontSize="8" letterSpacing="0.26em" fill={BRASS} style={mono} {...f.fade(12.0)}>
        GRANTED
      </motion.text>

      {/* the seven stage captions — each in its stage's ink, kept as a strip */}
      {CAPTIONS.map((c) => (
        <motion.text key={c.t} x={c.x} y={372} textAnchor="middle" fontSize="8.5"
          letterSpacing="0.16em" fill={c.color ?? SOFT} style={mono} {...f.fade(c.delay)}>
          {c.t}
        </motion.text>
      ))}
    </svg>
  )
}
