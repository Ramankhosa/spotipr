import { validateCountryProfile, ValidationResult } from './country-profile-validation'

/**
 * Repair result interface
 */
export interface RepairResult {
  success: boolean
  repairedProfile: any | null
  repairs: RepairAction[]
  validationResult: ValidationResult
  errors: string[]
}

/**
 * Individual repair action
 */
export interface RepairAction {
  type: 'added' | 'fixed' | 'converted' | 'normalized'
  field: string
  description: string
  oldValue?: any
  newValue?: any
}

/**
 * Default values for optional fields
 */
const DEFAULT_VALUES = {
  // Meta defaults
  meta: {
    version: 1,
    status: 'active',
    inheritsFrom: null,
    tags: []
  },

  // Rules defaults
  rules: {
    global: {
      paragraphNumberingRequired: false,
      maxPagesRecommended: 100,
      allowEquations: true,
      allowTables: true
    },
    abstract: {
      wordLimit: 150,
      noBenefitsOrAdvantages: true,
      noClaimLanguage: true,
      singleParagraph: true
    },
    claims: {
      twoPartFormPreferred: false,
      allowMultipleDependent: true,
      prohibitMultipleDependentOnMultipleDependent: true,
      preferredConnectors: ['comprising'],
      discouragedConnectors: ['consisting of'],
      forbiddenPhrases: [],
      maxIndependentClaimsBeforeExtraFee: 3,
      maxTotalClaimsRecommended: 20,
      allowReferenceNumeralsInClaims: true,
      requireSupportInDescription: true,
      unityStandard: 'PCT_UNITY_OF_INVENTION'
    },
    description: {
      requireBestModeDisclosure: true,
      avoidClaimLanguage: true,
      allowReferenceNumerals: true,
      requireEmbodimentSupportForAllClaims: true,
      industrialApplicabilitySectionRequired: false
    },
    drawings: {
      requiredWhenApplicable: true,
      paperSize: 'A4',
      colorAllowed: false,
      lineStyle: 'black_and_white_solid',
      referenceNumeralsMandatoryWhenDrawings: true,
      minReferenceTextSizePt: 8,
      marginTopCm: 2.5,
      marginBottomCm: 1.0,
      marginLeftCm: 2.5,
      marginRightCm: 1.5
    },
    procedural: {
      gracePeriodMonths: 12,
      foreignFilingLicenseRequired: false,
      idsRequired: false,
      priorArtDisclosureThreshold: 'any_relevant_to_novelty_or_inventive_step',
      allowProvisionalPriority: true
    },
    language: {
      allowedLanguages: ['en'],
      requiresOfficialTranslation: false
    }
  },

  // Export defaults
  export: {
    documentTypes: [{
      id: 'spec_pdf',
      label: 'Specification PDF',
      includesSections: ['title', 'field', 'background', 'summary', 'brief_drawings', 'detailed_description', 'claims', 'abstract'],
      pageSize: 'A4',
      lineSpacing: 1.5,
      fontFamily: 'Times New Roman',
      fontSizePt: 12,
      addPageNumbers: true,
      addParagraphNumbers: false
    }],
    sectionHeadings: {
      field: 'FIELD OF THE INVENTION',
      background: 'BACKGROUND',
      summary: 'SUMMARY',
      brief_drawings: 'BRIEF DESCRIPTION OF THE DRAWINGS',
      detailed_description: 'DETAILED DESCRIPTION',
      claims: 'CLAIMS',
      abstract: 'ABSTRACT'
    }
  },

  // Diagrams defaults
  diagrams: {
    requiredWhenApplicable: true,
    supportedDiagramTypes: ['block', 'flowchart', 'schematic'],
    figureLabelFormat: 'Fig. {number}',
    autoGenerateReferenceTable: true,
    diagramGenerationHints: {}
  },

  // Cross-checks defaults
  crossChecks: {
    enableSemanticCrossCheck: true,
    checkList: []
  }
}

/**
 * Canonical keys mapping for sections
 */
