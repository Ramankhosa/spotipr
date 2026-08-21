// Patent figures for the homepage capability cards.
//
// Each figure depicts the actual mechanism of a capability rather than showing a
// shrunken screenshot of the UI that performs it. They share one drawing
// language so eleven cards read as one system:
//
//   graphite (#3d4148)  the invention / the user's own material
//   cobalt   (#1d4ed8)  anything PatentNest adds — numerals, leaders, findings
//   red      (#b91c1c)  anything adversarial — prior art, objections, overlaps
//   green    (#096c45)  a test that was survived
//
// Conventions: 1.4px strokes, no fills, 45° hatching for occupied space, and a
// 300x175 viewBox so every plate aligns on the grid. Strokes are <path> only —
// Chromium ignores pathLength on <rect>/<line>, which breaks draw-in animation.

const GRAPHITE = '#3d4148'
const COBALT = '#1d4ed8'
const RED = '#b91c1c'
const GREEN = '#096c45'
const FAINT = '#a8a49b'


function Plate({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 300 175" className="block h-auto w-full" role="img" aria-label={label}>
      {children}
    </svg>
  )
}

// Novelty — the invention split into feature zones; the zones prior art already
// covers are hatched, the ones still open are numbered.
export function FigNovelty() {
  return (
    <Plate label="An invention divided into four feature zones, two hatched where prior-art references D1 and D2 overlap and two left clear">
      <g fill="none" stroke={GRAPHITE} strokeWidth="1.4" strokeLinecap="round">
        <path d="M70 30 H230 V140 H70 Z" />
        <path d="M150 30 V140" />
        <path d="M70 85 H230" />
      </g>
      <g fill="none" stroke={RED} strokeWidth="0.75" opacity="0.8">
        <path d="M70 45 L85 30 M70 60 L100 30 M70 75 L115 30 M78 85 L133 30 M93 85 L148 30 M108 85 L150 43 M123 85 L150 58 M138 85 L150 73" />
        <path d="M150 100 L165 85 M150 115 L180 85 M150 130 L195 85 M158 140 L213 85 M173 140 L228 85 M188 140 L230 98 M203 140 L230 113 M218 140 L230 128" />
        <path d="M96 46 L44 22" strokeOpacity="1" />
        <path d="M198 118 L254 150" strokeOpacity="1" />
      </g>
      <g className="font-mono" fontSize="10" fill={RED}>
        <text x="18" y="20">D1</text>
        <text x="258" y="156">D2</text>
      </g>
      <g fill="none" stroke={COBALT} strokeWidth="0.7">
        <path d="M190 56 L246 34" />
        <path d="M108 112 L52 152" />
      </g>
      <g className="font-mono" fontSize="10" fill={COBALT}>
        <text x="250" y="32">102</text>
        <text x="20" y="158">104</text>
      </g>
    </Plate>
  )
}

// Claims — scope drawn as nested area. The dashed outer boundary is the claim
// as filed; it got pulled in because a reference reached it.
export function FigClaims() {
  return (
    <Plate label="Nested rectangles showing claim scope narrowing from the originally filed breadth to defensible claims 1, 2 and 3">
      <path d="M28 16 H272 V152 H28 Z" fill="none" stroke={RED} strokeWidth="0.9" strokeDasharray="4 3" />
      <g fill="none" stroke={GRAPHITE} strokeWidth="1.5">
        <path d="M50 30 H250 V138 H50 Z" />
        <path d="M76 45 H224 V123 H76 Z" />
        <path d="M102 60 H198 V108 H102 Z" />
      </g>
      <g className="font-mono" fontSize="10" fill={COBALT}>
        <text x="56" y="42">1</text>
        <text x="82" y="57">2</text>
        <text x="108" y="72">3</text>
      </g>
      <text x="32" y="12" className="font-mono" fontSize="8" fill={RED} letterSpacing="1">
        AS FILED — ANTICIPATED BY D1
      </text>
      <path d="M150 108 L150 164" fill="none" stroke={COBALT} strokeWidth="0.7" />
      <text x="150" y="172" className="font-mono" fontSize="8.5" fill={COBALT} textAnchor="middle">
        SUPPORT ¶[0041]
      </text>
    </Plate>
  )
}

