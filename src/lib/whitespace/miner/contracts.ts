import { z } from 'zod'

export const MINER_CONTRACT_VERSION = 2
export const minerOfficeSchema = z.enum(['IN', 'US', 'EP'])
export type MinerOffice = z.infer<typeof minerOfficeSchema>
const text = z.string().trim().min(1).max(6000)
export const proposalSchema = z.object({
  title: text.max(180), problem: text, mechanism: text,
  elements: z.array(text.max(500)).min(2).max(12),
  relationships: z.array(text.max(1000)).min(1).max(12),
  intendedEffects: z.array(text.max(1000)).min(1).max(12),
  constraints: z.array(text.max(1000)).max(20),
  assumptions: z.array(text.max(1000)).max(20),
  experimentsNeeded: z.array(text.max(1000)).max(20),
  provenance: z.enum(['SOURCE_DISCLOSURE', 'USER_ASSERTION', 'AI_PROPOSAL']),
  sourceRefs: z.array(z.string().max(160)).max(40),
  outsideFieldInspiration: z.boolean(),
}).strict().superRefine((proposal, context) => {
  if (proposal.provenance === 'SOURCE_DISCLOSURE' && proposal.sourceRefs.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceRefs'], message: 'A source-disclosure proposal must identify at least one source.' })
  }
})
export type MinerProposal = z.infer<typeof proposalSchema>
export const sourcePassageSchema = z.object({
  id: z.string().min(1), publicationNumber: z.string().min(1), familyKey: z.string().min(1),
  title: z.string(), publicationDate: z.union([z.string(), z.date()]).nullable(),
  filingDate: z.union([z.string(), z.date()]).nullable(), sourceUrl: z.string().nullable(),
  sourcePageNumber: z.number().int().positive().nullable(), passage: z.string(), sourceHash: z.string().min(32),
  availableDepth: z.string(), readDepth: z.string(), truncated: z.boolean(),
}).passthrough()
export type MinerSourcePassage = z.infer<typeof sourcePassageSchema>

export const assessmentOutcomeSchema = z.enum(['SUPPORTED_FOR_REVIEW', 'CONDITIONAL', 'BLOCKED', 'UNASSESSED'])
export const officeAssessmentSchema = z.object({
  contractVersion: z.number().int(), leadId: z.string(), office: minerOfficeSchema,
  outcome: assessmentOutcomeSchema, snapshotId: z.string(), proposalRevisionId: z.string(),
  assessmentDate: z.string(), researchCutoff: z.string(), ruleProfile: z.object({
    version: z.string(), sources: z.array(z.string()), checks: z.array(z.string()),
    guidance: z.array(z.string()).optional(),
  }),
  queries: z.array(z.string()).max(4), references: z.array(sourcePassageSchema).max(12), limitations: z.array(z.string()),
}).passthrough()
export type MinerOfficeAssessment = z.infer<typeof officeAssessmentSchema>

export const briefContentSchema = z.object({
  title: text.max(300), executiveSummary: text, citedProblem: text, approvedMechanism: text,
  differencesFromPriorArt: z.union([z.string(), z.array(z.string())]), officeAssessment: z.union([z.string(), z.record(z.unknown())]),
  preliminaryClaims: z.array(z.string()), assumptions: z.array(z.string()), missingExperiments: z.array(z.string()),
  coverageLimitations: z.array(z.string()), questions: z.array(z.string()),
}).passthrough()
export type MinerBriefContent = z.infer<typeof briefContentSchema>

export const freshnessSchema = z.object({
  runId: z.string(), proposalRevisionId: z.string(), snapshotId: z.string(), assessmentRunId: z.string().nullable().optional(),
  outcome: assessmentOutcomeSchema.nullable().optional(), generatedAt: z.string(),
})

export const handoffPayloadSchema = z.object({
  v: z.literal(2), target: z.enum(['novelty', 'drafting']), office: minerOfficeSchema,
  studyId: z.string(), leadId: z.string(), snapshotId: z.string(), proposalRevisionId: z.string(),
  title: z.string(), description: z.string(), elements: z.array(z.string()), relationships: z.array(z.string()),
  preliminaryClaims: z.array(z.string()), assessmentRunId: z.string(), briefRunId: z.string().nullable(), limitations: z.array(z.unknown()),
}).strict()
export type MinerHandoffPayload = z.infer<typeof handoffPayloadSchema>
export const reviewSchema = z.object({
  proposalRevisionId: z.string().min(1),
  verdict: z.enum(['APPROVED', 'ENDORSED', 'REJECTED', 'NEEDS_INVESTIGATION']),
  note: z.string().trim().min(20).max(6000),
  assessmentRunId: z.string().optional(),
}).strict()
export class MinerError extends Error {
  constructor(message: string, public status = 422, public code = 'MINER_PREREQUISITE') { super(message) }
}
export function requireMinerEnabled() {
  if (process.env.INVENTION_MINER_ENABLED !== 'true') throw new MinerError('Invention Miner is not enabled on this installation.', 503, 'MINER_DISABLED')
}
