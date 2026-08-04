import { COVERAGE_REQUIREMENT_TYPES, DIAGRAM_KINDS, relationshipCategorySchema, type DiagramKind } from './types'

// OpenAI strict structured-output schemas for the diagram pipeline's three LLM
// payloads. These mirror the Zod contracts in types.ts/coverage.ts, which stay
// authoritative: the provider schema constrains token-level decoding so shape
// retries disappear, while Zod still enforces the semantic rules (exact claim
// excerpts, known IDs, density) a decoder cannot check.
//
// Strict-mode conventions:
// - Every object closes with additionalProperties:false and requires every key,
//   so Zod-optional fields are expressed as nullable; executeStructured strips
//   null-valued keys before Zod validation (no LLM-facing field means null).
// - Server-assigned fields (relationship id, process identifiers) and fields the
//   prompt forbids (COMPONENT/CONSTITUENT connector labels) are omitted outright,
//   which strict mode turns into "the model cannot emit them".

type JsonSchema = Record<string, unknown>

const text: JsonSchema = { type: 'string' }
const textArray: JsonSchema = { type: 'array', items: { type: 'string' } }
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] })
const enumOf = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: [...values] })
const arrayOf = (items: JsonSchema): JsonSchema => ({ type: 'array', items })
const objectOf = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
})

const RELATIONSHIP_CATEGORY = enumOf(relationshipCategorySchema.options)

export const COVERAGE_EXTRACTION_RESPONSE_SCHEMA = objectOf({
  requirements: arrayOf(objectOf({
    claimNumber: { type: 'integer' },
    type: enumOf(COVERAGE_REQUIREMENT_TYPES),
    label: text,
    sourceText: text,
    componentIds: textArray,
    componentCandidate: nullable(objectOf({
      name: text,
      type: text,
      parentId: nullable(text),
    })),
  })),
})

export const FIGURE_SET_PLAN_RESPONSE_SCHEMA = objectOf({
  schemaVersion: { type: 'integer', enum: [2] },
  figures: arrayOf(objectOf({
    key: text,
    kind: enumOf(DIAGRAM_KINDS),
    title: text,
    purpose: text,
    detailLevel: enumOf(['OVERVIEW', 'DETAIL']),
    direction: enumOf(['TB', 'LR']),
    componentIds: textArray,
    claimCriticalComponentIds: textArray,
    orderedGroups: arrayOf(objectOf({ id: text, label: text, componentIds: textArray })),
    phaseHints: textArray,
    evidenceIds: textArray,
    coverageRequirementIds: textArray,
  })),
})

const DIAGRAM_COMMON_FIELDS: Record<string, JsonSchema> = {
  schemaVersion: { type: 'integer', enum: [2] },
  key: text,
  title: text,
  purpose: text,
  detailLevel: enumOf(['OVERVIEW', 'DETAIL']),
  direction: enumOf(['TB', 'LR']),
  claimCriticalComponentIds: textArray,
  evidenceIds: textArray,
  coverageRequirementIds: textArray,
}

// No label: COMPONENT and CONSTITUENT connectors are unlabelled by rule, and
// omitting the key here makes emitting one impossible instead of merely wrong.
const UNLABELLED_RELATIONSHIP = objectOf({
  fromId: text,
  toId: text,
  category: RELATIONSHIP_CATEGORY,
  evidenceIds: textArray,
  coverageRequirementIds: textArray,
})

export function diagramDetailResponseSchema(kind: DiagramKind): JsonSchema {
  if (kind === 'COMPONENT') {
    return objectOf({
      ...DIAGRAM_COMMON_FIELDS,
      kind: enumOf(['COMPONENT']),
      systemBoundaryLabel: text,
      groups: arrayOf(objectOf({
        id: text,
        label: text,
        rows: arrayOf(objectOf({ componentIds: textArray })),
      })),
      components: arrayOf(objectOf({
        componentId: text,
        displayLabel: nullable(text),
        optional: { type: 'boolean' },
        external: { type: 'boolean' },
        coverageRequirementIds: textArray,
      })),
      relationships: arrayOf(UNLABELLED_RELATIONSHIP),
    })
  }
  if (kind === 'SEQUENCE') {
    return objectOf({
      ...DIAGRAM_COMMON_FIELDS,
      kind: enumOf(['SEQUENCE']),
      participants: arrayOf(objectOf({ componentId: text, displayLabel: nullable(text) })),
      interactions: arrayOf(objectOf({
        order: { type: 'integer' },
        fromId: text,
        toId: text,
        label: text,
        category: RELATIONSHIP_CATEGORY,
        phase: nullable(text),
        alternative: nullable(objectOf({ condition: text, branch: enumOf(['IF', 'ELSE']) })),
        evidenceIds: textArray,
        coverageRequirementIds: textArray,
      })),
    })
  }
  if (kind === 'PROCESS') {
    return objectOf({
      ...DIAGRAM_COMMON_FIELDS,
      kind: enumOf(['PROCESS']),
      nodes: arrayOf(objectOf({
        key: text,
        kind: enumOf(['STEP', 'DECISION']),
        componentId: nullable(text),
        relatedComponentIds: textArray,
        label: text,
        phase: nullable(text),
        evidenceIds: textArray,
        coverageRequirementIds: textArray,
      })),
      transitions: arrayOf(objectOf({
        fromId: text,
        toId: text,
        label: text,
        category: RELATIONSHIP_CATEGORY,
        evidenceIds: textArray,
        coverageRequirementIds: textArray,
      })),
    })
  }
  return objectOf({
    ...DIAGRAM_COMMON_FIELDS,
    kind: enumOf(['CONSTITUENT']),
    boundaryLabel: text,
    constituents: arrayOf(objectOf({
      componentId: text,
      displayLabel: nullable(text),
      technicalRole: nullable(text),
      quantityOrRange: nullable(text),
      evidenceIds: textArray,
      coverageRequirementIds: textArray,
    })),
    relationships: arrayOf(UNLABELLED_RELATIONSHIP),
  })
}
