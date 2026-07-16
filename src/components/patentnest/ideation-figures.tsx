'use client'

// The inventor's journey, as one living figure: a seed idea expands into a
// colorful mind map (dimensions → assumption-breaking moves), the user selects
// two moves, the combine tray runs, an idea is generated — and flows straight
// into the novelty pipeline. Used on the homepage ideation card and the
// ideation detail page. Choreographed with staggered delays on scroll-in;
// selections keep a gentle pulse and pipeline dashes keep drifting so the
// figure stays alive. Reduced motion renders the completed state.

import { motion, useReducedMotion } from 'framer-motion'
import { useFig, FlowLine, FigLabel } from './figures'
import { BLUE, BRASS, INK, LAMP, PAPER, SOFT, VIOLET, WAX } from '@/lib/patentnest/palette'

const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }
const VIEW = { once: true, margin: '-60px' } as const

// The colorful-but-calm palette: deep stroke (from the central palette) plus a
// light local tint per branch family (tints are derivations of the strokes —
// refresh them if the palette changes).
const HUES = {
  green: { stroke: LAMP, tint: '#e3ecdd' },
  blue: { stroke: BLUE, tint: '#e1e9f2' },
  coral: { stroke: WAX, tint: '#f6e3dd' },
  violet: { stroke: VIOLET, tint: '#e9e4f4' },
}

type Hue = keyof typeof HUES

function NodePill({
  x, y, w = 68, h = 20, label, hue, delay, small = false,
}: {
  x: number; y: number; w?: number; h?: number; label: string; hue: Hue; delay: number; small?: boolean
}) {
  const f = useFig()
  const c = HUES[hue]
  return (
    <g>
      <motion.rect x={x} y={y - h / 2} width={w} height={h} rx={h / 2}
        fill={c.tint} stroke={c.stroke} strokeWidth="1.2" {...f.pop(delay)} />
      <motion.text x={x + w / 2} y={y + (small ? 2.2 : 2.6)} textAnchor="middle"
        fontSize={small ? 5.6 : 6.4} letterSpacing="0.06em" fill={c.stroke} style={mono} {...f.fade(delay + 0.08)}>
        {label}
      </motion.text>
    </g>
  )
}

