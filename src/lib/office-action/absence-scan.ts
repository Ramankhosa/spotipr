/**
 * Office Action Studio — absence verification
 *
 * A reply that says "D1 does not disclose X" is asserting a fact about the
 * prior art to the Controller. The claim chart's absence verdicts come from a
 * model that was shown only the FIRST 6,000 CHARACTERS of each cited document
 * (see the truncation in claim-chart-service) — while a patent specification
 * runs 50,000–200,000. So the model routinely returns "not disclosed" for text
 * it was never shown, and that verdict is filed as fact.
 *
 * This module is the deterministic check that stands between the two. Before an
 * absence verdict is trusted, the COMPLETE stored document is scanned for the
 * claim feature. The complete text is already on file; only the prompt was
 * truncated. No embeddings, no dictionary, no extra model call.
 *
 * It is deliberately asymmetric. A hit downgrades to AMBIGUOUS and shows the
 * attorney the passage; a miss does not upgrade anything. One passage proves
 * disclosure — no passage proves nothing.
 */

/**
 * Words that appear in nearly every patent in a field and therefore prove
 * nothing on their own. Without this, "promoter" alone would match any
 * biotechnology document and downgrade every legitimate absence finding into
 * AMBIGUOUS — noise that costs the attorney real review time.
 */
const GENERIC_PATENT_TERMS = new Set([
  'method', 'methods', 'system', 'systems', 'device', 'devices', 'apparatus',
  'process', 'processes', 'composition', 'compositions', 'comprising', 'consisting',
  'vector', 'vectors', 'promoter', 'promoters', 'plant', 'plants', 'gene', 'genes',
  'protein', 'proteins', 'medium', 'media', 'sequence', 'sequences', 'cell', 'cells',
  'sample', 'samples', 'agent', 'agents', 'compound', 'compounds', 'material', 'materials',
  'means', 'element', 'elements', 'member', 'portion', 'surface', 'layer', 'unit',
  'first', 'second', 'third', 'said', 'wherein', 'thereof', 'therein', 'therefrom',
  'least', 'about', 'between', 'plurality', 'configured', 'adapted', 'formed',
  'having', 'including', 'provided', 'associated', 'respective', 'suitable',
  // Engineering/software vocabulary that appears in essentially every document
  // in its field. Without these, a feature like "a sensor coupled to a processor
  // configured to output a control signal" matched almost any electronics
  // citation on one word and overturned a genuine absence finding — which then
  // emptied chart.distinctions and cost the reply its novelty argument.
  'sensor', 'sensors', 'processor', 'processors', 'controller', 'controllers',
  'signal', 'signals', 'circuit', 'circuits', 'module', 'modules', 'memory',
  'network', 'networks', 'interface', 'interfaces', 'output', 'outputs',
  'input', 'inputs', 'coupled', 'connected', 'attached', 'mounted', 'disposed',
  'control', 'controls', 'data', 'value', 'values', 'threshold', 'thresholds',
  'server', 'servers', 'client', 'clients', 'database', 'databases', 'storage',
  'computer', 'software', 'hardware', 'program', 'programs', 'instruction',
  'instructions', 'operation', 'operations', 'function', 'functions', 'model',
  'models', 'algorithm', 'algorithms', 'parameter', 'parameters', 'component',
  'components', 'assembly', 'housing', 'chamber', 'channel', 'channels',
  'temperature', 'pressure', 'voltage', 'current', 'frequency', 'power',
  'transmit', 'transmitting', 'receive', 'receiving', 'generate', 'generating',
  'determine', 'determining', 'display', 'displaying', 'detect', 'detecting',
  'obtain', 'obtaining', 'measure', 'measuring', 'solution', 'mixture',
  'reaction', 'temperature', 'concentration', 'treatment', 'container'
])

export type AbsenceHitRule = 'exact-phrase' | 'rare-token' | 'co-occurrence'

export interface AbsenceScanResult {
  /** Something relevant was found in the full text — the absence is not safe to assert. */
  found: boolean
  rule?: AbsenceHitRule
  /** The term that matched, for the attorney to judge. */
  term?: string
  /** Surrounding text, so they can read it rather than take our word. */
  passage?: string
}

function normalize(s: string): string {
  return (s || '').toLowerCase().normalize('NFKC').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean)
}

/**
 * A token specific enough that finding it means something.
 *
 * Long words, and anything carrying digits — accession numbers (DQ116425),
 * strain designations (LBA4404), vector names (pCAMBIA2300), measured values
 * (OD600) — are exactly the terms that distinguish one disclosure from another,
 * and exactly the terms embeddings handle worst.
 */
export function isRareToken(token: string): boolean {
  if (GENERIC_PATENT_TERMS.has(token)) return false
  // Anything carrying digits is an identifier — accession number, strain, vector
  // name, measured value — and stays a strong signal at short length.
  if (/\d/.test(token) && token.length >= 3) return true
  // A purely alphabetic token has to be genuinely unusual to prove anything on
  // its own. At >= 6 characters this admitted ordinary field vocabulary
  // ("coupled", "sensor", "control"), and since ONE such hit overturns an
  // absence verdict, nearly every real distinction was being downgraded.
  return token.length >= 8
}

/**
 * Does `token` occur in the normalized haystack as a whole word?
 *
 * The haystack is normalized to space-separated tokens, so a raw `indexOf` is a
 * substring test: "100" matched inside "1000 rpm", and "vector" inside
 * "vectorial". Pad both sides and search that.
 */
function containsToken(normHaystack: string, token: string): boolean {
  if (!token) return false
  return ` ${normHaystack} `.includes(` ${token} `)
}

