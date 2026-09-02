import { z } from 'zod'
import { CORPUS_FIRST_YEAR, scopeMatching, type WhitespaceScope } from './types'

export const WHITESPACE_SCOPE_MAX_BYTES = 256 * 1024

const boundedText = (max: number) => z.string().max(max)
const nonEmptyText = (max: number) => boundedText(max).trim().min(1)
const origin = z.enum(['user', 'copilot'])

const conceptSchema = z
  .object({
    id: nonEmptyText(120),
    label: nonEmptyText(200),
    synonyms: z.array(nonEmptyText(200)).max(40),
    required: z.boolean(),
    origin,
  })
  .strict()

const classificationSchema = z
  .object({
    // CPC shape, e.g. A61B5/1455. Permissive on separators because users paste
    // codes in several house styles; normalisation happens in normalizeScope.
    code: nonEmptyText(40).regex(/^[A-Za-z0-9][A-Za-z0-9/ .-]*$/, 'Invalid CPC code.'),
    definition: boundedText(500).optional(),
    caution: boundedText(300).optional(),
    origin,
    accepted: z.boolean(),
  })
  .strict()

const exclusionSchema = z
  .object({
    term: nonEmptyText(200),
    reason: boundedText(300).optional(),
    origin,
  })
  .strict()

const assumptionSchema = z
  .object({
    id: nonEmptyText(120),
    text: nonEmptyText(600),
    kind: z.enum(['interpretation', 'corpus']),
  })
  .strict()

/**
 * Read per validation, never captured at module load.
 *
 * A Next.js server process runs for weeks, so a module-level
 * `new Date().getFullYear()` freezes on the year the process started. Baked
 * into a `.max()` bound it meant that on the first of January every scope
 * carrying the new year was rejected with "Number must be less than or equal
 * to <last year>" until someone restarted the server. The upper bounds are
 * checked in a refinement, which zod evaluates per parse.
 */
const thisYear = () => new Date().getFullYear()

/**
 * Year bound that ROUNDS a fractional number before demanding an integer.
 * Years reach the scope from a language model (service.ts's asInt passes a
 * numeric 2015.5 through unparsed), and a stored scope that fails .int() here
 * fails EVERY later readScope — the study bricks over a half-year nobody can
 * see. The contract is still "an integer year"; rounding just performs the
 * repair a numeric near-miss obviously intends instead of rejecting forever.
 */
const yearField = z.preprocess(
  value => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : value),
  z.number().int().min(CORPUS_FIRST_YEAR)
)

const filtersSchema = z
  .object({
    yearFrom: yearField,
    yearTo: yearField,
    jurisdictions: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use two-letter country codes.')).max(60),
    assignees: z.array(nonEmptyText(200)).max(50),
  })
  .strict()
  .superRefine((f, ctx) => {
    const ceiling = thisYear()
    if (f.yearFrom > ceiling) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['yearFrom'],
        message: `Start year cannot be after ${ceiling}.`,
      })
    }
    // One year of headroom: applications filed this year publish next year, and
    // a user setting the window forward is describing intent, not an error.
    if (f.yearTo > ceiling + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['yearTo'],
        message: `End year cannot be after ${ceiling + 1}.`,
      })
    }
    if (f.yearTo < f.yearFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['yearTo'],
        message: 'End year must be on or after the start year.',
      })
    }
  })

/**
 * "At least k of the optional concepts". `'auto'` fits k at run time; a number
 * pins it. Optional on the wire so scopes saved before the rule existed keep
 * validating — they read as `'auto'` (see scopeMatching in types.ts).
 */
const matchingSchema = z
  .object({
    minimumOptionalConcepts: z.union([z.literal('auto'), z.number().int().min(0).max(24)]),
  })
  .strict()

const scopeSchema = z
  .object({
    title: boundedText(200),
    summary: boundedText(2000),
    concepts: z.array(conceptSchema).max(24),
    classifications: z.array(classificationSchema).max(40),
    exclusions: z.array(exclusionSchema).max(40),
    assumptions: z.array(assumptionSchema).max(30),
    filters: filtersSchema,
    matching: matchingSchema.optional(),
  })
  .strict()

export type ScopeValidationResult =
  | { success: true; scope: WhitespaceScope }
  | { success: false; error: string; fields: Array<{ path: string; message: string }> }

export function validateWhitespaceScope(value: unknown): ScopeValidationResult {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { success: false, error: 'Scope must be valid JSON.', fields: [] }
  }
  if (typeof serialized !== 'string') {
    return { success: false, error: 'Scope must be a JSON object.', fields: [] }
  }
  if (Buffer.byteLength(serialized, 'utf8') > WHITESPACE_SCOPE_MAX_BYTES) {
    return {
      success: false,
      error: `Scope exceeds the ${WHITESPACE_SCOPE_MAX_BYTES / 1024} KB limit.`,
      fields: [],
    }
  }

  const parsed = scopeSchema.safeParse(value)
  if (!parsed.success) {
    return {
      success: false,
      error: 'Scope validation failed.',
      fields: parsed.error.issues.map(issue => ({
        path: issue.path.join('.') || 'scope',
        message: issue.message,
      })),
    }
  }
  return { success: true, scope: parsed.data as WhitespaceScope }
}

