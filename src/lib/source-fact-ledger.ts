export const SOURCE_FACT_LEDGER_KEYS = [
  'componentsAndSubcomponents',
  'materialsOrCompositions',
  'processSteps',
  'numericValuesAndUnits',
  'conditionsAndRules',
  'alternativesAndEmbodiments',
  'examplesAndUseCases',
  'safetyFallbackOrExpiryRules',
  'dataFieldsOrMetadata',
  'claimSeeds',
  'notStated',
] as const

export type SourceFactLedgerKey = typeof SOURCE_FACT_LEDGER_KEYS[number]

export type SourceFactLedger = Record<SourceFactLedgerKey, string[]>

export type SourceFactCandidate = {
  value: string
  category: SourceFactLedgerKey
}

export type SourceFactLedgerEntry = {
  id: string
  category: SourceFactLedgerKey
  value: string
}

export function createEmptySourceFactLedger(): SourceFactLedger {
  return SOURCE_FACT_LEDGER_KEYS.reduce((acc, key) => {
    acc[key] = []
    return acc
  }, {} as SourceFactLedger)
}

function unique(values: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  values.forEach((value) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return
    seen.add(key)
    out.push(normalized)
  })
  return out
}

function valueToLedgerString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (!value || typeof value !== 'object') return ''

  const record = value as Record<string, unknown>
  const parts = [
    record.name,
    record.title,
    record.value,
    record.description,
    record.condition,
    record.rule,
    record.example,
    record.seed,
  ]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map(part => part.trim())

  return parts.length > 0 ? parts.join(' - ') : JSON.stringify(value)
}

function toLedgerArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return unique(value.map(valueToLedgerString).filter(Boolean))
  }
  const single = valueToLedgerString(value)
  return single ? [single] : []
}

export function coerceSourceFactLedger(value: unknown): SourceFactLedger {
  const ledger = createEmptySourceFactLedger()
  if (!value || typeof value !== 'object') return ledger

  const record = value as Record<string, unknown>
  SOURCE_FACT_LEDGER_KEYS.forEach((key) => {
    ledger[key] = toLedgerArray(record[key])
  })

  return ledger
}

export function buildSourceFactLedgerEntries(value: unknown): SourceFactLedgerEntry[] {
  const ledger = coerceSourceFactLedger(value)
  const entries: SourceFactLedgerEntry[] = []

  SOURCE_FACT_LEDGER_KEYS.forEach((key) => {
    ledger[key].forEach((item, index) => {
      entries.push({
        id: `SF-${key}-${index + 1}`,
        category: key,
        value: item,
      })
    })
  })

  return entries
}

function sourceSentences(rawIdea: string) {
  return unique(
    rawIdea
      .replace(/\r\n/g, '\n')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(s => s.length >= 8 && s.length <= 260)
  )
}

function addRegexCandidates(
  rawIdea: string,
  regex: RegExp,
  category: SourceFactLedgerKey,
  out: SourceFactCandidate[]
) {
  const matches = rawIdea.match(regex) || []
  matches.forEach(value => {
    const cleaned = value.replace(/\s+/g, ' ').trim()
    if (cleaned) out.push({ value: cleaned, category })
  })
}

