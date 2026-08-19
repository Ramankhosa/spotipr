/**
 * Renders Fig. 1 for paper-fer-response.md — the verification-first FER pipeline.
 *
 * Output: figures/fig1-pipeline.png  (full-width IEEE `figure*`, ~7.16in)
 * Run:    node scripts/paper-figure.js
 *
 * Palette is chosen to survive greyscale printing: I/O is near-black, LLM
 * stages are mid-tone filled, deterministic steps are light-grey filled, and
 * guards are white with a heavy rule — so the generate/verify pairing that the
 * paper argues for stays legible without colour.
 */
const { createCanvas } = require('@napi-rs/canvas')
const fs = require('fs')
const path = require('path')

const S = 3 // supersample for print
const W = 1440
const H = 680

const canvas = createCanvas(W * S, H * S)
const ctx = canvas.getContext('2d')
ctx.scale(S, S)

const INK = '#0F1E2C'
const LINE = '#2C4763'
const LLM_F = '#C6D8EC'
const DET_F = '#EFEFEC'
const GRD_F = '#FFFFFF'
const IO_F = '#22364A'
const FAIL = '#8B2E2E'
const BAND = '#DDE5EC'
const SERIF = '"Times New Roman", Georgia, serif'

ctx.fillStyle = '#FFFFFF'
ctx.fillRect(0, 0, W, H)
ctx.textBaseline = 'top'

// ---------------------------------------------------------------- primitives

function roundRect(x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrap(text, maxW) {
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const word of words) {
    const t = cur ? cur + ' ' + word : word
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur)
      cur = word
    } else cur = t
  }
  if (cur) lines.push(cur)
  return lines
}

function arrowHead(x, y, dir) {
  const s = 5
  ctx.beginPath()
  if (dir === 'down') {
    ctx.moveTo(x, y); ctx.lineTo(x - s, y - s * 1.6); ctx.lineTo(x + s, y - s * 1.6)
  } else if (dir === 'right') {
    ctx.moveTo(x, y); ctx.lineTo(x - s * 1.6, y - s); ctx.lineTo(x - s * 1.6, y + s)
  }
  ctx.closePath()
  ctx.fill()
}

function vArrow(x, y1, y2, opts = {}) {
  ctx.strokeStyle = opts.color || LINE
  ctx.fillStyle = opts.color || LINE
  ctx.lineWidth = opts.w || 1.3
  ctx.setLineDash(opts.dash || [])
  ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2 - 6); ctx.stroke()
  ctx.setLineDash([])
  arrowHead(x, y2, 'down')
}

function hArrow(x1, x2, y) {
  ctx.strokeStyle = LINE; ctx.fillStyle = LINE; ctx.lineWidth = 1.6
  ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2 - 7, y); ctx.stroke()
  arrowHead(x2, y, 'right')
}

/** Draws a box, returns {x,y,w,h,cx,bottom}. */
function box(x, y, w, text, kind, note) {
  const pad = 9
  const fs = kind === 'io' ? 13.5 : 12.5
  ctx.font = `${kind === 'io' ? 'bold ' : ''}${fs}px ${SERIF}`
  const lines = wrap(text, w - 2 * pad)
  let noteLines = []
  if (note) {
    ctx.font = `italic 10.5px ${SERIF}`
    noteLines = wrap(note, w - 2 * pad)
  }
  const lh = fs + 3.5
  const nlh = 13
  const h = pad * 2 + lines.length * lh + (noteLines.length ? noteLines.length * nlh + 3 : 0)

  ctx.fillStyle = kind === 'llm' ? LLM_F : kind === 'det' ? DET_F : kind === 'io' ? IO_F : GRD_F
  roundRect(x, y, w, h, kind === 'io' ? 8 : 3)
  ctx.fill()
  ctx.strokeStyle = kind === 'fail' ? FAIL : kind === 'io' ? IO_F : LINE
  ctx.lineWidth = kind === 'guard' ? 2.4 : kind === 'fail' ? 2 : 1
  if (kind === 'fail') ctx.setLineDash([5, 3])
  roundRect(x, y, w, h, kind === 'io' ? 8 : 3)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.fillStyle = kind === 'io' ? '#FFFFFF' : kind === 'fail' ? FAIL : INK
  ctx.font = `${kind === 'io' ? 'bold ' : ''}${fs}px ${SERIF}`
  ctx.textAlign = 'center'
  let cy = y + pad
  for (const l of lines) { ctx.fillText(l, x + w / 2, cy); cy += lh }
  if (noteLines.length) {
    ctx.font = `italic 10.5px ${SERIF}`
    ctx.fillStyle = kind === 'io' ? '#C9D6E2' : '#4A5A6A'
    cy += 3
    for (const l of noteLines) { ctx.fillText(l, x + w / 2, cy); cy += nlh }
  }
  ctx.textAlign = 'left'
  return { x, y, w, h, cx: x + w / 2, bottom: y + h }
}

