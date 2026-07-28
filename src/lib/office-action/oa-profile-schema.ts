import { z } from 'zod'

/**
 * Office Action Studio — jurisdiction profile schema
 *
 * The `officeActionProfile` block lives inside a country profile JSON
 * (Countries/*.json → CountryProfile.profileData.officeActionProfile).
 * Everything jurisdiction-specific about office-action / FER response
 * practice is DATA in this block; the pipeline engine never branches on
 * a country code. See OFFICE_ACTION_STUDIO_PRODUCT_PLAN.md §4.
 */

// Canonical objection codes — jurisdiction-agnostic pipeline vocabulary.
// Profiles map these to local statute (e.g. NOVELTY → IN s.2(1)(j) / US §102 / EP Art.54).
export const CANONICAL_OBJECTION_CODES = [
  'NOVELTY',
  'INVENTIVE_STEP',
  'ELIGIBILITY',
  'CLARITY',
  'SUFFICIENCY',
  'UNITY',
  'ADDED_MATTER',
  'DOUBLE_PATENTING',
  'PROCEDURAL_DISCLOSURE',
  'FORMALITIES',
  'OTHER'
] as const

export type CanonicalObjectionCode = typeof CANONICAL_OBJECTION_CODES[number]

// Deadline models discovered across offices (see OFFICE_ACTION_WESTERN_JURISDICTIONS.md §0):
// PER_REPORT      — each report starts its own response clock (IN, US, CA, EP)
// ACCEPTANCE_CLOCK — one hard window from the first report to acceptance (AU, NZ)
// HYBRID          — per-report clocks inside an overall compliance ceiling (UK)
export const PROSECUTION_DEADLINE_MODELS = ['PER_REPORT', 'ACCEPTANCE_CLOCK', 'HYBRID'] as const

// ISO-8601 duration subset: P6M, P15D, P9M, P2Y, P30D …
const PERIOD_REGEX = /^P(?=\d)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/
export const periodSchema = z.string().regex(PERIOD_REGEX, 'Must be an ISO-8601 period like "P6M" or "P15D"')

const instrumentSchema = z.object({
  id: z.string().min(1),                          // e.g. "FER", "OA_NONFINAL", "HEARING_NOTICE"
  label: z.string().min(1),
  detectionHints: z.array(z.string().min(1)).optional(),  // literal phrases that identify this document type
  extractFields: z.array(z.string().min(1)).optional()    // metadata fields the parser must pull
})

const extensionSchema = z.object({
  period: periodSchema,                            // how much extra time an extension buys
  form: z.string().optional(),                     // e.g. "Form 4"
  feePerMonth: z.record(z.number()).optional(),    // keyed by entity type, office currency
  requestWindow: periodSchema.optional(),          // window (from trigger) in which the request may be filed
  feeFromDateOverride: z.string().optional(),      // e.g. US MPEP 706.07(f): fees run from advisory-action date
  note: z.string().optional()
})

const consequenceSchema = z.object({
  type: z.string().min(1),                         // e.g. "DEEMED_ABANDONED", "LAPSED", "TREATED_REFUSED"
  basis: z.string().optional(),                    // statute/rule, e.g. "Section 21(1)"
  revivable: z.boolean().optional(),
  note: z.string().optional()
})

const deadlineRuleSchema = z.object({
  id: z.string().min(1),                           // stable key, e.g. "fer_reply", "form3_update"
  instrument: z.string().min(1),                   // instrument id this rule attaches to
  trigger: z.string().min(1),                      // extracted date field, e.g. "dateOfReport", "hearingDate"
  period: periodSchema,
  what: z.string().optional(),                     // human label, e.g. "written submissions"
  basis: z.string().optional(),                    // e.g. "Rule 24B(5)"
  extension: extensionSchema.optional(),
  consequence: consequenceSchema.optional()
})

const counterSchema = z.object({
  id: z.string().min(1),                           // e.g. "reports_before_rce" (Canada)
  limit: z.number().int().min(1),
  gate: z.string().optional(),                     // what unlocks continuation, e.g. "RCE"
  note: z.string().optional()
})

const caseLawSchema = z.object({
  name: z.string().min(1),
  citation: z.string().optional(),
  point: z.string().optional(),
  // Sub-clauses this authority speaks to (e.g. ["3d"]). Omit when it applies to
  // the whole objection type — a Section 3(d) reply must not be handed the
  // Section 3(k) authority just because both hang off ELIGIBILITY.
  subTypes: z.array(z.string().min(1)).optional()
})

