/**
 * Ideation Engine - Zod Schemas
 * 
 * PatentNest.ai - Patent Ideation Engine (Refactored per SRS)
 * 
 * IMPORTANT: This is a PRELIMINARY NOVELTY ASSESSMENT system.
 * No patent databases are used. No legal novelty claims are made.
 * 
 * Pipeline Stages (Internal Only - UI MUST NOT show stage names):
 * SEED_INPUT → SEMANTIC_GROUNDING → INVENTIVE_FRAMING → 
 * DIMENSION_DISCOVERY → DIMENSION_EXPANSION → IDEA_GENERATION → 
 * PRELIMINARY_NOVELTY_ASSESSMENT
 */

import { z } from 'zod';

// =============================================================================
// ENUMS
// =============================================================================

export const InventionArchetypeEnum = z.enum([
  'PHYSICAL_DEVICE',
  'PROCESS_FLOW',
  'DIGITAL_SYSTEM',
  'BIO_CHEMICAL',
  'HYBRID',
]);
export type InventionArchetype = z.infer<typeof InventionArchetypeEnum>;

// Legacy enum maintained for backward compatibility
export const InventionClassEnum = z.enum([
  'PRODUCT_DEVICE',
  'SYSTEM',
  'METHOD_PROCESS',
  'COMPOSITION',
  'SOFTWARE_ALGORITHM',
  'BIOTECH_PHARMA',
  'MANUFACTURING',
  'SERVICE_WORKFLOW',
  'HYBRID',
]);
export type InventionClass = z.infer<typeof InventionClassEnum>;

export const ArchetypeEnum = z.enum([
  'MECH',
  'ELEC',
  'SOFT',
  'CHEM',
  'BIO',
  'MIXED',
]);
export type Archetype = z.infer<typeof ArchetypeEnum>;

export const ForkModeEnum = z.enum(['SINGLE', 'FORK', 'MERGE']);
export type ForkMode = z.infer<typeof ForkModeEnum>;

export const MindMapNodeTypeEnum = z.enum([
  'SEED',
  'COMPONENT',
  'DIMENSION',           // Invention-specific dimension (primary)
  'DIMENSION_MOVE',      // Assumption-breaking move under a dimension
  'IDEA_FRAME',
  // Legacy types kept for backward compatibility
  'DIMENSION_FAMILY',
  'DIMENSION_OPTION',
  'OPERATOR',
  'CONSTRAINT',
  'EVIDENCE_CLUSTER',
]);
export type MindMapNodeType = z.infer<typeof MindMapNodeTypeEnum>;

export const OriginalityStrengthEnum = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export type OriginalityStrength = z.infer<typeof OriginalityStrengthEnum>;

export const NoveltyRiskLevelEnum = z.enum(['LOW', 'MODERATE', 'HIGH']);
export type NoveltyRiskLevel = z.infer<typeof NoveltyRiskLevelEnum>;

// Legacy enums maintained for backward compatibility
export const SaturationLevelEnum = z.enum(['LOW', 'MEDIUM', 'HIGH']);
export type SaturationLevel = z.infer<typeof SaturationLevelEnum>;

export const NoveltyActionEnum = z.enum([
  'KEEP',
  'MUTATE_OPERATOR',
  'MUTATE_DIMENSION',
  'NARROW_MICRO_PROBLEM',
  'ASK_USER_QUESTION',
]);
export type NoveltyAction = z.infer<typeof NoveltyActionEnum>;

export const RecipeIntentEnum = z.enum([
  'DIVERGENT',
  'CONVERGENT',
  'RISK_REDUCTION',
  'COST_REDUCTION',
]);
export type RecipeIntent = z.infer<typeof RecipeIntentEnum>;

export const PrimaryChangeEnum = z.enum([
  'REMOVE',
  'INVERT',
  'DECOUPLE',
  'RELOCATE',
  'DELAY',
]);
export type PrimaryChange = z.infer<typeof PrimaryChangeEnum>;

// =============================================================================
// STAGE 1: SEMANTIC_GROUNDING (Replaces normalize)
// =============================================================================

/**
 * SEMANTIC_GROUNDING - Understand the idea WITHOUT inventing, reframing, or solving.
 * This is a READ-ONLY understanding of the user's invention concept.
 */
