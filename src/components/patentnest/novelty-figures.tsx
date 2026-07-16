'use client'

// Bespoke animated figures for the novelty-assessment feature page — the
// flagship treatment. Same patent-figure vocabulary as figures.tsx (ink line
// work, brass ceremony, mono labels), plus lamp green for the AI's positive
// verdicts. All motion respects prefers-reduced-motion via useFig().

import { motion, useReducedMotion } from 'framer-motion'
import { useFig, FlowLine, FigLabel } from './figures'
import { BRASS, INK, LAMP, PAPER, SOFT } from '@/lib/patentnest/palette'


const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }

/* ---------------------------------------------------------------- lanes --- */
/** Two retrieval lanes (keyword providers + semantic embeddings) unified by a
 *  neural reranker into one ranked list. */
export function TwoLaneFig() {
  const f = useFig()
  const offices = ['US', 'EP', 'WO', 'JP', 'CN', 'IN']
  const rankBars = [64, 50, 40, 30, 22]
  return (
    <svg viewBox="0 0 400 184" className="h-auto w-full" role="img"
      aria-label="Keyword and semantic retrieval lanes unified by a neural reranker into one ranked list">
      {/* disclosure source */}
      <motion.rect x={16} y={78} width={40} height={48} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0, 0.5)} />
      {[88, 96, 104, 112].map((y, i) => (
        <motion.line key={y} x1={22} y1={y} x2={i === 3 ? 40 : 50} y2={y} stroke={SOFT} strokeWidth="1.4" {...f.fade(0.15 + i * 0.05)} />
      ))}
      <FigLabel x={36} y={140} size={7}>disclosure</FigLabel>

      {/* keyword lane — patent-office blocks */}
      <FlowLine d="M 56 90 L 90 90 L 90 58 L 124 58" delay={0.3} />
      {offices.map((p, i) => (
        <g key={p}>
          <motion.rect x={124 + i * 25} y={44} width={22} height={28} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.2" {...f.pop(0.4 + i * 0.07)} />
          <motion.text x={135 + i * 25} y={61} textAnchor="middle" fontSize="6.6" fill={INK} style={mono} {...f.fade(0.45 + i * 0.07)}>
            {p}
          </motion.text>
        </g>
      ))}
      <motion.text x={278} y={61} fontSize="7.5" fill={SOFT} style={mono} {...f.fade(0.9)}>
        +
      </motion.text>
      <FigLabel x={195} y={34} brass>keyword lane · patent offices</FigLabel>

      {/* semantic lane */}
      <FlowLine d="M 56 114 L 90 114 L 90 146 L 130 146" delay={0.4} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <motion.circle key={i} cx={136 + i * 16} cy={146 + (i % 2 === 0 ? -5 : 5)} r={3.2}
          fill="none" stroke={INK} strokeWidth="1.1" {...f.pop(0.5 + i * 0.05)} />
      ))}
      <FigLabel x={195} y={176} brass>semantic lane · embeddings</FigLabel>

      {/* reranker diamond */}
      <FlowLine d="M 284 58 L 290 58 L 290 100 L 298 100" delay={0.9} />
      <FlowLine d="M 262 146 L 290 146 L 290 100 L 298 100" delay={0.95} />
      <motion.path d="M 322 76 L 346 100 L 322 124 L 298 100 Z" fill={PAPER} stroke={BRASS} strokeWidth="1.5" {...f.draw(1.05, 0.6)} />
      <motion.text x={322} y={103} textAnchor="middle" fontSize="6.4" fill={BRASS} style={mono} {...f.fade(1.2)}>
        RERANK
      </motion.text>

      {/* one ranked list */}
      {rankBars.map((w, i) => (
        <motion.rect key={i} x={356} y={70 + i * 13} width={w * 0.45} height={6} rx={3}
          fill={i === 0 ? LAMP : i < 3 ? SOFT : '#cbd5e1'} {...f.pop(1.3 + i * 0.08)} />
      ))}
      <FigLabel x={370} y={148} size={7}>one list</FigLabel>
    </svg>
  )
}

/* ----------------------------------------------------------------- gate --- */
/** Candidates flow toward the relevance gate; accepted references continue to
 *  deep analysis, borderline pass marked, rejects fall away. */