function header(x, y, w, label) {
  ctx.fillStyle = BAND
  roundRect(x, y, w, 25, 3); ctx.fill()
  ctx.strokeStyle = LINE; ctx.lineWidth = 1
  roundRect(x, y, w, 25, 3); ctx.stroke()
  ctx.fillStyle = INK
  ctx.font = `bold 12.5px ${SERIF}`
  ctx.textAlign = 'center'
  ctx.fillText(label, x + w / 2, y + 5.5)
  ctx.textAlign = 'left'
  return y + 25
}

function label(text, x, y, align = 'left') {
  ctx.font = `italic 10.5px ${SERIF}`
  ctx.fillStyle = '#3C4C5C'
  ctx.textAlign = align
  ctx.fillText(text, x, y)
  ctx.textAlign = 'left'
}

// ------------------------------------------------------------------- columns

const TOP = 18
const AX = 16, AW = 300
const BX = 346, BW = 300
const CX = 676, CW = 430
const DX = 1136, DW = 250

let y

// ---- A. INTAKE
y = header(AX, TOP, AW, 'A.  INTAKE') + 14
const a1 = box(AX, y, AW, 'First Examination Report (PDF / DOCX)', 'io')
vArrow(a1.cx, a1.bottom, a1.bottom + 16)
const a2 = box(AX, a1.bottom + 16, AW, 'Extract text · clean page furniture · detect instrument', 'det', 'deterministic — profile hints, no model')
vArrow(a2.cx, a2.bottom, a2.bottom + 16)
const a3 = box(AX, a2.bottom + 16, AW, 'Parse structure · classify objections', 'llm', 'OA_INTAKE_PARSE · OA_OBJECTION_CLASSIFY')
vArrow(a3.cx, a3.bottom, a3.bottom + 14)
const a4 = box(AX + 14, a3.bottom + 14, AW - 14, 'GUARD  verifyQuote + reconciliation', 'guard', 'exact < 12 words; bigram cover ≥ 0.85. One raw objection = one card; none lost')
vArrow(a4.cx, a4.bottom, a4.bottom + 16)
const a5 = box(AX, a4.bottom + 16, AW, 'Deadlines — pure calendar arithmetic', 'det', 'Rule 24B(5): P6M + P3M (Form 4)')

// ---- B. INVENTION CONTEXT
y = header(BX, TOP, BW, 'B.  CONTEXT — once per case') + 14
const b1 = box(BX, y, BW, 'Specification + claims as filed', 'io')
vArrow(b1.cx, b1.bottom, b1.bottom + 16)
const b2 = box(BX, b1.bottom + 16, BW, 'Normalise: ¶ IDs · sections · claim elements · ~400-token chunks', 'det', 'pure string code, no model')
vArrow(b2.cx, b2.bottom, b2.bottom + 16)
const b3 = box(BX, b2.bottom + 16, BW, 'Invention digest — the ONLY full read', 'llm', 'cached on the case; 1–2k tokens, each item carrying a ¶ pointer')
vArrow(b3.cx, b3.bottom, b3.bottom + 16)
const b4 = box(BX, b3.bottom + 16, BW, 'Embed chunks once → top-K retrieval', 'det', 'K = 8, packed to 4 000 tokens; failure returns [] — never full-spec stuffing')
vArrow(b4.cx, b4.bottom, b4.bottom + 16)
const b5 = box(BX, b4.bottom + 16, BW, 'newMatterSafe = true filter', 'guard', 'post-filing material is structurally unable to reach amendment basis')