const CANONICAL_KEYS_MAP: { [key: string]: string[] } = {
  title: ['title'],
  field: ['field_of_invention', 'technical_field'],
  background: ['background', 'background_art'],
  summary: ['summary_of_invention', 'disclosure_of_invention'],
  brief_drawings: ['brief_description_of_drawings'],
  detailed_description: ['detailed_description', 'modes_for_carrying_out_invention'],
  claims: ['claims'],
  abstract: ['abstract'],
  cross_reference: ['cross_reference', 'priority_data'],
  industrial_applicability: ['industrial_applicability']
}

/**
 * Recursively fill missing fields from a defaults object WITHOUT overwriting
 * anything the author provided. This is what makes a half-written block
 * (e.g. "diagrams": {} or a rules.claims missing two fields) importable —
 * a partially-present block must never be treated worse than an absent one.
 */
function fillDefaults(target: any, defaults: any, path: string, repairs: RepairAction[]): void {
  if (!target || typeof target !== 'object' || Array.isArray(target)) return
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const current = target[key]
    if (current === undefined || current === null) {
      target[key] = Array.isArray(defaultValue)
        ? [...defaultValue]
        : defaultValue && typeof defaultValue === 'object'
          ? JSON.parse(JSON.stringify(defaultValue))
          : defaultValue
      repairs.push({
        type: 'added',
        field: `${path}.${key}`,
        description: 'Added default value for missing field',
        newValue: defaultValue
      })
    } else if (
      defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue) &&
      typeof current === 'object' && !Array.isArray(current)
    ) {
      fillDefaults(current, defaultValue, `${path}.${key}`, repairs)
    }
  }
}

/**
 * Attempt to repair a country profile JSON with non-essential fixes
 */
