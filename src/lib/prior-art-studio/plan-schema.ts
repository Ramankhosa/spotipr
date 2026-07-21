import { z } from 'zod'
import type { StudioPlan } from './types'

export const STUDIO_PLAN_MAX_BYTES = 256 * 1024

const boundedText = (max: number) => z.string().max(max)
const nonEmptyText = (max: number) => boundedText(max).trim().min(1)

const studioTermSchema = z.object({
  text: nonEmptyText(200),
  origin: z.enum(['user', 'copilot']),
  accepted: z.boolean(),
}).strict()

const studioBlockSchema = z.object({
  id: nonEmptyText(120),
  label: nonEmptyText(160),
  mode: z.enum(['MATCH', 'EXPAND', 'BOTH']),
  terms: z.array(studioTermSchema).max(50),
}).strict()

const studioElementSchema = z.object({
  id: nonEmptyText(120),
  text: nonEmptyText(2000),
  origin: z.enum(['user', 'copilot']),
}).strict()

const studioCpcSchema = z.object({
  code: nonEmptyText(40).regex(/^[A-Za-z0-9][A-Za-z0-9/ .-]*$/, 'Invalid CPC/IPC code.'),
  definition: boundedText(500).optional(),
  origin: z.enum(['user', 'copilot']),
  accepted: z.boolean(),
}).strict()

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date.')

const studioFiltersSchema = z.object({
  jurisdictions: z.array(nonEmptyText(12)).max(50),
  publicationDateFrom: isoDate.optional(),
  publicationDateTo: isoDate.optional(),
  applicants: z.array(nonEmptyText(200)).max(100).optional(),
  inventors: z.array(nonEmptyText(200)).max(100).optional(),
}).strict().superRefine((filters, ctx) => {
  if (filters.publicationDateFrom && filters.publicationDateTo && filters.publicationDateFrom > filters.publicationDateTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['publicationDateTo'],
      message: 'Publication end date must not be before the start date.',
    })
  }
})

export const studioPlanSchema = z.object({
  title: boundedText(160),
  blocks: z.array(studioBlockSchema).max(20),
  notTerms: z.array(studioTermSchema).max(100),
  elements: z.array(studioElementSchema).max(30),
  cpc: z.array(studioCpcSchema).max(100),
  filters: studioFiltersSchema,
  conceptSummary: boundedText(10_000).optional(),
  steer: z.object({
    enabled: z.boolean(),
    publicationNumbers: z.array(nonEmptyText(60)).max(50),
    weight: z.number().finite().min(0).max(1),
  }).strict().optional(),
}).strict()

export type StudioPlanValidationResult =
  | { success: true; plan: StudioPlan }
  | { success: false; error: string; fields: Array<{ path: string; message: string }> }

export function validateStudioPlan(value: unknown): StudioPlanValidationResult {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    return { success: false, error: 'Search plan must be valid JSON.', fields: [] }
  }
  if (typeof serialized !== 'string') {
    return { success: false, error: 'Search plan must be a JSON object.', fields: [] }
  }
  if (Buffer.byteLength(serialized, 'utf8') > STUDIO_PLAN_MAX_BYTES) {
    return {
      success: false,
      error: `Search plan exceeds the ${STUDIO_PLAN_MAX_BYTES / 1024} KB limit.`,
      fields: [],
    }
  }

  const parsed = studioPlanSchema.safeParse(value)
  if (!parsed.success) {
    return {
      success: false,
      error: 'Search plan validation failed.',
      fields: parsed.error.issues.map(issue => ({
        path: issue.path.join('.') || 'plan',
        message: issue.message,
      })),
    }
  }
  return { success: true, plan: parsed.data }
}