// Whitespace — a crowded field with one clear opening, attacked from six
// directions; the green marks are the gates it held against.
export function FigWhitespace() {
  return (
    <Plate label="A crowded field of hatched patent territory with one clear opening, attacked from six directions and holding">
      <path d="M28 22 H272 V150 H28 Z" fill="none" stroke={GRAPHITE} strokeWidth="1.2" />
      <g fill="none" stroke={GRAPHITE} strokeWidth="0.6" opacity="0.55">
        <path d="M38 52 L58 32 M38 66 L72 32 M46 74 L86 34 M62 74 L92 44" />
        <path d="M196 46 L216 26 M200 60 L230 30 M212 64 L242 34 M228 66 L252 42" />
        <path d="M48 138 L70 116 M62 140 L88 114 M78 140 L102 116 M96 138 L112 122" />
        <path d="M206 138 L228 116 M220 140 L246 114 M236 138 L256 118" />
      </g>
      <path d="M122 66 H184 V112 H122 Z" fill="none" stroke={COBALT} strokeWidth="1.5" />
      <g fill="none" stroke={RED} strokeWidth="0.85">
        <path d="M92 60 L114 74" />
        <path d="M214 58 L192 74" />
        <path d="M92 122 L114 106" />
        <path d="M214 124 L192 106" />
        <path d="M153 34 L153 58" />
        <path d="M153 144 L153 120" />
      </g>
      <g fill="none" stroke={GREEN} strokeWidth="1.4">
        <path d="M110 68 L118 76 M188 68 L180 76 M110 114 L118 106 M188 114 L180 106 M145 58 L161 58 M145 120 L161 120" />
      </g>
      <text x="153" y="93" className="font-mono" fontSize="9" fill={COBALT} textAnchor="middle">
        OPEN
      </text>
      <text x="153" y="168" className="font-mono" fontSize="8.5" fill={GREEN} textAnchor="middle">
        6 ATTACKS — HELD
      </text>
    </Plate>
  )
}

// Drawings — a loose sketch becoming a formal figure with numerals.
export function FigDrawings() {
  return (
    <Plate label="A loose hand sketch transformed into a formal patent figure with reference numerals">
      <g fill="none" stroke={FAINT} strokeWidth="1.4" strokeLinecap="round">
        <path d="M34 112 L52 46 L104 44 L118 110 Z" />
        <path d="M50 80 L112 78" />
        <path d="M80 79 L82 112" />
      </g>
      <text x="76" y="140" className="font-mono" fontSize="8.5" fill={FAINT} textAnchor="middle">
        SKETCH
      </text>
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M134 78 L162 78" />
        <path d="M155 72 L162 78 L155 84" />
      </g>
      <g fill="none" stroke={GRAPHITE} strokeWidth="1.5" strokeLinecap="round">
        <path d="M180 110 L196 46 L246 46 L262 110 Z" />
        <path d="M196 78 L246 78" />
        <path d="M221 78 L221 110" />
      </g>
      <g fill="none" stroke={COBALT} strokeWidth="0.65">
        <path d="M246 46 L272 30" />
        <path d="M252 88 L280 96" />
      </g>
      <g className="font-mono" fontSize="9" fill={COBALT}>
        <text x="266" y="28">120</text>
        <text x="276" y="99">140</text>
      </g>
      <text x="221" y="140" className="font-mono" fontSize="8.5" fill={GRAPHITE} textAnchor="middle">
        FIG. 3
      </text>
    </Plate>
  )
}

// Office actions — an objection strikes the claim boundary; the boundary is
// redrawn around it and the response is supported.
export function FigOfficeAction() {
  return (
    <Plate label="An objection striking a claim boundary, the boundary redrawn around it, and the response marked argued and supported">
      <path d="M52 42 H236 V132 H52 Z" fill="none" stroke={GRAPHITE} strokeWidth="0.9" strokeDasharray="4 3" opacity="0.55" />
      <g fill="none" stroke={RED} strokeWidth="1.1">
        <path d="M14 24 L92 68" />
        <path d="M78 62 L92 68 L84 54" />
      </g>
      <text x="12" y="18" className="font-mono" fontSize="8.5" fill={RED}>
        §103 — D1 + D2
      </text>
      <path d="M92 56 H236 V132 H52 V86 Z" fill="none" stroke={GRAPHITE} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M52 86 L92 56" fill="none" stroke={COBALT} strokeWidth="1.2" strokeDasharray="3 2" />
      <text x="150" y="100" className="font-mono" fontSize="9" fill={GRAPHITE} textAnchor="middle">
        CLAIM 1, AMENDED
      </text>
      <path d="M150 152 L158 160 L174 142" fill="none" stroke={GREEN} strokeWidth="1.2" />
      <text x="182" y="158" className="font-mono" fontSize="8.5" fill={GREEN}>
        ARGUED + SUPPORTED
      </text>
    </Plate>
  )
}

