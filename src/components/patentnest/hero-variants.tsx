'use client'

// Hero lab variants — three answers to "the unbroken line is too small to read":
//   A · SERPENTINE  — the line switchbacks over three rows; every stage gets
//                     ~2× the room, captions at readable sizes.
//   B · FOUR ACTS   — fewer, bigger chapters: Disclose / Search / Draft / Grant.
//                     The search lens literally circles "30M+".
//   C · CINEMATIC   — one stage at a time, drawn large, with real HTML type
//                     beside it; auto-advances through all seven stages.
// Same one-pen grammar and stage inks as hero-line.tsx.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useFig } from './figures'
import { BLUE, BRASS, INK, LAMP, SOFT, VIOLET, WAX } from '@/lib/patentnest/palette'


const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
const serif = { fontFamily: 'var(--font-cormorant), Georgia, serif' }
const VIEW = { once: true, margin: '-80px' } as const

function Caption({ x, y, name, promise, color }: { x: number; y: number; name: string; promise: string; color: string }) {
  const f = useFig()
  return (
    <g>
      <motion.text x={x} y={y} textAnchor="middle" fontSize="14" letterSpacing="0.14em" fill={color} style={mono} {...f.fade(0.2)}>
        {name}
      </motion.text>
      <motion.text x={x} y={y + 18} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={SOFT} style={mono} {...f.fade(0.35)}>
        {promise}
      </motion.text>
    </g>
  )
}

/* ================================================== A · SERPENTINE ======= */