export function extractPatentCriticalSourceFacts(rawIdea: string): SourceFactCandidate[] {
  const out: SourceFactCandidate[] = []
  const text = rawIdea || ''

  addRegexCandidates(
    text,
    /\b\d+(?:\.\d+)?\s*(?:-|–|—|to)\s*\d+(?:\.\d+)?\s*(?:%|percent|wt%|w\/w|v\/v|°?\s*[CFK]|[a-zA-Zµμ][a-zA-Z0-9µμ/%.\-]*)?\b/gi,
    'numericValuesAndUnits',
    out
  )

  addRegexCandidates(
    text,
    /\b\d+(?:\.\d+)?\s*(?:%|percent|wt%|w\/w|v\/v|ppm|ppb|mg|g|kg|µg|ug|mcg|mL|ml|L|l|L\/min|l\/min|mm|cm|m|nm|µm|um|V|mV|kV|A|mA|W|kW|Hz|kHz|MHz|GHz|rpm|N|Pa|kPa|MPa|bar|psi|°C|°F|C|F|K|pH|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?)\b/gi,
    'numericValuesAndUnits',
    out
  )

  addRegexCandidates(
    text,
    /\b\d+(?:\.\d+)?\s*(?:\u2013|\u2014)\s*\d+(?:\.\d+)?\s*(?:%|percent|wt%|w\/w|v\/v|\u00b0?\s*[CFK]|[a-zA-Z\u00b5\u03bc][a-zA-Z0-9\u00b5\u03bc/%.\-]*)?\b/gi,
    'numericValuesAndUnits',
    out
  )

  addRegexCandidates(
    text,
    /\b\d+(?:\.\d+)?\s*(?:\u00b0C|\u00b0F|\u00b5g|\u00b5m)\b/gi,
    'numericValuesAndUnits',
    out
  )

  addRegexCandidates(
    text,
    /\b\d+(?:\.\d+)?\s*(?:L\/min|l\/min|mL\/min|ml\/min)\b/gi,
    'numericValuesAndUnits',
    out
  )

  addRegexCandidates(
    text,
    /\b(?:confidence|score|threshold|probability|accuracy)\s+(?:is\s+)?(?:below|above|under|over|at least|less than|greater than|<=|>=|<|>)\s*\d+(?:\.\d+)?\b/gi,
    'numericValuesAndUnits',
    out
  )

  sourceSentences(text).forEach((sentence) => {
    if (/\b(if|unless|when|wherein|provided that|in response to|trigger(?:s|ed)?|activat(?:es|ed)|below|above|exceeds?)\b/i.test(sentence)) {
      out.push({ value: sentence, category: 'conditionsAndRules' })
    }
    if (/\b(optional|optionally|alternative|alternatively|variant|embodiment|or|either)\b/i.test(sentence)) {
      out.push({ value: sentence, category: 'alternativesAndEmbodiments' })
    }
    if (/\b(example|for example|use case|scenario|prototype|test|trial)\b/i.test(sentence)) {
      out.push({ value: sentence, category: 'examplesAndUseCases' })
    }
    if (/\b(fallback|fail(?:s|ure)?|safety|shutdown|cutoff|cut-off|expire(?:s|d)?|expiry|retention|alert|alarm|manual review)\b/i.test(sentence)) {
      out.push({ value: sentence, category: 'safetyFallbackOrExpiryRules' })
    }
    if (/\b(metadata|field|identifier|id|timestamp|confidence|score|payload|header|token|cache)\b/i.test(sentence)) {
      out.push({ value: sentence, category: 'dataFieldsOrMetadata' })
    }
  })

  const deduped = unique(out.map(item => `${item.category}\u0000${item.value}`))
  return deduped.map(item => {
    const [category, value] = item.split('\u0000')
    return { category: category as SourceFactLedgerKey, value }
  })
}

function normalizeForSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/\u00b0/g, '')
    .replace(/[°]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function containsCandidate(normalizedOutput: string, candidate: string) {
  const normalizedCandidate = normalizeForSearch(candidate)
  if (!normalizedCandidate) return true
  if (normalizedOutput.includes(normalizedCandidate)) return true

  const numbers = normalizedCandidate.match(/\d+(?:\.\d+)?/g) || []
  if (numbers.length === 0) return false

  const units = normalizedCandidate.match(/\b(?:percent|wt|w\/w|v\/v|ppm|ppb|mg|kg|ug|mcg|ml|l\/min|mm|cm|nm|um|mv|kv|hz|khz|mhz|ghz|rpm|pa|kpa|mpa|bar|psi|ph|hours?|minutes?|seconds?|days?|weeks?|months?|years?|[a-z])\b/g) || []
  const hasNumbers = numbers.every(number => normalizedOutput.includes(number))
  const hasUnit = units.length === 0 || units.some(unit => normalizedOutput.includes(unit))
  return hasNumbers && hasUnit
}

export function sourceMentionsBestMethod(rawIdea: string) {
  return /\b(best\s+(?:mode|method|implementation)|preferred\s+(?:embodiment|implementation|method|mode|configuration)|preferably)\b/i.test(rawIdea || '')
}

export function completeSourceFactLedger(
  rawIdea: string,
  normalizedData: Record<string, unknown>
): { sourceFactLedger: SourceFactLedger; normalizationReviewWarnings: string[] } {
  const ledger = coerceSourceFactLedger(normalizedData?.sourceFactLedger)
  const outputTextBeforeBackfill = normalizeForSearch(JSON.stringify(normalizedData || {}))
  const warnings: string[] = []

  extractPatentCriticalSourceFacts(rawIdea).forEach((candidate) => {
    if (!containsCandidate(outputTextBeforeBackfill, candidate.value)) {
      warnings.push(`Detected "${candidate.value}" in the source. Please verify it appears in the comprehended invention before generating claims.`)
      ledger[candidate.category].push(candidate.value)
    }
  })

  SOURCE_FACT_LEDGER_KEYS.forEach((key) => {
    ledger[key] = unique(ledger[key])
  })

  return {
    sourceFactLedger: ledger,
    normalizationReviewWarnings: unique(warnings),
  }
}

export function buildSourceFactLedgerPromptBlock(
  value: unknown,
  heading = 'SOURCE FACT LEDGER (SOURCE-STATED FACTS ONLY)'
): string {
  const ledger = coerceSourceFactLedger(value)
  const lines: string[] = []

  SOURCE_FACT_LEDGER_KEYS.forEach((key) => {
    const values = ledger[key]
    if (!values.length) return
    const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
    lines.push(`${label}:`)
    values.forEach((item, index) => lines.push(`- [SF-${key}-${index + 1}] ${item}`))
  })

  if (lines.length === 0) return ''

  return `${heading}
Use these facts as source support. Do not invent missing facts and do not convert optional facts into mandatory claim elements.
${lines.join('\n')}`
}
