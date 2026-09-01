// Attorney-language grouping for the Check Coverage feature.
//
// Support entries carry machine sourceField strings like
// "sourceFactLedger.numericValuesAndUnits"; the coverage UI must never show
// those. This map projects every sourceField the support machinery produces
// (see supportEntriesFromContext in preliminary-claim-generation.ts) onto a
// small set of stable category keys with human labels. Lives in the engine
// layer so grouping is computed once and testable, not re-derived per client.

export type CoverageCategory = {
  key: string
  label: string
  hint: string
}

const CATEGORY_DEFS: Record<string, Omit<CoverageCategory, 'key'>> = {
  components: {
    label: 'Components & parts',
    hint: 'Physical parts, modules, and sub-assemblies you described.',
  },
  numbers: {
    label: 'Numbers & measurements',
    hint: 'Dimensions, ranges, thresholds, and other stated values.',
  },
  processSteps: {
    label: 'Process steps',
    hint: 'Method, operation, and preparation steps you described.',
  },
  conditions: {
    label: 'Conditions & rules',
    hint: 'When/if rules, triggers, and operating conditions.',
  },
  materials: {
    label: 'Materials & compositions',
    hint: 'Materials, formulations, and constituents you named.',
  },
  alternatives: {
    label: 'Variations & alternatives',
    hint: 'Optional features, variants, and alternative arrangements.',
  },
  examples: {
    label: 'Examples & use cases',
    hint: 'Scenarios, trials, and applications you described.',
  },
  safety: {
    label: 'Safety & fallback rules',
    hint: 'Safety behavior, shutdowns, fallbacks, and expiry rules.',
  },
  dataFields: {
    label: 'Data & records',
    hint: 'Data fields, identifiers, and recorded values.',
  },
  claimable: {
    label: 'Claimable features',
    hint: 'Features identified as claim-worthy from your disclosure.',
  },
  fallbackPositions: {
    label: 'Fallback positions',
    hint: 'Narrowing limitations kept in reserve for dependent claims.',
  },
  story: {
    label: 'Problem & solution story',
    hint: 'The problem, objectives, and core concept you stated.',
  },
  scopedElements: {
    label: 'Scoped elements',
    hint: 'Elements you selected for the claims at Stage 0.',
  },
  supportFacts: {
    label: 'Supporting facts',
    hint: 'Other supporting details captured from your disclosure.',
  },
}

// sourceFactLedger.<category> → category key
const LEDGER_CATEGORY_MAP: Record<string, string> = {
  componentsAndSubcomponents: 'components',
  materialsOrCompositions: 'materials',
  processSteps: 'processSteps',
  numericValuesAndUnits: 'numbers',
  conditionsAndRules: 'conditions',
  alternativesAndEmbodiments: 'alternatives',
  examplesAndUseCases: 'examples',
  safetyFallbackOrExpiryRules: 'safety',
  dataFieldsOrMetadata: 'dataFields',
  claimSeeds: 'claimable',
  notStated: 'supportFacts',
}

// supportDataSources.<kind> → category key
const SDS_KIND_MAP: Record<string, string> = {
  component: 'components',
  subcomponent: 'components',
  process_step: 'processSteps',
  material: 'materials',
  composition: 'materials',
  numeric_value: 'numbers',
  condition: 'conditions',
  alternative: 'alternatives',
  example: 'examples',
  table: 'dataFields',
  equation: 'numbers',
  data_schema: 'dataFields',
  algorithm: 'processSteps',
  figure: 'supportFacts',
  test_result: 'examples',
  bio_sequence: 'materials',
  deposit: 'materials',
  advantage: 'story',
  other: 'supportFacts',
}

const DIRECT_FIELD_MAP: Record<string, string> = {
  components: 'components',
  problem: 'story',
  objectives: 'story',
  logic: 'story',
  coreInventiveConcept: 'story',
  claimableFeatures: 'claimable',
  fallbackLimitations: 'fallbackPositions',
  doNotClaim: 'supportFacts',
}

export function coverageCategoryKeyForSourceField(sourceField: string): string {
  const field = String(sourceField || '').trim()
  if (field.startsWith('sourceFactLedger.')) {
    return LEDGER_CATEGORY_MAP[field.slice('sourceFactLedger.'.length)] || 'supportFacts'
  }
  if (field.startsWith('supportDataSources.')) {
    return SDS_KIND_MAP[field.slice('supportDataSources.'.length)] || 'supportFacts'
  }
  if (field.startsWith('scopeRecommendations.')) {
    return 'scopedElements'
  }
  return DIRECT_FIELD_MAP[field] || 'supportFacts'
}

export function coverageCategory(key: string): CoverageCategory {
  const def = CATEGORY_DEFS[key] || CATEGORY_DEFS.supportFacts
  return { key: CATEGORY_DEFS[key] ? key : 'supportFacts', ...def }
}

/** Display order for grouped coverage lists. */
export const COVERAGE_CATEGORY_ORDER: string[] = [
  'components',
  'numbers',
  'processSteps',
  'materials',
  'conditions',
  'safety',
  'claimable',
  'fallbackPositions',
  'scopedElements',
  'alternatives',
  'examples',
  'dataFields',
  'story',
  'supportFacts',
]