export const SemanticGroundingSchema = z.object({
  coreEntity: z.string().min(1).describe('The main physical or conceptual thing being invented'),
  currentApproach: z.string().describe('How the user currently approaches or describes the solution'),
  userIntent: z.string().min(1).describe('What the user wants to achieve or solve'),
  explicitConstraints: z.array(z.string()).default([]).describe('Hard limits explicitly mentioned'),
  implicitAssumptions: z.array(z.string()).default([]).describe('Hidden assumptions inferred from context'),
  ambiguityFlags: z.array(z.string()).default([]).describe('Areas of the idea that are unclear or ambiguous'),
  clarificationQuestions: z.array(z.string()).default([]).describe('Questions that would help clarify the invention (max 3-5)'),
});
export type SemanticGrounding = z.infer<typeof SemanticGroundingSchema>;

// Legacy alias for backward compatibility
export const InputNormalizationSchema = SemanticGroundingSchema.extend({
  // Additional legacy fields for backward compatibility
  intentGoal: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  context: z.string().optional(),
  negativeConstraints: z.array(z.string()).default([]),
  knownComponents: z.array(z.string()).default([]),
  unknownsToAsk: z.array(z.string()).default([]),
  technicalContradictions: z.array(z.object({
    parameterToImprove: z.string(),
    parameterThatWorsens: z.string(),
    conflictDescription: z.string(),
  })).default([]),
  unstatedAssumptions: z.array(z.string()).default([]),
  secondOrderGoals: z.array(z.string()).default([]),
  patentableProblemStatement: z.string().optional(),
});
export type InputNormalization = z.infer<typeof InputNormalizationSchema>;

// =============================================================================
// STAGE 2: INVENTIVE_FRAMING (Replaces contradiction logic in normalize)
// =============================================================================

/**
 * Technical contradiction - only if it naturally exists
 */
export const TechnicalContradictionSchema = z.object({
  parameterToImprove: z.string().describe('What we want to improve'),
  parameterThatWorsens: z.string().describe('What gets worse when we improve the first'),
  conflictDescription: z.string().describe('Why these are in conflict'),
});
export type TechnicalContradiction = z.infer<typeof TechnicalContradictionSchema>;

/**
 * Non-technical tension (e.g., cost vs quality, speed vs accuracy)
 */
export const NonTechnicalTensionSchema = z.object({
  aspect1: z.string(),
  aspect2: z.string(),
  tensionDescription: z.string(),
});
export type NonTechnicalTension = z.infer<typeof NonTechnicalTensionSchema>;

/**
 * INVENTIVE_FRAMING - Identify real tensions ONLY if they exist.
 * DO NOT force TRIZ-style conflicts. Return empty arrays if no real contradiction exists.
 */
export const InventiveFramingSchema = z.object({
  technicalContradictions: z.array(TechnicalContradictionSchema).default([])
    .describe('Technical contradictions ONLY if they naturally exist'),
  nonTechnicalTensions: z.array(NonTechnicalTensionSchema).default([])
    .describe('Non-technical tensions like cost/quality tradeoffs'),
  assumptionToChallenge: z.string().optional()
    .describe('The most important assumption that could be challenged'),
  patentableProblemStatement: z.string().optional()
    .describe('Reframed problem in inventive terms'),
});
export type InventiveFraming = z.infer<typeof InventiveFramingSchema>;

// Legacy ContradictionMapping alias
export const ContradictionMappingSchema = z.object({
  contradictions: z.array(z.object({
    parameterToImprove: z.string(),
    parameterThatWorsens: z.string(),
    whyThisIsHard: z.string().optional(),
    trizContradictionNumber: z.number().optional(),
  })).default([]),
  secondOrderEffects: z.array(z.string()).default([]),
  inventivePrinciples: z.array(z.string()).default([]),
  resolutionStrategies: z.array(z.object({
    strategy: z.enum(['SEPARATION_IN_TIME', 'SEPARATION_IN_SPACE', 'SEPARATION_ON_CONDITION', 'SEPARATION_BETWEEN_PARTS', 'INVERSION', 'SUBSTANCE_FIELD_SHIFT', 'DYNAMIZATION']),
    description: z.string(),
    applicableTo: z.string(),
  })).default([]),
});
export type ContradictionMapping = z.infer<typeof ContradictionMappingSchema>;