// Ideation — one disclosure opened out along the axes it can vary on.
export function FigIdeation() {
  return (
    <Plate label="One disclosure at the centre branching into variant embodiments along three axes">
      <path d="M126 74 H174 V116 H126 Z" fill="none" stroke={GRAPHITE} strokeWidth="1.6" />
      <text x="150" y="99" className="font-mono" fontSize="8.5" fill={GRAPHITE} textAnchor="middle">
        AS FILED
      </text>
      <g fill="none" stroke={COBALT} strokeWidth="0.7" strokeDasharray="3 2">
        <path d="M126 82 L64 44" />
        <path d="M126 108 L64 146" />
        <path d="M174 95 L236 95" />
      </g>
      <g fill="none" stroke={COBALT} strokeWidth="1.3">
        <path d="M22 30 H62 V58 H22 Z" />
        <path d="M22 132 H62 V160 H22 Z" />
        <path d="M240 81 H280 V109 H240 Z" />
      </g>
      <g className="font-mono" fontSize="7.5" fill={COBALT}>
        <text x="42" y="47" textAnchor="middle">DERIVED</text>
        <text x="42" y="149" textAnchor="middle">EVENT-DRIVEN</text>
        <text x="260" y="98" textAnchor="middle">MEDIATED</text>
      </g>
      <text x="150" y="168" className="font-mono" fontSize="8.5" fill={COBALT} textAnchor="middle">
        3 AXES — 9 EMBODIMENTS
      </text>
    </Plate>
  )
}

// Specifications — the sheet set assembling, paragraph numbering running.
export function FigSpecification() {
  return (
    <Plate label="Three stacked specification sheets with running paragraph numbers and a jurisdiction mark">
      <g fill="none" stroke={GRAPHITE} strokeWidth="1.1" opacity="0.45">
        <path d="M52 22 H176 V150 H52 Z" />
        <path d="M66 30 H190 V158 H66 Z" />
      </g>
      <path d="M80 38 H204 V166 H80 Z" fill="none" stroke={GRAPHITE} strokeWidth="1.6" />
      <g fill="none" stroke={GRAPHITE} strokeWidth="0.9" opacity="0.7">
        <path d="M108 62 H190 M108 76 H190 M108 90 H176 M108 112 H190 M108 126 H182" />
      </g>
      <g className="font-mono" fontSize="7" fill={COBALT}>
        <text x="90" y="65">0041</text>
        <text x="90" y="79">0042</text>
        <text x="90" y="93">0043</text>
        <text x="90" y="115">0063</text>
        <text x="90" y="129">0064</text>
      </g>
      <path d="M222 38 H286 V60 H222 Z" fill="none" stroke={COBALT} strokeWidth="1.2" />
      <text x="254" y="53" className="font-mono" fontSize="9" fill={COBALT} textAnchor="middle">
        IPO
      </text>
      <g className="font-mono" fontSize="7.5" fill={GRAPHITE} opacity="0.75">
        <text x="254" y="76" textAnchor="middle">USPTO</text>
        <text x="254" y="90" textAnchor="middle">EPO</text>
        <text x="254" y="104" textAnchor="middle">PCT</text>
      </g>
    </Plate>
  )
}

// Review — the assembly with defects flagged where they actually are.
export function FigReview() {
  return (
    <Plate label="An assembly with three flagged defects and one verified section">
      <g fill="none" stroke={GRAPHITE} strokeWidth="1.5" strokeLinecap="round">
        <path d="M88 40 H212 V136 H88 Z" />
        <path d="M88 88 H212" />
        <path d="M150 40 V88" />
      </g>
      <g fill="none" stroke={RED} strokeWidth="1.1">
        <path d="M104 56 L118 70 M118 56 L104 70" />
        <path d="M172 56 L186 70 M186 56 L172 70" />
        <path d="M62 64 L84 62" strokeWidth="0.7" />
        <path d="M228 64 L216 62" strokeWidth="0.7" />
      </g>
      <g className="font-mono" fontSize="7.5" fill={RED}>
        <text x="14" y="66">NO ANTECEDENT</text>
        <text x="232" y="66">NUMERAL MISMATCH</text>
      </g>
      <path d="M112 104 L120 112 L136 96" fill="none" stroke={GREEN} strokeWidth="1.3" />
      <text x="150" y="120" className="font-mono" fontSize="8" fill={GREEN}>
        SUPPORT VERIFIED
      </text>
      <text x="150" y="164" className="font-mono" fontSize="8.5" fill={GRAPHITE} textAnchor="middle">
        CAUGHT BEFORE FILING
      </text>
    </Plate>
  )
}