const objectionSchema = z.object({
  canonical: z.enum(CANONICAL_OBJECTION_CODES),
  localLabel: z.string().optional(),
  legalBasis: z.array(z.string().min(1)).min(1),
  citationDriven: z.boolean().optional(),          // objection argues from cited documents (D1…Dn)
  detectionHints: z.array(z.string()).optional(),  // classifier anchors for this office's phrasing
  responseType: z.enum(['SUBSTANTIVE', 'PROCEDURAL']).optional(),
  track: z.enum(['SUBSTANTIVE', 'FORMAL']).optional(), // e.g. US rejection (appeal) vs objection (petition)
  doctrine: z.string().optional(),                 // key into doctrines map
  strategies: z.array(z.string()).optional(),      // e.g. ["DISTINGUISH_ART", "AMEND_CLAIMS", "BOTH"]
  argumentSkeleton: z.string().optional(),
  guidance: z.string().optional(),
  actions: z.array(z.string()).optional(),         // procedural to-dos, e.g. "File updated Form 3"
  subTypes: z.array(z.object({
    id: z.string().min(1),
    basis: z.string().optional(),
    guidance: z.string().optional()
  })).optional(),
  // The ONLY authorities the drafter may cite for this objection type.
  caseLawWhitelist: z.array(caseLawSchema).optional()
})

const doctrineSchema = z.object({
  steps: z.array(z.string().min(1)).min(1),        // ordered argumentation framework the drafter must follow
  styleNotes: z.string().optional(),
  leadingCases: z.array(caseLawSchema).optional()
})

const amendmentsSchema = z.object({
  legalBasis: z.array(z.string().min(1)).min(1),
  scopeRule: z.string().min(1),                    // the added-matter / scope constraint, verbatim
  basisRequired: z.boolean(),                      // every amendment must cite spec support
  voluntaryForm: z.object({
    form: z.string().min(1),
    requiredForOaReply: z.boolean().optional()
  }).optional(),
  format: z.object({
    markedCopy: z.boolean(),
    cleanCopy: z.boolean(),
    markStyle: z.string().optional(),              // e.g. "underline-strikethrough"
    statusIdentifiers: z.array(z.string()).optional(), // e.g. US 1.121 closed set
    note: z.string().optional()
  })
})

const citationsSchema = z.object({
  labels: z.string().optional(),                   // e.g. "D1, D2, …"
  patentNumberFormats: z.array(z.string()).optional(), // regex sources for cited doc numbers
  nplAllowed: z.boolean().optional()
})

const responseSchema = z.object({
  skeleton: z.array(z.string().min(1)).min(1),     // ordered section ids the generator must fill
  tone: z.string().optional(),
  phrases: z.record(z.string()).optional(),        // named boilerplate, e.g. opening / prayer
  export: z.object({
    formats: z.array(z.string()).optional(),
    headingStyle: z.string().optional(),
    // Presentation formatting for the reply document (all optional — sensible defaults apply).
    formatting: z.object({
      font: z.string().optional(),               // e.g. "Times New Roman"
      fontSizePt: z.number().optional(),         // body point size, e.g. 12
      lineSpacing: z.number().optional(),        // e.g. 1.15, 1.5
      justify: z.boolean().optional(),
      marginCm: z.number().optional(),           // page margin
      numberedSections: z.boolean().optional(),  // 1 / 1.1 / 2.1 hierarchy
      restateExaminerObjection: z.boolean().optional(), // show "Examiner's objection:" per objection
      salutation: z.string().optional(),         // e.g. "Sir/Madam,"
      sectionTitles: z.record(z.string()).optional() // override default block titles
    }).optional()
  }).optional()
})

const hearingSchema = z.object({
  available: z.boolean(),
  trigger: z.string().optional(),
  writtenSubmissionsAfter: periodSchema.optional(),
  adjournment: z.object({
    requestBefore: periodSchema.optional(),
    max: z.number().int().min(0).optional(),
    eachUpTo: periodSchema.optional(),
    basis: z.string().optional()
  }).optional(),
  guidance: z.string().optional()
})

