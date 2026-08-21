// FIG. 2 — the whole system on one sheet.
//
// This replaced the eight-step icon rail, which listed stages without showing
// how any of them related. The honest shape of the product is not a line: the
// three exploration modules feed each other, drafting is a chain, and
// prosecution loops BACK into the claims. A flow diagram can show that; a row of
// icons cannot.
//
// Drawn in the same language as the feature figures (see FeatureFigures.tsx):
// graphite boxes for stages, cobalt for flow, red for anything adversarial —
// which is why the FER return path is the only red line on the sheet. It is the
// one edge that runs backwards, and colouring it red is what makes the loop
// legible at a glance.
//
// TWO LAYOUTS, ONE SET OF WORDS. Legibility inside an SVG depends on absolute
// text size, so scaling the landscape sheet down to a phone would render its 9px
// labels at ~3px, and rotating it would leave every label on its side. Instead
// the diagram is authored twice — landscape for >=640px, portrait for phones —
// and both read their labels from STAGES below so the two can never drift apart.
// Only one is in the DOM's accessibility tree at a time, because the hidden one
// is display:none.

import Reveal from './Reveal'

const GRAPHITE = '#3d4148'
const INK = '#14161a'
const COBALT = '#1d4ed8'
const RED = '#b91c1c'
const MUTED = '#6b6c66'

// Single source of truth for every label in both layouts.
const STAGES = {
  disclosure: { title: 'DISCLOSURE', sub: 'PLAIN LANGUAGE' },
  novelty: { title: 'Novelty search', sub: '55M+ DOCUMENTS · FEATURE BY FEATURE' },
  ideation: { title: 'Ideation', sub: 'VARIANTS ALONG EVERY AXIS' },
  whitespace: { title: 'Whitespace', sub: 'GAPS ATTACKED SIX WAYS' },
  claims: { title: 'Claims', sub: 'BROAD → NARROW, SUPPORTED' },
  priorArt: { title: 'Prior art review', sub: 'DRAFTED CLAIMS VS THE ART FOUND' },
  spec: { title: 'Specification', sub: 'YOUR STYLE, YOUR OFFICE' },
  drawings: { title: 'Drawings', sub: 'SKETCH → FORMAL FIGURES' },
  review: { title: 'AI review', sub: 'EVERY LIMITATION TRACED TO A ¶' },
  packageTitle: 'Filing package',
  packageRows: ['SPECIFICATION', 'CLAIMS', 'DRAWINGS', 'FORMS'],
  oa: { title: 'Office action', subs: ['FER RESPONSE', 'ARGUE / AMEND'] },
  returnPath: 'OBJECTION → BACK INTO THE SAME CLAIMS',
} as const

const DIAGRAM_LABEL =
  'System flow diagram. A disclosure feeds three exploration modules — novelty search, ideation and whitespace — which inform each other. Their output feeds the drafting chain: claims, prior art review, specification, drawings and AI review. That produces a filing package of specification, claims, drawings and forms, which is filed. An office action returns from prosecution back into the claims to be amended.'

function Arrows() {
  return (
    <defs>
      <marker
        id="flow-arrow"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10" fill="none" stroke={COBALT} strokeWidth="1.8" />
      </marker>
      <marker
        id="flow-arrow-red"
        viewBox="0 0 10 10"
        refX="9"
        refY="5"
        markerWidth="5"
        markerHeight="5"
        orient="auto-start-reverse"
      >
        <path d="M0 0 L10 5 L0 10" fill="none" stroke={RED} strokeWidth="1.8" />
      </marker>
    </defs>
  )
}

function Node({
  x,
  y,
  w,
  h,
  title,
  sub,
  titleSize = 15,
}: {
  x: number
  y: number
  w: number
  h: number
  title: string
  sub: string
  titleSize?: number
}) {
  const tight = h <= 54
  return (
    <g>
      <path
        d={`M${x} ${y} H${x + w} V${y + h} H${x} Z`}
        fill="#faf9f7"
        stroke={GRAPHITE}
        strokeWidth="1.5"
      />
      <text x={x + 16} y={y + (tight ? 23 : 26)} fontSize={titleSize} fontWeight="600" fill={INK}>
        {title}
      </text>
      <text
        x={x + 16}
        y={y + (tight ? 40 : 44)}
        className="font-mono"
        fontSize="9"
        fill={MUTED}
        letterSpacing="0.5"
      >
        {sub}
      </text>
    </g>
  )
}

