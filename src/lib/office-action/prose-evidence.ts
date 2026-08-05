import { verifyQuote } from './objection-classifier'
import type { Authority } from './objection-doctrine'

/**
 * Office Action Studio — evidence checks over the drafted prose
 *
 * Everything else in this module verifies STRUCTURED output: a chart cell must
 * carry a passage that verifies, an amendment's inserted words must appear in
 * the paragraphs it cites, a paragraph anchor must resolve. The thing actually
 * filed, though, is free prose from the drafting model, and against that the
 * only controls were paragraph-number resolution and a narrow contradiction
 * scan.
 *
 * The drafter is TOLD "do not fabricate quotes or authorities" and "this list is
 * exhaustive — cite no others". Nothing read its output back. An instruction in
 * a prompt is not a control.
 *
 * These three checks are deterministic functions over the finished text. They
 * need no model call, and — unlike anything that asks the drafter to declare
 * what it relied on — they cannot be satisfied by the drafter simply asserting
 * that it complied. They check the artifact, not the author's self-report.
 *
 * All three are calibrated for PRECISION over recall. A check that fires on
 * correct replies gets switched off within a week, and then catches nothing at
 * all.
 */

export interface ProseSection {
  where: string
  text: string
}

/** A document whose text is on file and can therefore be quoted from. */
export interface EvidenceSource {
  /** 'D1', 'specification', 'the examination report' — as it would be named in prose. */
  label: string
  text: string
}

export interface ProseFinding {
  where: string
  detail: string
  /** 'fail' — provably wrong against material on file. 'warn' — uncheckable. */
  status: 'fail' | 'warn'
}

// ---------------------------------------------------------------------------
// 1. Quotations
// ---------------------------------------------------------------------------

/**
 * Quotation marks in the shapes a model actually emits, including the curly
 * pairs word processors and LLM output use.
 */
const QUOTE_RE = /[""]([^""]{25,600})[""]|"([^"]{25,600})"/g

/** "D1", "D3" — the labels an office uses for cited documents. */
const CITATION_LABEL_RE = /\bD\s?(\d{1,2})\b/g

/**
 * Short quoted spans are skipped deliberately: a reply quotes claim terms
 * ("comprising", "operably linked") constantly, and those are terms of art being
 * discussed, not passages being attributed. Only a span long enough to be a real
 * quotation of a document is checked — which is also the length at which
 * verifyQuote's bigram coverage becomes meaningful.
 */
function quotedSpans(text: string): string[] {
  const out: string[] = []
  QUOTE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = QUOTE_RE.exec(text)) !== null) {
    const span = (m[1] || m[2] || '').trim()
    if (span.length >= 25) out.push(span)
  }
  return out
}

function labelsIn(text: string): string[] {
  const out: string[] = []
  CITATION_LABEL_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = CITATION_LABEL_RE.exec(text)) !== null) out.push(`D${m[1]}`)
  return Array.from(new Set(out))
}

/** The sentence a match sits in — quotes are attributed by their sentence. */
function sentenceAround(text: string, index: number): string {
  const before = text.lastIndexOf('.', index)
  const after = text.indexOf('.', index)
  return text.slice(before + 1, after < 0 ? text.length : after + 1).trim()
}

/**
 * Every quotation in the filed text must exist in a document on file.
 *
 * Graded by what we can actually establish:
 *   fail — the sentence names a cited document we HOLD, and the quoted passage
 *          is not in it. That is a fabricated quotation of prior art, attributed
 *          to a specific reference, going to the Controller.
 *   warn — the passage matches nothing on file and is not attributed to a
 *          document we hold (a quotation from case law, say). We cannot check
 *          it, and say so rather than pretending either way.
 */
