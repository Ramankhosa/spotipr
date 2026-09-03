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
      const shown = quote.length > 90 ? `${quote.slice(0, 90)}…` : quote

      /**
       * A quotation attributed to a document we HOLD is checked against THAT
       * document, and nothing else.
       *
       * This used to look for the passage anywhere on file first, and consult
       * the attribution only when it was found nowhere. "Anywhere" includes the
       * applicant's own specification, the claims, the examination report and
       * every supplementary upload — so "D1 discloses X", where X is lifted
       * verbatim from the specification, was reported as located. The single
       * failure this function exists to catch is a misquotation of cited art
       * attributed to a specific reference, and that was the shape it passed.
       */
      if (attributed.length) {
        if (attributed.some(l => verifyQuote(quote, byLabel.get(l.toLowerCase()) || ''))) continue
        findings.push({
          where: section.where,
          status: 'fail',
          detail: `The reply quotes ${attributed.join(' / ')} as saying “${shown}”, but that passage does not appear in the copy of ${attributed.length === 1 ? 'that document' : 'those documents'} on file. Remove the quotation or correct it — a misquotation of cited art goes to the Controller over your signature.`
        })
        continue
      }

      // Unattributed: anywhere on file is enough. It may be quoting the
      // specification, the report, or the attorney's own evidence, and the
      // sentence does not say which.
      if (sources.some(s => verifyQuote(quote, s.text))) continue
      findings.push({
        where: section.where,
        status: 'warn',
        detail: `The quotation “${shown}” could not be found in any document on this case. Check it against your source before filing.`
      })
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
// 3. Statutory citations
// ---------------------------------------------------------------------------

/**
 * Provisions as a reply cites them: "Section 3(d)", "Sections 2(1)(ja)",
 * "s.59", "Rule 24B(5)", "Form 3".
 *
 * Only the local shapes — a foreign code is matched separately below, because
 * the two mean very different things when they cannot be resolved.
 */
const LOCAL_PROVISION_RE =
  /\b(?:sections?|rules?|forms?|sec\.|s\.|r\.)\s*(\d{1,3}[A-Za-z]?(?:\s*\([^()\s]{1,8}\))*)/gi

/**
 * A citation to another jurisdiction's code. Unambiguous, and exactly the reach
 * a model makes when it argues an Indian objection from what it was trained on:
 * "35 U.S.C. § 103", "Article 56 EPC", "MPEP § 2143".
 */
const FOREIGN_CODE_RE =
  /\b\d{1,2}\s*U\.?\s?S\.?\s?C\.?|\bC\.?F\.?R\.?\b|\bM\.?P\.?E\.?P\.?\b|\bEPC\b|\bArticle\s+\d{1,3}\s*(?:EPC|PCT)\b|§/gi

/** Which keyword opened the citation — the key is namespaced by it. */
function provisionKind(raw: string): 'SECTION' | 'RULE' | 'FORM' {
  const head = raw.trim().toLowerCase()
  if (head.startsWith('r')) return 'RULE'
  if (head.startsWith('f')) return 'FORM'
  return 'SECTION'
}

/**
 * A provision split into its levels: "2(1)(ja)" → ["2", "1", "JA"].
 *
 * Segmented rather than kept as one string so that containment can be tested on
 * level boundaries. Compared as raw text, "Section 64" reads as an elaboration
 * of "Section 6" and a citation to a revocation provision would be waved
 * through by a profile that happens to mention Section 6.
 */
function provisionSegments(body: string): string[] {
  const cleaned = body.replace(/\s+/g, '').toUpperCase()
  const head = /^[^(]*/.exec(cleaned)?.[0] || ''
  const nested = Array.from(cleaned.matchAll(/\(([^)]*)\)/g)).map(m => m[1])
  return [head, ...nested].filter(Boolean)
}

/**
 * Canonical key for a provision, so "Section 2(1)(ja)", "section 2 (1) (ja)"
 * and "s.2(1)(JA)" are one thing.
 */
export function provisionKey(kindWord: string, body: string): string {
  return `${provisionKind(kindWord)}:${provisionSegments(body).join('|')}`
}

/** Every provision the text cites, with the words that produced each key. */
export function collectProvisions(text: string): Array<{ raw: string; key: string }> {
  const out: Array<{ raw: string; key: string }> = []
  const seen = new Set<string>()
  LOCAL_PROVISION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LOCAL_PROVISION_RE.exec(text)) !== null) {
    const key = provisionKey(m[0], m[1])
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ raw: m[0].replace(/\s+/g, ' ').trim(), key })
  }
  return out
}

/**
 * A cited provision is recognised when the jurisdiction declares it, or declares
 * something it contains or is contained by.
 *
 * Both directions are legitimate drafting. The reply may answer a "Section 3"
 * objection by arguing the specific sub-clause "Section 3(d)", or answer a
 * "Section 2(1)(ja)" objection by referring to "Section 2(1)". Demanding an
 * exact match would fire on correct replies, which is how a check gets ignored.
 */
function recognised(key: string, declared: Set<string>): boolean {
  if (declared.has(key)) return true
  // Containment on LEVEL boundaries only — see provisionSegments.
  return Array.from(declared).some(d => d.startsWith(`${key}|`) || key.startsWith(`${d}|`))
}

/**
 * Every statute, rule and form the reply cites must be one this jurisdiction
 * actually has.
 *
 * `checkAuthorities` reads case names; nothing read the provisions, which in an
 * Indian reply are the denser and more citable material — and the more likely
 * error. Section 2(1)(j) and 2(1)(ja) are different objections; Rule 24B(5) and
 * Rule 24B(6) are different deadlines; Form 3 and Form 27 are different
 * obligations. All of them are reconstructed by a model rather than recalled.
 *
 * Graded by what the miss actually means:
 *   fail — a citation to another jurisdiction's code. There is no reading on
 *          which "35 U.S.C. § 103" belongs in a submission to the Controller,
 *          and it is the same reach that puts KSR in an Indian reply.
 *   warn — a local-form provision this jurisdiction's profile does not declare.
 *          The profile is not an exhaustive statute book, so this is "check
 *          it", not "it is wrong".
 */
export function checkStatutoryCitations(sections: ProseSection[], declared: Set<string>): ProseFinding[] {
  const findings: ProseFinding[] = []

  for (const section of sections) {
    FOREIGN_CODE_RE.lastIndex = 0
    const foreign = Array.from(new Set((section.text.match(FOREIGN_CODE_RE) || []).map(s => s.trim())))
    if (foreign.length) {
      findings.push({
        where: section.where,
        status: 'fail',
        detail: `The reply cites ${foreign.slice(0, 3).map(f => `“${f}”`).join(', ')} — another jurisdiction's code. Argue the objection under the provisions of the Act and Rules this office applies, and remove the foreign citation.`
      })
    }

    if (!declared.size) continue
    const unknown = collectProvisions(section.text).filter(p => !recognised(p.key, declared))
    if (unknown.length) {
      findings.push({
        where: section.where,
        status: 'warn',
        detail: `The reply cites ${unknown.slice(0, 4).map(p => `“${p.raw}”`).join(', ')}, which this jurisdiction's profile does not declare. Verify the provision number against the Act and Rules before filing.`
      })
    }
  }

  return findings
}

// ---------------------------------------------------------------------------
// 4. Quantitative claims
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