// =============================================================================
// STAGE 3: DIMENSION_DISCOVERY (Replaces fixed dimension families)
// =============================================================================

/**
 * Primary dimension - discovered from the invention, NOT from a fixed template
 */
export const PrimaryDimensionSchema = z.object({
  dimensionId: z.string().min(1).describe('Unique identifier for this dimension'),
  name: z.string().min(1).describe('Short name of the dimension'),
  whyItMatters: z.string().describe('Why this dimension is critical to the invention'),
  typicalAssumption: z.string().describe('The typical/default assumption about this dimension'),
});
export type PrimaryDimension = z.infer<typeof PrimaryDimensionSchema>;

/**
 * DIMENSION_DISCOVERY - Discover invention-specific dimensions.
 * Dimensions MUST emerge from the invention, NOT from generic templates.
 */
export const DimensionDiscoverySchema = z.object({
  inventionArchetype: InventionArchetypeEnum.describe('Classification of invention type'),
  primaryDimensions: z.array(PrimaryDimensionSchema).min(4).max(6)
    .describe('4-6 invention-specific dimensions that control success or failure'),
  excludedDimensions: z.array(z.string()).default([])
    .describe('Dimensions explicitly NOT relevant to this invention'),
});
export type DimensionDiscovery = z.infer<typeof DimensionDiscoverySchema>;

// =============================================================================
// STAGE 4: DIMENSION_EXPANSION (Assumption-breaking moves)
// =============================================================================

/**
 * Assumption-breaking move - NOT a feature addition
 */
export const AssumptionBreakingMoveSchema = z.object({
  moveText: z.string().min(1).describe('What if we... statement'),
  primaryChange: PrimaryChangeEnum.describe('Type of change: REMOVE | INVERT | DECOUPLE | RELOCATE | DELAY'),
  immediateEffect: z.string().describe('What happens immediately when this move is applied'),
  newProblemCreated: z.string().describe('What new problem or constraint this creates'),
  contradictionAddressed: z.string().optional()
    .describe('Which tension or contradiction this move addresses'),
});
export type AssumptionBreakingMove = z.infer<typeof AssumptionBreakingMoveSchema>;

/**
 * DIMENSION_EXPANSION response - generates 3-5 assumption-breaking moves per dimension
 */
export const DimensionExpansionSchema = z.object({
  dimensionId: z.string().describe('ID of the dimension being expanded'),
  moves: z.array(AssumptionBreakingMoveSchema).min(3).max(5)
    .describe('3-5 assumption-breaking invention moves'),
});
export type DimensionExpansion = z.infer<typeof DimensionExpansionSchema>;

// Legacy SuggestedMove schema for backward compatibility
export const SuggestedMoveSchema = z.object({
  id: z.string().min(1).describe('Unique move ID'),
  move: z.string().min(1).describe('What-if statement'),
  impact: z.string().min(1).describe('Immediate change'),
  leadsTo: z.string().min(1).describe('New constraint or opportunity'),
  tension: z.string().optional().describe('What assumption this challenges'),
  challengesPrior: z.boolean().default(false),
  modifies: z.enum([
    'BEHAVIOR_OVER_TIME',
    'ARCHITECTURE_CONTROL_FLOW',
    'INTERFACE_BOUNDARY',
    'FAILURE_MODE_LIFECYCLE'
  ]).optional().default('BEHAVIOR_OVER_TIME'),
});
export type SuggestedMove = z.infer<typeof SuggestedMoveSchema>;

export const SuggestedMovesResponseSchema = z.object({
  moves: z.array(SuggestedMoveSchema).min(1).max(10),
  contextAcknowledged: z.boolean().default(false),
  priorSelectionsUsed: z.array(z.string()).default([]),
});
export type SuggestedMovesResponse = z.infer<typeof SuggestedMovesResponseSchema>;

// =============================================================================
// STAGE 5: IDEA_GENERATION (Mechanism-Pure)
// =============================================================================

/**
 * Mechanism boundary test - what the idea does NOT solve
 */