export function GateFig() {
  const f = useFig()
  const reduce = useReducedMotion()
  const incoming = [0, 1, 2, 3, 4, 5]
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img"
      aria-label="Candidate references classified at a relevance gate: accepted ones proceed to deep analysis, rejected ones fall away">
      <FlowLine d="M 20 100 L 176 100" delay={0.1} />
      {incoming.map((i) => (
        <motion.circle key={i} cx={34 + i * 24} cy={100} r={5}
          fill="none" stroke={INK} strokeWidth="1.3" {...f.pop(0.15 + i * 0.07)} />
      ))}
      <FigLabel x={98} y={82} size={7}>120 candidates</FigLabel>

      {/* the gate */}
      <motion.line x1={200} y1={40} x2={200} y2={160} stroke={BRASS} strokeWidth="2" {...f.draw(0.5, 0.5)} />
      <motion.rect x={188} y={88} width={24} height={24} rx={4} fill={PAPER} stroke={BRASS} strokeWidth="1.5" {...f.pop(0.7)} />
      {!reduce && (
        <motion.circle cx={200} cy={100} r={4} fill={BRASS}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0.3, 1, 0.3] }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        />
      )}
      {reduce && <circle cx={200} cy={100} r={4} fill={BRASS} />}
      <FigLabel x={200} y={30} brass>relevance gate</FigLabel>
      <FigLabel x={200} y={174} size={6.6}>evidence quality · high / medium / low</FigLabel>

      {/* accept track → deep analysis */}
      <FlowLine d="M 212 96 L 240 96 L 240 62 L 284 62" delay={0.9} />
      {[0, 1, 2].map((i) => (
        <motion.circle key={i} cx={296 + i * 20} cy={62} r={5} fill={LAMP} {...f.pop(1.0 + i * 0.09)} />
      ))}
      <motion.text x={296} y={48} fontSize="7" fill={LAMP} style={mono} {...f.fade(1.15)}>
        ACCEPT
      </motion.text>

      {/* borderline track */}
      <FlowLine d="M 212 102 L 284 102" delay={1.0} />
      {[0, 1].map((i) => (
        <g key={i}>
          <motion.circle cx={296 + i * 20} cy={102} r={5} fill="none" stroke={BRASS} strokeWidth="1.4" {...f.pop(1.15 + i * 0.09)} />
          <motion.path d={`M ${291 + i * 20} 102 A 5 5 0 0 1 ${301 + i * 20} 102 Z`} fill={BRASS} {...f.pop(1.2 + i * 0.09)} />
        </g>
      ))}
      <motion.text x={296} y={121} fontSize="7" fill={BRASS} style={mono} {...f.fade(1.3)}>
        BORDERLINE · QUOTA 5
      </motion.text>

      {/* reject: fall away */}
      {[0, 1].map((i) => (
        <motion.circle key={i} cx={232 + i * 18} cy={140 + i * 10} r={4.5}
          fill="none" stroke="#cbd5e1" strokeWidth="1.2"
          initial={{ opacity: 0, y: -12 }}
          whileInView={{ opacity: 0.55, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 1.25 + i * 0.1 }}
        />
      ))}
      <FigLabel x={250} y={166} size={6.6}>reject · no budget spent</FigLabel>

      {/* deep analysis box */}
      <motion.rect x={352} y={44} width={40} height={74} rx={5} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(1.35, 0.5)} />
      <motion.text x={372} y={78} textAnchor="middle" fontSize="6.4" fill={INK} style={mono} {...f.fade(1.5)}>
        DEEP
      </motion.text>
      <motion.text x={372} y={88} textAnchor="middle" fontSize="6.4" fill={INK} style={mono} {...f.fade(1.5)}>
        ANALYSIS
      </motion.text>
      <FigLabel x={372} y={132} size={6.6}>≤ 60 refs</FigLabel>
    </svg>
  )
}

/* -------------------------------------------------------------- journey --- */
/** The novelty pipeline as one living schematic: disclosure → approved plan →
 *  two retrieval lanes (patent offices + embeddings) → the gate → the evidence
 *  matrix (with one all-clear row: NOVEL) → the sealed attorney report.
 *  Orthogonal routing throughout. */
