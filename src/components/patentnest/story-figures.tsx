'use client'

// Story figures — literal, self-explanatory replacements for the six most
// abstract feature glyphs. Each one SHOWS the thing itself: a spreadsheet
// whose rows become drafts, writing samples whose stroke-texture the new
// draft visibly inherits, an examiner's margin marks, a scope dial and a
// frozen claim, one master document becoming four office-shaped documents,
// and references earning their way into a draft's citations.
// Same vocabulary as figures.tsx: ink line work, orthogonal routing, brass
// ceremony, lamp = the AI's positive act. Reduced-motion renders complete.

import { motion, useReducedMotion } from 'framer-motion'
import { useFig, FlowLine, FigLabel } from './figures'
import { BRASS, INK, LAMP, PAPER, SOFT, WAX } from '@/lib/patentnest/palette'

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
const serif = { fontFamily: 'var(--font-cormorant), Georgia, serif' }
const VIEW = { once: true, margin: '-60px' } as const

/* ---------------------------------------------------------------- batch --- */
/** A spreadsheet's rows become drafts on three desks, then one ZIP. */
export function BatchStoryFig() {
  const f = useFig()
  return (
    <svg viewBox="0 0 420 210" className="h-auto w-full" role="img"
      aria-label="A spreadsheet of inventions: each row travels to a drafting desk, the finished documents drop into one ZIP archive with DOCX and PDF inside">

      {/* the spreadsheet */}
      <motion.rect x={16} y={38} width={110} height={112} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0, 0.5)} />
      <motion.line x1={16} y1={58} x2={126} y2={58} stroke={INK} strokeWidth="1" {...f.draw(0.2, 0.3)} />
      <motion.text x={71} y={52} textAnchor="middle" fontSize="6.6" letterSpacing="0.14em" fill={INK} style={mono} {...f.fade(0.25)}>
        IDEAS.XLSX
      </motion.text>
      {[48, 82].map((x) => (
        <motion.line key={x} x1={x} y1={58} x2={x} y2={150} stroke={SOFT} strokeWidth="0.7" opacity={0.6} {...f.draw(0.3, 0.3)} />
      ))}
      {[72, 92, 112, 132].map((y, i) => (
        <g key={y}>
          <motion.line x1={16} y1={y + 8} x2={126} y2={y + 8} stroke={SOFT} strokeWidth="0.7" opacity={0.5} {...f.fade(0.3 + i * 0.05)} />
          <motion.text x={24} y={y + 3} fontSize="6" fill={SOFT} style={mono} {...f.fade(0.35 + i * 0.05)}>
            {String(i + 1).padStart(2, '0')}
          </motion.text>
          <motion.line x1={54} y1={y - 1} x2={i === 3 ? 70 : 78} y2={y - 1} stroke="#cbd5e1" strokeWidth="1.6" {...f.fade(0.4 + i * 0.05)} />
          <motion.line x1={88} y1={y - 1} x2={118} y2={y - 1} stroke="#cbd5e1" strokeWidth="1.6" {...f.fade(0.42 + i * 0.05)} />
        </g>
      ))}
      <FigLabel x={71} y={166} size={6.6}>one upload · 25 ideas</FigLabel>

      {/* rows fan out to three desks */}
      {([46, 102, 158] as const).map((y, i) => (
        <FlowLine key={y} d={`M 126 ${76 + i * 20} L 146 ${76 + i * 20} L 146 ${y + 18} L 164 ${y + 18}`} delay={0.9 + i * 0.15} />
      ))}
      {([46, 102, 158] as const).map((y, i) => (
        <g key={y}>
          <motion.rect x={164} y={y} width={68} height={40} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.2" {...f.pop(1.1 + i * 0.15)} />
          {[10, 17, 24].map((dy, k) => (
            <motion.line key={dy} x1={172} y1={y + dy} x2={k === 2 ? 208 : 224} y2={y + dy}
              stroke={SOFT} strokeWidth="1.3" {...f.draw(1.4 + i * 0.15 + k * 0.12, 0.35)} />
          ))}
          <motion.rect x={172} y={y + 31} width={52} height={3} rx={1.5} fill="#e7e4d8" {...f.fade(1.5 + i * 0.15)} />
          <motion.rect x={172} y={y + 31} width={52} height={3} rx={1.5} fill={LAMP}
            initial={{ scaleX: 0, opacity: 0 }}
            whileInView={{ scaleX: 1, opacity: 1 }}
            viewport={VIEW}
            transition={{ delay: 1.6 + i * 0.15, duration: 0.9, ease: 'easeOut' }}
            style={{ transformOrigin: `${172}px 0px` }}
          />
        </g>
      ))}
      <FigLabel x={198} y={30} size={6.6}>drafted in parallel</FigLabel>

      {/* into the ZIP */}
      {([66, 122, 178] as const).map((y, i) => (
        <FlowLine key={y} d={`M 232 ${y} L 254 ${y} L 254 122 L 276 122`} delay={2.5 + i * 0.1} />
      ))}
      <motion.path d="M 276 88 L 276 156 L 396 156 L 396 88 L 344 88 L 336 78 L 284 78 L 276 88 Z"
        fill={PAPER} stroke={INK} strokeWidth="1.4" strokeLinejoin="round" {...f.draw(2.7, 0.6)} />
      <motion.line x1={336} y1={92} x2={336} y2={152} stroke={BRASS} strokeWidth="1.2" strokeDasharray="3 3" {...f.draw(3.0, 0.4)} />
      <motion.text x={336} y={174} textAnchor="middle" fontSize="8" letterSpacing="0.24em" fill={INK} style={mono} {...f.fade(3.2)}>
        PORTFOLIO.ZIP
      </motion.text>
      {(['DOCX', 'PDF'] as const).map((t, i) => (
        <g key={t}>
          <motion.rect x={296 + i * 46} y={106} width={38} height={16} rx={3} fill="none" stroke={LAMP} strokeWidth="1" {...f.pop(3.3 + i * 0.15)} />
          <motion.text x={315 + i * 46} y={117} textAnchor="middle" fontSize="6.6" fill={LAMP} style={mono} {...f.fade(3.4 + i * 0.15)}>
            {t}
          </motion.text>
        </g>
      ))}
      <FigLabel x={336} y={196} size={6.6} brass>every office · one download</FigLabel>
    </svg>
  )
}

