import { z } from 'zod'

export const DIAGRAM_KINDS = ['COMPONENT', 'SEQUENCE', 'PROCESS', 'CONSTITUENT'] as const
export type DiagramKind = (typeof DIAGRAM_KINDS)[number]

export const DIAGRAM_SOURCE_MODES = ['MANAGED', 'RAW_OVERRIDE', 'IMPORTED_RAW', 'IMPORTED_IMAGE'] as const
export type DiagramSourceMode = (typeof DIAGRAM_SOURCE_MODES)[number]

export const DIAGRAM_OUTPUT_MODES = ['FILING', 'REVIEW'] as const
export type DiagramOutputMode = (typeof DIAGRAM_OUTPUT_MODES)[number]

export const relationshipCategorySchema = z.enum([
  'PRIMARY',
  'DATA_INPUT',
  'TECHNICAL_OUTPUT',
  'EVIDENCE',
  'GENERATED_CONTENT',
  'CONTROL',
  'CONFIGURATION',
  'VALIDATION',
  'RESPONSE',
  'REVIEW_FEEDBACK',
  'STORAGE',
  'OPTIONAL',
  'ASSOCIATION',
])
export type RelationshipCategory = z.infer<typeof relationshipCategorySchema>

const shortText = z.string().trim().min(1).max(160)
const idText = z.string().trim().min(1).max(120)

export const orderedGroupSchema = z.object({
  id: idText,
  label: shortText,
  componentIds: z.array(idText).min(1),
})

export const figureSetPlanItemSchema = z.object({
  key: idText,
  kind: z.enum(DIAGRAM_KINDS),
  title: shortText,
  purpose: z.string().trim().min(1).max(600),
  detailLevel: z.enum(['OVERVIEW', 'DETAIL']).default('DETAIL'),
  direction: z.enum(['TB', 'LR']).default('TB'),
  componentIds: z.array(idText).min(1),
  claimCriticalComponentIds: z.array(idText).default([]),
  orderedGroups: z.array(orderedGroupSchema).default([]),
  phaseHints: z.array(shortText).default([]),
})

export const figureSetPlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  figures: z.array(figureSetPlanItemSchema).min(1).max(10),
})

export type FigureSetPlanItem = z.infer<typeof figureSetPlanItemSchema>
export type FigureSetPlan = z.infer<typeof figureSetPlanSchema>

const diagramBaseSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  key: idText,
  title: shortText,
  purpose: z.string().trim().min(1).max(600),
  detailLevel: z.enum(['OVERVIEW', 'DETAIL']).default('DETAIL'),
  direction: z.enum(['TB', 'LR']).default('TB'),
  claimCriticalComponentIds: z.array(idText).default([]),
  evidenceIds: z.array(idText).default([]),
})

export const relationshipSchema = z.object({
  id: idText.optional(),
  fromId: idText,
  toId: idText,
  label: z.string().trim().max(80).default(''),
  category: relationshipCategorySchema.default('PRIMARY'),
})

export const componentNodeSchema = z.object({
  componentId: idText,
  displayLabel: shortText.optional(),
  optional: z.boolean().default(false),
  external: z.boolean().default(false),
})

export const componentDiagramSchema = diagramBaseSchema.extend({
  kind: z.literal('COMPONENT'),
  systemBoundaryLabel: shortText,
  groups: z.array(z.object({
    id: idText,
    label: shortText,
    rows: z.array(z.object({ componentIds: z.array(idText).min(1).max(4) })).min(1),
  })).min(1),
  components: z.array(componentNodeSchema).min(1),
  relationships: z.array(relationshipSchema).default([]),
})

export const sequenceDiagramSchema = diagramBaseSchema.extend({
  kind: z.literal('SEQUENCE'),
  participants: z.array(z.object({
    componentId: idText,
    displayLabel: shortText.optional(),
  })).min(2),
  interactions: z.array(z.object({
    order: z.number().int().positive(),
    fromId: idText,
    toId: idText,
    label: shortText,
    category: relationshipCategorySchema.default('PRIMARY'),
    phase: shortText.optional(),
    alternative: z.object({
      condition: z.string().trim().min(1).max(100),
      branch: z.enum(['IF', 'ELSE']).default('IF'),
    }).optional(),
  })).min(1),
})

export const processDiagramSchema = diagramBaseSchema.extend({
  kind: z.literal('PROCESS'),
  nodes: z.array(z.object({
    key: idText,
    kind: z.enum(['STEP', 'DECISION']),
    componentId: idText.optional(),
    relatedComponentIds: z.array(idText).default([]),
    label: shortText,
    identifier: z.string().trim().max(30).optional(),
    phase: shortText.optional(),
  })).min(2),
  transitions: z.array(z.object({
    fromId: idText,
    toId: idText,
    label: z.string().trim().max(40).default(''),
    category: relationshipCategorySchema.default('PRIMARY'),
  })).min(1),
})

export const constituentDiagramSchema = diagramBaseSchema.extend({
  kind: z.literal('CONSTITUENT'),
  boundaryLabel: shortText,
  constituents: z.array(z.object({
    componentId: idText,
    displayLabel: shortText.optional(),
    technicalRole: z.string().trim().max(120).optional(),
    quantityOrRange: z.string().trim().max(80).optional(),
  })).min(1),
  relationships: z.array(relationshipSchema).default([]),
})

export const patentDiagramSchema = z.discriminatedUnion('kind', [
  componentDiagramSchema,
  sequenceDiagramSchema,
  processDiagramSchema,
  constituentDiagramSchema,
])

export type PatentDiagram = z.infer<typeof patentDiagramSchema>
export type ComponentDiagram = z.infer<typeof componentDiagramSchema>
export type SequenceDiagram = z.infer<typeof sequenceDiagramSchema>
export type ProcessDiagram = z.infer<typeof processDiagramSchema>
export type ConstituentDiagram = z.infer<typeof constituentDiagramSchema>

export interface PatentDiagramComponent {
  id: string
  name: string
  type?: string | null
  description?: string | null
  referenceLabel: string
  parentId?: string | null
}

export type DiagramIssueSeverity = 'error' | 'warning' | 'info'

export interface DiagramValidationIssue {
  code: string
  severity: DiagramIssueSeverity
  message: string
  path?: string
  componentId?: string
}

export interface DiagramComplexityMetrics {
  visibleNodeCount: number
  connectorCount: number
  groupCount: number
  maximumRowSize: number
  maximumLabelWords: number
  crossLayerConnectorCount: number
  nestingDepth: number
  branchDepth?: number
  requiresSplit: boolean
  splitReasons: string[]
}

export interface DiagramValidationReport {
  filingReady: boolean
  issues: DiagramValidationIssue[]
  corrections: string[]
  claimCriticalCoverage: { required: string[]; covered: string[]; missing: string[] }
  complexity: DiagramComplexityMetrics
  render?: {
    width?: number
    height?: number
    viewBox?: string
    aspectRatio?: number
    effectiveFontSizePt?: number
  }
}

export interface DiagramRenderArtifact {
  filename?: string
  path?: string
  checksum: string
  contentType: string
  width?: number
  height?: number
}

export interface DiagramRenderArtifacts {
  svg: DiagramRenderArtifact
  png: DiagramRenderArtifact
}

export interface BuiltPatentDiagram {
  diagram: PatentDiagram
  plantumlCode: string
  labelMap: Record<string, string>
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
  validation: DiagramValidationReport
}