/** A scope with no accepted concept and no accepted classification retrieves nothing. */
export function scopeIsRunnable(scope: WhitespaceScope): { runnable: boolean; reason?: string } {
  const hasConcept = scope.concepts.some(c => c.label.trim().length > 0)
  const hasClassification = scope.classifications.some(c => c.accepted && c.code.trim().length > 0)
  if (!hasConcept && !hasClassification) {
    return { runnable: false, reason: 'Add at least one concept or accept one classification before running.' }
  }
  // A pinned minimum that no rung can express is refused here, where the user
  // can still change it, rather than at run time as a bare failure.
  const pinned = scopeMatching(scope).minimumOptionalConcepts
  if (pinned !== 'auto') {
    const optional = scope.concepts.filter(c => !c.required && c.label.trim()).length
    if (pinned > optional) {
      return {
        runnable: false,
        reason: `The match rule asks for at least ${pinned} of the optional concepts, but only ${optional} ${
          optional === 1 ? 'is' : 'are'
        } optional. Lower it or add concepts.`,
      }
    }
    if (!rungIsCompilable(optional, pinned)) {
      return {
        runnable: false,
        reason: `"At least ${pinned} of ${optional}" is too many concept combinations to search (${combinationCount(
          optional,
          pinned
        ).toLocaleString()}; the limit is ${MAX_RUNG_COMBINATIONS}). Pick a minimum nearer 1 or nearer ${optional}, or merge some concepts.`,
      }
    }
  }
  return { runnable: true }
}

/**
 * Ceiling on the concept combinations one rung may expand to. "At least k of n"
 * is searched as an OR over every k-subset of the optional concepts (each
 * subset an index-backed AND), so C(n, k) is the number of index scans a rung
 * costs. 70 = C(8, 4): every rung is expressible up to eight optional concepts,
 * and past that only the ends of the ladder are — the middle rungs of a
 * ten-concept scope would each be hundreds of scans for little extra insight.
 */
export const MAX_RUNG_COMBINATIONS = 70

export function combinationCount(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= Math.min(k, n - k); i++) result = (result * (n - i + 1)) / i
  return Math.round(result)
}

export function rungIsCompilable(optionalCount: number, minimumOptional: number): boolean {
  if (minimumOptional <= 0) return true
  // k > n is inexpressible, not "cheap": combinationCount returns 0 there, which
  // slipped under the ceiling and read as compilable — and a rung with zero
  // k-subsets compiles to NO predicate arms, silently deleting the concept gate.
  if (minimumOptional > optionalCount) return false
  return combinationCount(optionalCount, minimumOptional) <= MAX_RUNG_COMBINATIONS
}

/**
 * Normalises a scope for storage and querying:
 * CPC codes uppercased and de-spaced, synonyms and exclusions de-duplicated
 * case-insensitively, year range clamped to what the corpus can actually answer.
 *
 * Clamping rather than rejecting is deliberate — a user asking for 1985 should
 * get the corpus floor plus a corpus assumption telling them why, not an error.
 */
export function normalizeScope(scope: WhitespaceScope): WhitespaceScope {
  const dedupe = (values: string[]) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const value of values) {
      const trimmed = value.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(trimmed)
    }
    return out
  }

  const seenCodes = new Set<string>()
  const classifications = scope.classifications
    .map(c => ({ ...c, code: c.code.replace(/\s+/g, '').toUpperCase() }))
    .filter(c => {
      if (!c.code || seenCodes.has(c.code)) return false
      seenCodes.add(c.code)
      return true
    })

  const seenExclusions = new Set<string>()
  const exclusions = scope.exclusions.filter(e => {
    const key = e.term.trim().toLowerCase()
    if (!key || seenExclusions.has(key)) return false
    seenExclusions.add(key)
    return true
  })

  const ceiling = thisYear()
  // Rounded for the same reason yearField rounds: a fractional year that
  // reached normalisation must not be stored to fail every later validation.
  const yearFrom = Math.max(CORPUS_FIRST_YEAR, Math.min(Math.round(scope.filters.yearFrom), ceiling))
  const yearTo = Math.max(yearFrom, Math.min(Math.round(scope.filters.yearTo), ceiling + 1))

  return {
    ...scope,
    title: scope.title.trim(),
    summary: scope.summary.trim(),
    concepts: scope.concepts.map(c => ({
      ...c,
      label: c.label.trim(),
      synonyms: dedupe(c.synonyms).slice(0, 40),
    })),
    classifications,
    exclusions,
    filters: {
      ...scope.filters,
      yearFrom,
      yearTo,
      jurisdictions: dedupe(scope.filters.jurisdictions.map(j => j.toUpperCase())),
      assignees: dedupe(scope.filters.assignees),
    },
    // Stored explicitly so a saved scope states its own rule instead of
    // inheriting whatever the default happens to be when it is next read.
    matching: scopeMatching(scope),
  }
}