/* ------------------------------------------------------------- personas --- */
/** Three writing samples with distinct stroke textures; the persona distills
 *  them, and the new draft visibly writes itself in that texture. */
export function PersonaStoryFig() {
  const f = useFig()
  // the signature texture: loopy cursive
  const loop = (x: number, y: number) =>
    `M ${x} ${y} c 4 -7, 9 -7, 9 0 c 0 5, -6 5, -6 0 c 0 -7, 8 -9, 13 -3 c 4 5, 10 4, 13 -1 c 3 -5, 9 -5, 12 1`
  return (
    <svg viewBox="0 0 420 210" className="h-auto w-full" role="img"
      aria-label="Three writing samples with visibly different stroke styles feed a persona; a new draft then writes itself in the chosen style — style only, never content">

      <FigLabel x={56} y={16} size={6.6}>your past drafts</FigLabel>
      {/* sample A — tight waves */}
      <motion.rect x={16} y={24} width={80} height={48} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.1" {...f.draw(0.1, 0.4)} />
      <motion.path d="M 24 42 q 3 -5 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0 t 6 0" fill="none" stroke={SOFT} strokeWidth="1.2" {...f.draw(0.35, 0.6)} />
      <motion.path d="M 24 56 q 3 -5 6 0 t 6 0 t 6 0 t 6 0 t 6 0" fill="none" stroke={SOFT} strokeWidth="1.2" {...f.draw(0.5, 0.5)} />

      {/* sample B — the loopy cursive (this one gets chosen) */}
      <motion.rect x={16} y={82} width={80} height={48} rx={4} fill={PAPER} stroke={LAMP} strokeWidth="1.4" {...f.draw(0.55, 0.4)} />
      <motion.path d={loop(23, 102)} fill="none" stroke={LAMP} strokeWidth="1.3" {...f.draw(0.8, 0.7)} />
      <motion.path d={loop(23, 118)} fill="none" stroke={LAMP} strokeWidth="1.3" {...f.draw(0.95, 0.6)} />

      {/* sample C — angular */}
      <motion.rect x={16} y={140} width={80} height={48} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.1" {...f.draw(1.0, 0.4)} />
      <motion.path d="M 24 160 l 6 -7 l 6 7 l 6 -7 l 6 7 l 6 -7 l 6 7 l 6 -7 l 6 7" fill="none" stroke={SOFT} strokeWidth="1.2" {...f.draw(1.25, 0.6)} />
      <motion.path d="M 24 174 l 6 -7 l 6 7 l 6 -7 l 6 7 l 6 -7" fill="none" stroke={SOFT} strokeWidth="1.2" {...f.draw(1.4, 0.5)} />

      {/* into the persona */}
      {([48, 106, 164] as const).map((y, i) => (
        <FlowLine key={y} d={`M 96 ${y} L 120 ${y} L 120 106 L 142 106`} delay={1.6 + i * 0.12} />
      ))}
      <motion.rect x={142} y={70} width={96} height={72} rx={8} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(1.9, 0.5)} />
      {/* fountain-pen nib */}
      <motion.path d="M 190 82 l 8 12 l -8 20 l -8 -20 Z" fill="none" stroke={BRASS} strokeWidth="1.4" strokeLinejoin="round" {...f.draw(2.15, 0.4)} />
      <motion.circle cx={190} cy={104} r={1.8} fill={BRASS} {...f.pop(2.4)} />
      <motion.text x={190} y={128} textAnchor="middle" fontSize="7" letterSpacing="0.16em" fill={INK} style={mono} {...f.fade(2.5)}>
        CSE PATENTS
      </motion.text>
      <FigLabel x={190} y={158} size={6.6}>the persona · per office, per section</FigLabel>

      {/* the new draft writes itself in the SAME loopy hand */}
      <FlowLine d="M 238 106 L 262 106" delay={2.7} />
      <motion.rect x={262} y={34} width={142} height={144} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(2.85, 0.5)} />
      <motion.line x1={274} y1={52} x2={368} y2={52} stroke={INK} strokeWidth="1.6" {...f.draw(3.05, 0.35)} />
      {[74, 94, 114, 134].map((y, i) => (
        <motion.path key={y} d={loop(274, y)} fill="none" stroke={LAMP} strokeWidth="1.3"
          {...f.draw(3.2 + i * 0.3, 0.7)} />
      ))}
      <motion.path d={`M 274 154 c 4 -7, 9 -7, 9 0 c 0 5, -6 5, -6 0`} fill="none" stroke={LAMP} strokeWidth="1.3" {...f.draw(4.4, 0.4)} />
      <FigLabel x={333} y={196} size={6.6} brass>your voice · never your content</FigLabel>
    </svg>
  )
}