export function SerpentineHeroFig({ speed = 0.62 }: { speed?: number }) {
  // Simulation finding: a senior partner gives the page ~5 seconds — the pen
  // must reach GRANTED in ~10s, not 17. `speed` scales the whole choreography
  // (delays and draw durations) without re-authoring the timeline.
  const f0 = useFig()
  const reduce = useReducedMotion()
  const S = speed
  const f = {
    draw: (delay = 0, dur = 0.9) => f0.draw(delay * S, Math.max(0.25, dur * S)),
    pop: (delay = 0) => f0.pop(delay * S),
    fade: (delay = 0) => f0.fade(delay * S),
  }

  return (
    <svg viewBox="0 0 900 600" className="h-auto w-full" role="img"
      aria-label="The unbroken line as a serpentine through the patent process: a scribble resolves into a lightbulb, a double search-lens loop passes prior-art documents and the relevance gate, a hatched mechanism drawing is numbered, a claim is refined twice and underlined, the specification writes itself with paragraph numbers, a triple review loop clears the statutes — then the FILED stamp and the ribboned GRANTED seal">

      {/* ---- row 1 · disclose (ink) + search (blue) ---- */}
      {/* the scribble resolves into a lightbulb */}
      <motion.path
        d="M 40 110 C 72 44, 108 176, 86 96 C 68 36, 142 56, 120 128 C 104 178, 162 152, 148 98 C 141 72, 158 84, 152 106 C 148 82, 154 74, 168 72 C 190 70, 200 88, 192 104 C 187 114, 176 118, 170 112 L 186 118 L 214 110"
        fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...f.draw(0.3, 1.6)} />
      {/* filament + rays */}
      <motion.line x1={172} y1={122} x2={184} y2={122} stroke={INK} strokeWidth="1.2" {...f.fade(1.8)} />
      <motion.line x1={174} y1={127} x2={182} y2={127} stroke={INK} strokeWidth="1.2" {...f.fade(1.85)} />
      {([[203, 62], [214, 84], [158, 56]] as const).map(([x, y], i) => (
        <motion.line key={i} x1={x} y1={y} x2={x + (i === 2 ? -7 : 7)} y2={y - 7} stroke={BRASS} strokeWidth="1.4" {...f.fade(1.95 + i * 0.08)} />
      ))}

      {/* the search: double lens loop → prior-art stack → the gate */}
      <motion.path
        d="M 214 110 L 240 118 L 258 134 C 232 162, 250 204, 286 198 C 320 192, 326 150, 296 140 C 275 133, 258 150, 268 170 C 274 182, 290 184, 296 172 L 322 160 L 348 138 L 372 120 L 396 110 L 466 110 L 540 110 L 850 110 L 850 300"
        fill="none" stroke={BLUE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...f.draw(2.2, 2.4)} />
      {/* the prior-art stack the line reads through */}
      {([[404, 78], [412, 72], [420, 66]] as const).map(([x, y], i) => (
        <motion.rect key={i} x={x} y={y} width={40} height={56} rx={3} fill="#fdfcfa" stroke={SOFT} strokeWidth="1" {...f.fade(3.2 + i * 0.1)} />
      ))}
      {[80, 90, 100].map((y, i) => (
        <motion.line key={y} x1={427} y1={y} x2={i === 2 ? 444 : 453} y2={y} stroke="#cbd5e1" strokeWidth="1.4" {...f.fade(3.5)} />
      ))}
      {/* classification chips */}
      <motion.text x={300} y={62} textAnchor="middle" fontSize="10" letterSpacing="0.08em" fill={SOFT} style={mono} {...f.fade(3.0)}>
        CPC · A01G 25/16
      </motion.text>
      {/* the gate */}
      <motion.line x1={510} y1={72} x2={510} y2={96} stroke={BRASS} strokeWidth="2.4" {...f.draw(3.7, 0.25)} />
      <motion.line x1={510} y1={124} x2={510} y2={148} stroke={BRASS} strokeWidth="2.4" {...f.draw(3.75, 0.25)} />
      {reduce ? <circle cx={510} cy={110} r={3.5} fill={BRASS} /> : (
        <motion.circle cx={510} cy={110} r={3.5} fill={BRASS}
          initial={{ opacity: 0 }} whileInView={{ opacity: [0, 1, 0.45, 1] }} viewport={VIEW}
          transition={{ delay: 4.0 * S, duration: 2.6, repeat: Infinity, repeatDelay: 0.4 }} />
      )}
      {/* searched art flying past on the straightaway */}
      {(['US 10,842 B2', 'EP 3,301 A1', 'WO 19/144']).map((p, i) => (
        <motion.text key={p} x={590 + i * 95} y={94} textAnchor="middle" fontSize="10" letterSpacing="0.06em" fill={SOFT} style={mono} {...f.fade(4.1 + i * 0.15)}>
          {p}
        </motion.text>
      ))}
      <Caption x={116} y={200} name="I · DISCLOSE" promise="a rough idea is enough" color={INK} />
      <Caption x={330} y={248} name="II · SEARCH" promise="30M+ patents · gate-checked" color={BLUE} />

      {/* ---- row 2 · drawings (violet) + claims (brass), right to left ---- */}
      <motion.path
        d="M 850 300 L 812 300 L 812 260 L 764 260 L 764 238 A 14 14 0 0 0 736 238 L 736 260 L 692 260 L 692 300 L 660 300"
        fill="none" stroke={VIOLET} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...f.draw(4.8, 1.6)} />
      {/* section hatching — patent-drawing convention */}
      {([0, 1, 2] as const).map((i) => (
        <motion.line key={i} x1={706 + i * 26} y1={294} x2={722 + i * 26} y2={268} stroke={VIOLET} strokeWidth="1" opacity={0.45} {...f.draw(5.6 + i * 0.12, 0.3)} />
      ))}
      {/* FIG. tag */}
      <motion.text x={790} y={222} textAnchor="middle" fontSize="11" letterSpacing="0.2em" fill={SOFT} style={mono} {...f.fade(5.4)}>
        FIG. 1
      </motion.text>
      {([
        { nx: 838, ny: 244, lx1: 830, ly1: 250, lx2: 818, ly2: 258, n: '10' },
        { nx: 750, ny: 202, lx1: 750, ly1: 208, lx2: 750, ly2: 220, n: '12' },
        { nx: 668, ny: 252, lx1: 676, ly1: 258, lx2: 688, ly2: 266, n: '14' },
      ]).map((m, i) => (
        <g key={m.n}>
          <motion.line x1={m.lx1} y1={m.ly1} x2={m.lx2} y2={m.ly2} stroke={SOFT} strokeWidth="1" {...f.fade(5.9 + i * 0.15)} />
          <motion.text x={m.nx} y={m.ny} textAnchor="middle" fontSize="13" fill={INK} style={serif} fontStyle="italic" {...f.fade(5.95 + i * 0.15)}>
            {m.n}
          </motion.text>
        </g>
      ))}
      {/* claims: two refinement curls, then the numbered claim's underline */}
      <motion.path
        d="M 660 300 C 652 274, 624 272, 622 292 C 621 308, 646 312, 648 294 C 649 284, 638 280, 632 286 L 616 300 C 610 282, 590 282, 590 298 C 590 311, 610 310, 608 298 L 592 300 L 560 300 L 180 300 L 130 300"
        fill="none" stroke={BRASS} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...f.draw(6.6, 2.2)} />
      <motion.text x={188} y={282} fontSize="18" fill={INK} style={serif} {...f.fade(7.6)}>
        1.
      </motion.text>
      <motion.text x={214} y={282} fontSize="16.5" fill={INK} style={serif} fontStyle="italic" {...f.fade(7.7)}>
        … wherein the sensor array (12) self-calibrates …
      </motion.text>
      <motion.text x={252} y={240} fontSize="10.5" letterSpacing="0.08em" fill={SOFT} style={mono} {...f.fade(8.0)}>
        A SENSOR ARRAY
      </motion.text>
      <motion.path d="M 322 272 C 310 260, 298 252, 288 246" fill="none" stroke={BRASS} strokeWidth="1.2" {...f.draw(8.05, 0.4)} />
      <motion.path d="M 348 236 l 4 4.4 l 8 -9" fill="none" stroke={LAMP} strokeWidth="1.8" strokeLinecap="round" {...f.draw(8.25, 0.3)} />
      {/* the dependent claim, already forming */}
      <motion.text x={214} y={330} fontSize="12" fill={SOFT} style={serif} fontStyle="italic" {...f.fade(8.4)}>
        2. The array of claim 1, wherein …
      </motion.text>
      <Caption x={758} y={366} name="III · DRAWINGS" promise="numerals once · FIG. discipline" color={VIOLET} />
      <Caption x={452} y={366} name="IV · CLAIMS" promise="refined · antecedent verified" color={BRASS} />

      {/* ---- row 3 · spec (wax) + review (green) + filed/granted ---- */}
      <motion.path
        d="M 130 300 L 70 300 L 70 480 L 116 480 C 128 466, 134 494, 146 480 C 158 466, 164 494, 176 480 C 188 466, 194 494, 206 480 C 218 466, 224 494, 236 480 L 252 486 C 258 494, 250 502, 240 502 L 148 502 C 140 502, 136 508, 142 512 L 250 512 L 274 496"
        fill="none" stroke={WAX} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...f.draw(9.0, 2.2)} />
      {/* the page + paragraph numbering */}
      <motion.rect x={100} y={450} width={172} height={76} rx={4} fill="none" stroke={INK} strokeWidth="0.8" opacity={0.25} {...f.fade(8.9)} />
      <motion.text x={84} y={484} textAnchor="end" fontSize="9" fill={SOFT} style={mono} {...f.fade(10.0)}>
        [0001]
      </motion.text>
      <motion.text x={84} y={510} textAnchor="end" fontSize="9" fill={SOFT} style={mono} {...f.fade(10.2)}>
        [0002]
      </motion.text>
      {/* review: a triple cursive loop, then the statutes cleared */}
      <motion.path
        d="M 274 496 C 258 526, 290 546, 312 530 C 328 518, 314 494, 296 502 C 282 508, 286 528, 304 530 C 310 546, 334 550, 346 536 C 355 526, 346 510, 332 514 L 358 520 L 392 500 L 420 486"
        fill="none" stroke={LAMP} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" {...f.draw(11.5, 1.7)} />
      <motion.path d="M 384 464 l 5 5.6 l 10 -11" fill="none" stroke={LAMP} strokeWidth="2.2" strokeLinecap="round" {...f.draw(13.0, 0.35)} />
      {/* through the FILED stamp */}
      <motion.path d="M 420 486 L 470 480 L 556 480" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" {...f.draw(13.4, 0.7)} />
      <motion.g
        initial={{ opacity: 0, scale: reduce ? 1 : 1.25 }}
        whileInView={{ opacity: 1, scale: 1 }} viewport={VIEW}
        transition={{ delay: reduce ? 0 : 13.9 * S, duration: 0.3, ease: 'easeOut' }}
        style={{ transformOrigin: '512px 474px' }}
      >
        <rect x={466} y={456} width={94} height={36} rx={5} fill="none" stroke={INK} strokeWidth="2" transform="rotate(-7 513 474)" />
        <text x={513} y={473} textAnchor="middle" fontSize="13" letterSpacing="0.24em" fill={INK} style={mono} transform="rotate(-7 513 474)">FILED</text>
        <text x={513} y={485} textAnchor="middle" fontSize="7" letterSpacing="0.12em" fill={SOFT} style={mono} transform="rotate(-7 513 474)">16 JUL 2026</text>
      </motion.g>
      {/* the ribboned seal */}
      <motion.path
        d="M 556 480 C 590 486, 622 496, 648 506 C 674 516, 696 510, 692 492 C 688 476, 666 474, 660 490 C 655 502, 666 512, 682 514 L 706 518"
        fill="none" stroke={BRASS} strokeWidth="2.4" strokeLinecap="round" {...f.draw(14.4, 1.4)} />
      <motion.circle cx={672} cy={496} r={18} fill="none" stroke={BRASS} strokeWidth="2" {...f.pop(15.7)} />
      <motion.circle cx={672} cy={496} r={12} fill="none" stroke={BRASS} strokeWidth="1.1" strokeDasharray="2 2.2" {...f.fade(15.85)} />
      {/* the ribbon tails */}
      <motion.path d="M 664 512 L 656 536 L 668 528" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinejoin="round" {...f.draw(16.0, 0.35)} />
      <motion.path d="M 680 512 L 688 536 L 676 528" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinejoin="round" {...f.draw(16.05, 0.35)} />
      {reduce ? null : (
        <motion.circle cx={672} cy={496} r={18} fill="none" stroke={BRASS} strokeWidth="1.2"
          initial={{ opacity: 0, scale: 1 }} whileInView={{ opacity: [0, 0.5, 0], scale: [1, 1.45, 1.8] }} viewport={VIEW}
          transition={{ delay: 16.4 * S, duration: 2.8, repeat: Infinity, repeatDelay: 1.2 }}
          style={{ transformOrigin: '672px 496px' }} />
      )}
      <motion.text x={772} y={492} fontSize="13" letterSpacing="0.26em" fill={BRASS} style={mono} {...f.fade(16.2)}>
        GRANTED
      </motion.text>
      <motion.text x={772} y={508} fontSize="8" letterSpacing="0.14em" fill={SOFT} style={mono} {...f.fade(16.4)}>
        PAT. NO. PN-2,026,001
      </motion.text>
      <Caption x={176} y={566} name="V · SPECIFICATION" promise="[0001] numbering · 12 offices" color={WAX} />
      <Caption x={370} y={584} name="VI · REVIEW" promise="no objections · § 112 · § 103" color={LAMP} />
      <Caption x={636} y={584} name="VII · FILED → GRANTED" promise="for your signature" color={BRASS} />
    </svg>
  )
}

