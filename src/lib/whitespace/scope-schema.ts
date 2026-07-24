import { z } from 'zod'
import { CORPUS_FIRST_YEAR, type WhitespaceScope } from './types'

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

const currentYear = new Date().getFullYear()

const filtersSchema = z
  .object({
    yearFrom: z.number().int().min(CORPUS_FIRST_YEAR).max(currentYear),
    yearTo: z.number().int().min(CORPUS_FIRST_YEAR).max(currentYear + 1),
    jurisdictions: z.array(z.string().trim().regex(/^[A-Za-z]{2}$/, 'Use two-letter country codes.')).max(60),
    assignees: z.array(nonEmptyText(200)).max(50),
  })
  .strict()
  .refine(f => f.yearTo >= f.yearFrom, {
    message: 'End year must be on or after the start year.',
    path: ['yearTo'],
  })

const scopeSchema = z
  .object({
    title: boundedText(200),
    summary: boundedText(2000),
    concepts: z.array(conceptSchema).max(24),
    classifications: z.array(classificationSchema).max(40),
    exclusions: z.array(exclusionSchema).max(40),
    assumptions: z.array(assumptionSchema).max(30),
    filters: filtersSchema,
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
  return { runnable: true }
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

  const yearFrom = Math.max(CORPUS_FIRST_YEAR, Math.min(scope.filters.yearFrom, currentYear))
  const yearTo = Math.max(yearFrom, Math.min(scope.filters.yearTo, currentYear + 1))

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
  }
}