/* --------------------------------------------------------------- review --- */
/** The examiner's pass: margin verdicts, one surgical fix, claims locked,
 *  a score that says ready. */
export function ReviewStoryFig() {
  const f = useFig()
  const reduce = useReducedMotion()
  return (
    <svg viewBox="0 0 420 210" className="h-auto w-full" role="img"
      aria-label="An AI review reads the draft like an examiner: margin checks, one flagged line surgically rewritten, the claims block locked read-only, and a 94 out of 100 score marked ready for export">

      {/* the draft */}
      <motion.rect x={44} y={20} width={156} height={172} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0, 0.6)} />
      <motion.line x1={58} y1={38} x2={168} y2={38} stroke={INK} strokeWidth="1.6" {...f.draw(0.25, 0.35)} />
      {/* body lines; the third is the defect */}
      {[56, 70, 98, 112].map((y, i) => (
        <motion.line key={y} x1={58} y1={y} x2={i === 3 ? 152 : 186} y2={y} stroke="#cbd5e1" strokeWidth="1.6" {...f.fade(0.4 + i * 0.08)} />
      ))}
      <motion.line x1={58} y1={84} x2={186} y2={84} stroke={WAX} strokeWidth="1.6" {...f.fade(0.65)} />
      {/* the surgical fix: wax line struck, lamp line rewrites it */}
      <motion.line x1={58} y1={84} x2={186} y2={84} stroke={WAX} strokeWidth="0.9"
        initial={{ opacity: 0 }} whileInView={{ opacity: 0.35 }} viewport={VIEW} transition={{ delay: 2.0, duration: 0.3 }} />
      <motion.path d="M 58 84 L 186 84" fill="none" stroke={LAMP} strokeWidth="1.8" {...f.draw(2.1, 0.6)} />
      <motion.text x={122} y={78} textAnchor="middle" fontSize="6" letterSpacing="0.12em" fill={LAMP} style={mono} {...f.fade(2.6)}>
        FIX APPLIED · ONLY THIS LINE
      </motion.text>

      {/* the claims block — locked */}
      <motion.rect x={56} y={128} width={132} height={48} rx={4} fill="none" stroke={BRASS} strokeWidth="1.3" {...f.draw(0.9, 0.5)} />
      {[142, 156].map((y, i) => (
        <motion.line key={y} x1={66} y1={y} x2={i === 1 ? 148 : 178} y2={y} stroke={SOFT} strokeWidth="1.4" {...f.fade(1.1 + i * 0.1)} />
      ))}
      <motion.rect x={176} y={120} width={14} height={11} rx={2} fill={PAPER} stroke={BRASS} strokeWidth="1.2" {...f.pop(1.4)} />
      <motion.path d="M 179 120 v -3 a 4 4 0 0 1 8 0 v 3" fill="none" stroke={BRASS} strokeWidth="1.2" {...f.draw(1.5, 0.3)} />
      <FigLabel x={122} y={188} size={6.4} brass>claims · never touched</FigLabel>

      {/* margin verdicts */}
      {([52, 108] as const).map((y, i) => (
        <motion.path key={y} d={`M 212 ${y} l 4 4.6 l 8.5 -9.5`} fill="none" stroke={LAMP} strokeWidth="1.8" strokeLinecap="round" {...f.draw(1.0 + i * 0.25, 0.35)} />
      ))}
      <motion.path d="M 212 80 h 12 m -12 0 v 9" fill="none" stroke={WAX} strokeWidth="1.7" strokeLinecap="round" {...f.draw(1.6, 0.3)} />
      <FigLabel x={224} y={30} size={6.4}>the margin</FigLabel>

      {/* the score */}
      <motion.rect x={268} y={56} width={124} height={72} rx={8} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.pop(3.0)} />
      <motion.text x={314} y={98} textAnchor="middle" fontSize="30" fontWeight="600" fill={INK} style={serif} {...f.fade(3.2)}>
        94
      </motion.text>
      <motion.text x={352} y={98} textAnchor="middle" fontSize="10" fill={SOFT} style={serif} {...f.fade(3.3)}>
        /100
      </motion.text>
      <motion.text x={330} y={116} textAnchor="middle" fontSize="6.6" letterSpacing="0.16em" fill={LAMP} style={mono} {...f.fade(3.45)}>
        READY FOR EXPORT
      </motion.text>
      {reduce ? (
        <circle cx={392} cy={56} r={3} fill={LAMP} />
      ) : (
        <motion.circle cx={392} cy={56} r={3} fill={LAMP}
          initial={{ opacity: 0 }} whileInView={{ opacity: [0.4, 1, 0.4] }} viewport={VIEW}
          transition={{ delay: 3.6, duration: 2.4, repeat: Infinity, ease: 'easeInOut' }} />
      )}
      <FigLabel x={330} y={152} size={6.4}>errors · warnings · suggestions</FigLabel>
      <FigLabel x={330} y={166} size={6.4}>one click each</FigLabel>
    </svg>
  )
}

