/**
 * Plan Catalog - Single Source of Truth
 *
 * Defines the commercial ladder (TRIAL -> BASIC -> PRO -> ENTERPRISE) together with
 * everything each plan grants: which features are switched on, the completion and
 * token quotas per feature, which LLM model classes the plan may use, and the
 * published price.
 *
 * Consumed by:
 * - `scripts/seed-plans-v2.ts` (writes this catalog into the database)
 * - `src/lib/plan-pricing-service.ts` (fallback when PlanPricing rows are missing)
 * - `src/app/api/v1/admin/plans` (reset-to-catalog + shape of the admin editor)
 *
 * IMPORTANT - plan codes are frozen. `FREE_PLAN` is the *Basic* paid tier; the code is
 * kept for backward compatibility with existing TenantPlan/Subscription rows. Renaming
 * it would orphan paying tenants, so only `name` changes.
 *
 * IMPORTANT - a feature that is absent from a plan is *denied*, and a feature whose
 * quotas are all null is also denied (see `checkServiceQuota`'s `hasAnyLimit` guard in
 * `service-usage-tracker.ts`). "Unlimited" must therefore be expressed as a large
 * explicit number, never as null.
 */

import type { FeatureCode, ModelClass, TaskCode } from '@prisma/client'

// ============================================================================
// Plan codes
// ============================================================================

export const PLAN_CODES = ['TRIAL', 'FREE_PLAN', 'PRO_PLAN', 'ENTERPRISE_PLAN'] as const
export type PlanCatalogCode = (typeof PLAN_CODES)[number]

/** Public-facing SKU code used by the pricing page and Razorpay. */
export const PLAN_CODE_TO_PUBLIC: Record<PlanCatalogCode, string> = {
  TRIAL: 'TRIAL',
  FREE_PLAN: 'BASIC',
  PRO_PLAN: 'PRO',
  ENTERPRISE_PLAN: 'ENTERPRISE',
}

export const PUBLIC_TO_PLAN_CODE: Record<string, PlanCatalogCode> = {
  TRIAL: 'TRIAL',
  BASIC: 'FREE_PLAN',
  PRO: 'PRO_PLAN',
  ENTERPRISE: 'ENTERPRISE_PLAN',
}

// ============================================================================
// Feature catalog
// ============================================================================

export interface FeatureDefinition {
  code: FeatureCode
  name: string
  /** Unit stored on the Feature row, shown in the admin UI. */
  unit: string
  /** Short description surfaced in the super-admin plan editor. */
  description: string
}

export const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    code: 'PATENT_DRAFTING',
    name: 'AI-Assisted Patent Drafting',
    unit: 'drafts',
    description: 'Full drafting pipeline. Counted once description + claims are complete.',
  },
  {
    code: 'PRIOR_ART_SEARCH',
    name: 'Prior Art Search',
    unit: 'searches',
    description: 'In-pipeline prior art retrieval. Internal meter - keep generous.',
  },
  {
    code: 'NOVELTY_SEARCH',
    name: 'Standalone Novelty Search',
    unit: 'searches',
    description: 'Novelty Search + Prior-Art Studio runs. Highest external API cost.',
  },
  {
    code: 'IDEATION',
    name: 'Patent Ideation Engine',
    unit: 'sessions',
    description: 'Seven-stage mind-map ideation with TRIZ contradiction mapping.',
  },
  {
    code: 'IDEA_BANK',
    name: 'Idea Bank',
    unit: 'reservations',
    description: 'Browse, reserve and edit ideas from the shared idea bank.',
  },
  {
    code: 'DIAGRAM_GENERATION',
    name: 'Diagrams & Sketches',
    unit: 'diagrams',
    description: 'Figure generation, sketch generation and diagram image analysis.',
  },
  {
    code: 'PATENT_REVIEW',
    name: 'AI Patent Review',
    unit: 'reviews',
    description: 'AI review pass over a drafted specification.',
  },
  {
    code: 'OFFICE_ACTION_RESPONSE',
    name: 'Office Action Studio',
    unit: 'responses',
    description: 'FER/OA parsing, claim charting and response drafting.',
  },
  {
    code: 'PERSONA_SYNC',
    name: 'PersonaSync Style Learning',
    unit: 'trainings',
    description: 'Learns a firm/attorney drafting style from writing samples.',
  },
]