export const officeActionProfileSchema = z.object({
  profileVersion: z.string().min(1),
  meta: z.object({
    code: z.string().min(2).max(3),
    office: z.string().min(1),
    moduleLabel: z.string().min(1),                // UI name per jurisdiction, e.g. "FER Response"
    languages: z.array(z.string()).min(1),
    lawVersion: z.string().min(1),
    reviewedOn: z.string().refine(v => !isNaN(Date.parse(v)), { message: 'Invalid ISO date string' }),
    status: z.enum(['draft', 'active'])
  }),
  instruments: z.array(instrumentSchema).min(1),
  timeline: z.object({
    deadlines: z.array(deadlineRuleSchema).min(1)
  }),
  prosecution: z.object({
    model: z.enum(PROSECUTION_DEADLINE_MODELS),
    counters: z.array(counterSchema).optional(),
    note: z.string().optional()
  }),
  objections: z.array(objectionSchema).min(1),
  doctrines: z.record(doctrineSchema).optional(),
  amendments: amendmentsSchema,
  citations: citationsSchema.optional(),
  response: responseSchema,
  hearing: hearingSchema.optional(),
  // Per-pipeline-stage prompt overlays, merged over global stage prompts.
  // Values may be a string or a nested record (e.g. OA_ARGUE keyed by canonical code).
  prompts: z.record(z.union([z.string(), z.record(z.string())])).optional()
})

export type OfficeActionProfile = z.infer<typeof officeActionProfileSchema>

export interface OaValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * Validates the officeActionProfile block. Structural (zod) + semantic checks.
 */
export function validateOfficeActionProfile(block: any): OaValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const result = officeActionProfileSchema.safeParse(block)
  if (!result.success) {
    result.error.errors.forEach(e => {
      errors.push(`officeActionProfile.${e.path.join('.')}: ${e.message}`)
    })
    return { valid: false, errors, warnings }
  }

  const profile = result.data
  const instrumentIds = new Set(profile.instruments.map(i => i.id))

  // Every deadline must attach to a declared instrument
  profile.timeline.deadlines.forEach(d => {
    if (!instrumentIds.has(d.instrument)) {
      errors.push(`timeline.deadlines "${d.id}" references unknown instrument "${d.instrument}"`)
    }
  })

  // Deadline ids must be unique
  const deadlineIds = profile.timeline.deadlines.map(d => d.id)
  const dupes = deadlineIds.filter((id, i) => deadlineIds.indexOf(id) !== i)
  if (dupes.length > 0) errors.push(`timeline.deadlines has duplicate ids: ${Array.from(new Set(dupes)).join(', ')}`)

  // Every objection.doctrine must resolve in the doctrines map
  const doctrineKeys = new Set(Object.keys(profile.doctrines || {}))
  profile.objections.forEach(o => {
    if (o.doctrine && !doctrineKeys.has(o.doctrine)) {
      errors.push(`objections[${o.canonical}].doctrine "${o.doctrine}" not found in doctrines`)
    }
  })

  // One canonical code per profile entry (subTypes handle variants)
  const canonicals = profile.objections.map(o => o.canonical)
  const dupCanonicals = canonicals.filter((c, i) => canonicals.indexOf(c) !== i)
  if (dupCanonicals.length > 0) {
    warnings.push(`objections has duplicate canonical codes: ${Array.from(new Set(dupCanonicals)).join(', ')} — use subTypes for variants`)
  }

  if (profile.meta.code.toUpperCase() !== profile.meta.code) {
    warnings.push('meta.code should be uppercase')
  }

  return { valid: errors.length === 0, errors, warnings }
}

export interface OaReadinessCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail?: string
}

export interface OaReadiness {
  ready: boolean
  status: 'active' | 'draft' | 'absent'
  checks: OaReadinessCheck[]
}

/**
 * Readiness mirrors what the OA pipeline actually needs to run — a 'fail'
 * means some pipeline stage would throw or produce garbage. Pure function;
 * DB-loading wrappers live in country-readiness-service.
 */