export function checkQuotations(sections: ProseSection[], sources: EvidenceSource[]): ProseFinding[] {
  // With nothing on file there is nothing to check against. Reporting every
  // quotation as unlocatable would be a wall of findings that says only "we have
  // no documents" — the caller decides what to do about that, not this function.
  if (!sources.length) return []

  const findings: ProseFinding[] = []
  const byLabel = new Map(sources.map(s => [s.label.toLowerCase(), s.text]))

  for (const section of sections) {
    for (const quote of quotedSpans(section.text)) {
      const at = section.text.indexOf(quote)
      const sentence = at >= 0 ? sentenceAround(section.text, at) : section.text
      const attributed = labelsIn(sentence).filter(l => byLabel.has(l.toLowerCase()))

      // Found anywhere on file → the quotation is real.
      if (sources.some(s => verifyQuote(quote, s.text))) continue

      const shown = quote.length > 90 ? `${quote.slice(0, 90)}…` : quote
      if (attributed.length) {
        findings.push({
          where: section.where,
          status: 'fail',
          detail: `The reply quotes ${attributed.join(' / ')} as saying “${shown}”, but that passage does not appear in the copy of ${attributed.length === 1 ? 'that document' : 'those documents'} on file. Remove the quotation or correct it — a misquotation of cited art goes to the Controller over your signature.`
        })
      } else {
        findings.push({
          where: section.where,
          status: 'warn',
          detail: `The quotation “${shown}” could not be found in any document on this case. Check it against your source before filing.`
        })
      }
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// 2. Authorities
// ---------------------------------------------------------------------------

/**
 * Case-name shapes: "X v. Y", "X vs Y". Deliberately narrow — this is the form
 * an authority is cited in, and matching anything looser would flag ordinary
 * prose.
 */
const CASE_NAME_RE = /\b([A-Z][A-Za-z.&'()-]*(?:\s+[A-Za-z.&'()-]+){0,6})\s+(?:v\.?|vs\.?)\s+([A-Z][A-Za-z.&'()-]*(?:\s+[A-Za-z.&'()-]+){0,6})/g

function normalizeCaseName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\b(v\.?|vs\.?)\b/g, 'v')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Do two case names refer to the same authority? Party-name overlap, both sides. */
function sameAuthority(a: string, b: string): boolean {
  const na = normalizeCaseName(a)
  const nb = normalizeCaseName(b)
  if (!na || !nb) return false
  if (na === nb || na.includes(nb) || nb.includes(na)) return true
  // "Biswanath Prasad Radhey Shyam v Hindustan Metal Industries" cited short as
  // "Biswanath Prasad v Hindustan Metal" is the same case.
  const parties = (s: string) => s.split(' v ').map(p => p.split(' ').filter(w => w.length > 3))
  const [aLeft, aRight] = parties(na)
  const [bLeft, bRight] = parties(nb)
  if (!aLeft?.length || !aRight?.length || !bLeft?.length || !bRight?.length) return false
  const shares = (x: string[], y: string[]) => x.some(w => y.includes(w))
  return shares(aLeft, bLeft) && shares(aRight, bRight)
}

/**
 * Every authority cited in the filed text must be one the jurisdiction
 * whitelists.
 *
 * This is the check that catches a US authority in an Indian reply. Models are
 * trained overwhelmingly on US case law and reach for it — KSR, Graham, Alice —
 * regardless of a prompt saying the Indian list is exhaustive. Filing a reply to
 * the Controller that argues obviousness from KSR is not a small error.
 */