export const MechanismBoundaryTestSchema = z.object({
  whatItDoesNotSolve: z.string().describe('Problems this mechanism explicitly does NOT address'),
  outOfScope: z.string().describe('Areas considered outside the scope of this invention'),
});
export type MechanismBoundaryTest = z.infer<typeof MechanismBoundaryTestSchema>;

/**
 * IDEA_FRAME - Patent idea with EXACTLY ONE causal mechanism
 * 
 * RULE: If more than ONE causal mechanism is required → discard and regenerate.
 */
export const NewIdeaFrameSchema = z.object({
  ideaId: z.string().min(1).describe('Unique ID for this idea'),
  coreMechanism: z.string().min(1)
    .describe('A single sentence describing the ONE primary inventive mechanism'),
  inventiveLeap: z.string().min(1)
    .describe('The non-obvious insight that makes this patentable'),
  eliminatedAssumption: z.string().min(1)
    .describe('Which traditional assumption is eliminated or challenged'),
  contradictionResolved: z.string().optional()
    .describe('Which technical contradiction this resolves'),
  whyNotObvious: z.string().min(1)
    .describe('Why a skilled person would NOT arrive at this solution'),
  mechanismBoundaryTest: MechanismBoundaryTestSchema
    .describe('Explicit boundaries of what this mechanism does NOT solve'),
});
export type NewIdeaFrame = z.infer<typeof NewIdeaFrameSchema>;

// Legacy IdeaFrame schema (extended to include new required fields)
export const IdeaVariantSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  differentiator: z.string().optional(),
});
export type IdeaVariant = z.infer<typeof IdeaVariantSchema>;

export const IdeaFrameSchema = z.object({
  ideaId: z.string().min(1),
  title: z.string().min(1).max(200),
  classLabels: z.array(z.string()).default([]),
  problem: z.string().min(1),
  principle: z.string().min(1).max(500),
  
  // NEW REQUIRED FIELDS (per SRS)
  coreMechanism: z.string().min(1)
    .describe('EXACTLY ONE causal mechanism - if more than one is required, idea is invalid'),
  inventiveLeap: z.string().min(1)
    .describe('The non-obvious insight'),
  eliminatedAssumption: z.string().optional()
    .describe('Traditional assumption eliminated'),
  contradictionResolved: z.string().optional(),
  whyNotObvious: z.string().min(1),
  mechanismBoundaryTest: MechanismBoundaryTestSchema.optional(),
  
  // Legacy fields for backward compatibility
  components: z.array(z.string()).default([]),
  mechanismSteps: z.array(z.string()).default([]),
  triggerCondition: z.string().optional(),
  technicalEffect: z.string().optional(),
  constraintsSatisfied: z.array(z.string()).default([]),
  operatorsUsed: z.array(z.string()).default([]),
  dimensionsUsed: z.array(z.string()).default([]),
  variants: z.array(IdeaVariantSchema).default([]),
  claimHooks: z.array(z.string()).default([]),
  riskNotes: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).default([]),
  analogySource: z.string().optional(),
  eliminatedComponent: z.string().optional(),
  secondOrderEffect: z.string().optional(),
  resolutionStrategy: z.string().optional(),
});
export type IdeaFrame = z.infer<typeof IdeaFrameSchema>;

// =============================================================================
// STAGE 6: PRELIMINARY_NOVELTY_ASSESSMENT (LLM-Only, No Prior Art)
// =============================================================================

/**
 * PRELIMINARY_NOVELTY_ASSESSMENT - LLM-only assessment of conceptual originality.
 * 
 * IMPORTANT: This is NOT a legal novelty determination.
 * No patent databases are searched. No clearance is implied.
 */
export const PreliminaryNoveltyAssessmentSchema = z.object({
  originalityStrength: OriginalityStrengthEnum
    .describe('HIGH | MEDIUM | LOW - conceptual originality'),
  noveltyRiskLevel: NoveltyRiskLevelEnum
    .describe('LOW | MODERATE | HIGH - risk that prior art exists'),
  likelyExaminerObjection: z.string()
    .describe('What objection a patent examiner would likely raise'),
  redundancyRisk: z.string()
    .describe('Risk that this is redundant with existing solutions'),
  strongestNovelAspect: z.string()
    .describe('The most novel aspect of the idea'),
  weakestNovelAspect: z.string()
    .describe('The least novel aspect that may face challenges'),
  improvementDirections: z.array(z.string()).default([])
    .describe('Suggestions to improve novelty'),
});
export type PreliminaryNoveltyAssessment = z.infer<typeof PreliminaryNoveltyAssessmentSchema>;