/**
 * Locate a term in the ORIGINAL text.
 *
 * Matching happens in normalized space (punctuation stripped, whitespace
 * collapsed), so a normalized offset does not point at the same place in the
 * original — quoting from it would hand the attorney an excerpt from the wrong
 * part of the document. Lowercasing preserves offsets, so search that; fall
 * back to the term's first word when the exact run does not survive
 * punctuation.
 */
function locateInOriginal(haystack: string, term: string): number {
  const lower = haystack.toLowerCase()
  const direct = lower.indexOf(term.toLowerCase())
  if (direct >= 0) return direct
  const firstWord = (term.match(/[a-z0-9]+/i) || [])[0]
  return firstWord ? lower.indexOf(firstWord.toLowerCase()) : -1
}

function excerpt(haystack: string, term: string, span = 240): string {
  const at = locateInOriginal(haystack, term)
  if (at < 0) return ''
  const start = Math.max(0, at - span / 2)
  const end = Math.min(haystack.length, at + span / 2)
  return (start > 0 ? '…' : '') + haystack.slice(start, end).replace(/\s+/g, ' ').trim() + (end < haystack.length ? '…' : '')
}

/**
 * Scan the whole cited document for a claim feature.
 *
 * Ranked, first match wins — strongest evidence first, and a generic term on
 * its own never counts at any rank.
 */
export function scanForFeature(feature: string, fullText: string): AbsenceScanResult {
  const hay = fullText || ''
  if (!hay.trim() || !feature?.trim()) return { found: false }

  const normHay = normalize(hay)
  const featureTokens = tokens(feature)
  if (!featureTokens.length) return { found: false }

  // 1. The whole feature, as written.
  const normFeature = normalize(feature)
  if (normFeature.length > 12) {
    const at = normHay.indexOf(normFeature)
    if (at >= 0) return { found: true, rule: 'exact-phrase', term: feature, passage: excerpt(hay, feature) }
  }

  // 2. A single rare technical token — this is the phaseolin case.
  const rare = featureTokens.filter(isRareToken)
  for (const token of rare) {
    if (containsToken(normHay, token)) {
      return { found: true, rule: 'rare-token', term: token, passage: excerpt(hay, token) }
    }
  }

  // 3. Two or more non-generic terms close enough together to be about the same
  //    thing rather than coincidence.
  const meaningful = Array.from(new Set(featureTokens.filter(t => !GENERIC_PATENT_TERMS.has(t) && t.length >= 4)))
  if (meaningful.length >= 2) {
    const WINDOW = 100
    const positions = meaningful
      .map(t => ({ t, at: containsToken(normHay, t) ? ` ${normHay} `.indexOf(` ${t} `) : -1 }))
      .filter(p => p.at >= 0)
      .sort((a, b) => a.at - b.at)
    for (let i = 1; i < positions.length; i++) {
      if (positions[i].at - positions[i - 1].at <= WINDOW) {
        return {
          found: true, rule: 'co-occurrence',
          term: `${positions[i - 1].t} + ${positions[i].t}`,
          passage: excerpt(hay, positions[i - 1].t)
        }
      }
    }
  }

  return { found: false }
}

// ---------------------------------------------------------------------------
// Coverage — did we have the document to look at in the first place?
// ---------------------------------------------------------------------------

export interface CitationCorpus {
  kind?: 'PATENT' | 'NPL' | string
  title?: string
  abstract?: string
  claims?: string
  description?: string
  /** NPL only: the attorney uploaded the whole paper rather than a scraped snippet. */
  suppliedAsCompleteDocument?: boolean
  expectedPageCount?: number
  extractedPageCount?: number
  extractionError?: string
}

export type ExtractionQuality = 'GOOD' | 'PARTIAL' | 'FAILED'

/** Enough text to be worth calling a section. */
function hasMeaningfulText(v: string | undefined): boolean {
  return Boolean(v && v.replace(/\s+/g, ' ').trim().length >= 200)
}

/**
 * Is the stored copy of this document complete enough that "we did not find it"
 * means something?
 *
 * Document-type aware, and it has to be: a research paper has no claims
 * section, so a patent-shaped test would mark EVERY cited paper incomplete and
 * suppress findings that work today.
 *
 * Note this is about the STORED corpus, never about prompt truncation. Almost
 * every real patent is truncated for the prompt; that is why the scan above
 * exists, and it is not a reason to call the document incomplete.
 */
export function determineCorpusCompleteness(corpus: CitationCorpus): boolean {
  if (corpus.extractionError) return false
  if (corpus.kind === 'NPL') {
    if (!corpus.suppliedAsCompleteDocument) return false
    if (corpus.expectedPageCount !== undefined && corpus.extractedPageCount !== undefined
        && corpus.expectedPageCount !== corpus.extractedPageCount) return false
    return hasMeaningfulText(corpus.description) || hasMeaningfulText(corpus.claims)
  }
  // Patent, or unknown kind treated as one.
  return hasMeaningfulText(corpus.claims) && hasMeaningfulText(corpus.description)
}

/** How well the text came out, assigned by rule rather than by feel. */
export function assessExtractionQuality(corpus: CitationCorpus): ExtractionQuality {
  if (corpus.extractionError) return 'FAILED'
  const body = [corpus.claims, corpus.description].filter(Boolean).join('\n')
  if (!body.trim() && !corpus.abstract?.trim()) return 'FAILED'
  if (!hasMeaningfulText(corpus.description) && !hasMeaningfulText(corpus.claims)) return 'PARTIAL'
  if (corpus.expectedPageCount !== undefined && corpus.extractedPageCount !== undefined
      && corpus.extractedPageCount < corpus.expectedPageCount) return 'PARTIAL'
  return 'GOOD'
}