export function NoveltyJourneyFig() {
  const f = useFig()
  const reduce = useReducedMotion()
  const offices = ['US', 'EP', 'WO', 'JP', 'CN', 'IN']
  const BLUE = '#31567e'
  // matrix marks: p = present (lamp dot), h = partial (brass half), a = absent
  const marks: ('p' | 'h' | 'a')[][] = [
    ['p', 'a', 'h'],
    ['a', 'p', 'a'],
    ['h', 'a', 'p'],
    ['a', 'a', 'a'], // the all-clear row — your novel feature
  ]
  const cellX = (c: number) => 322 + c * 13
  const cellY = (r: number) => 82 + r * 13

  return (
    <svg viewBox="0 0 440 214" className="h-auto w-full" role="img"
      aria-label="The novelty pipeline: a disclosure becomes an approved search plan, retrieves through patent-office and semantic lanes, passes the relevance gate, is mapped in an evidence matrix revealing a novel feature, and ends as a sealed attorney report">

      {/* 1 · the disclosure */}
      <motion.rect x={18} y={76} width={38} height={56} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0, 0.5)} />
      {[88, 96, 104, 112, 120].map((y, i) => (
        <motion.line key={y} x1={24} y1={y} x2={i === 3 ? 42 : 50} y2={y} stroke={SOFT} strokeWidth="1.3" {...f.fade(0.15 + i * 0.04)} />
      ))}
      <FigLabel x={37} y={148} size={6.2}>disclosure</FigLabel>

      <FlowLine d="M 56 104 L 84 104" delay={0.35} />

      {/* 2 · the plan, approved by you */}
      <motion.rect x={84} y={74} width={64} height={60} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0.5, 0.5)} />
      <motion.text x={116} y={88} textAnchor="middle" fontSize="5.4" letterSpacing="0.1em" fill={INK} style={mono} {...f.fade(0.7)}>
        SEARCH PLAN
      </motion.text>
      {[98, 108, 118].map((y, i) => (
        <g key={y}>
          <motion.line x1={92} y1={y} x2={126} y2={y} stroke={SOFT} strokeWidth="1.4" {...f.fade(0.75 + i * 0.07)} />
          <motion.circle cx={136} cy={y} r={2.6} fill="none" stroke={LAMP} strokeWidth="1.1" {...f.pop(0.8 + i * 0.07)} />
        </g>
      ))}
      {/* the approval stamp */}
      <motion.circle cx={148} cy={74} r={8} fill={BRASS} {...f.pop(1.0)} />
      <motion.path d="M 144.5 74 l 2.4 2.6 l 4.6 -5.2" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" {...f.draw(1.1, 0.25)} />
      <FigLabel x={116} y={148} size={6.2} brass>01 · plan · you approve</FigLabel>

      {/* 3 · the split into two lanes (orthogonal bus) */}
      <motion.path d="M 148 104 L 162 104" fill="none" stroke={SOFT} strokeWidth="1.1" {...f.draw(1.15, 0.2)} />
      <motion.path d="M 162 40 L 162 172" fill="none" stroke={SOFT} strokeWidth="1.1" {...f.draw(1.25, 0.35)} />
      <motion.path d="M 162 40 L 176 40" fill="none" stroke={SOFT} strokeWidth="1.1" {...f.draw(1.35, 0.2)} />
      <motion.path d="M 162 172 L 178 172" fill="none" stroke={SOFT} strokeWidth="1.1" {...f.draw(1.35, 0.2)} />

      {/* keyword lane — office blocks */}
      <FigLabel x={230} y={22} brass size={6.4}>02 · retrieve · patent offices</FigLabel>
      {offices.map((o, i) => (
        <g key={o}>
          <motion.rect x={176 + i * 18} y={32} width={16} height={16} rx={3} fill={PAPER} stroke={INK} strokeWidth="1.1" {...f.pop(1.4 + i * 0.08)} />
          <motion.text x={184 + i * 18} y={42.5} textAnchor="middle" fontSize="5.6" fill={INK} style={mono} {...f.fade(1.45 + i * 0.08)}>
            {o}
          </motion.text>
        </g>
      ))}
      <motion.text x={230} y={59} textAnchor="middle" fontSize="5.4" letterSpacing="0.1em" fill={SOFT} style={mono} {...f.fade(1.9)}>
        30M+ PATENTS · WORLDWIDE
      </motion.text>
      <FlowLine d="M 284 40 L 298 40 L 298 96" delay={1.95} />

      {/* semantic lane — embedding dots */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <motion.circle key={i} cx={178 + i * 14} cy={i % 2 === 0 ? 168 : 176} r={3}
          fill="none" stroke={BLUE} strokeWidth="1.1" {...f.pop(1.5 + i * 0.05)} />
      ))}
      <text x={230} y={196} textAnchor="middle" fontSize="6.4" letterSpacing="0.08em" fill={BLUE} style={mono}>
        SEMANTIC LANE
      </text>
      <FlowLine d="M 268 172 L 298 172 L 298 120" delay={2.05} />

      {/* 4 · the gate */}
      <motion.rect x={286} y={96} width={24} height={24} rx={4} fill={PAPER} stroke={BRASS} strokeWidth="1.5" {...f.draw(2.15, 0.4)} />
      {reduce ? (
        <circle cx={298} cy={108} r={3.4} fill={BRASS} />
      ) : (
        <motion.circle cx={298} cy={108} r={3.4} fill={BRASS}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0.35, 1, 0.35] }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ delay: 2.3, duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <FigLabel x={298} y={148} size={6.2}>03 · the gate</FigLabel>

      <FlowLine d="M 310 108 L 322 108" delay={2.45} />

      {/* 5 · the evidence matrix */}
      {marks.map((row, r) =>
        row.map((m, c) => {
          const x = cellX(c)
          const y = cellY(r)
          const d = 2.5 + (r * 3 + c) * 0.045
          return (
            <g key={`${r}-${c}`}>
              <motion.rect x={x} y={y} width={11} height={11} rx={2} fill={PAPER} stroke="#cbd5e1" strokeWidth="0.9" {...f.fade(d)} />
              {m === 'p' && <motion.circle cx={x + 5.5} cy={y + 5.5} r={3} fill={LAMP} {...f.pop(d + 0.12)} />}
              {m === 'h' && (
                <g>
                  <motion.circle cx={x + 5.5} cy={y + 5.5} r={3} fill="none" stroke={BRASS} strokeWidth="1" {...f.pop(d + 0.12)} />
                  <motion.path d={`M ${x + 2.5} ${y + 5.5} A 3 3 0 0 1 ${x + 8.5} ${y + 5.5} Z`} fill={BRASS} {...f.pop(d + 0.16)} />
                </g>
              )}
              {m === 'a' && (
                <motion.line x1={x + 3} y1={y + 5.5} x2={x + 8} y2={y + 5.5} stroke={SOFT} strokeWidth="1.2" {...f.fade(d + 0.12)} />
              )}
            </g>
          )
        })
      )}
      {/* the all-clear row: novel */}
      {reduce ? (
        <rect x={319} y={118.5} width={45} height={16} rx={5} fill="none" stroke={LAMP} strokeWidth="1.3" />
      ) : (
        <motion.rect x={319} y={118.5} width={45} height={16} rx={5} fill="none" stroke={LAMP} strokeWidth="1.3"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0, 1, 0.55, 1] }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ delay: 3.25, duration: 2.6, repeat: Infinity, repeatDelay: 0.5 }}
        />
      )}
      <motion.text x={341} y={152} textAnchor="middle" fontSize="6.4" letterSpacing="0.12em" fill={LAMP} style={mono} {...f.fade(3.35)}>
        NOVEL
      </motion.text>
      <FigLabel x={341} y={163} size={5.8}>04 · map</FigLabel>

      <FlowLine d="M 362 108 L 376 108" delay={3.5} />

      {/* 6 · the attorney report */}
      <motion.rect x={376} y={68} width={52} height={80} rx={5} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(3.6, 0.5)} />
      <motion.line x1={384} y1={80} x2={420} y2={80} stroke={INK} strokeWidth="1.6" {...f.draw(3.8, 0.3)} />
      {[90, 98, 106].map((y, i) => (
        <motion.line key={y} x1={384} y1={y} x2={i === 2 ? 406 : 420} y2={y} stroke={SOFT} strokeWidth="1.2" {...f.fade(3.85 + i * 0.06)} />
      ))}
      {/* risk bars */}
      <motion.rect x={384} y={116} width={16} height={5} rx={2.5} fill={LAMP} opacity={0.85} {...f.pop(4.1)} />
      <motion.rect x={404} y={116} width={12} height={5} rx={2.5} fill="#b45309" opacity={0.7} {...f.pop(4.18)} />
      {/* the seal */}
      <motion.circle cx={414} cy={136} r={7} fill="none" stroke={BRASS} strokeWidth="1.3" {...f.draw(4.25, 0.4)} />
      <motion.circle cx={414} cy={136} r={4.4} fill="none" stroke={BRASS} strokeWidth="0.8" strokeDasharray="1.4 1.6" {...f.fade(4.4)} />
      {/* emailed pulse */}
      {reduce ? (
        <circle cx={422} cy={74} r={3} fill={LAMP} />
      ) : (
        <motion.circle cx={422} cy={74} r={3} fill={LAMP}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0.4, 1, 0.4] }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ delay: 4.5, duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <FigLabel x={400} y={163} size={5.8} brass>05 · report · ~15 min</FigLabel>
    </svg>
  )
}