// ---------------------------------------------------------------- landscape
function LandscapeSheet() {
  return (
    <svg viewBox="0 0 1120 418" className="block h-auto w-full" role="img" aria-label={DIAGRAM_LABEL}>
      <Arrows />

      <g className="font-mono" fontSize="10" fill={MUTED} letterSpacing="1.6">
        <text x="146" y="14">01 — EXPLORE</text>
        <text x="490" y="14">02 — DRAFT</text>
        <text x="816" y="14">03 — ASSEMBLE</text>
        <text x="988" y="14">04 — PROSECUTE</text>
      </g>

      <Node x={6} y={170} w={118} h={64} {...STAGES.disclosure} titleSize={12} />

      <Node x={146} y={78} w={296} h={64} {...STAGES.novelty} />
      <Node x={146} y={170} w={296} h={64} {...STAGES.ideation} />
      <Node x={146} y={262} w={296} h={64} {...STAGES.whitespace} />

      <Node x={490} y={84} w={280} h={52} {...STAGES.claims} />
      <Node x={490} y={150} w={280} h={52} {...STAGES.priorArt} />
      <Node x={490} y={216} w={280} h={52} {...STAGES.spec} />
      <Node x={490} y={282} w={280} h={52} {...STAGES.drawings} />
      <Node x={490} y={348} w={280} h={52} {...STAGES.review} />

      <path d="M816 176 H956 V308 H816 Z" fill="#faf9f7" stroke={GRAPHITE} strokeWidth="1.5" />
      <text x="832" y="202" fontSize="13" fontWeight="600" fill={INK}>
        {STAGES.packageTitle}
      </text>
      <g className="font-mono" fontSize="9" fill={COBALT}>
        {STAGES.packageRows.map((r, i) => (
          <text key={r} x="832" y={228 + i * 20}>
            {r}
          </text>
        ))}
      </g>

      <path d="M988 194 H1112 V290 H988 Z" fill="#faf9f7" stroke={GRAPHITE} strokeWidth="1.5" />
      <text x="1002" y="222" fontSize="12" fontWeight="600" fill={INK}>
        {STAGES.oa.title}
      </text>
      <g className="font-mono" fontSize="9" fill={MUTED}>
        {STAGES.oa.subs.map((s, i) => (
          <text key={s} x="1002" y={242 + i * 18}>
            {s}
          </text>
        ))}
      </g>

      {/* disclosure fans into the three explore modules */}
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M124 202 H132" />
        <path d="M132 110 V294" />
        <path d="M132 110 H146" markerEnd="url(#flow-arrow)" />
        <path d="M132 202 H146" markerEnd="url(#flow-arrow)" />
        <path d="M132 294 H146" markerEnd="url(#flow-arrow)" />
      </g>

      {/* the three inform each other */}
      <g fill="none" stroke={COBALT} strokeWidth="1" strokeDasharray="4 3">
        <path d="M294 142 V170" markerEnd="url(#flow-arrow)" />
        <path d="M294 234 V262" markerEnd="url(#flow-arrow)" />
      </g>

      {/* explore collects into claims, and the same reference set is reused by
          the prior art review further down the chain */}
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M442 110 H458" />
        <path d="M442 202 H458" />
        <path d="M442 294 H458" />
        <path d="M458 110 V294" />
        <path d="M458 110 H490" markerEnd="url(#flow-arrow)" />
      </g>
      <path
        d="M458 176 H490"
        fill="none"
        stroke={COBALT}
        strokeWidth="1"
        strokeDasharray="4 3"
        markerEnd="url(#flow-arrow)"
      />

      {/* the drafting chain */}
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M630 136 V150" markerEnd="url(#flow-arrow)" />
        <path d="M630 202 V216" markerEnd="url(#flow-arrow)" />
        <path d="M630 268 V282" markerEnd="url(#flow-arrow)" />
        <path d="M630 334 V348" markerEnd="url(#flow-arrow)" />
      </g>

      {/* review assembles the package, package is filed */}
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M770 374 H792 V242 H816" markerEnd="url(#flow-arrow)" />
        <path d="M956 242 H988" markerEnd="url(#flow-arrow)" />
      </g>
      <text x="972" y="234" className="font-mono" fontSize="8" fill={COBALT} textAnchor="middle">
        FILED
      </text>

      {/* the one backwards edge */}
      <path
        d="M1050 194 V46 H630 V84"
        fill="none"
        stroke={RED}
        strokeWidth="1.3"
        markerEnd="url(#flow-arrow-red)"
      />
      <text
        x="840"
        y="40"
        className="font-mono"
        fontSize="9"
        fill={RED}
        textAnchor="middle"
        letterSpacing="1"
      >
        {STAGES.returnPath}
      </text>
    </svg>
  )
}

// ----------------------------------------------------------------- portrait
// Same graph, rebuilt top-to-bottom so a phone reads it by scrolling the way it
// already scrolls. The return path runs down the left gutter.
function PortraitSheet() {
  const boxX = 52
  const boxW = 296
  const chain = [
    { y: 300, stage: STAGES.claims },
    { y: 368, stage: STAGES.priorArt },
    { y: 436, stage: STAGES.spec },
    { y: 504, stage: STAGES.drawings },
    { y: 572, stage: STAGES.review },
  ]

  return (
    <svg viewBox="0 0 400 872" className="block h-auto w-full" role="img" aria-label={DIAGRAM_LABEL}>
      <Arrows />

      <g className="font-mono" fontSize="9.5" fill={MUTED} letterSpacing="1.5">
        <text x={boxX} y="12">01 — EXPLORE</text>
        <text x={boxX} y="290">02 — DRAFT</text>
        <text x={boxX} y="642">03 — ASSEMBLE</text>
        <text x={boxX} y="774">04 — PROSECUTE</text>
      </g>

      <Node x={boxX} y={24} w={boxW} h={44} {...STAGES.disclosure} titleSize={12} />
      <Node x={boxX} y={84} w={boxW} h={52} {...STAGES.novelty} titleSize={14} />
      <Node x={boxX} y={152} w={boxW} h={52} {...STAGES.ideation} titleSize={14} />
      <Node x={boxX} y={220} w={boxW} h={52} {...STAGES.whitespace} titleSize={14} />

      {chain.map((c) => (
        <Node key={c.stage.title} x={boxX} y={c.y} w={boxW} h={52} {...c.stage} titleSize={14} />
      ))}

      <path d={`M${boxX} 652 H${boxX + boxW} V756 H${boxX} Z`} fill="#faf9f7" stroke={GRAPHITE} strokeWidth="1.5" />
      <text x={boxX + 16} y="676" fontSize="13" fontWeight="600" fill={INK}>
        {STAGES.packageTitle}
      </text>
      <g className="font-mono" fontSize="9" fill={COBALT}>
        {STAGES.packageRows.map((r, i) => (
          <text key={r} x={boxX + 16 + (i % 2) * 140} y={700 + Math.floor(i / 2) * 20}>
            {r}
          </text>
        ))}
      </g>

      <path d={`M${boxX} 784 H${boxX + boxW} V854 H${boxX} Z`} fill="#faf9f7" stroke={GRAPHITE} strokeWidth="1.5" />
      <text x={boxX + 16} y="810" fontSize="13" fontWeight="600" fill={INK}>
        {STAGES.oa.title}
      </text>
      <g className="font-mono" fontSize="9" fill={MUTED}>
        {STAGES.oa.subs.map((s, i) => (
          <text key={s} x={boxX + 16 + i * 140} y="832">
            {s}
          </text>
        ))}
      </g>

      {/* straight-through flow */}
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M200 68 V84" markerEnd="url(#flow-arrow)" />
        <path d="M200 272 V300" markerEnd="url(#flow-arrow)" />
        <path d="M200 624 V652" markerEnd="url(#flow-arrow)" />
        <path d="M200 756 V784" markerEnd="url(#flow-arrow)" />
        {chain.slice(0, -1).map((c) => (
          <path key={c.y} d={`M200 ${c.y + 52} V${c.y + 68}`} markerEnd="url(#flow-arrow)" />
        ))}
      </g>

      {/* the three inform each other */}
      <g fill="none" stroke={COBALT} strokeWidth="1" strokeDasharray="4 3">
        <path d="M200 136 V152" markerEnd="url(#flow-arrow)" />
        <path d="M200 204 V220" markerEnd="url(#flow-arrow)" />
      </g>

      <text x="208" y="770" className="font-mono" fontSize="8" fill={COBALT}>
        FILED
      </text>

      {/* the return path, down the left gutter */}
      <path
        d={`M${boxX} 819 H30 V326 H${boxX}`}
        fill="none"
        stroke={RED}
        strokeWidth="1.3"
        markerEnd="url(#flow-arrow-red)"
      />
      <text
        x="20"
        y="560"
        className="font-mono"
        fontSize="8.5"
        fill={RED}
        textAnchor="middle"
        letterSpacing="0.8"
        transform="rotate(-90 20 560)"
      >
        OBJECTION → BACK INTO CLAIMS
      </text>
    </svg>
  )
}

export default function SystemFlow() {
  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-24 sm:px-8 lg:pt-28">
      <Reveal>
        <div className="border-t-2 border-vellum-900 pt-6">
          <p className="font-mono text-[10.5px] tracking-[0.2em] text-ink-examiner">
            FIG. 2 — THE SYSTEM
          </p>
          <h2 className="mt-3 max-w-[20ch] text-[clamp(30px,4.6vw,58px)] font-bold leading-[0.98] tracking-[-0.035em] text-vellum-900">
            Every step feeds the next.
          </h2>
          <p className="mt-4 max-w-[62ch] text-[16.5px] leading-[1.6] text-vellum-700">
            Novelty, ideation and whitespace inform each other before a word is drafted.
            Drafting runs as one chain, with the claims reviewed against the art that was
            found. And when an examiner objects, the response comes back into the same
            claims — not into a separate tool.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.1}>
        <div className="mt-10">
          <div className="border border-vellum-900 bg-vellum-100 p-4 sm:p-5">
            <div className="hidden sm:block">
              <LandscapeSheet />
            </div>
            <div className="sm:hidden">
              <PortraitSheet />
            </div>
          </div>

          <p className="mt-3 font-mono text-[9.5px] tracking-[0.14em] text-vellum-600">
            FIG. 2 — COBALT: FLOW · RED: THE RETURN PATH
          </p>
        </div>
      </Reveal>
    </section>
  )
}