export async function repairCountryProfile(originalProfile: any): Promise<RepairResult> {
  const repairs: RepairAction[] = []
  const errors: string[] = []

  try {
    let profile = JSON.parse(JSON.stringify(originalProfile)) // Deep clone

    // 1. Fix meta section
    repairs.push(...repairMetaSection(profile))

    // 2. Fix structure section
    repairs.push(...repairStructureSection(profile))

    // 3. Fix rules section
    repairs.push(...repairRulesSection(profile))

    // 4. Fix validation section
    repairs.push(...repairValidationSection(profile))

    // 5. Fix prompts section
    repairs.push(...repairPromptsSection(profile))

    // 6. Fix export section
    repairs.push(...repairExportSection(profile))

    // 7. Fix diagrams section
    repairs.push(...repairDiagramsSection(profile))

    // 8. Fix cross-checks section
    repairs.push(...repairCrossChecksSection(profile))

    // 9. Fix data types
    repairs.push(...fixDataTypes(profile))

    // Validate the repaired profile
    const validationResult = validateCountryProfile(profile)

    return {
      success: validationResult.errors.length === 0,
      repairedProfile: profile,
      repairs,
      validationResult,
      errors
    }

  } catch (error) {
    errors.push(`Repair failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    return {
      success: false,
      repairedProfile: null,
      repairs,
      validationResult: { valid: false, errors: [], warnings: [] },
      errors
    }
  }
}

/**
 * Repair meta section
 */
function repairMetaSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.meta) {
    profile.meta = {}
    repairs.push({
      type: 'added',
      field: 'meta',
      description: 'Added missing meta section'
    })
  }

  // Ensure required meta fields
  if (!profile.meta.id && profile.meta.code) {
    profile.meta.id = profile.meta.code
    repairs.push({
      type: 'added',
      field: 'meta.id',
      description: 'Set meta.id to match meta.code',
      newValue: profile.meta.code
    })
  }

  // Add default values for missing optional fields
  Object.entries(DEFAULT_VALUES.meta).forEach(([key, defaultValue]) => {
    if (profile.meta[key] === undefined) {
      profile.meta[key] = defaultValue
      repairs.push({
        type: 'added',
        field: `meta.${key}`,
        description: `Added default value for optional field`,
        newValue: defaultValue
      })
    }
  })

  // Required arrays that hand-written profiles often omit
  if (!Array.isArray(profile.meta.applicationTypes) || profile.meta.applicationTypes.length === 0) {
    profile.meta.applicationTypes = ['ordinary', 'PCT national phase']
    repairs.push({
      type: 'added',
      field: 'meta.applicationTypes',
      description: 'Added default application types',
      newValue: profile.meta.applicationTypes
    })
  }
  if (!Array.isArray(profile.meta.languages) || profile.meta.languages.length === 0) {
    profile.meta.languages = ['en']
    repairs.push({
      type: 'added',
      field: 'meta.languages',
      description: 'Added default languages',
      newValue: profile.meta.languages
    })
  }

  // A bare domain fails z.string().url() — prepend the protocol rather than reject
  if (typeof profile.meta.officeUrl === 'string' && profile.meta.officeUrl.trim() && !/^[a-z][a-z0-9+.-]*:\/\//i.test(profile.meta.officeUrl.trim())) {
    const fixed = `https://${profile.meta.officeUrl.trim()}`
    repairs.push({
      type: 'fixed',
      field: 'meta.officeUrl',
      description: 'Prefixed officeUrl with https://',
      oldValue: profile.meta.officeUrl,
      newValue: fixed
    })
    profile.meta.officeUrl = fixed
  }

  return repairs
}

/**
 * Repair structure section
 */
function repairStructureSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.structure) {
    profile.structure = { defaultVariant: 'standard', variants: [] }
    repairs.push({
      type: 'added',
      field: 'structure',
      description: 'Added missing structure section'
    })
  }

  if (!profile.structure.defaultVariant) {
    profile.structure.defaultVariant = 'standard'
    repairs.push({
      type: 'added',
      field: 'structure.defaultVariant',
      description: 'Added default variant',
      newValue: 'standard'
    })
  }

  if (!Array.isArray(profile.structure.variants)) {
    profile.structure.variants = []
    repairs.push({
      type: 'fixed',
      field: 'structure.variants',
      description: 'Converted variants to array',
      newValue: []
    })
  }

  // Point defaultVariant at a real variant when it references a non-existent id
  if (
    profile.structure.variants.length > 0 &&
    !profile.structure.variants.some((v: any) => v?.id === profile.structure.defaultVariant)
  ) {
    const fallbackId = profile.structure.variants[0]?.id
    if (fallbackId) {
      repairs.push({
        type: 'fixed',
        field: 'structure.defaultVariant',
        description: `defaultVariant "${profile.structure.defaultVariant}" not found in variants — set to "${fallbackId}"`,
        newValue: fallbackId
      })
      profile.structure.defaultVariant = fallbackId
    }
  }

  // Fill missing per-variant and per-section required fields so a lean,
  // hand-written structure block still passes schema validation.
  profile.structure.variants.forEach((variant: any, variantIndex: number) => {
    const vPath = `structure.variants[${variantIndex}]`
    if (variant && typeof variant === 'object') {
      if (!variant.label && variant.id) {
        variant.label = String(variant.id)
        repairs.push({ type: 'added', field: `${vPath}.label`, description: 'Defaulted variant label to its id', newValue: variant.label })
      }
      if (!variant.description) {
        variant.description = `${variant.label || variant.id || 'Standard'} specification structure`
        repairs.push({ type: 'added', field: `${vPath}.description`, description: 'Added default variant description', newValue: variant.description })
      }
    }

    if (variant.sections && Array.isArray(variant.sections)) {
      variant.sections.forEach((section: any, sectionIndex: number) => {
        const sPath = `${vPath}.sections[${sectionIndex}]`
        const sectionId = section.id
        const expectedKeys = CANONICAL_KEYS_MAP[sectionId]

        if (!Array.isArray(section.canonicalKeys) || section.canonicalKeys.length === 0) {
          // Known ids get their catalog keys; unknown ids fall back to the id
          // itself — the import resolver (aliases + synonyms) takes it from there.
          const keys = expectedKeys || (sectionId ? [String(sectionId)] : undefined)
          if (keys) {
            section.canonicalKeys = keys
            repairs.push({
              type: 'fixed',
              field: `${sPath}.canonicalKeys`,
              description: `Fixed canonical keys for section ${sectionId}`,
              newValue: keys
            })
          }
        }

        if (!section.label && sectionId) {
          section.label = String(sectionId)
            .replace(/[_-]+/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
          repairs.push({ type: 'added', field: `${sPath}.label`, description: 'Derived section label from its id', newValue: section.label })
        }
        if (typeof section.order !== 'number' || section.order < 1) {
          section.order = sectionIndex + 1
          repairs.push({ type: 'fixed', field: `${sPath}.order`, description: 'Defaulted section order to its position', newValue: section.order })
        }
        if (typeof section.required !== 'boolean') {
          section.required = ['title', 'claims', 'abstract'].includes(String(sectionId))
          repairs.push({ type: 'added', field: `${sPath}.required`, description: 'Added default required flag', newValue: section.required })
        }
        if (!['header', 'body', 'claims', 'abstract'].includes(section.group)) {
          const id = String(sectionId || '').toLowerCase()
          section.group = id.includes('claim') ? 'claims'
            : id.includes('abstract') ? 'abstract'
            : (id === 'title' || id.includes('preamble') || id.includes('cross_reference') || id.includes('crossreference')) ? 'header'
            : 'body'
          repairs.push({ type: 'added', field: `${sPath}.group`, description: 'Inferred section group from its id', newValue: section.group })
        }
      })
    }
  })

  return repairs
}