/* --------------------------------------------------------------- refine --- */
/** The scope dial, the antecedent thread, the freeze — and the sections
 *  that obey the anchor. */
export function RefineStoryFig() {
  const f = useFig()
  return (
    <svg viewBox="0 0 420 210" className="h-auto w-full" role="img"
      aria-label="A scope dial set between broad and narrow, a claim whose antecedent thread checks out, the claim frozen with a lock — and the specification sections lining up behind the anchor">

      {/* the scope dial */}
      <motion.circle cx={58} cy={84} r={28} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0.1, 0.5)} />
      {([
        { a: -135, t: 'BROAD' },
        { a: -90, t: '' },
        { a: -45, t: 'NARROW' },
      ]).map(({ a }, i) => {
        const r1 = 22, r2 = 27
        const rad = (a * Math.PI) / 180
        return (
          <motion.line key={i}
            x1={58 + r1 * Math.cos(rad)} y1={84 + r1 * Math.sin(rad)}
            x2={58 + r2 * Math.cos(rad)} y2={84 + r2 * Math.sin(rad)}
            stroke={SOFT} strokeWidth="1.4" {...f.fade(0.4 + i * 0.08)} />
        )
      })}
      <motion.text x={22} y={52} fontSize="6" fill={SOFT} style={mono} {...f.fade(0.55)}>BROAD</motion.text>
      <motion.text x={72} y={48} fontSize="6" fill={SOFT} style={mono} {...f.fade(0.6)}>NARROW</motion.text>
      {/* needle at balanced */}
      <motion.line x1={58} y1={84} x2={58} y2={62} stroke={BRASS} strokeWidth="2" strokeLinecap="round" {...f.draw(0.7, 0.4)} />
      <motion.circle cx={58} cy={84} r={3} fill={BRASS} {...f.pop(0.9)} />
      <FigLabel x={58} y={130} size={6.4}>scope · a dial</FigLabel>

      <FlowLine d="M 86 84 L 112 84" delay={1.0} />

      {/* the claim */}
      <motion.rect x={112} y={40} width={168} height={92} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(1.15, 0.5)} />
      <motion.text x={124} y={64} fontSize="14" fill={INK} style={serif} {...f.fade(1.4)}>1.</motion.text>
      <motion.text x={140} y={64} fontSize="10.5" fill={INK} style={serif} fontStyle="italic" {...f.fade(1.45)}>
        A sensor array (12) …
      </motion.text>
      <motion.text x={140} y={86} fontSize="10.5" fill={INK} style={serif} fontStyle="italic" {...f.fade(1.55)}>
        wherein the sensor array …
      </motion.text>
      <motion.line x1={140} y1={110} x2={244} y2={110} stroke="#cbd5e1" strokeWidth="1.5" {...f.fade(1.65)} />
      {/* antecedent thread: "the" → "A" */}
      <motion.path d="M 176 78 C 168 72, 160 68, 152 60" fill="none" stroke={BRASS} strokeWidth="1.1" {...f.draw(1.8, 0.4)} />
      <motion.path d="M 246 56 l 3.4 3.8 l 7 -8" fill="none" stroke={LAMP} strokeWidth="1.7" strokeLinecap="round" {...f.draw(2.0, 0.3)} />

      {/* the freeze */}
      <motion.rect x={108} y={36} width={176} height={100} rx={8} fill="none" stroke={BRASS} strokeWidth="1.2" strokeDasharray="5 4" {...f.draw(2.3, 0.6)} />
      <motion.rect x={186} y={128} width={16} height={12} rx={2} fill={PAPER} stroke={BRASS} strokeWidth="1.3" {...f.pop(2.7)} />
      <motion.path d="M 189.5 128 v -3.5 a 4.5 4.5 0 0 1 9 0 v 3.5" fill="none" stroke={BRASS} strokeWidth="1.3" {...f.draw(2.8, 0.3)} />
      <FigLabel x={196} y={158} size={6.6} brass>frozen · the anchor</FigLabel>

      {/* sections obey the anchor */}
      {([28, 84, 140] as const).map((y, i) => (
        <g key={y}>
          <FlowLine d={`M 284 86 L 306 86 L 306 ${y + 20} L 324 ${y + 20}`} delay={3.0 + i * 0.15} />
          <motion.rect x={324} y={y} width={74} height={42} rx={4} fill={PAPER} stroke={INK} strokeWidth="1.1" {...f.pop(3.2 + i * 0.15)} />
          {[12, 20, 28].map((dy, k) => (
            <motion.line key={dy} x1={332} y1={y + dy} x2={k === 2 ? 372 : 390} y2={y + dy} stroke={SOFT} strokeWidth="1.1" {...f.fade(3.35 + i * 0.15 + k * 0.05)} />
          ))}
        </g>
      ))}
      <FigLabel x={361} y={196} size={6.4}>sections follow — never the reverse</FigLabel>
    </svg>
  )
}