function SelectionRing({ x, y, w = 58, h = 16, hue, delay }: {
  x: number; y: number; w?: number; h?: number; hue: Hue; delay: number
}) {
  const reduce = useReducedMotion()
  const c = HUES[hue]
  return (
    <g>
      <motion.rect x={x - 3} y={y - h / 2 - 3} width={w + 6} height={h + 6} rx={(h + 6) / 2}
        fill="none" stroke={c.stroke} strokeWidth="1.4"
        initial={{ opacity: reduce ? 0.9 : 0, scale: reduce ? 1 : 0.9 }}
        whileInView={reduce ? { opacity: 0.9 } : { opacity: [0, 1, 0.55, 1], scale: 1 }}
        viewport={VIEW}
        transition={reduce ? { duration: 0 } : {
          opacity: { delay, duration: 2.4, repeat: Infinity, repeatDelay: 0.6 },
          scale: { delay, duration: 0.3 },
        }}
      />
      {/* the "chosen" check */}
      <motion.circle cx={x + w + 4} cy={y - h / 2 - 4} r={5} fill={c.stroke}
        initial={{ opacity: 0, scale: reduce ? 1 : 0.5 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={VIEW}
        transition={{ delay: reduce ? 0 : delay + 0.15, duration: 0.3 }}
      />
      <motion.path d={`M ${x + w + 1.6} ${y - h / 2 - 4} l 1.6 1.8 l 3.2 -3.6`}
        fill="none" stroke="#fff" strokeWidth="1.1" strokeLinecap="round"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={VIEW}
        transition={{ delay: reduce ? 0 : delay + 0.28, duration: 0.2 }}
      />
    </g>
  )
}

export function IdeationJourneyFig() {
  const f = useFig()
  const reduce = useReducedMotion()

  const dims: { y: number; label: string; hue: Hue }[] = [
    { y: 32, label: 'STRUCTURE', hue: 'green' },
    { y: 80, label: 'SENSING', hue: 'blue' },
    { y: 128, label: 'TIMING', hue: 'coral' },
    { y: 176, label: 'MATERIAL', hue: 'violet' },
  ]

  return (
    <svg viewBox="0 0 440 214" className="h-auto w-full" role="img"
      aria-label="A seed idea expands into a mind map of dimensions and assumption-breaking moves; two selected moves are combined into a generated idea, which flows into the novelty pipeline">

      {/* the seed */}
      <motion.circle cx={36} cy={104} r={11} fill="#f1e8cf" stroke={BRASS} strokeWidth="1.5" {...f.pop(0)} />
      <motion.circle cx={36} cy={104} r={3.5} fill={BRASS} {...f.pop(0.15)} />
      <FigLabel x={36} y={128} size={6.4}>seed</FigLabel>

      {/* level 1 — dimensions discovered (orthogonal bus, org-chart style) */}
      <motion.path d="M 47 104 L 76 104" fill="none" stroke={SOFT} strokeWidth="1.1" {...f.draw(0.2, 0.25)} />
      <motion.path d="M 76 32 L 76 176" fill="none" stroke={SOFT} strokeWidth="1.1" {...f.draw(0.35, 0.5)} />
      {dims.map((d, i) => (
        <g key={d.label}>
          <motion.path
            d={`M 76 ${d.y} L 104 ${d.y}`}
            fill="none" stroke={HUES[d.hue].stroke} strokeWidth="1.2"
            {...f.draw(0.5 + i * 0.1, 0.3)}
          />
          <NodePill x={104} y={d.y} label={d.label} hue={d.hue} delay={0.6 + i * 0.1} />
        </g>
      ))}
      <FigLabel x={138} y={208} size={6.4}>dimensions</FigLabel>

      {/* level 2 — assumption-breaking moves (orthogonal buses from two dims) */}
      <motion.path d="M 172 32 L 191 32" fill="none" stroke={HUES.green.stroke} strokeWidth="1" opacity={0.7} {...f.draw(1.1, 0.25)} />
      <motion.path d="M 191 16 L 191 44" fill="none" stroke={HUES.green.stroke} strokeWidth="1" opacity={0.7} {...f.draw(1.2, 0.25)} />
      <motion.path d="M 172 128 L 191 128" fill="none" stroke={HUES.coral.stroke} strokeWidth="1" opacity={0.7} {...f.draw(1.3, 0.25)} />
      <motion.path d="M 191 112 L 191 140" fill="none" stroke={HUES.coral.stroke} strokeWidth="1" opacity={0.7} {...f.draw(1.4, 0.25)} />
      {([
        { y: 16, label: 'INVERT', hue: 'green' as Hue, d: 1.25 },
        { y: 44, label: 'DECOUPLE', hue: 'green' as Hue, d: 1.35 },
        { y: 112, label: 'RELOCATE', hue: 'coral' as Hue, d: 1.45 },
        { y: 140, label: 'REPLACE', hue: 'coral' as Hue, d: 1.55 },
      ]).map((m) => (
        <g key={m.label}>
          <motion.path
            d={`M 191 ${m.y} L 210 ${m.y}`}
            fill="none" stroke={HUES[m.hue].stroke} strokeWidth="1" opacity={0.7}
            {...f.draw(m.d, 0.25)}
          />
          <NodePill x={210} y={m.y} w={58} h={16} label={m.label} hue={m.hue} delay={m.d + 0.12} small />
        </g>
      ))}
      <FigLabel x={239} y={208} size={6.4}>moves · you choose</FigLabel>

      {/* the user selects two moves */}
      <SelectionRing x={210} y={44} hue="green" delay={1.95} />
      <SelectionRing x={210} y={112} hue="coral" delay={2.15} />

      {/* selected moves flow into the combine tray */}
      <FlowLine d="M 271 44 L 283 44 L 283 78 L 296 78" delay={2.5} />
      <FlowLine d="M 271 112 L 283 112 L 283 92 L 296 92" delay={2.6} />

      {/* combine tray */}
      <motion.rect x={296} y={68} width={58} height={34} rx={8} fill={PAPER} stroke={INK} strokeWidth="1.4" {...f.draw(2.55, 0.5)} />
      <motion.text x={325} y={82} textAnchor="middle" fontSize="6" letterSpacing="0.08em" fill={INK} style={mono} {...f.fade(2.75)}>
        COMBINE
      </motion.text>
      <motion.circle cx={317} cy={92} r={3.4} fill={HUES.green.stroke} {...f.pop(2.85)} />
      <motion.circle cx={333} cy={92} r={3.4} fill={HUES.coral.stroke} {...f.pop(2.95)} />
      <FigLabel x={325} y={114} size={5.6}>intent · divergent</FigLabel>

      {/* run → the generated idea */}
      <FlowLine d="M 354 85 L 372 85" delay={3.0} />
      <motion.rect x={374} y={58} width={60} height={54} rx={6} fill={PAPER} stroke={INK} strokeWidth="1.5" {...f.pop(3.15)} />
      {/* brass spark */}
      <motion.path d="M 404 66 l 2 5 l 5 2 l -5 2 l -2 5 l -2 -5 l -5 -2 l 5 -2 Z" fill={BRASS} {...f.pop(3.35)} />
      <motion.text x={404} y={92} textAnchor="middle" fontSize="7.5" fill={INK} style={mono} {...f.fade(3.4)}>
        IDEA
      </motion.text>
      <motion.text x={404} y={103} textAnchor="middle" fontSize="4.9" letterSpacing="0.06em" fill={SOFT} style={mono} {...f.fade(3.5)}>
        ONE MECHANISM
      </motion.text>

      {/* into the novelty pipeline */}
      <FlowLine d="M 404 112 L 404 131 L 317 131 L 317 150" delay={3.7} />
      {(['PLAN', 'SEARCH', 'REPORT'] as const).map((s, i) => (
        <g key={s}>
          <motion.rect x={296 + i * 50} y={150} width={42} height={18} rx={4}
            fill={PAPER} stroke={BRASS} strokeWidth="1.2" {...f.pop(3.9 + i * 0.15)} />
          <motion.text x={317 + i * 50} y={161.5} textAnchor="middle" fontSize="5.6" fill={BRASS} style={mono} {...f.fade(4.0 + i * 0.15)}>
            {s}
          </motion.text>
          {i < 2 && <FlowLine d={`M ${338 + i * 50} 159 L ${346 + i * 50} 159`} delay={4.05 + i * 0.15} />}
        </g>
      ))}
      {/* assessed pulse */}
      {reduce ? (
        <circle cx={404} cy={140} r={3.5} fill={HUES.green.stroke} />
      ) : (
        <motion.circle cx={404} cy={140} r={3.5} fill={HUES.green.stroke}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: [0.4, 1, 0.4] }}
          viewport={VIEW}
          transition={{ delay: 4.5, duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <FigLabel x={367} y={208} size={6.4} brass>into the novelty pipeline</FigLabel>
    </svg>
  )
}