// Personas — sample passages on the left training the hand on the right.
export function FigPersona() {
  return (
    <Plate label="Sample passages from your own patents training a writing style, with four sections covered">
      <g fill="none" stroke={FAINT} strokeWidth="1.2">
        <path d="M26 34 H116 V142 H26 Z" />
        <path d="M40 58 H102 M40 72 H102 M40 86 H92 M40 100 H102 M40 114 H84" strokeWidth="0.8" />
      </g>
      <text x="71" y="164" className="font-mono" fontSize="8" fill={FAINT} textAnchor="middle">
        YOUR PATENTS
      </text>
      <g fill="none" stroke={COBALT} strokeWidth="1.2">
        <path d="M130 88 L162 88" />
        <path d="M155 82 L162 88 L155 94" />
      </g>
      <g fill="none" stroke={GRAPHITE} strokeWidth="1.5">
        <path d="M178 34 H274 V142 H178 Z" />
      </g>
      <g fill="none" stroke={GREEN} strokeWidth="1.2">
        <path d="M190 58 L196 64 L208 50" />
        <path d="M190 82 L196 88 L208 74" />
        <path d="M190 106 L196 112 L208 98" />
      </g>
      <path d="M190 130 L202 118 M190 118 L202 130" fill="none" stroke={FAINT} strokeWidth="1.1" />
      <g className="font-mono" fontSize="7.5" fill={GRAPHITE}>
        <text x="216" y="62">CLAIMS</text>
        <text x="216" y="86">DESCRIPTION</text>
        <text x="216" y="110">BACKGROUND</text>
      </g>
      <text x="216" y="134" className="font-mono" fontSize="7.5" fill={FAINT}>
        SUMMARY
      </text>
      <text x="226" y="164" className="font-mono" fontSize="8" fill={GRAPHITE} textAnchor="middle">
        3 OF 4 SECTIONS LEARNED
      </text>
    </Plate>
  )
}

// Batch — a portfolio of inventions moving through the pipeline together.
export function FigBatch() {
  const rows = [
    { y: 40, done: 0.9, state: 'DRAFTING', color: COBALT },
    { y: 68, done: 0.55, state: 'IN REVIEW', color: COBALT },
    { y: 96, done: 1, state: 'COMPLETE', color: GREEN },
    { y: 124, done: 0.22, state: 'INFO NEEDED', color: FAINT },
  ]
  return (
    <Plate label="Four inventions progressing through the drafting pipeline at different stages">
      {rows.map((r) => (
        <g key={r.y}>
          <path d={`M24 ${r.y} H60 V${r.y + 18} H24 Z`} fill="none" stroke={GRAPHITE} strokeWidth="1.2" />
          <path d={`M72 ${r.y + 9} H196`} fill="none" stroke={FAINT} strokeWidth="3" opacity="0.5" />
          <path
            d={`M72 ${r.y + 9} H${72 + 124 * r.done}`}
            fill="none"
            stroke={r.color}
            strokeWidth="3"
          />
          <text x="208" y={r.y + 12} className="font-mono" fontSize="7.5" fill={r.color}>
            {r.state}
          </text>
        </g>
      ))}
      <text x="150" y="164" className="font-mono" fontSize="8.5" fill={GRAPHITE} textAnchor="middle">
        ONE STYLE ACROSS THE PORTFOLIO
      </text>
    </Plate>
  )
}

// Filing package — one draft leaving as the complete set an office receives:
// the specification, the claims, the figures, and the statutory forms. Form
// names are jurisdiction-specific (Form 1 / Form 5 are the Indian Patents Act
// forms); the label stays generic so the drawing stays true for every office in
// the coverage schedule.
export function FigExport() {
  const parts = [
    { y: 20, label: 'SPECIFICATION' },
    { y: 48, label: 'CLAIMS' },
    { y: 76, label: 'DRAWINGS' },
    { y: 104, label: 'FORM 1 — APPLICATION' },
    { y: 132, label: 'FORM 5 — INVENTORSHIP' },
  ]
  return (
    <Plate label="One draft leaving as a complete filing package: specification, claims, drawings and the statutory application forms">
      <path d="M20 56 H92 V120 H20 Z" fill="none" stroke={GRAPHITE} strokeWidth="1.6" />
      <g fill="none" stroke={GRAPHITE} strokeWidth="0.8" opacity="0.7">
        <path d="M32 74 H80 M32 86 H80 M32 98 H68" />
      </g>
      <text x="56" y="138" className="font-mono" fontSize="8" fill={GRAPHITE} textAnchor="middle">
        ONE DRAFT
      </text>
      <g fill="none" stroke={COBALT} strokeWidth="1.1">
        <path d="M98 88 L124 88" />
        <path d="M117 82 L124 88 L117 94" />
      </g>
      {parts.map((p) => (
        <g key={p.label}>
          <path d={`M132 ${p.y} H288 V${p.y + 22} H132 Z`} fill="none" stroke={COBALT} strokeWidth="1.1" />
          <text x="140" y={p.y + 15} className="font-mono" fontSize="8" fill={COBALT}>
            {p.label}
          </text>
        </g>
      ))}
    </Plate>
  )
}