/* ================================================== B · FOUR ACTS ======== */

export function FourActsHeroFig() {
  const f = useFig()
  const reduce = useReducedMotion()

  return (
    <svg viewBox="0 0 900 330" className="h-auto w-full" role="img"
      aria-label="The journey in four large acts: a scribbled disclosure, a search lens circling thirty million patents, a drafted claim with its mechanism, and the filed stamp followed by the granted seal">

      {/* I — the scribble */}
      <motion.path
        d="M 40 170 C 70 100, 110 240, 86 155 C 66 90, 145 115, 122 185 C 105 235, 170 205, 152 150 C 142 116, 180 150, 210 170"
        fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...f.draw(0.3, 1.2)} />

      {/* II — the lens circles 30M+ */}
      <motion.path
        d="M 210 170 L 252 170 L 270 156 C 244 122, 262 74, 310 74 C 358 74, 376 128, 340 158 C 314 180, 282 170, 284 142 L 316 136 L 356 152 L 386 166 L 420 170"
        fill="none" stroke={BLUE} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...f.draw(1.8, 1.8)} />
      <motion.text x={312} y={124} textAnchor="middle" fontSize="24" fontWeight="600" fill={BLUE} style={serif} {...f.fade(3.0)}>
        30M+
      </motion.text>
      <motion.line x1={444} y1={136} x2={444} y2={158} stroke={BRASS} strokeWidth="2.6" {...f.draw(3.3, 0.25)} />
      <motion.line x1={444} y1={182} x2={444} y2={204} stroke={BRASS} strokeWidth="2.6" {...f.draw(3.35, 0.25)} />
      {reduce ? <circle cx={444} cy={170} r={3.5} fill={BRASS} /> : (
        <motion.circle cx={444} cy={170} r={3.5} fill={BRASS}
          initial={{ opacity: 0 }} whileInView={{ opacity: [0, 1, 0.45, 1] }} viewport={VIEW}
          transition={{ delay: 3.6, duration: 2.6, repeat: Infinity, repeatDelay: 0.4 }} />
      )}

      {/* III — mechanism + claim underline */}
      <motion.path
        d="M 444 170 L 482 170 L 482 132 L 524 132 L 524 112 A 12 12 0 0 1 548 112 L 548 132 L 588 132 L 588 170 L 600 170 L 600 206 L 700 206 L 712 206 L 712 170 L 730 170"
        fill="none" stroke={BRASS} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...f.draw(4.2, 1.9)} />
      <motion.text x={652} y={196} textAnchor="middle" fontSize="14" fill={INK} style={serif} fontStyle="italic" {...f.fade(5.4)}>
        … wherein the array (12) …
      </motion.text>
      <motion.text x={536} y={94} textAnchor="middle" fontSize="12" fill={INK} style={serif} fontStyle="italic" {...f.fade(5.2)}>
        12
      </motion.text>
      <motion.line x1={536} y1={98} x2={536} y2={104} stroke={SOFT} strokeWidth="1" {...f.fade(5.15)} />

      {/* IV — filed, then granted */}
      <motion.path d="M 730 170 L 760 170" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" {...f.draw(6.3, 0.4)} />
      <motion.g
        initial={{ opacity: 0, scale: reduce ? 1 : 1.25 }}
        whileInView={{ opacity: 1, scale: 1 }} viewport={VIEW}
        transition={{ delay: reduce ? 0 : 6.7, duration: 0.3, ease: 'easeOut' }}
        style={{ transformOrigin: '790px 150px' }}
      >
        <rect x={748} y={118} width={86} height={32} rx={5} fill="none" stroke={INK} strokeWidth="2" transform="rotate(-7 791 134)" />
        <text x={791} y={133} textAnchor="middle" fontSize="12.5" letterSpacing="0.22em" fill={INK} style={mono} transform="rotate(-7 791 134)">FILED</text>
        <text x={791} y={144} textAnchor="middle" fontSize="6.6" letterSpacing="0.12em" fill={SOFT} style={mono} transform="rotate(-7 791 134)">16 JUL 2026</text>
      </motion.g>
      <motion.path
        d="M 760 170 C 782 182, 806 196, 822 206 C 844 218, 864 212, 860 196 C 856 182, 838 180, 832 192 C 827 203, 837 213, 851 215 L 870 220"
        fill="none" stroke={BRASS} strokeWidth="2.6" strokeLinecap="round" {...f.draw(7.2, 1.3)} />
      <motion.circle cx={844} cy={199} r={16} fill="none" stroke={BRASS} strokeWidth="2" {...f.pop(8.4)} />
      <motion.circle cx={844} cy={199} r={10.8} fill="none" stroke={BRASS} strokeWidth="1" strokeDasharray="1.8 2" {...f.fade(8.55)} />
      {reduce ? null : (
        <motion.circle cx={844} cy={199} r={16} fill="none" stroke={BRASS} strokeWidth="1.2"
          initial={{ opacity: 0, scale: 1 }} whileInView={{ opacity: [0, 0.5, 0], scale: [1, 1.45, 1.8] }} viewport={VIEW}
          transition={{ delay: 8.9, duration: 2.8, repeat: Infinity, repeatDelay: 1.2 }}
          style={{ transformOrigin: '844px 199px' }} />
      )}
      <motion.text x={844} y={248} textAnchor="middle" fontSize="11" letterSpacing="0.26em" fill={BRASS} style={mono} {...f.fade(8.7)}>
        GRANTED
      </motion.text>

      {/* four act captions — large */}
      <Caption x={125} y={280} name="I · DISCLOSE" promise="a rough idea is enough" color={INK} />
      <Caption x={330} y={280} name="II · SEARCH" promise="verbatim evidence · gate-checked" color={BLUE} />
      <Caption x={590} y={280} name="III · DRAFT" promise="claims anchored · numerals once" color={BRASS} />
      <Caption x={805} y={294} name="IV · FILE & GRANT" promise="for your signature" color={BRASS} />
    </svg>
  )
}