// ---- C. PER OBJECTION
y = header(CX, TOP, CW, 'C.  PER OBJECTION — isolated, persisted after each') + 14
const cSubW = 262
const cProcW = 150
const cProcX = CX + CW - cProcW

const c0 = box(CX, y, CW, 'Procedural objection?', 'det')
// branch right → procedural bypass
ctx.strokeStyle = LINE; ctx.fillStyle = LINE; ctx.lineWidth = 1.3
const cbY = c0.bottom + 22
ctx.beginPath()
ctx.moveTo(cProcX + cProcW / 2, c0.bottom)
ctx.lineTo(cProcX + cProcW / 2, cbY - 6)
ctx.stroke()
arrowHead(cProcX + cProcW / 2, cbY, 'down')
label('yes', cProcX + cProcW / 2 + 6, c0.bottom + 4)
const cp = box(cProcX, cbY, cProcW, 'Fixed profile sentence + attorney checklist', 'det', 'NO model call — compliance is an act, not an argument')

vArrow(CX + cSubW / 2, c0.bottom, c0.bottom + 22)
label('no', CX + cSubW / 2 + 6, c0.bottom + 4)
const c1 = box(CX, cbY, cSubW, 'Claim chart', 'llm', 'OA_CITATION_ANALYSIS')
vArrow(c1.cx, c1.bottom, c1.bottom + 13)
const c2 = box(CX + 14, c1.bottom + 13, cSubW - 14, 'GUARD  passage verify · absence scan', 'guard', 'unverified cell → AMBIGUOUS; absence re-checked against the COMPLETE document')
vArrow(c2.cx, c2.bottom, c2.bottom + 15)
const c3 = box(CX, c2.bottom + 15, cSubW, 'Strategy + proposed amendments', 'llm', 'OA_STRATEGY')
vArrow(c3.cx, c3.bottom, c3.bottom + 13)
const c4 = box(CX + 14, c3.bottom + 13, cSubW - 14, 'GUARD  Section 59 basis', 'guard', 'refs must resolve in as-filed ¶s AND ≥ 70 % of inserted words appear there')
vArrow(c4.cx, c4.bottom, c4.bottom + 15)
const c5 = box(CX, c4.bottom + 15, cSubW, 'Draft reply section', 'llm', 'OA_DRAFT_SECTION')
vArrow(c5.cx, c5.bottom, c5.bottom + 13)
const c6 = box(CX + 14, c5.bottom + 13, cSubW - 14, 'GUARD  contradiction · prose evidence', 'guard', 'quotations, authorities and figures re-read off the finished text')

// merge procedural branch back
const mergeY = Math.max(c6.bottom, cp.bottom) + 20
ctx.strokeStyle = LINE; ctx.lineWidth = 1.3
ctx.beginPath()
ctx.moveTo(c6.cx, c6.bottom); ctx.lineTo(c6.cx, mergeY)
ctx.moveTo(cp.cx, cp.bottom); ctx.lineTo(cp.cx, mergeY)
ctx.lineTo(c6.cx, mergeY)
ctx.stroke()
vArrow(c6.cx, mergeY, mergeY + 18)
const c7 = box(CX, mergeY + 18, CW, 'Persist draft — unit of loss is one objection, never one case', 'det')