/* -------------------------------------------------------------- offices --- */
/** One master document becomes four office-shaped documents — each with a
 *  visibly different internal layout. */
export function OfficesStoryFig() {
  const f = useFig()
  const doc = (x: number, y: number, tag: string, d: number, children: React.ReactNode) => (
    <g key={tag}>
      <motion.rect x={x} y={y} width={104} height={82} rx={5} fill={PAPER} stroke={INK} strokeWidth="1.2" {...f.draw(d, 0.5)} />
      <motion.rect x={x + 8} y={y + 7} width={30} height={12} rx={2} fill="none" stroke={BRASS} strokeWidth="1" {...f.pop(d + 0.2)} />
      <motion.text x={x + 23} y={y + 15.5} textAnchor="middle" fontSize="6.4" fill={BRASS} style={mono} {...f.fade(d + 0.25)}>
        {tag}
      </motion.text>
      {children}
    </g>
  )
  return (
    <svg viewBox="0 0 420 210" className="h-auto w-full" role="img"
      aria-label="One master document fans out into four office documents — USPTO with paragraph numbers, EPO in two columns, JPO with problem and solution blocks, India in its own order — same invention, each office's form">

      {/* the master */}
      <motion.rect x={16} y={54} width={88} height={104} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(0, 0.6)} />
      <motion.line x1={28} y1={72} x2={92} y2={72} stroke={INK} strokeWidth="1.5" {...f.draw(0.25, 0.3)} />
      {[86, 98, 110].map((y, i) => (
        <motion.line key={y} x1={28} y1={y} x2={i === 2 ? 74 : 92} y2={y} stroke="#cbd5e1" strokeWidth="1.5" {...f.fade(0.35 + i * 0.07)} />
      ))}
      <motion.rect x={26} y={122} width={68} height={26} rx={3} fill="none" stroke={BRASS} strokeWidth="1" {...f.draw(0.6, 0.4)} />
      <motion.text x={60} y={138} textAnchor="middle" fontSize="5.8" letterSpacing="0.1em" fill={BRASS} style={mono} {...f.fade(0.75)}>
        FROZEN CLAIMS
      </motion.text>
      <FigLabel x={60} y={174} size={6.4}>one master</FigLabel>

      {/* orthogonal fan */}
      {([44, 152] as const).map((y, i) => (
        <g key={y}>
          <FlowLine d={`M 104 ${86 + i * 40} L 128 ${86 + i * 40} L 128 ${y + 40} L 148 ${y + 40}`} delay={1.0 + i * 0.1} />
          <FlowLine d={`M 128 ${y + 40} L 128 ${y + 40}`} delay={1.0} />
        </g>
      ))}
      <FlowLine d="M 104 106 L 128 106 L 128 84 L 288 84 L 288 84" delay={1.15} />
      <FlowLine d="M 128 126 L 128 192 L 288 192 L 288 192" delay={1.2} />

      {/* US — [0001] paragraph numbering */}
      {doc(148, 20, 'US', 1.5, (
        <>
          {[40, 52, 64].map((dy, k) => (
            <g key={dy}>
              <motion.text x={158} y={20 + dy} fontSize="5" fill={SOFT} style={mono} {...f.fade(1.8 + k * 0.07)}>
                [{`000${k + 1}`}]
              </motion.text>
              <motion.line x1={184} y1={17 + dy} x2={k === 2 ? 224 : 242} y2={17 + dy} stroke={SOFT} strokeWidth="1.2" {...f.fade(1.85 + k * 0.07)} />
            </g>
          ))}
          <motion.text x={238} y={34} textAnchor="end" fontSize="5" fill={SOFT} style={mono} {...f.fade(1.75)}>LETTER</motion.text>
        </>
      ))}

      {/* EP — two-column body */}
      {doc(288, 20, 'EP', 1.9, (
        <>
          {[40, 50, 60, 70].map((dy, k) => (
            <g key={dy}>
              <motion.line x1={296} y1={17 + dy} x2={334} y2={17 + dy} stroke={SOFT} strokeWidth="1.2" {...f.fade(2.15 + k * 0.05)} />
              <motion.line x1={342} y1={17 + dy} x2={382} y2={17 + dy} stroke={SOFT} strokeWidth="1.2" {...f.fade(2.2 + k * 0.05)} />
            </g>
          ))}
          <motion.text x={378} y={34} textAnchor="end" fontSize="5" fill={SOFT} style={mono} {...f.fade(2.1)}>A4</motion.text>
        </>
      ))}

      {/* JP — problem / solution blocks */}
      {doc(148, 116, 'JP', 2.3, (
        <>
          <motion.rect x={158} y={146} width={84} height={16} rx={2} fill="#f7f5ef" stroke={SOFT} strokeWidth="0.8" {...f.fade(2.55)} />
          <motion.text x={162} y={156.5} fontSize="5" fill={SOFT} style={mono} {...f.fade(2.6)}>PROBLEM</motion.text>
          <motion.rect x={158} y={168} width={84} height={16} rx={2} fill="#f7f5ef" stroke={SOFT} strokeWidth="0.8" {...f.fade(2.65)} />
          <motion.text x={162} y={178.5} fontSize="5" fill={SOFT} style={mono} {...f.fade(2.7)}>SOLUTION · EFFECTS</motion.text>
        </>
      ))}

      {/* IN — its own section order */}
      {doc(288, 116, 'IN', 2.7, (
        <>
          {[142, 154, 166, 178].map((y, k) => (
            <motion.line key={y} x1={298} y1={y} x2={k % 2 ? 382 : 356} y2={y} stroke={SOFT} strokeWidth="1.2" {...f.fade(2.95 + k * 0.05)} />
          ))}
          <motion.text x={378} y={130} textAnchor="end" fontSize="5" fill={SOFT} style={mono} {...f.fade(2.9)}>A4</motion.text>
        </>
      ))}

      <FigLabel x={270} y={206} size={6.4} brass>same invention · each office&apos;s form</FigLabel>
    </svg>
  )
}