/* ------------------------------------------------------------- evidence --- */
/** A verbatim quote is lifted character-for-character from a reference into a
 *  matrix cell; thin evidence is forced to Unknown instead of guessed. */
export function EvidenceFig() {
  const f = useFig()
  return (
    <svg viewBox="0 0 400 200" className="h-auto w-full" role="img"
      aria-label="A verbatim quote extracted from a prior-art reference becomes the evidence for a Present verdict; thin evidence is marked Unknown instead of guessed">
      {/* the reference document */}
      <motion.rect x={24} y={26} width={130} height={150} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.5" {...f.draw(0, 0.6)} />
      <motion.text x={36} y={46} fontSize="7.5" fill={INK} style={mono} {...f.fade(0.2)}>
        US 10,842 B2
      </motion.text>
      <motion.line x1={36} y1={54} x2={142} y2={54} stroke={SOFT} strokeWidth="0.8" {...f.draw(0.25, 0.4)} />
      {[66, 76, 86, 106, 116, 126, 136, 146, 156].map((y, i) => (
        <motion.line key={y} x1={36} y1={y} x2={i % 3 === 2 ? 110 : 142} y2={y} stroke="#cbd5e1" strokeWidth="1.6" {...f.fade(0.3 + i * 0.04)} />
      ))}
      {/* the highlighted span */}
      <motion.rect x={34} y={90} width={110} height={10} rx={2} fill={BRASS} opacity={0.16} {...f.pop(0.75)} />
      <motion.line x1={36} y1={96} x2={142} y2={96} stroke={BRASS} strokeWidth="1.8" {...f.draw(0.8, 0.6)} />
      <FigLabel x={89} y={190} size={7}>title · abstract · claims only</FigLabel>

      {/* the lift */}
      <FlowLine d="M 148 95 L 196 95 L 196 68 L 240 68" delay={1.1} />

      {/* the evidence cell */}
      <motion.rect x={244} y={40} width={132} height={56} rx={6} fill={PAPER} stroke={LAMP} strokeWidth="1.5" {...f.draw(1.25, 0.5)} />
      <motion.circle cx={262} cy={60} r={6} fill={LAMP} {...f.pop(1.45)} />
      <motion.text x={276} y={63} fontSize="7.5" fill={INK} style={mono} {...f.fade(1.5)}>
        PRESENT
      </motion.text>
      <motion.text x={258} y={82} fontSize="6.6" fill={SOFT} style={mono} {...f.fade(1.6)}>
        “…VERBATIM, ≤ 18 WORDS”
      </motion.text>
      <motion.rect x={330} y={52} width={38} height={14} rx={7} fill="none" stroke={LAMP} strokeWidth="1" {...f.pop(1.7)} />
      <motion.text x={349} y={62} textAnchor="middle" fontSize="6.6" fill={LAMP} style={mono} {...f.fade(1.75)}>
        0.92
      </motion.text>

      {/* the honest cell */}
      <motion.rect x={244} y={116} width={132} height={48} rx={6} fill="none" stroke={SOFT} strokeWidth="1.2" strokeDasharray="4 4" {...f.draw(1.6, 0.5)} />
      <motion.text x={262} y={140} fontSize="10" fill={SOFT} style={mono} {...f.fade(1.8)}>
        ?
      </motion.text>
      <motion.text x={276} y={136} fontSize="7" fill={SOFT} style={mono} {...f.fade(1.85)}>
        UNKNOWN
      </motion.text>
      <motion.text x={276} y={148} fontSize="6.2" fill={SOFT} style={mono} {...f.fade(1.9)}>
        THIN EVIDENCE — NEVER GUESSED
      </motion.text>
      <FigLabel x={310} y={190} size={7} brass>evidence, or it did not happen</FigLabel>
    </svg>
  )
}