export const FEATURE_CODES = FEATURE_DEFINITIONS.map((f) => f.code)

// ============================================================================
// Per-plan grants
// ============================================================================

export interface FeatureGrant {
  /** Completed operations allowed per calendar month. */
  monthlyQuota: number
  /** Completed operations allowed per UTC day. */
  dailyQuota: number
  /** Token ceiling per month - guards against regeneration abuse. Null = no token cap. */
  monthlyTokenLimit?: number | null
  /** Token ceiling per day. Null = no token cap. */
  dailyTokenLimit?: number | null
}

export interface PlanDefinition {
  code: PlanCatalogCode
  name: string
  /** Razorpay/DB billing cycle. */
  cycle: 'MONTHLY' | 'YEARLY' | 'ONE_TIME'
  /** Ordering in pricing tables and the admin UI. */
  tier: number
  tagline: string
  /** True when the plan is sold one-to-one and must not publish a price. */
  isCustomPriced: boolean
  /** Trial length in days. Only meaningful for TRIAL. */
  trialDays?: number
  /** Seats included. Enforced via PolicyRule `max_seats`. */
  seats: number
  /** Jurisdictions allowed per patent. Enforced via PolicyRule `max_jurisdictions_per_patent`. */
  maxJurisdictionsPerPatent: number
  /** LLM model classes the plan may use, and the default pick. */
  modelClasses: { allowed: ModelClass[]; default: ModelClass }
  /** Feature grants. A feature omitted here is NOT included in the plan and will be denied. */
  features: Partial<Record<FeatureCode, FeatureGrant>>
}

/**
 * Quotas are sized against unit economics, not aspiration. Pro is $20/mo, so it sits on
 * PRO_M and below - PRO_L/ADVANCED drafting would exceed the subscription price within a
 * handful of drafts. Enterprise is negotiated per customer, so its numbers here are the
 * starting point a super admin edits per deal.
 */