/* ================================================== C · CINEMATIC ======== */

type Stage = {
  roman: string
  name: string
  promise: string
  color: string
  art: JSX.Element
}

function StageArt({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <svg viewBox="0 0 360 230" className="h-auto w-full" aria-hidden>
      {children}
    </svg>
  )
}

function useStageDraw() {
  const reduce = useReducedMotion()
  return {
    draw: (delay = 0, dur = 0.9) => ({
      initial: { pathLength: reduce ? 1 : 0, opacity: reduce ? 1 : 0 },
      animate: { pathLength: 1, opacity: 1 },
      transition: { duration: reduce ? 0 : dur, ease: [0.16, 1, 0.3, 1] as [number, number, number, number], delay: reduce ? 0 : delay },
    }),
    fade: (delay = 0) => ({
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: 0.4, delay: reduce ? 0 : delay },
    }),
  }
}

function ScribbleArt() {
  const f = useStageDraw()
  return (
    <StageArt>
      <motion.path d="M 60 120 C 100 40, 150 200, 120 105 C 96 30, 190 60, 160 145 C 140 210, 220 175, 200 110 C 188 70, 240 105, 300 118"
        fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" {...f.draw(0.1, 1.4)} />
    </StageArt>
  )
}
function SearchArt() {
  const f = useStageDraw()
  return (
    <StageArt>
      <motion.path d="M 40 130 L 92 130 L 116 112 C 84 70, 108 14, 168 14 C 228 14, 250 82, 206 118 C 174 144, 132 132, 136 96 L 175 90 L 226 108 L 268 126 L 320 130"
        fill="none" stroke={BLUE} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...f.draw(0.1, 1.6)} />
      <motion.text x={170} y={78} textAnchor="middle" fontSize="28" fontWeight="600" fill={BLUE} style={serif} {...f.fade(1.3)}>30M+</motion.text>
      <motion.line x1={294} y1={92} x2={294} y2={116} stroke={BRASS} strokeWidth="3" {...f.draw(1.5, 0.25)} />
      <motion.line x1={294} y1={144} x2={294} y2={168} stroke={BRASS} strokeWidth="3" {...f.draw(1.55, 0.25)} />
      <motion.circle cx={294} cy={130} r={4} fill={BRASS} {...f.fade(1.8)} />
      <motion.text x={170} y={196} textAnchor="middle" fontSize="12" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(1.7)}>
        KEYWORD + SEMANTIC · GATE-CHECKED
      </motion.text>
    </StageArt>
  )
}
function DrawingsArt() {
  const f = useStageDraw()
  return (
    <StageArt>
      <motion.path d="M 50 150 L 96 150 L 96 96 L 160 96 L 160 68 A 18 18 0 0 1 196 68 L 196 96 L 258 96 L 258 152 L 310 152"
        fill="none" stroke={VIOLET} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...f.draw(0.1, 1.5)} />
      {([
        { nx: 74, ny: 78, n: '10' }, { nx: 178, ny: 34, n: '12' }, { nx: 290, ny: 128, n: '14' },
      ]).map((m, i) => (
        <motion.text key={m.n} x={m.nx} y={m.ny} textAnchor="middle" fontSize="17" fill={INK} style={serif} fontStyle="italic" {...f.fade(1.2 + i * 0.15)}>
          {m.n}
        </motion.text>
      ))}
      <motion.text x={180} y={200} textAnchor="middle" fontSize="12" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(1.6)}>
        FIGURES · CLAIMS · SPEC AGREE
      </motion.text>
    </StageArt>
  )
}
function ClaimsArt() {
  const f = useStageDraw()
  return (
    <StageArt>
      <motion.text x={180} y={104} textAnchor="middle" fontSize="19" fill={INK} style={serif} fontStyle="italic" {...f.fade(0.3)}>
        … wherein the sensor array (12)
      </motion.text>
      <motion.text x={180} y={130} textAnchor="middle" fontSize="19" fill={INK} style={serif} fontStyle="italic" {...f.fade(0.45)}>
        self-calibrates …
      </motion.text>
      <motion.path d="M 60 148 C 66 122, 94 120, 96 138 C 97 154, 72 158, 70 142 C 69 133, 79 129, 86 134 L 100 148 L 300 148"
        fill="none" stroke={BRASS} strokeWidth="3" strokeLinecap="round" {...f.draw(0.6, 1.3)} />
      <motion.text x={92} y={44} fontSize="12" letterSpacing="0.1em" fill={SOFT} style={mono} {...f.fade(1.5)}>A SENSOR ARRAY</motion.text>
      <motion.path d="M 150 88 C 138 70, 126 60, 114 52" fill="none" stroke={BRASS} strokeWidth="1.4" {...f.draw(1.55, 0.4)} />
      <motion.path d="M 210 38 l 5 5.6 l 10 -11" fill="none" stroke={LAMP} strokeWidth="2.4" strokeLinecap="round" {...f.draw(1.8, 0.3)} />
      <motion.text x={180} y={200} textAnchor="middle" fontSize="12" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(1.9)}>
        REFINED · FROZEN AS THE ANCHOR
      </motion.text>
    </StageArt>
  )
}
function SpecArt() {
  const f = useStageDraw()
  return (
    <StageArt>
      <motion.rect x={82} y={38} width={196} height={130} rx={6} fill="none" stroke={INK} strokeWidth="1.2" opacity={0.3} {...f.fade(0.2)} />
      <motion.path d="M 40 110 L 96 110 C 112 90, 120 130, 136 110 C 152 90, 160 130, 176 110 C 192 90, 200 130, 216 110 C 232 90, 240 130, 256 110 L 276 122 L 320 130"
        fill="none" stroke={WAX} strokeWidth="3" strokeLinecap="round" {...f.draw(0.3, 1.5)} />
      <motion.text x={180} y={200} textAnchor="middle" fontSize="12" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(1.5)}>
        EVERY SECTION · 12 OFFICES · YOUR VOICE
      </motion.text>
    </StageArt>
  )
}
function ReviewArt() {
  const f = useStageDraw()
  return (
    <StageArt>
      <motion.path d="M 50 120 L 110 120 C 90 170, 140 200, 172 172 C 194 152, 172 116, 146 130 C 126 140, 134 172, 162 174 L 210 176 L 260 140 L 310 120"
        fill="none" stroke={LAMP} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...f.draw(0.2, 1.5)} />
      <motion.path d="M 246 106 l 7 8 l 14 -16" fill="none" stroke={LAMP} strokeWidth="3" strokeLinecap="round" {...f.draw(1.5, 0.35)} />
      <motion.text x={180} y={216} textAnchor="middle" fontSize="12" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(1.7)}>
        CLAIMS NEVER TOUCHED · FIXES SURGICAL
      </motion.text>
    </StageArt>
  )
}
function GrantArt() {
  const f = useStageDraw()
  const reduce = useReducedMotion()
  return (
    <StageArt>
      <motion.path d="M 36 110 L 120 110" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" {...f.draw(0.2, 0.4)} />
      <motion.g
        initial={{ opacity: 0, scale: reduce ? 1 : 1.3 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: reduce ? 0 : 0.6, duration: 0.3, ease: 'easeOut' }}
        style={{ transformOrigin: '120px 84px' }}
      >
        <rect x={72} y={56} width={104} height={40} rx={6} fill="none" stroke={INK} strokeWidth="2.4" transform="rotate(-7 124 76)" />
        <text x={124} y={74} textAnchor="middle" fontSize="15" letterSpacing="0.24em" fill={INK} style={mono} transform="rotate(-7 124 76)">FILED</text>
        <text x={124} y={88} textAnchor="middle" fontSize="8" letterSpacing="0.12em" fill={SOFT} style={mono} transform="rotate(-7 124 76)">16 JUL 2026</text>
      </motion.g>
      <motion.path d="M 120 110 C 158 122, 196 138, 222 150 C 254 164, 282 156, 277 136 C 272 118, 246 116, 238 132 C 231 146, 244 160, 262 162 L 288 168"
        fill="none" stroke={BRASS} strokeWidth="3" strokeLinecap="round" {...f.draw(1.0, 1.3)} />
      <motion.circle cx={252} cy={143} r={22} fill="none" stroke={BRASS} strokeWidth="2.6" {...f.fade(2.1)} />
      <motion.circle cx={252} cy={143} r={15} fill="none" stroke={BRASS} strokeWidth="1.3" strokeDasharray="2.2 2.4" {...f.fade(2.25)} />
      <motion.text x={252} y={206} textAnchor="middle" fontSize="14" letterSpacing="0.26em" fill={BRASS} style={mono} {...f.fade(2.4)}>
        GRANTED
      </motion.text>
    </StageArt>
  )
}