/**
 * Repair rules section
 */
function repairRulesSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.rules) {
    profile.rules = {}
    repairs.push({
      type: 'added',
      field: 'rules',
      description: 'Added missing rules section'
    })
  }

  // Add missing rule blocks with defaults, and fill missing fields inside
  // partially-written blocks (a rules.claims with two fields must not fail
  // schema validation over the other nine).
  Object.entries(DEFAULT_VALUES.rules).forEach(([ruleType, defaults]) => {
    if (!profile.rules[ruleType] || typeof profile.rules[ruleType] !== 'object') {
      profile.rules[ruleType] = JSON.parse(JSON.stringify(defaults))
      repairs.push({
        type: 'added',
        field: `rules.${ruleType}`,
        description: `Added missing ${ruleType} rules with defaults`,
        newValue: defaults
      })
    } else {
      fillDefaults(profile.rules[ruleType], defaults, `rules.${ruleType}`, repairs)
    }
  })

  return repairs
}

/**
 * Repair validation section
 */
function repairValidationSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.validation) {
    profile.validation = { sectionChecks: {}, crossSectionChecks: [] }
    repairs.push({
      type: 'added',
      field: 'validation',
      description: 'Added missing validation section'
    })
  }

  if (!profile.validation.sectionChecks) {
    profile.validation.sectionChecks = {}
    repairs.push({
      type: 'added',
      field: 'validation.sectionChecks',
      description: 'Added missing sectionChecks object'
    })
  }

  if (!Array.isArray(profile.validation.crossSectionChecks)) {
    profile.validation.crossSectionChecks = []
    repairs.push({
      type: 'fixed',
      field: 'validation.crossSectionChecks',
      description: 'Converted crossSectionChecks to array'
    })
  }

  return repairs
}

/**
 * Repair prompts section
 */
function repairPromptsSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.prompts) {
    profile.prompts = { baseStyle: {}, sections: {} }
    repairs.push({
      type: 'added',
      field: 'prompts',
      description: 'Added missing prompts section'
    })
  }

  if (!profile.prompts.baseStyle) {
    profile.prompts.baseStyle = {
      tone: 'technical, neutral, precise',
      voice: 'impersonal_third_person',
      avoid: ['marketing language', 'unsupported advantages']
    }
    repairs.push({
      type: 'added',
      field: 'prompts.baseStyle',
      description: 'Added default baseStyle configuration'
    })
  } else {
    fillDefaults(profile.prompts.baseStyle, {
      tone: 'technical, neutral, precise',
      voice: 'impersonal_third_person',
      avoid: ['marketing language', 'unsupported advantages']
    }, 'prompts.baseStyle', repairs)
  }

  if (!profile.prompts.sections) {
    profile.prompts.sections = {}
    repairs.push({
      type: 'added',
      field: 'prompts.sections',
      description: 'Added missing sections object'
    })
  }

  // Normalize legacy flat prompt configs to the canonical topUp shape so the
  // stored profile always has one form: { topUp: { instruction, constraints, ... } }
  for (const [key, config] of Object.entries<any>(profile.prompts.sections)) {
    if (config && typeof config === 'object' && !config.topUp && typeof config.instruction === 'string') {
      profile.prompts.sections[key] = {
        topUp: {
          instruction: config.instruction,
          constraints: Array.isArray(config.constraints) ? config.constraints : [],
          ...(Array.isArray(config.additions) ? { additions: config.additions } : {}),
          ...(typeof config.importFiguresDirectly === 'boolean' ? { importFiguresDirectly: config.importFiguresDirectly } : {})
        }
      }
      repairs.push({
        type: 'converted',
        field: `prompts.sections.${key}`,
        description: 'Converted legacy prompt config to topUp format'
      })
    }
  }

  return repairs
}

/**
 * Repair export section
 */
function repairExportSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.export) {
    profile.export = DEFAULT_VALUES.export
    repairs.push({
      type: 'added',
      field: 'export',
      description: 'Added default export configuration'
    })
    return repairs
  }

  if (!Array.isArray(profile.export.documentTypes) || profile.export.documentTypes.length === 0) {
    // Schema requires >= 1 document type — an empty array must get the default
    // just like a missing one, not fail validation.
    profile.export.documentTypes = JSON.parse(JSON.stringify(DEFAULT_VALUES.export.documentTypes))
    repairs.push({
      type: 'fixed',
      field: 'export.documentTypes',
      description: 'Added default document type (documentTypes was missing or empty)'
    })
  }

  if (!profile.export.sectionHeadings || typeof profile.export.sectionHeadings !== 'object') {
    profile.export.sectionHeadings = { ...DEFAULT_VALUES.export.sectionHeadings }
    repairs.push({
      type: 'added',
      field: 'export.sectionHeadings',
      description: 'Added default section headings'
    })
  }

  // Ensure each document type has required fields
  profile.export.documentTypes.forEach((docType: any, index: number) => {
    const requiredFields = ['id', 'label', 'includesSections', 'pageSize', 'lineSpacing', 'fontFamily', 'fontSizePt', 'addPageNumbers', 'addParagraphNumbers']

    requiredFields.forEach(field => {
      if ((docType as any)[field] === undefined) {
        const defaultDocType = DEFAULT_VALUES.export.documentTypes[0]
        ;(docType as any)[field] = (defaultDocType as any)[field]
        repairs.push({
          type: 'added',
          field: `export.documentTypes[${index}].${field}`,
          description: `Added missing required field ${field}`,
          newValue: (defaultDocType as any)[field]
        })
      }
    })
  })

  return repairs
}

/**
 * Repair diagrams section
 */
function repairDiagramsSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.diagrams) {
    profile.diagrams = JSON.parse(JSON.stringify(DEFAULT_VALUES.diagrams))
    repairs.push({
      type: 'added',
      field: 'diagrams',
      description: 'Added default diagrams configuration'
    })
    return repairs
  }

  // Ensure arrays are arrays
  if (!Array.isArray(profile.diagrams.supportedDiagramTypes) || profile.diagrams.supportedDiagramTypes.length === 0) {
    profile.diagrams.supportedDiagramTypes = [...DEFAULT_VALUES.diagrams.supportedDiagramTypes]
    repairs.push({
      type: 'fixed',
      field: 'diagrams.supportedDiagramTypes',
      description: 'Fixed supportedDiagramTypes to be a non-empty array'
    })
  }

  // Fill any other missing fields — "diagrams": {} must behave like an
  // omitted block, not fail schema validation on four required fields.
  fillDefaults(profile.diagrams, DEFAULT_VALUES.diagrams, 'diagrams', repairs)

  return repairs
}