// loop-back arrow
ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3])
ctx.beginPath()
ctx.moveTo(CX, c7.y + c7.h / 2)
ctx.lineTo(CX - 12, c7.y + c7.h / 2)
ctx.lineTo(CX - 12, c0.y + c0.h / 2)
ctx.lineTo(CX - 7, c0.y + c0.h / 2)
ctx.stroke()
ctx.setLineDash([])
ctx.fillStyle = LINE
arrowHead(CX, c0.y + c0.h / 2, 'right')
// vertical caption on the loop-back, kept inside the 30 px gutter
ctx.save()
ctx.translate(CX - 14, (c0.y + c7.y) / 2)
ctx.rotate(-Math.PI / 2)
label('next objection', 0, -11, 'center')
ctx.restore()

// ---- D. OUTPUT
y = header(DX, TOP, DW, 'D.  OUTPUT') + 14
const d1 = box(DX, y, DW, 'Assemble in profile skeleton order', 'det', 'pure; one block model feeds both DOCX and preview')
vArrow(d1.cx, d1.bottom, d1.bottom + 14)
const d2 = box(DX, d1.bottom + 14, DW, 'GATE  Compliance lint — 20 checks', 'guard', 'coverage · content · quotes · basis · copies · anchors · forms')
const dFailY = d2.bottom + 20
vArrow(d2.cx, d2.bottom, dFailY, { color: FAIL, dash: [5, 3] })
label('any fail', d2.cx + 8, d2.bottom + 4)
const d3 = box(DX, dFailY, DW, 'Export blocked — 422, no document produced', 'fail')
const d4y = d3.bottom + 26
const d4 = box(DX, d4y, DW, 'Attorney approval, per section', 'det', 'any edit re-opens approval')
// routed "pass" path from the lint down the gutter into approval
ctx.strokeStyle = LINE; ctx.fillStyle = LINE; ctx.lineWidth = 1.5
ctx.beginPath()
ctx.moveTo(DX, d2.y + d2.h / 2)
ctx.lineTo(DX - 14, d2.y + d2.h / 2)
ctx.lineTo(DX - 14, d4y + d4.h / 2)
ctx.lineTo(DX - 7, d4y + d4.h / 2)
ctx.stroke()
arrowHead(DX, d4y + d4.h / 2, 'right')
label('pass', DX - 16, d2.bottom + 16, 'right')
vArrow(d4.cx, d4.bottom, d4.bottom + 16)
box(DX, d4.bottom + 16, DW, 'Filing-grade DOCX', 'io')

// ---- phase arrows
hArrow(AX + AW, BX, TOP + 12.5)
hArrow(BX + BW, CX, TOP + 12.5)
hArrow(CX + CW, DX, TOP + 12.5)

// ------------------------------------------------------------------- legend
const LY = H - 46
ctx.strokeStyle = '#B7C2CC'; ctx.lineWidth = 1
ctx.beginPath(); ctx.moveTo(16, LY - 12); ctx.lineTo(W - 16, LY - 12); ctx.stroke()

const legend = [
  ['io', 'document in / out'],
  ['llm', 'generative stage (metered LLM call)'],
  ['det', 'deterministic step'],
  ['guard', 'deterministic guard — checks the artifact, not the model'],
]
let lx = 16
ctx.font = `12px ${SERIF}`
for (const [kind, text] of legend) {
  ctx.fillStyle = kind === 'llm' ? LLM_F : kind === 'det' ? DET_F : kind === 'io' ? IO_F : GRD_F
  roundRect(lx, LY, 26, 15, 3); ctx.fill()
  ctx.strokeStyle = LINE; ctx.lineWidth = kind === 'guard' ? 2.4 : 1
  roundRect(lx, LY, 26, 15, 3); ctx.stroke()
  ctx.fillStyle = INK
  ctx.fillText(text, lx + 33, LY + 1)
  lx += 33 + ctx.measureText(text).width + 26
}

// ---------------------------------------------------------------------- save
const outDir = path.join(__dirname, '..', 'figures')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, 'fig1-pipeline.png')
fs.writeFileSync(out, canvas.toBuffer('image/png'))
console.log('wrote', out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', `${W * S}x${H * S}`)