/* ------------------------------------------------------------- priorArt --- */
/** References earn a verdict; only the ones that matter are written into
 *  the draft's citations. */
export function PriorArtStoryFig() {
  const f = useFig()
  return (
    <svg viewBox="0 0 420 210" className="h-auto w-full" role="img"
      aria-label="Three prior-art references are judged — two cited, one dismissed as remote — and the cited ones are written into the draft's background section before drafting begins">

      <FigLabel x={52} y={16} size={6.6}>the art, reviewed first</FigLabel>
      {([
        { y: 24, tag: 'US 10,842', verdict: 'cite', d: 0.1 },
        { y: 88, tag: 'EP 3,301', verdict: 'cite', d: 0.35 },
        { y: 152, tag: 'WO 19/144', verdict: 'remote', d: 0.6 },
      ]).map((r) => (
        <g key={r.tag}>
          <motion.rect x={16} y={r.y} width={72} height={48} rx={4}
            fill={PAPER} stroke={r.verdict === 'cite' ? INK : SOFT} strokeWidth="1.2"
            opacity={r.verdict === 'cite' ? 1 : 0.75} {...f.draw(r.d, 0.4)} />
          <motion.text x={52} y={r.y + 14} textAnchor="middle" fontSize="6" fill={r.verdict === 'cite' ? INK : SOFT} style={mono} {...f.fade(r.d + 0.2)}>
            {r.tag}
          </motion.text>
          {[24, 32, 40].map((dy, k) => (
            <motion.line key={dy} x1={24} y1={r.y + dy} x2={k === 2 ? 62 : 80} y2={r.y + dy}
              stroke="#cbd5e1" strokeWidth="1.2" {...f.fade(r.d + 0.25 + k * 0.05)} />
          ))}
          {/* verdict */}
          {r.verdict === 'cite' ? (
            <g>
              <motion.path d={`M 96 ${r.y + 20} l 4 4.6 l 8.5 -9.5`} fill="none" stroke={LAMP} strokeWidth="1.9" strokeLinecap="round" {...f.draw(1.0 + r.d, 0.35)} />
              <motion.text x={102} y={r.y + 36} textAnchor="middle" fontSize="5.8" letterSpacing="0.1em" fill={LAMP} style={mono} {...f.fade(1.15 + r.d)}>
                CITE
              </motion.text>
            </g>
          ) : (
            <g>
              <motion.path d={`M 96 ${r.y + 14} l 11 11 M 107 ${r.y + 14} l -11 11`} fill="none" stroke={SOFT} strokeWidth="1.6" strokeLinecap="round" {...f.draw(1.0 + r.d, 0.35)} />
              <motion.text x={102} y={r.y + 38} textAnchor="middle" fontSize="5.8" letterSpacing="0.1em" fill={SOFT} style={mono} {...f.fade(1.15 + r.d)}>
                REMOTE
              </motion.text>
            </g>
          )}
        </g>
      ))}

      {/* cited refs travel into the draft */}
      <FlowLine d="M 112 48 L 136 48 L 136 96 L 158 96" delay={2.0} />
      <FlowLine d="M 112 112 L 136 112 L 136 118 L 158 118" delay={2.15} />

      {/* the draft */}
      <motion.rect x={158} y={26} width={168} height={164} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(1.6, 0.6)} />
      <motion.line x1={172} y1={46} x2={296} y2={46} stroke={INK} strokeWidth="1.6" {...f.draw(1.85, 0.35)} />
      <motion.text x={172} y={66} fontSize="6.2" letterSpacing="0.14em" fill={SOFT} style={mono} {...f.fade(2.0)}>
        BACKGROUND
      </motion.text>
      {/* citation slots that fill */}
      {([78, 104] as const).map((y, i) => (
        <g key={y}>
          <motion.rect x={172} y={y} width={124} height={18} rx={3} fill="none" stroke={SOFT} strokeWidth="0.9" strokeDasharray="3 3" {...f.fade(2.1 + i * 0.1)} />
          <motion.rect x={172} y={y} width={124} height={18} rx={3} fill="#f2f6f1" stroke={LAMP} strokeWidth="1" {...f.pop(2.5 + i * 0.2)} />
          <motion.text x={180} y={y + 12} fontSize="6" fill={LAMP} style={mono} {...f.fade(2.65 + i * 0.2)}>
            {i === 0 ? 'US 10,842 — DISTINGUISHED' : 'EP 3,301 — DISTINGUISHED'}
          </motion.text>
        </g>
      ))}
      {/* the rest of the draft, written aware */}
      {[136, 148, 160, 172].map((y, k) => (
        <motion.line key={y} x1={172} y1={y} x2={k === 3 ? 260 : 312} y2={y} stroke="#cbd5e1" strokeWidth="1.4" {...f.draw(3.0 + k * 0.15, 0.4)} />
      ))}
      <FigLabel x={242} y={204} size={6.4} brass>drafted against the art — before section one</FigLabel>

      {/* audit note */}
      <motion.rect x={340} y={80} width={64} height={52} rx={5} fill="none" stroke={SOFT} strokeWidth="1" {...f.draw(3.4, 0.4)} />
      <motion.text x={372} y={98} textAnchor="middle" fontSize="6" fill={SOFT} style={mono} {...f.fade(3.6)}>AUDIT</motion.text>
      {[106, 114, 122].map((y, k) => (
        <motion.line key={y} x1={348} y1={y} x2={k === 2 ? 380 : 396} y2={y} stroke="#e7e4d8" strokeWidth="1.4" {...f.fade(3.7 + k * 0.06)} />
      ))}
    </svg>
  )
}