export function checkAuthorities(sections: ProseSection[], allowed: Authority[]): ProseFinding[] {
  const findings: ProseFinding[] = []
  const names = allowed.map(a => a.name).filter(Boolean)

  for (const section of sections) {
    CASE_NAME_RE.lastIndex = 0
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = CASE_NAME_RE.exec(section.text)) !== null) {
      const cited = m[0].trim()
      const key = normalizeCaseName(cited)
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (names.some(n => sameAuthority(cited, n))) continue

      findings.push({
        where: section.where,
        status: 'fail',
        detail: names.length
          ? `The reply cites “${cited}”, which is not among the authorities this jurisdiction allows for these objections (${names.slice(0, 3).join('; ')}${names.length > 3 ? `, +${names.length - 3} more` : ''}). Remove it or replace it with one of those.`
          : `The reply cites “${cited}”, but no case law is whitelisted for these objections — argue from the statute and the specification only.`
      })
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// 3. Quantitative claims
// ---------------------------------------------------------------------------

const MAGNITUDE_WORDS: Record<string, string> = {
  two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
}

const UNITS = 'mg|ml|kg|µg|ug|nm|µm|um|mm|cm|km|rpm|ppm|psi|kpa|mpa|hz|khz|mhz|ghz|wt%|v/v|w/w|mol|mmol|molar|°c|°f|celsius|fahrenheit|degrees|hours|hrs|minutes|mins|seconds|days|weeks|months'

/**
 * Quantities as a reply asserts them: "40%", "three-fold", "2.5 times",
 * "100 °C", "reduced by 30".
 *
 * Deliberately requires a unit or a magnitude word. A bare number in legal prose
 * is nearly always a claim number, a paragraph citation, a statutory section or
 * a date — flagging those would bury the real finding.
 */
const QUANTITY_PATTERNS: RegExp[] = [
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(%|per\\s?cent|percent)`, 'gi'),
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[-\\s]?(fold|times|×)\\b`, 'gi'),
  new RegExp(`\\b(${Object.keys(MAGNITUDE_WORDS).join('|')})\\s*[-\\s]?(fold|times)\\b`, 'gi'),
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNITS})\\b`, 'gi')
]

/** Contexts where a number is structural, never a technical assertion. */
const STRUCTURAL_NUMBER = /\b(claims?|paragraphs?|para|section|rule|form|figure|fig|page|item|schedule)\s*$/i

function quantitiesIn(text: string): Array<{ raw: string; forms: string[] }> {
  const out: Array<{ raw: string; forms: string[] }> = []
  const seen = new Set<string>()

  for (const pattern of QUANTITY_PATTERNS) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      const raw = m[0].trim()
      const before = text.slice(Math.max(0, m.index - 24), m.index)
      if (STRUCTURAL_NUMBER.test(before)) continue
      // Inside a bracketed paragraph citation, e.g. "[0038]".
      if (/\[\s*\d*$/.test(before)) continue

      const key = raw.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)

      const value = m[1] || ''
      const digits = MAGNITUDE_WORDS[value.toLowerCase()] || value
      const unit = (m[2] || '').toLowerCase()
      // Every written form the source might use for the same quantity.
      const forms = Array.from(new Set([
        raw.toLowerCase(),
        `${digits}${unit}`,
        `${digits} ${unit}`.trim(),
        `${digits}-${unit}`,
        digits
      ].filter(Boolean)))
      out.push({ raw, forms })
    }
  }
  return out
}

/**
 * A number the reply asserts must appear somewhere on the record.
 *
 * This is the class that matters most for inventive step and was the least
 * protected: "the invention achieves a three-fold increase in expression" is
 * exactly the kind of technical effect a reply turns on, and exactly the kind of
 * detail a model will supply from nowhere. Unlike a characterisation, a figure
 * is machine-checkable — either it is in the specification (or in the evidence
 * the attorney supplied) or the reply invented it.
 *
 * Reported as 'fail': an unsupported quantitative assertion about the invention
 * is a statement of fact to the office that nothing on the file supports.
 */
export function checkQuantitativeClaims(sections: ProseSection[], sources: EvidenceSource[]): ProseFinding[] {
  // No record to check against — see checkQuotations.
  if (!sources.length) return []

  const findings: ProseFinding[] = []
  const haystacks = sources.map(s => s.text.toLowerCase().replace(/\s+/g, ' '))

  for (const section of sections) {
    for (const q of quantitiesIn(section.text)) {
      if (haystacks.some(h => q.forms.some(f => f.length > 1 && h.includes(f)))) continue
      findings.push({
        where: section.where,
        status: 'fail',
        detail: `The reply asserts “${q.raw}”, but that figure does not appear in the specification as filed or in any evidence on this case. Cite where it comes from, or remove it — an unsupported technical figure is a statement of fact to the Controller.`
      })
    }
  }
  return findings
}