const C_STAGES: Stage[] = [
  { roman: 'I', name: 'Disclose', promise: 'Describe it roughly, in your own words — a rough disclosure is enough to begin.', color: INK, art: <ScribbleArt /> },
  { roman: 'II', name: 'Search', promise: '30M+ patents worldwide, keyword and semantic lanes, every candidate gate-checked for evidence quality.', color: BLUE, art: <SearchArt /> },
  { roman: 'III', name: 'Drawings', promise: 'Reference numerals assigned once — figures, claims, and description can never disagree.', color: VIOLET, art: <DrawingsArt /> },
  { roman: 'IV', name: 'Claims', promise: 'Refined against the actual prior art, antecedent basis verified, then frozen as the anchor.', color: BRASS, art: <ClaimsArt /> },
  { roman: 'V', name: 'Specification', promise: 'Every section drafted in your voice, office-correct for 12 jurisdictions from one source of truth.', color: WAX, art: <SpecArt /> },
  { roman: 'VI', name: 'Review', promise: 'An examiner-style pass with surgical one-click fixes — claims and figures are never touched.', color: LAMP, art: <ReviewArt /> },
  { roman: 'VII', name: 'File & Grant', promise: 'Quality-gated export, the FILED stamp, and the seal — prepared for your signature.', color: BRASS, art: <GrantArt /> },
]