export const PLAN_CATALOG: PlanDefinition[] = [
  {
    code: 'TRIAL',
    name: 'Trial',
    cycle: 'ONE_TIME',
    tier: 0,
    tagline: '14 days to run one invention end to end.',
    isCustomPriced: false,
    trialDays: 14,
    seats: 1,
    maxJurisdictionsPerPatent: 1,
    modelClasses: { allowed: ['BASE_S', 'BASE_M'], default: 'BASE_M' },
    features: {
      PATENT_DRAFTING: { monthlyQuota: 1, dailyQuota: 1, monthlyTokenLimit: 300_000, dailyTokenLimit: 150_000 },
      PRIOR_ART_SEARCH: { monthlyQuota: 30, dailyQuota: 10 },
      NOVELTY_SEARCH: { monthlyQuota: 2, dailyQuota: 1 },
      IDEATION: { monthlyQuota: 2, dailyQuota: 1, monthlyTokenLimit: 400_000, dailyTokenLimit: 200_000 },
      IDEA_BANK: { monthlyQuota: 3, dailyQuota: 2 },
      DIAGRAM_GENERATION: { monthlyQuota: 5, dailyQuota: 3 },
      PATENT_REVIEW: { monthlyQuota: 1, dailyQuota: 1 },
      // OFFICE_ACTION_RESPONSE and PERSONA_SYNC intentionally excluded.
    },
  },
  {
    code: 'FREE_PLAN',
    name: 'Basic',
    cycle: 'MONTHLY',
    tier: 1,
    tagline: 'For solo inventors filing a few applications a year.',
    isCustomPriced: false,
    seats: 1,
    maxJurisdictionsPerPatent: 1,
    modelClasses: { allowed: ['BASE_S', 'BASE_M'], default: 'BASE_M' },
    features: {
      PATENT_DRAFTING: { monthlyQuota: 1, dailyQuota: 1, monthlyTokenLimit: 600_000, dailyTokenLimit: 200_000 },
      PRIOR_ART_SEARCH: { monthlyQuota: 100, dailyQuota: 20 },
      NOVELTY_SEARCH: { monthlyQuota: 3, dailyQuota: 2 },
      IDEATION: { monthlyQuota: 2, dailyQuota: 1, monthlyTokenLimit: 600_000, dailyTokenLimit: 250_000 },
      IDEA_BANK: { monthlyQuota: 5, dailyQuota: 3 },
      DIAGRAM_GENERATION: { monthlyQuota: 8, dailyQuota: 4 },
      PATENT_REVIEW: { monthlyQuota: 1, dailyQuota: 1 },
      // OFFICE_ACTION_RESPONSE and PERSONA_SYNC intentionally excluded.
    },
  },
  {
    code: 'PRO_PLAN',
    name: 'Pro',
    cycle: 'MONTHLY',
    tier: 2,
    tagline: 'The working tier - ideation through prosecution.',
    isCustomPriced: false,
    seats: 3,
    maxJurisdictionsPerPatent: 2,
    modelClasses: { allowed: ['BASE_S', 'BASE_M', 'PRO_M'], default: 'PRO_M' },
    features: {
      PATENT_DRAFTING: { monthlyQuota: 3, dailyQuota: 2, monthlyTokenLimit: 2_500_000, dailyTokenLimit: 800_000 },
      PRIOR_ART_SEARCH: { monthlyQuota: 300, dailyQuota: 50 },
      NOVELTY_SEARCH: { monthlyQuota: 10, dailyQuota: 4 },
      IDEATION: { monthlyQuota: 8, dailyQuota: 3, monthlyTokenLimit: 2_500_000, dailyTokenLimit: 800_000 },
      IDEA_BANK: { monthlyQuota: 25, dailyQuota: 10 },
      DIAGRAM_GENERATION: { monthlyQuota: 30, dailyQuota: 10 },
      PATENT_REVIEW: { monthlyQuota: 5, dailyQuota: 3 },
      OFFICE_ACTION_RESPONSE: { monthlyQuota: 2, dailyQuota: 1 },
      // PERSONA_SYNC stays an Enterprise differentiator.
    },
  },
  {
    code: 'ENTERPRISE_PLAN',
    name: 'Enterprise',
    cycle: 'MONTHLY',
    tier: 3,
    tagline: 'Negotiated per organisation. Everything on, tuned per deal.',
    isCustomPriced: true,
    seats: 5,
    maxJurisdictionsPerPatent: 6,
    modelClasses: { allowed: ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED'], default: 'ADVANCED' },
    features: {
      PATENT_DRAFTING: { monthlyQuota: 25, dailyQuota: 5, monthlyTokenLimit: null, dailyTokenLimit: null },
      PRIOR_ART_SEARCH: { monthlyQuota: 5_000, dailyQuota: 500 },
      NOVELTY_SEARCH: { monthlyQuota: 100, dailyQuota: 20 },
      IDEATION: { monthlyQuota: 50, dailyQuota: 15, monthlyTokenLimit: null, dailyTokenLimit: null },
      IDEA_BANK: { monthlyQuota: 200, dailyQuota: 50 },
      DIAGRAM_GENERATION: { monthlyQuota: 200, dailyQuota: 50 },
      PATENT_REVIEW: { monthlyQuota: 40, dailyQuota: 10 },
      OFFICE_ACTION_RESPONSE: { monthlyQuota: 15, dailyQuota: 5 },
      PERSONA_SYNC: { monthlyQuota: 20, dailyQuota: 5 },
    },
  },
]

export const PLAN_BY_CODE: Record<PlanCatalogCode, PlanDefinition> = Object.fromEntries(
  PLAN_CATALOG.map((p) => [p.code, p])
) as Record<PlanCatalogCode, PlanDefinition>

// ============================================================================
// Pricing
// ============================================================================

export interface PlanPriceDefinition {
  /** USD in cents. Null when the plan is sold one-to-one. */
  priceUSD: number | null
  /** INR in paise. Null when the plan is sold one-to-one. */
  priceINR: number | null
}

export interface PlanPricingDefinition {
  monthly: PlanPriceDefinition
  yearly: PlanPriceDefinition
  /** Months free on the annual plan. 2 = pay for 10, get 12. */
  yearlyDiscountMonths: number
}

/**
 * Annual pricing gives two months free (pay 10, get 12), matching the ~20% that
 * ClaimMaster and Patsnap discount by. Enterprise publishes no price.
 *
 * INR is pegged at a flat **1:100** to USD. Spot was ₹96.36/USD on 2026-07-21, so the
 * peg carries a ~3.8% buffer against FX drift and payment-processing spread, and lands
 * every tier on a clean charm price. Both tiers use the same rate - an earlier revision
 * of this file implied 1:83 on Basic and 1:75 on Pro, which was simply wrong.
 *
 * These are the fallback values. Live prices are the `PlanPricing` rows, editable at
 * /super-admin/plans - repeg there when the rupee moves, no deploy needed.
 */
export const PLAN_PRICING_CATALOG: Record<PlanCatalogCode, PlanPricingDefinition> = {
  TRIAL: {
    monthly: { priceUSD: 0, priceINR: 0 },
    yearly: { priceUSD: 0, priceINR: 0 },
    yearlyDiscountMonths: 0,
  },
  FREE_PLAN: {
    monthly: { priceUSD: 900, priceINR: 89_900 }, // $9 / ₹899
    yearly: { priceUSD: 9_000, priceINR: 899_000 }, // $90 / ₹8,990
    yearlyDiscountMonths: 2,
  },
  PRO_PLAN: {
    monthly: { priceUSD: 2_000, priceINR: 199_900 }, // $20 / ₹1,999
    yearly: { priceUSD: 20_000, priceINR: 1_999_000 }, // $200 / ₹19,990
    yearlyDiscountMonths: 2,
  },
  ENTERPRISE_PLAN: {
    monthly: { priceUSD: null, priceINR: null },
    yearly: { priceUSD: null, priceINR: null },
    yearlyDiscountMonths: 2,
  },
}

// ============================================================================
// LLM task coverage
// ============================================================================

/**
 * Every TaskCode a plan can be granted. The seed expands `modelClasses` across this list
 * so a plan never has a task without an access rule (which would fall through to the
 * gateway's default and silently ignore the tier).
 */
export const ALL_TASK_CODES: TaskCode[] = [
  'LLM1_PRIOR_ART',
  'LLM2_DRAFT',
  'LLM3_DIAGRAM',
  'LLM4_NOVELTY_SCREEN',
  'LLM5_NOVELTY_ASSESS',
  'LLM6_REPORT_GENERATION',
  'LLM1_CLAIM_REFINEMENT',
  'LLM7_ADVANCED_MANUAL_SEARCH',
  'LLM8_OA_RESPONSE',
  'IDEA_BANK_ACCESS',
  'IDEA_BANK_RESERVE',
  'IDEA_BANK_EDIT',
  'PERSONA_SYNC_LEARN',
  'IDEATION_NORMALIZE',
  'IDEATION_CLASSIFY',
  'IDEATION_CONTRADICTION_MAPPING',
  'IDEATION_EXPAND',
  'IDEATION_OBVIOUSNESS_FILTER',
  'IDEATION_GENERATE',
  'IDEATION_NOVELTY',
]

/** Which feature each task bills against - drives the Task.linkedFeatureId rows. */
export const TASK_TO_FEATURE: Record<TaskCode, FeatureCode> = {
  LLM1_PRIOR_ART: 'PRIOR_ART_SEARCH',
  LLM2_DRAFT: 'PATENT_DRAFTING',
  LLM3_DIAGRAM: 'DIAGRAM_GENERATION',
  LLM4_NOVELTY_SCREEN: 'NOVELTY_SEARCH',
  LLM5_NOVELTY_ASSESS: 'NOVELTY_SEARCH',
  LLM6_REPORT_GENERATION: 'NOVELTY_SEARCH',
  LLM1_CLAIM_REFINEMENT: 'PATENT_DRAFTING',
  LLM7_ADVANCED_MANUAL_SEARCH: 'NOVELTY_SEARCH',
  LLM8_OA_RESPONSE: 'OFFICE_ACTION_RESPONSE',
  IDEA_BANK_ACCESS: 'IDEA_BANK',
  IDEA_BANK_RESERVE: 'IDEA_BANK',
  IDEA_BANK_EDIT: 'IDEA_BANK',
  PERSONA_SYNC_LEARN: 'PERSONA_SYNC',
  IDEATION_NORMALIZE: 'IDEATION',
  IDEATION_CLASSIFY: 'IDEATION',
  IDEATION_CONTRADICTION_MAPPING: 'IDEATION',
  IDEATION_EXPAND: 'IDEATION',
  IDEATION_OBVIOUSNESS_FILTER: 'IDEATION',
  IDEATION_GENERATE: 'IDEATION',
  IDEATION_NOVELTY: 'IDEATION',
}

/** Human labels for the task codes, used by the admin editor. */
export const TASK_LABELS: Record<TaskCode, string> = {
  LLM1_PRIOR_ART: 'Prior Art Search',
  LLM2_DRAFT: 'Patent Drafting',
  LLM3_DIAGRAM: 'Diagram Generation',
  LLM4_NOVELTY_SCREEN: 'Novelty Screening',
  LLM5_NOVELTY_ASSESS: 'Novelty Assessment',
  LLM6_REPORT_GENERATION: 'Report Generation',
  LLM1_CLAIM_REFINEMENT: 'Claim Refinement',
  LLM7_ADVANCED_MANUAL_SEARCH: 'Advanced Manual Search',
  LLM8_OA_RESPONSE: 'Office Action Response',
  IDEA_BANK_ACCESS: 'Idea Bank Access',
  IDEA_BANK_RESERVE: 'Idea Reservation',
  IDEA_BANK_EDIT: 'Idea Editing',
  PERSONA_SYNC_LEARN: 'Style Learning',
  IDEATION_NORMALIZE: 'Seed Normalization',
  IDEATION_CLASSIFY: 'Invention Classification',
  IDEATION_CONTRADICTION_MAPPING: 'Contradiction Mapping',
  IDEATION_EXPAND: 'Dimension Expansion',
  IDEATION_OBVIOUSNESS_FILTER: 'Obviousness Filter',
  IDEATION_GENERATE: 'Idea Frame Generation',
  IDEATION_NOVELTY: 'Novelty Gate',
}

/** Model classes in ascending capability order. */
export const MODEL_CLASS_ORDER: ModelClass[] = ['BASE_S', 'BASE_M', 'PRO_M', 'PRO_L', 'ADVANCED']

// ============================================================================
// Policy limits (seats, jurisdictions) - stored as PolicyRule rows
// ============================================================================

export const POLICY_KEYS = {
  MAX_SEATS: 'max_seats',
  MAX_JURISDICTIONS: 'max_jurisdictions_per_patent',
} as const

/**
 * Resolve the tasks a plan should be granted: only those whose linked feature is
 * actually included in the plan. A plan without OFFICE_ACTION_RESPONSE therefore gets
 * no LLM8_OA_RESPONSE rule, so the gateway denies it too.
 */
export function tasksForPlan(plan: PlanDefinition): TaskCode[] {
  return ALL_TASK_CODES.filter((task) => plan.features[TASK_TO_FEATURE[task]] !== undefined)
}