// Legacy NoveltyGate schema (DEPRECATED - use PreliminaryNoveltyAssessment)
// Kept for backward compatibility during migration
export const NoveltySearchResultSchema = z.object({
  source: z.string(),
  title: z.string(),
  snippet: z.string().optional(),
  url: z.string().optional(),
  publicationNumber: z.string().optional(),
  assignee: z.string().optional(),
  filingDate: z.string().optional(),
  similarityScore: z.number().min(0).max(100).optional(),
  whyRelevant: z.string(),
});
export type NoveltySearchResult = z.infer<typeof NoveltySearchResultSchema>;

export const ClosestPriorArtSchema = z.object({
  publicationNumber: z.string().default('Unknown'),
  title: z.string().default('Unknown Patent'),
  relevanceScore: z.number().min(0).max(100).default(50),
  overlappingFeatures: z.array(z.string()).default([]),
  differentiatingFactors: z.array(z.string()).default([]),
  remark: z.string().default('Requires manual review'),
});
export type ClosestPriorArt = z.infer<typeof ClosestPriorArtSchema>;

export const MutationInstructionsSchema = z.object({
  action: z.enum(['MUTATE_DIMENSION', 'MUTATE_OPERATOR', 'ADD_ANALOGY', 'NARROW_PROBLEM', 'INVERT_APPROACH']),
  specifics: z.string(),
  retainElements: z.array(z.string()).default([]),
  suggestedAnalogy: z.string().optional(),
  dimensionToReplace: z.string().optional(),
  replacementSuggestion: z.string().optional(),
});
export type MutationInstructions = z.infer<typeof MutationInstructionsSchema>;

export const NoveltyGateSchema = z.object({
  // Map new fields to legacy structure for backward compatibility
  query: z.string().default(''),
  results: z.array(NoveltySearchResultSchema).default([]),
  conceptSaturation: SaturationLevelEnum.default('MEDIUM'),
  solutionSaturation: SaturationLevelEnum.default('MEDIUM'),
  noveltyScore: z.number().int().min(0).max(100).default(50),
  recommendedAction: NoveltyActionEnum.default('KEEP'),
  reasoning: z.string().optional(),
  
  // New fields from PreliminaryNoveltyAssessment
  originalityStrength: OriginalityStrengthEnum.optional(),
  noveltyRiskLevel: NoveltyRiskLevelEnum.optional(),
  likelyExaminerObjection: z.string().optional(),
  redundancyRisk: z.string().optional(),
  strongestNovelAspect: z.string().optional(),
  weakestNovelAspect: z.string().optional(),
  improvementDirections: z.array(z.string()).default([]),
  
  // Legacy fields (DEPRECATED - no longer populated)
  patentsAnalyzed: z.number().optional(),
  closestPriorArt: z.array(ClosestPriorArtSchema).default([]),
  priorArtSummary: z.string().optional(),
  obviousnessFlags: z.array(z.enum([
    'COMBINATIONAL',
    'SAME_DOMAIN',
    'PARAMETER_TWEAK',
    'OBVIOUS_SUBSTITUTION',
    'PREDICTABLE_RESULT',
  ])).default([]),
  mutationInstructions: MutationInstructionsSchema.optional(),
  phositaTest: z.string().optional(),
  suggestedIterations: z.array(z.string()).default([]),
});
export type NoveltyGate = z.infer<typeof NoveltyGateSchema>;

// =============================================================================
// LEGACY: CLASSIFICATION (Kept for backward compatibility)
// =============================================================================

export const ClassificationLabelSchema = z.object({
  class: InventionClassEnum,
  weight: z.number().min(0).max(1),
  rationaleShort: z.string(),
});
export type ClassificationLabel = z.infer<typeof ClassificationLabelSchema>;

export const ClassificationSchema = z.object({
  labels: z.array(ClassificationLabelSchema).min(1),
  dominantClass: InventionClassEnum,
  forkMode: ForkModeEnum,
  archetype: ArchetypeEnum,
});
export type Classification = z.infer<typeof ClassificationSchema>;