export function CinematicHero() {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const stage = C_STAGES[i]

  useEffect(() => {
    if (reduce || paused) return
    const t = setInterval(() => setI((v) => (v + 1) % C_STAGES.length), 3400)
    return () => clearInterval(t)
  }, [reduce, paused])

  return (
    <div
      className="grid items-center gap-8 lg:grid-cols-[3fr_2fr]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="rounded-xl border border-ai-graphite-900/10 bg-white p-6 sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            initial={{ opacity: 0, y: reduce ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -10 }}
            transition={{ duration: 0.35 }}
          >
            {stage.art}
          </motion.div>
        </AnimatePresence>
      </div>

      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-ai-graphite-400">
          Stage {stage.roman} of VII
        </p>
        <AnimatePresence mode="wait">
          <motion.div key={i}
            initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
          >
            <h3 className="mt-3 font-serif text-4xl font-medium tracking-tight" style={{ color: stage.color }}>
              {stage.name}
            </h3>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-ai-graphite-600">
              {stage.promise}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* stage ticks */}
        <div className="mt-8 flex items-center gap-2.5">
          {C_STAGES.map((s, k) => (
            <button
              key={s.roman}
              onClick={() => setI(k)}
              aria-label={`Stage ${s.roman} · ${s.name}`}
              className="h-2.5 rounded-full transition-all duration-300"
              style={{
                width: k === i ? 26 : 10,
                backgroundColor: k === i ? s.color : '#d8d4c2',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