/**
 * Repair cross-checks section
 */
function repairCrossChecksSection(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  if (!profile.crossChecks) {
    profile.crossChecks = JSON.parse(JSON.stringify(DEFAULT_VALUES.crossChecks))
    repairs.push({
      type: 'added',
      field: 'crossChecks',
      description: 'Added default crossChecks configuration'
    })
    return repairs
  }

  if (!Array.isArray(profile.crossChecks.checkList)) {
    profile.crossChecks.checkList = []
    repairs.push({
      type: 'fixed',
      field: 'crossChecks.checkList',
      description: 'Fixed checkList to be an array'
    })
  }

  if (typeof profile.crossChecks.enableSemanticCrossCheck !== 'boolean') {
    profile.crossChecks.enableSemanticCrossCheck = DEFAULT_VALUES.crossChecks.enableSemanticCrossCheck
    repairs.push({
      type: 'added',
      field: 'crossChecks.enableSemanticCrossCheck',
      description: 'Added default enableSemanticCrossCheck flag',
      newValue: DEFAULT_VALUES.crossChecks.enableSemanticCrossCheck
    })
  }

  return repairs
}

/**
 * Fix common data type issues
 */
function fixDataTypes(profile: any): RepairAction[] {
  const repairs: RepairAction[] = []

  // Convert string numbers to actual numbers where expected
  const numberFields = [
    'meta.version',
    'rules.global.maxPagesRecommended',
    'rules.abstract.wordLimit',
    'rules.claims.maxIndependentClaimsBeforeExtraFee',
    'rules.claims.maxTotalClaimsRecommended',
    'rules.drawings.minReferenceTextSizePt',
    'rules.drawings.marginTopCm',
    'rules.drawings.marginBottomCm',
    'rules.drawings.marginLeftCm',
    'rules.drawings.marginRightCm',
    'rules.procedural.gracePeriodMonths'
  ]

  numberFields.forEach(fieldPath => {
    const value = getNestedValue(profile, fieldPath)
    if (typeof value === 'string' && !isNaN(Number(value))) {
      setNestedValue(profile, fieldPath, Number(value))
      repairs.push({
        type: 'converted',
        field: fieldPath,
        description: 'Converted string number to number',
        oldValue: value,
        newValue: Number(value)
      })
    }
  })

  // Ensure boolean fields are actually booleans
  const booleanFields = [
    'rules.global.paragraphNumberingRequired',
    'rules.global.allowEquations',
    'rules.global.allowTables',
    'rules.abstract.noBenefitsOrAdvantages',
    'rules.abstract.noClaimLanguage',
    'rules.abstract.singleParagraph'
  ]

  booleanFields.forEach(fieldPath => {
    const value = getNestedValue(profile, fieldPath)
    if (typeof value === 'string') {
      const boolValue = value.toLowerCase() === 'true'
      setNestedValue(profile, fieldPath, boolValue)
      repairs.push({
        type: 'converted',
        field: fieldPath,
        description: 'Converted string boolean to boolean',
        oldValue: value,
        newValue: boolValue
      })
    }
  })

  return repairs
}

/**
 * Get nested object value by dot notation path
 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj)
}

/**
 * Set nested object value by dot notation path
 */
function setNestedValue(obj: any, path: string, value: any): void {
  const keys = path.split('.')
  const lastKey = keys.pop()!
  const target = keys.reduce((current, key) => {
    if (!current[key]) current[key] = {}
    return current[key]
  }, obj)
  target[lastKey] = value
}