// =============================================================================
// LEGACY: OBVIOUSNESS FILTER (DEPRECATED - no longer used)
// =============================================================================

export const ObviousnessFilterSchema = z.object({
  combinationNovelty: z.number().min(0).max(100),
  obviousnessFlags: z.array(z.enum([
    'COMBINATIONAL',
    'SAME_DOMAIN',
    'PARAMETER_TWEAK',
    'OBVIOUS_SUBSTITUTION',
    'PREDICTABLE_RESULT',
  ])).default([]),
  wildCardSuggestion: z.string().optional(),
  dimensionQualityScores: z.array(z.object({
    dimensionId: z.string(),
    noveltyContribution: z.number().min(0).max(100),
    recommendation: z.enum(['KEEP', 'REPLACE', 'INVERT']),
  })).default([]),
  suggestedAnalogySources: z.array(z.string()).default([]),
});
export type ObviousnessFilter = z.infer<typeof ObviousnessFilterSchema>;

// =============================================================================
// GRAPH STRUCTURES
// =============================================================================

export const DimensionNodeSchema = z.object({
  id: z.string().min(1),
  type: MindMapNodeTypeEnum,
  title: z.string().min(1),
  description: z.string().optional(),
  descriptionShort: z.string().optional(),
  family: z.string().optional(),
  selectable: z.boolean().default(true),
  defaultExpanded: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  parentId: z.string().optional(),
  positionX: z.number().optional(),
  positionY: z.number().optional(),
  state: z.string().optional(),
  depth: z.number().optional(),
  payloadJson: z.any().optional(),
  // New fields for SRS compliance
  whyItMatters: z.string().optional(),
  typicalAssumption: z.string().optional(),
});
export type DimensionNode = z.infer<typeof DimensionNodeSchema>;

export const DimensionEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1),
});
export type DimensionEdge = z.infer<typeof DimensionEdgeSchema>;

export const DimensionGraphSchema = z.object({
  nodes: z.array(DimensionNodeSchema).min(1),
  edges: z.array(DimensionEdgeSchema).default([]),
});
export type DimensionGraph = z.infer<typeof DimensionGraphSchema>;

// Extended node type for suggested moves payload
export interface DimensionNodeWithPayload {
  id: string;
  type: z.infer<typeof MindMapNodeTypeEnum>;
  title: string;
  description?: string;
  descriptionShort?: string;
  family?: string;
  selectable: boolean;
  defaultExpanded: boolean;
  tags: string[];
  parentId?: string;
  positionX?: number | null;
  positionY?: number | null;
  state?: string | null;
  depth?: number | null;
  payloadJson?: SuggestedMovePayloadType | Record<string, unknown> | null;
  whyItMatters?: string;
  typicalAssumption?: string;
}

export interface SuggestedMovePayloadType {
  move: string;
  impact: string;
  leadsTo: string;
  tension?: string;
  challengesPrior?: boolean;
  modifies?: 'BEHAVIOR_OVER_TIME' | 'ARCHITECTURE_CONTROL_FLOW' | 'INTERFACE_BOUNDARY' | 'FAILURE_MODE_LIFECYCLE';
  isSuggestedMove: true;
  // New fields for SRS compliance
  primaryChange?: 'REMOVE' | 'INVERT' | 'DECOUPLE' | 'RELOCATE' | 'DELAY';
  newProblemCreated?: string;
  contradictionAddressed?: string;
}

export interface ExpandedDimensionGraph {
  nodes: DimensionNodeWithPayload[];
  edges: Array<{ from: string; to: string; relation: string }>;
}

// =============================================================================
// COMBINE RECIPE
// =============================================================================

export const CombineRecipeSchema = z.object({
  selectedComponents: z.array(z.string()).default([]),
  selectedDimensions: z.array(z.string()).default([]),
  selectedOperators: z.array(z.string()).default([]),
  recipeIntent: RecipeIntentEnum.default('DIVERGENT'),
  count: z.number().int().min(1).max(20).default(5),
  userGuidance: z.string().optional(),
});
export type CombineRecipe = z.infer<typeof CombineRecipeSchema>;

