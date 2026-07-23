'use client'

// Hero figure — "IDEA → GRANT" in three beats, one line.
//
//   1 · A ROUGH IDEA         an inventor's note: two lines of cursive
//                            handwriting write themselves, a hand-drawn
//                            sketch below — wobbly circle, crooked box,
//                            shaky arrow, a scrawled "12?" — then the pen
//                            sweeps out in one flourish toward the machine.
//   2 · AI DRAFTS & VERIFIES the flourish disappears into a GEAR TRAIN —
//                            four meshing cogs, one per engine:
//                              · prior-art review            (blue)
//                              · diagram & sketch generation (violet)
//                              · jurisdiction-aware claims   (brass)
//                              · AI review                   (lamp)
//                            Counter-rotating forever at matched surface
//                            speed, like a real train.
//   3 · READY TO FILE        the line exits ruler-straight into the final
//                            draft — a page that slowly SCROLLS through
//                            everything the gears produced: front page,
//                            claims, figures, cited prior art, the review
//                            checks, then signature, seal and GRANTED.
//
// The one-pen grammar survives: handwriting in, typesetting out — the
// wobble-to-straight transformation IS the product.

import { motion } from 'framer-motion'
import { useFig } from './figures'
import { BLUE, BRASS, INK, LAMP, PAPER, SOFT, VIOLET, WAX } from '@/lib/patentnest/palette'

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
const serif = { fontFamily: 'var(--font-cormorant), Georgia, serif' }
const VIEW = { once: true, margin: '-80px' } as const

// Deterministic + rounded so server and client render byte-identical paths.
const r2 = (v: number) => Math.round(v * 100) / 100
function gearPath(cx: number, cy: number, rOut: number, rRoot: number, teeth: number) {
  const s = (Math.PI * 2) / teeth
  const pt = (r: number, a: number) => `${r2(cx + r * Math.cos(a))} ${r2(cy + r * Math.sin(a))}`
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a = i * s
    d += `${i === 0 ? 'M' : 'L'} ${pt(rRoot, a)} L ${pt(rRoot, a + 0.3 * s)} L ${pt(rOut, a + 0.38 * s)} L ${pt(rOut, a + 0.62 * s)} L ${pt(rRoot, a + 0.7 * s)} `
  }
  return d + 'Z'
}

// The train — center distances ≈ rRoot(A) + rOut(other), so the teeth mesh.
const GEARS = [
  { key: 'claims', cx: 450, cy: 208, rOut: 52, rRoot: 44, teeth: 12, hole: 7, inner: 26, color: BRASS, dur: 44, dir: 1 },
  { key: 'prior', cx: 388, cy: 160, rOut: 34, rRoot: 27, teeth: 9, hole: 5, inner: 17, color: BLUE, dur: 28.8, dir: -1 },
  { key: 'diagrams', cx: 514, cy: 156, rOut: 38, rRoot: 31, teeth: 10, hole: 5.5, inner: 19, color: VIOLET, dur: 32.2, dir: -1 },
  { key: 'review', cx: 430, cy: 276, rOut: 26, rRoot: 20, teeth: 8, hole: 4, inner: 12, color: LAMP, dur: 22, dir: -1 },
] as const

const PATHS = GEARS.map((g) => gearPath(g.cx, g.cy, g.rOut, g.rRoot, g.teeth))

// The inventor's hand — cursive lines (loops and humps, word gaps) and the
// sketch. Suggestive script, not glyphs: it must read as handwriting at 60px.
const SCRIPT_1 =
  'M 58 108 C 63 96, 71 96, 74 106 C 76 112, 82 112, 86 104 C 89 98, 95 98, 97 106 C 99 92, 107 90, 108 100 C 108 106, 114 108, 118 104 L 126 102 C 130 94, 137 94, 139 103 C 141 110, 148 110, 152 103 C 155 97, 161 98, 163 105 C 164 92, 172 90, 173 100 C 173 107, 180 108, 185 103 C 189 99, 196 100, 199 104'
const SCRIPT_2 =
  'M 58 128 C 62 118, 68 118, 71 126 C 74 132, 80 132, 84 125 C 87 119, 93 120, 95 127 C 97 114, 104 112, 106 122 C 107 129, 113 130, 118 126 L 128 124 C 132 116, 138 117, 140 125 C 142 131, 149 131, 153 125 C 157 119, 163 120, 165 127 C 167 132, 174 131, 178 126 C 182 121, 188 122, 190 127'