export function computeOaReadiness(block: any): OaReadiness {
  const checks: OaReadinessCheck[] = []

  if (!block) {
    return {
      ready: false,
      status: 'absent',
      checks: [{ id: 'oa-profile', label: 'Office action profile present', status: 'fail', detail: 'No officeActionProfile block in the country profile' }]
    }
  }

  const validation = validateOfficeActionProfile(block)
  if (!validation.valid) {
    return {
      ready: false,
      status: block?.meta?.status === 'active' ? 'active' : 'draft',
      checks: [{ id: 'oa-valid', label: 'Office action profile valid', status: 'fail', detail: validation.errors.slice(0, 5).join('; ') }]
    }
  }
  checks.push({ id: 'oa-valid', label: 'Office action profile valid', status: 'pass' })

  const profile = block as OfficeActionProfile

  // Intake: at least one instrument must be detectable
  const detectable = profile.instruments.filter(i => (i.detectionHints || []).length > 0)
  checks.push(
    detectable.length > 0
      ? { id: 'oa-instruments', label: 'Detectable instruments configured', status: 'pass', detail: `${detectable.length}/${profile.instruments.length} with detection hints` }
      : { id: 'oa-instruments', label: 'Detectable instruments configured', status: 'fail', detail: 'No instrument has detectionHints — intake cannot classify uploads' }
  )

  // Deadlines: every instrument with a deadline; at least one consequence-bearing rule
  const withConsequence = profile.timeline.deadlines.some(d => d.consequence)
  checks.push(
    withConsequence
      ? { id: 'oa-deadlines', label: 'Deadline rules with consequences', status: 'pass' }
      : { id: 'oa-deadlines', label: 'Deadline rules with consequences', status: 'warn', detail: 'No deadline declares a consequence — the deadline banner loses its warning tier' }
  )

  // Classification: core substantive objections must be mapped
  const codes = new Set(profile.objections.map(o => o.canonical))
  const missingCore = (['NOVELTY', 'INVENTIVE_STEP'] as const).filter(c => !codes.has(c))
  checks.push(
    missingCore.length === 0
      ? { id: 'oa-objections', label: 'Core objection taxonomy mapped', status: 'pass', detail: `${codes.size} canonical codes` }
      : { id: 'oa-objections', label: 'Core objection taxonomy mapped', status: 'fail', detail: `Missing: ${missingCore.join(', ')}` }
  )

  // Amendments guard is mandatory (added-matter check depends on it)
  checks.push(
    profile.amendments.scopeRule.length > 0
      ? { id: 'oa-amendments', label: 'Amendment scope rule present', status: 'pass' }
      : { id: 'oa-amendments', label: 'Amendment scope rule present', status: 'fail' }
  )

  // Drafting: response skeleton drives the generator
  checks.push(
    profile.response.skeleton.length >= 3
      ? { id: 'oa-skeleton', label: 'Response skeleton configured', status: 'pass', detail: `${profile.response.skeleton.length} sections` }
      : { id: 'oa-skeleton', label: 'Response skeleton configured', status: 'fail', detail: 'Skeleton needs at least an opening, an objection-wise section and a closing' }
  )

  // Prompts for the two LLM-critical stages
  const promptKeys = new Set(Object.keys(profile.prompts || {}))
  const missingPrompts = ['OA_CLASSIFY', 'OA_DRAFT_SECTION'].filter(k => !promptKeys.has(k))
  checks.push(
    missingPrompts.length === 0
      ? { id: 'oa-prompts', label: 'Stage prompt overlays present', status: 'pass' }
      : { id: 'oa-prompts', label: 'Stage prompt overlays present', status: 'fail', detail: `Missing: ${missingPrompts.join(', ')}` }
  )

  // Recommended (warn-level)
  if (!profile.doctrines || Object.keys(profile.doctrines).length === 0) {
    checks.push({ id: 'oa-doctrines', label: 'Doctrine frameworks', status: 'warn', detail: 'No doctrines — argument generation falls back to generic reasoning' })
  }
  const anyWhitelist = profile.objections.some(o => (o.caseLawWhitelist || []).length > 0)
  if (!anyWhitelist) {
    checks.push({ id: 'oa-caselaw', label: 'Case-law whitelists', status: 'warn', detail: 'No whitelists — drafter will cite no authority at all' })
  }
  if (!profile.citations) {
    checks.push({ id: 'oa-citations', label: 'Citation conventions', status: 'warn', detail: 'No citation conventions — resolver uses generic number patterns' })
  }

  return {
    ready: checks.every(c => c.status !== 'fail'),
    status: profile.meta.status === 'active' ? 'active' : 'draft',
    checks
  }
}