// =============================================================================
// TRIZ OPERATORS (Kept for backward compatibility)
// =============================================================================

export const TrizOperatorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  examples: z.array(z.string()).default([]),
  applicableTo: z.array(InventionClassEnum).default([]),
});
export type TrizOperator = z.infer<typeof TrizOperatorSchema>;

export const TRIZ_OPERATORS: TrizOperator[] = [
  {
    id: 'op-segmentation',
    name: 'Segmentation',
    description: 'Divide an object into independent parts; make it modular or sectional',
    examples: ['Modular furniture', 'Segmented plunger that snaps'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'MANUFACTURING'],
  },
  {
    id: 'op-extraction',
    name: 'Extraction',
    description: 'Remove or separate a disturbing part or property',
    examples: ['Remove heat with heat sink', 'Extract noise with dampeners'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
  {
    id: 'op-inversion',
    name: 'Inversion',
    description: 'Invert the action; make fixed parts movable and vice versa',
    examples: ['Inside-out umbrella', 'Rotating object vs rotating tool'],
    applicableTo: ['PRODUCT_DEVICE', 'METHOD_PROCESS', 'SYSTEM'],
  },
  {
    id: 'op-dynamics',
    name: 'Dynamics',
    description: 'Allow characteristics to change; divide into parts that can move relative to each other',
    examples: ['Adjustable furniture', 'Flexible displays'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM'],
  },
  {
    id: 'op-merging',
    name: 'Merging',
    description: 'Combine identical or similar objects; unite operations in time',
    examples: ['Multi-blade razors', 'Combined washer-dryer'],
    applicableTo: ['PRODUCT_DEVICE', 'SYSTEM', 'METHOD_PROCESS'],
  },
];

// =============================================================================
// DIMENSION FAMILIES - DELETED PER SRS
// =============================================================================
// NOTE: Fixed dimension families have been REMOVED per SRS requirements.
// Dimensions are now discovered dynamically from each invention via DIMENSION_DISCOVERY stage.
// The legacy DIMENSION_FAMILIES constant is intentionally NOT included here.

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export function getSchemaDescription(schemaName: string): string {
  const descriptions: Record<string, string> = {
    SemanticGrounding: `{
  "coreEntity": "string (the main thing being invented)",
  "currentApproach": "string (how user currently approaches it)",
  "userIntent": "string (what user wants to achieve)",
  "explicitConstraints": ["string array of hard limits"],
  "implicitAssumptions": ["string array of hidden assumptions"],
  "ambiguityFlags": ["string array of unclear areas"],
  "clarificationQuestions": ["string array of questions to clarify - max 3-5"]
}`,
    InventiveFraming: `{
  "technicalContradictions": [{"parameterToImprove": "", "parameterThatWorsens": "", "conflictDescription": ""}],
  "nonTechnicalTensions": [{"aspect1": "", "aspect2": "", "tensionDescription": ""}],
  "assumptionToChallenge": "string (most important assumption to challenge)",
  "patentableProblemStatement": "string (problem reframed in inventive terms)"
}`,
    DimensionDiscovery: `{
  "inventionArchetype": "PHYSICAL_DEVICE | PROCESS_FLOW | DIGITAL_SYSTEM | BIO_CHEMICAL | HYBRID",
  "primaryDimensions": [
    {
      "dimensionId": "unique-id",
      "name": "short name",
      "whyItMatters": "why this dimension is critical",
      "typicalAssumption": "the default assumption about this dimension"
    }
  ],
  "excludedDimensions": ["dimensions NOT relevant to this invention"]
}`,
    DimensionExpansion: `[
  {
    "moveText": "What if we...",
    "primaryChange": "REMOVE | INVERT | DECOUPLE | RELOCATE | DELAY",
    "immediateEffect": "what happens immediately",
    "newProblemCreated": "what new problem this creates",
    "contradictionAddressed": "which tension this addresses"
  }
]`,
    IdeaFrame: `{
  "ideaId": "unique-id",
  "coreMechanism": "EXACTLY ONE causal mechanism (required)",
  "inventiveLeap": "the non-obvious insight (required)",
  "eliminatedAssumption": "what traditional assumption is eliminated",
  "contradictionResolved": "which contradiction this solves",
  "whyNotObvious": "why skilled person wouldn't arrive at this (required)",
  "mechanismBoundaryTest": {
    "whatItDoesNotSolve": "explicit non-goals",
    "outOfScope": "areas outside scope"
  }
}`,
    PreliminaryNoveltyAssessment: `{
  "originalityStrength": "HIGH | MEDIUM | LOW",
  "noveltyRiskLevel": "LOW | MODERATE | HIGH",
  "likelyExaminerObjection": "string (what examiner would object to)",
  "redundancyRisk": "string (risk of overlap with existing solutions)",
  "strongestNovelAspect": "string (most novel part)",
  "weakestNovelAspect": "string (least novel part)",
  "improvementDirections": ["string array of suggestions"]
}`,
    // Legacy schema descriptions for backward compatibility
    InputNormalization: `{
  "coreEntity": "string",
  "intentGoal": "string",
  "constraints": ["string array"],
  "assumptions": ["string array"],
  "context": "string",
  "negativeConstraints": ["string array"],
  "knownComponents": ["string array"],
  "unknownsToAsk": ["string array"]
}`,
    Classification: `{
  "labels": [{"class": "PRODUCT_DEVICE|SYSTEM|...", "weight": 0.0-1.0, "rationaleShort": "reason"}],
  "dominantClass": "primary classification",
  "forkMode": "SINGLE|FORK|MERGE",
  "archetype": "MECH|ELEC|SOFT|CHEM|BIO|MIXED"
}`,
    DimensionGraph: `{
  "nodes": [{"id": "unique-id", "type": "SEED|DIMENSION|...", "title": "name", "descriptionShort": "desc", "whyItMatters": "importance", "typicalAssumption": "default assumption"}],
  "edges": [{"from": "source-id", "to": "target-id", "relation": "contains|enables|..."}]
}`,
    NoveltyGate: `{
  "originalityStrength": "HIGH | MEDIUM | LOW",
  "noveltyRiskLevel": "LOW | MODERATE | HIGH",
  "likelyExaminerObjection": "string",
  "redundancyRisk": "string",
  "strongestNovelAspect": "string",
  "weakestNovelAspect": "string",
  "improvementDirections": ["string array"]
}`,
    SuggestedMovesResponse: `{
  "moves": [
    {
      "id": "move-id",
      "move": "What if we <specific action>?",
      "impact": "immediate effect",
      "leadsTo": "new constraint or opportunity",
      "tension": "what assumption this challenges",
      "challengesPrior": true/false,
      "modifies": "BEHAVIOR_OVER_TIME|ARCHITECTURE_CONTROL_FLOW|INTERFACE_BOUNDARY|FAILURE_MODE_LIFECYCLE"
    }
  ],
  "contextAcknowledged": true/false,
  "priorSelectionsUsed": ["id-of-prior-selection"]
}`,
  };
  return descriptions[schemaName] || 'Schema not found';
}

/**
 * Safely parse JSON from LLM response with repair attempt
 */
export function safeParseJson<T>(
  jsonString: string,
  schema: z.ZodSchema<T>
): { success: true; data: T } | { success: false; error: string } {
  try {
    let cleaned = jsonString.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      cleaned = jsonMatch[1].trim();
    }
    
    // Handle array responses
    const firstBrace = cleaned.indexOf('{');
    const firstBracket = cleaned.indexOf('[');
    
    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      // Array response
      const lastBracket = cleaned.lastIndexOf(']');
      if (lastBracket > firstBracket) {
        cleaned = cleaned.slice(firstBracket, lastBracket + 1);
      }
    } else if (firstBrace !== -1) {
      // Object response
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
    }
    
    const parsed = JSON.parse(cleaned);
    const result = schema.safeParse(parsed);
    
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      return {
        success: false,
        error: `Validation failed: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      };
    }
  } catch (e) {
    return {
      success: false,
      error: `JSON parse error: ${e instanceof Error ? e.message : 'Unknown error'}`
    };
  }
}

/**
 * Validate an IdeaFrame array
 */
export function validateIdeaFrames(data: unknown): IdeaFrame[] {
  const arraySchema = z.array(IdeaFrameSchema);
  const result = arraySchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw new Error(`Invalid idea frames: ${result.error.message}`);
}