const SCRIPT_3 =
  'M 58 148 C 63 139, 69 140, 72 146 C 75 151, 81 151, 85 145 C 89 139, 95 140, 97 147 C 99 138, 106 136, 108 144 C 110 150, 117 150, 121 145 L 131 143'

// The scrolling draft: viewport y 56…334, content y 56…614, travel −280.
const SCROLL_TIMES = [0, 0.12, 0.5, 0.92, 1]
const SCROLL_DUR = 18

function Beat({ x, name, promise, color, delay }: { x: number; name: string; promise: string; color: string; delay: number }) {
  const f = useFig()
  return (
    <g>
      <motion.text x={x} y={372} textAnchor="middle" fontSize="14" letterSpacing="0.14em" fill={color} style={mono} {...f.fade(delay)}>
        {name}
      </motion.text>
      <motion.text x={x} y={390} textAnchor="middle" fontSize="11.5" letterSpacing="0.08em" fill={SOFT} style={mono} {...f.fade(delay + 0.15)}>
        {promise}
      </motion.text>
    </g>
  )
}

function Tag({ x, y, children, delay }: { x: number; y: number; children: string; delay: number }) {
  const f = useFig()
  return (
    <motion.text x={x} y={y} fontSize="8" letterSpacing="0.18em" fill={SOFT} style={mono} {...f.fade(delay)}>
      {children}
    </motion.text>
  )
}

export function IdeaToGrantHeroFig() {
  const f = useFig()

  return (
    <svg viewBox="0 0 900 420" className="h-auto w-full" role="img"
      aria-label="One line tells the whole story: an inventor's note — two lines of cursive handwriting and a hand-drawn sketch with a scrawled numeral — flows into a train of four meshing gears: prior-art review, diagram and sketch generation, jurisdiction-aware claim drafting, and AI review. The line exits perfectly straight into the finished application: a page that scrolls through its own front page, claims, numbered figures, cited prior art, review checks, signature line, brass seal and GRANTED mark">

      <defs>
        <clipPath id="itg-doc-clip">
          <rect x={661} y={56} width={168} height={278} rx={5} />
        </clipPath>
      </defs>

      {/* ---- beat 1 · the inventor's note ---- */}
      {/* the idea sparks… */}
      {([[52, 84, -6], [66, 78, 0], [80, 84, 6]] as const).map(([x, y, dx], i) => (
        <motion.line key={i} x1={x} y1={y} x2={x + dx} y2={y - 8} stroke={BRASS} strokeWidth="1.4" strokeLinecap="round" {...f.fade(0.5 + i * 0.1)} />
      ))}
      {/* …and the hand starts writing */}
      <motion.path d={SCRIPT_1} fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...f.draw(0.2, 0.9)} />
      <motion.path d={SCRIPT_2} fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...f.draw(1.0, 0.85)} />
      <motion.path d={SCRIPT_3} fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...f.draw(1.75, 0.55)} />

      {/* the napkin sketch: wobbly circle, crooked box, shaky arrow, "12?" */}
      <motion.path
        d="M 134 194 C 136 178, 122 168, 106 170 C 90 172, 80 184, 82 200 C 84 214, 98 224, 112 222 C 126 220, 136 210, 134 196 C 133 193, 134 195, 133 192"
        fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" {...f.draw(2.05, 0.65)} />
      <motion.path
        d="M 114 195 C 114 191, 110 189, 106 190 C 102 191, 100 195, 102 199 C 104 202, 109 203, 112 200 C 114 198, 114 196, 114 194"
        fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" {...f.draw(2.5, 0.35)} />
      <motion.path
        d="M 137 191 L 173 186 L 177 213 L 141 217 L 138 189"
        fill="none" stroke={INK} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...f.draw(2.65, 0.45)} />
      <motion.line x1={146} y1={213} x2={154} y2={192} stroke={INK} strokeWidth="1" opacity={0.55} {...f.fade(2.95)} />
      <motion.line x1={158} y1={211} x2={166} y2={190} stroke={INK} strokeWidth="1" opacity={0.55} {...f.fade(3.03)} />
      <motion.path d="M 172 162 C 152 164, 140 172, 130 180 M 130 180 l 8 -2 M 130 180 l 3 7"
        fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" {...f.draw(3.05, 0.35)} />
      <motion.text x={176} y={160} fontSize="13" fill={INK} style={serif} fontStyle="italic" {...f.fade(3.25)}>
        12?
      </motion.text>

      {/* the pen sweeps out in one flourish — wobble decaying toward the machine */}
      <motion.path
        d="M 62 246 C 100 254, 132 242, 160 234 C 192 225, 216 224, 240 214 C 266 203, 302 205, 340 200"
        fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" {...f.draw(2.7, 0.85)} />
      {/* into the train (occluded by the claims gear), and out the far side */}
      <motion.path d="M 340 200 L 560 200" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" {...f.draw(3.5, 0.3)} />
      <motion.path d="M 560 200 L 660 200" fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" {...f.draw(3.8, 0.35)} />

      {/* ---- beat 2 · the gear train ---- */}
      {GEARS.map((g, i) => (
        // outer g fades in; inner g turns forever — separate transitions
        <motion.g key={g.key} {...f.fade(3.1 + i * 0.2)}>
          <motion.g
            animate={f.reduce ? undefined : { rotate: 360 * g.dir }}
            transition={f.reduce ? undefined : { repeat: Infinity, duration: g.dur, ease: 'linear' }}
            style={{ transformOrigin: `${g.cx}px ${g.cy}px` }}
          >
            <path d={PATHS[i]} fill={PAPER} stroke={g.color} strokeWidth="2" strokeLinejoin="round" />
            <circle cx={g.cx} cy={g.cy} r={g.inner} fill="none" stroke={g.color} strokeWidth="0.9" strokeDasharray="3 3.5" opacity={0.6} />
            <circle cx={g.cx} cy={g.cy} r={g.hole} fill="none" stroke={g.color} strokeWidth="1.6" />
          </motion.g>
        </motion.g>
      ))}

      {/* the four engines, named */}
      <g>
        <motion.line x1={362} y1={134} x2={332} y2={112} stroke={SOFT} strokeWidth="1" {...f.fade(4.0)} />
        <motion.text x={300} y={104} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={BLUE} style={mono} {...f.fade(4.0)}>
          prior-art review
        </motion.text>
      </g>
      <g>
        <motion.line x1={540} y1={128} x2={564} y2={106} stroke={SOFT} strokeWidth="1" {...f.fade(4.15)} />
        <motion.text x={600} y={92} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={VIOLET} style={mono} {...f.fade(4.15)}>
          diagram &amp; sketch
        </motion.text>
        <motion.text x={600} y={106} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={VIOLET} style={mono} {...f.fade(4.2)}>
          generation
        </motion.text>
      </g>
      <g>
        <motion.line x1={494} y1={232} x2={518} y2={250} stroke={SOFT} strokeWidth="1" {...f.fade(4.3)} />
        <motion.text x={574} y={262} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={BRASS} style={mono} {...f.fade(4.3)}>
          jurisdiction-aware
        </motion.text>
        <motion.text x={574} y={276} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={BRASS} style={mono} {...f.fade(4.35)}>
          claim drafting
        </motion.text>
      </g>
      <g>
        <motion.line x1={410} y1={290} x2={372} y2={306} stroke={SOFT} strokeWidth="1" {...f.fade(4.45)} />
        <motion.text x={340} y={312} textAnchor="middle" fontSize="10.5" letterSpacing="0.08em" fill={LAMP} style={mono} {...f.fade(4.45)}>
          AI review
        </motion.text>
      </g>

      {/* ---- beat 3 · the final draft, scrolling through itself ---- */}
      <motion.rect x={660} y={55} width={170} height={280} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.pop(4.1)} />

      <g clipPath="url(#itg-doc-clip)">
        <motion.g
          animate={f.reduce ? undefined : { y: [0, 0, -280, -280, 0] }}
          transition={f.reduce ? undefined : { delay: 5.8, duration: SCROLL_DUR, times: SCROLL_TIMES, ease: 'easeInOut', repeat: Infinity }}
        >
          {/* § front page */}
          {([786, 791, 795, 800, 806] as const).map((x, i) => (
            <motion.line key={x} x1={x} y1={68} x2={x} y2={86} stroke={INK} strokeWidth={i % 2 ? 2 : 1} {...f.fade(4.3)} />
          ))}
          <motion.rect x={676} y={78} width={82} height={4} rx={1.5} fill={INK} {...f.fade(4.35)} />
          <motion.rect x={676} y={88} width={58} height={3} rx={1.5} fill={SOFT} {...f.fade(4.4)} />
          <motion.line x1={676} y1={102} x2={814} y2={102} stroke={SOFT} strokeWidth="1" {...f.fade(4.45)} />
          {([[114, 814], [126, 796], [138, 780]] as const).map(([y, x2]) => (
            <motion.line key={y} x1={676} y1={y} x2={x2} y2={y} stroke={SOFT} strokeWidth="1.2" opacity={0.75} {...f.fade(4.5)} />
          ))}

          {/* § claims — jurisdiction-aware */}
          <Tag x={676} y={162} delay={4.6}>CLAIMS</Tag>
          <motion.text x={676} y={184} fontSize="13" fill={INK} style={serif} {...f.fade(4.65)}>1.</motion.text>
          <motion.rect x={692} y={177} width={96} height={3} rx={1.5} fill={INK} {...f.fade(4.65)} />
          <motion.rect x={692} y={188} width={72} height={2.5} rx={1} fill={SOFT} {...f.fade(4.7)} />
          <motion.rect x={692} y={197} width={42} height={2.5} rx={1} fill={BRASS} {...f.fade(4.75)} />
          <motion.text x={676} y={218} fontSize="13" fill={SOFT} style={serif} {...f.fade(4.8)}>2.</motion.text>
          <motion.rect x={692} y={211} width={84} height={2.5} rx={1} fill={SOFT} {...f.fade(4.8)} />
          <motion.rect x={692} y={222} width={60} height={2.5} rx={1} fill={SOFT} opacity={0.7} {...f.fade(4.85)} />

          {/* § figures — drawn & numbered */}
          <Tag x={676} y={252} delay={4.9}>FIGURES</Tag>
          <motion.rect x={676} y={260} width={64} height={58} rx={3} fill="none" stroke={SOFT} strokeWidth="1" {...f.fade(4.95)} />
          <motion.circle cx={702} cy={288} r={11} fill="none" stroke={INK} strokeWidth="1.3" {...f.fade(5.0)} />
          <motion.rect x={714} y={296} width={16} height={13} fill="none" stroke={INK} strokeWidth="1.1" {...f.fade(5.0)} />
          <motion.line x1={718} y1={276} x2={709} y2={282} stroke={SOFT} strokeWidth="0.8" {...f.fade(5.05)} />
          <motion.text x={724} y={272} fontSize="10.5" fill={INK} style={serif} fontStyle="italic" {...f.fade(5.05)}>12</motion.text>
          <motion.rect x={752} y={260} width={62} height={58} rx={3} fill="none" stroke={SOFT} strokeWidth="1" {...f.fade(5.1)} />
          {([[758, 770], [772, 784], [786, 798]] as const).map(([x1, x2]) => (
            <motion.line key={x1} x1={x1} y1={308} x2={x2} y2={286} stroke={VIOLET} strokeWidth="1.2" {...f.fade(5.15)} />
          ))}
          <motion.text x={676} y={332} fontSize="8" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(5.1)}>FIG. 1</motion.text>
          <motion.text x={752} y={332} fontSize="8" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(5.15)}>FIG. 2</motion.text>

          {/* § prior art — cited & checked */}
          <Tag x={676} y={358} delay={5.2}>PRIOR ART · IDS</Tag>
          {(['US 10,842 B2', 'EP 3,301 A1', 'WO 19/144 A1'] as const).map((p, i) => (
            <g key={p}>
              <motion.path d={`M 676 ${370 + i * 16} l 3.5 4 l 7 -8`} fill="none" stroke={BLUE} strokeWidth="1.6" strokeLinecap="round" {...f.fade(5.25 + i * 0.05)} />
              <motion.text x={694} y={376 + i * 16} fontSize="8" letterSpacing="0.08em" fill={SOFT} style={mono} {...f.fade(5.25 + i * 0.05)}>
                {p}
              </motion.text>
            </g>
          ))}

          {/* § AI review — passes closed */}
          <Tag x={676} y={430} delay={5.4}>AI REVIEW</Tag>
          <motion.rect x={676} y={440} width={100} height={2.5} rx={1} fill={SOFT} {...f.fade(5.45)} />
          <motion.path d="M 790 436 l 4 4.5 l 8 -9" fill="none" stroke={LAMP} strokeWidth="1.8" strokeLinecap="round" {...f.fade(5.45)} />
          <motion.rect x={676} y={456} width={84} height={2.5} rx={1} fill={SOFT} {...f.fade(5.5)} />
          <motion.path d="M 790 452 l 4 4.5 l 8 -9" fill="none" stroke={LAMP} strokeWidth="1.8" strokeLinecap="round" {...f.fade(5.5)} />
          <motion.text x={676} y={478} fontSize="8" letterSpacing="0.12em" fill={LAMP} style={mono} {...f.fade(5.55)}>
            § 112 ✓ · § 103 ✓
          </motion.text>

          {/* § sign & file — seal, GRANTED */}
          <Tag x={676} y={506} delay={5.6}>SIGN &amp; FILE</Tag>
          <motion.path d="M 680 550 C 690 538, 698 556, 706 544 C 712 536, 720 550, 730 542" fill="none" stroke={WAX} strokeWidth="1.4" strokeLinecap="round" {...f.fade(5.65)} />
          <motion.line x1={676} y1={558} x2={764} y2={558} stroke={SOFT} strokeWidth="1" {...f.fade(5.65)} />
          <motion.circle cx={700} cy={588} r={16} fill="none" stroke={BRASS} strokeWidth="2" {...f.fade(5.7)} />
          <motion.circle cx={700} cy={588} r={11} fill="none" stroke={BRASS} strokeWidth="1" strokeDasharray="2 2.2" {...f.fade(5.75)} />
          <motion.path d="M 694 602 L 690 612 L 697 608" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinejoin="round" {...f.fade(5.8)} />
          <motion.path d="M 706 602 L 710 612 L 703 608" fill="none" stroke={BRASS} strokeWidth="1.6" strokeLinejoin="round" {...f.fade(5.8)} />
          {f.reduce ? null : (
            <motion.circle cx={700} cy={588} r={16} fill="none" stroke={BRASS} strokeWidth="1.2"
              initial={{ opacity: 0, scale: 1 }} whileInView={{ opacity: [0, 0.5, 0], scale: [1, 1.5, 1.9] }} viewport={VIEW}
              transition={{ delay: 6.4, duration: 2.8, repeat: Infinity, repeatDelay: 1.2 }}
              style={{ transformOrigin: '700px 588px' }} />
          )}
          <motion.text x={773} y={588} textAnchor="middle" fontSize="11.5" letterSpacing="0.2em" fill={BRASS} style={mono} {...f.fade(5.85)}>
            GRANTED
          </motion.text>
          <motion.text x={773} y={602} textAnchor="middle" fontSize="8" letterSpacing="0.12em" fill={SOFT} style={mono} {...f.fade(5.95)}>
            PN-2,026,001
          </motion.text>
        </motion.g>
      </g>

      {/* the page's own scrollbar — thumb rides as the draft scrolls */}
      <motion.line x1={824} y1={62} x2={824} y2={330} stroke={SOFT} strokeWidth="1" opacity={0.3} {...f.fade(5.3)} />
      <motion.g {...f.fade(5.3)}>
        <motion.rect x={822.75} y={62} width={2.5} height={36} rx={1.25} fill={SOFT} opacity={0.6}
          animate={f.reduce ? undefined : { y: [0, 0, 232, 232, 0] }}
          transition={f.reduce ? undefined : { delay: 5.8, duration: SCROLL_DUR, times: SCROLL_TIMES, ease: 'easeInOut', repeat: Infinity }} />
      </motion.g>

      {/* ---- the three beats, named ---- */}
      <Beat x={150} name="1 · A ROUGH IDEA" promise="your words · your sketch" color={INK} delay={1.4} />
      <Beat x={450} name="2 · AI DRAFTS & VERIFIES" promise="four engines · one draft" color={LAMP} delay={3.7} />
      <Beat x={745} name="3 · READY TO FILE" promise="the full draft · end to end" color={BRASS} delay={5.8} />
    </svg>
  )
}
