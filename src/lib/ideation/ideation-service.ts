/**
 * Patent Ideation Engine Service
 * 
 * PatentNest.ai - Ideation Engine (Refactored per SRS)
 * 
 * IMPORTANT: This is a PRELIMINARY NOVELTY ASSESSMENT system.
 * - NO patent databases are searched
 * - NO legal novelty claims are made
 * - This is an invention-thinking system, NOT a patent clearance system
 * 
 * Pipeline (Internal Only - UI MUST NOT show stage names):
 * SEED_INPUT → SEMANTIC_GROUNDING → INVENTIVE_FRAMING → 
 * DIMENSION_DISCOVERY → DIMENSION_EXPANSION → IDEA_GENERATION → 
 * PRELIMINARY_NOVELTY_ASSESSMENT
 */

import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import {
  SemanticGroundingSchema,
  InventiveFramingSchema,
  DimensionDiscoverySchema,
  DimensionExpansionSchema,
  IdeaFrameSchema,
  PreliminaryNoveltyAssessmentSchema,
  DimensionGraphSchema,
  SuggestedMovesResponseSchema,
  SuggestedMoveSchema,
  safeParseJson,
  getSchemaDescription,
  TRIZ_OPERATORS,
  type SemanticGrounding,
  type InventiveFraming,
  type DimensionDiscovery,
  type PrimaryDimension,
  type DimensionExpansion,
  type IdeaFrame,
  type PreliminaryNoveltyAssessment,
  type DimensionGraph,
  type DimensionNode,
  type CombineRecipe,
  type TrizOperator,
  type SuggestedMove,
  type SuggestedMovesResponse,
  type ExpandedDimensionGraph,
  type SuggestedMovePayloadType,
  // Legacy types for backward compatibility
  type InputNormalization,
  type Classification,
  type NoveltyGate,
} from './schemas';
import type { 
  IdeationSession, 
  MindMapNode, 
  IdeaFrame as PrismaIdeaFrame,
  Prisma,
} from '@prisma/client';
import crypto from 'crypto';

// Import the LLM Gateway for proper API key handling
import { llmGateway } from '@/lib/metering/gateway'
import type { TaskCode } from '@prisma/client'

// =============================================================================
// TYPES
// =============================================================================

export interface CreateSessionInput {
  tenantId: string;
  userId: string;
  seedText: string;
  seedGoal?: string;
  seedConstraints?: string[];
  budgetCap?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ExpandNodeInput {
  sessionId: string;
  nodeId: string;
  depth?: number;
  requestHeaders: Record<string, string>;
  userInput?: string;
}

export interface GenerateIdeasInput {
  sessionId: string;
  recipe: CombineRecipe;
  requestHeaders: Record<string, string>;
  userGuidance?: string;
}

export interface NoveltyCheckInput {
  sessionId: string;
  ideaFrameId: string;
  requestHeaders: Record<string, string>;
}

export interface ExportToIdeaBankInput {
  sessionId: string;
  ideaFrameIds: string[];
  userId: string;
  tenantId: string;
  // User-selected improvement suggestions to include in export
  selectedSuggestions?: Record<string, string[]>;
}

// =============================================================================
// LLM INTEGRATION
// =============================================================================

async function callLLM(
  prompt: string,
  taskCode: string,
  sessionId: string,
  requestHeaders: Record<string, string>,
): Promise<{ response: string; tokensUsed: number; model: string }> {
  try {
    const result = await llmGateway.executeLLMOperation(
      { headers: requestHeaders },
      {
        taskCode: taskCode as TaskCode,
        stageCode: taskCode,
        prompt,
        parameters: {
          temperature: 0.7,
        },
        idempotencyKey: `ideation-${sessionId}-${taskCode}-${Date.now()}`,
        metadata: {
          sessionId,
          module: 'ideation',
        }
      }
    );

    if (!result.success || !result.response) {
      throw new Error(result.error?.message || 'LLM call failed');
    }

    const response = result.response.output;
    const tokensUsed = result.response.outputTokens || 0;
    const model = result.response.modelClass || 'unknown';

    const session = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    await prisma.ideationHistory.create({
      data: {
        sessionId,
        action: `LLM_CALL_${taskCode}`,
        stage: taskCode,
        inputJson: { prompt: prompt.slice(0, 1000) },
        outputJson: { response: response.slice(0, 1000) },
        userId: session?.userId || 'unknown',
        tokensUsed,
        modelUsed: model,
      },
    });

    return { response, tokensUsed, model };
  } catch (error) {
    console.error(`LLM call failed for ${taskCode}:`, error);
    throw error;
  }
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

export async function createSession(input: CreateSessionInput): Promise<IdeationSession> {
  const session = await prisma.ideationSession.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      seedText: input.seedText,
      seedGoal: input.seedGoal,
      seedConstraints: input.seedConstraints || [],
      budgetCap: input.budgetCap || 'MEDIUM',
      status: 'SEED_INPUT',
    },
  });

  await prisma.mindMapNode.create({
    data: {
      sessionId: session.id,
      nodeId: 'seed-root',
      type: 'SEED',
      title: input.seedText.slice(0, 100),
      description: input.seedText,
      state: 'EXPANDED',
      selectable: false,
      defaultExpanded: true,
      depth: 0,
      positionX: 50,
      positionY: 200,
    },
  });

  await prisma.ideationHistory.create({
    data: {
      sessionId: session.id,
      action: 'SESSION_CREATED',
      stage: 'SEED_INPUT',
      inputJson: { seedText: input.seedText },
      userId: input.userId,
    },
  });

  return session;
}

export async function getSession(sessionId: string) {
  return prisma.ideationSession.findUnique({
    where: { id: sessionId },
    include: {
      nodes: { orderBy: { createdAt: 'asc' } },
      edges: true,
      combineTray: true,
      ideaFrames: { orderBy: { createdAt: 'desc' } },
      evidenceResults: true,
    },
  });
}

export async function listSessions(userId: string, tenantId: string) {
  return prisma.ideationSession.findMany({
    where: { userId, tenantId },
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: {
        select: { ideaFrames: true, nodes: true },
      },
    },
  });
}

// =============================================================================
// STAGE 1: SEMANTIC_GROUNDING (Replaces normalizeSeed)
// =============================================================================

/**
 * SEMANTIC_GROUNDING - Understand the idea WITHOUT inventing, reframing, or solving.
 * 
 * CANONICAL PROMPT - DO NOT MODIFY WITHOUT REVIEW
 */
export async function semanticGrounding(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<SemanticGrounding> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  const prompt = `ROLE: Semantic Grounding Agent

TASK:
Understand the user's idea WITHOUT inventing, reframing, or solving it.

INPUT IDEA:
"""
${session.seedText}
"""

${session.seedGoal ? `STATED GOAL: ${session.seedGoal}` : ''}
${session.seedConstraints.length > 0 ? `USER CONSTRAINTS: ${session.seedConstraints.join(', ')}` : ''}

OUTPUT (VALID JSON ONLY):
${getSchemaDescription('SemanticGrounding')}

RULES:
- DO NOT propose solutions
- DO NOT invent contradictions
- DO NOT assume technical domains
- Prefer "unknown" over guessing
- Generate 3-5 clarification questions maximum
- Questions should help understand the WHAT and WHY, not suggest solutions`;

  const { response, tokensUsed, model } = await callLLM(
    prompt,
    'IDEATION_NORMALIZE', // Using existing task code for compatibility
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, SemanticGroundingSchema);
  
  if (!parsed.success) {
    throw new Error(`Semantic grounding failed: ${parsed.error}`);
  }

  const groundingContext: SemanticGrounding = {
    coreEntity: parsed.data.coreEntity,
    currentApproach: parsed.data.currentApproach || '',
    userIntent: parsed.data.userIntent,
    explicitConstraints: parsed.data.explicitConstraints ?? [],
    implicitAssumptions: parsed.data.implicitAssumptions ?? [],
    ambiguityFlags: parsed.data.ambiguityFlags ?? [],
    clarificationQuestions: parsed.data.clarificationQuestions ?? [],
  };

  // Persist as groundingContext (read-only for downstream stages)
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      normalizationJson: groundingContext as any,
      status: groundingContext.clarificationQuestions.length > 0 ? 'CLARIFYING' : 'CLASSIFYING',
    },
  });

  return groundingContext;
}

// Legacy alias for backward compatibility
export const normalizeSeed = semanticGrounding;

// =============================================================================
// STAGE 2: INVENTIVE_FRAMING (Replaces contradiction logic)
// =============================================================================

/**
 * INVENTIVE_FRAMING - Identify real tensions ONLY if they exist.
 * 
 * CANONICAL PROMPT - DO NOT MODIFY WITHOUT REVIEW
 */
export async function inventiveFraming(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<InventiveFraming> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (!session.normalizationJson) {
    throw new Error('Session must have grounding context before inventive framing');
  }

  const groundingContext = session.normalizationJson as SemanticGrounding;

  const prompt = `ROLE: Inventive Framing Agent

INPUT:
${JSON.stringify(groundingContext, null, 2)}

TASK:
Identify genuine inventive tensions ONLY if they naturally exist.

OUTPUT (VALID JSON):
${getSchemaDescription('InventiveFraming')}

RULES:
- If no real contradiction exists, return empty arrays
- DO NOT force TRIZ-style conflicts
- DO NOT invent technical problems
- Only identify tensions that are INHERENT to the idea
- The patentableProblemStatement should focus on what makes this inventive, not just the wish`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_CLASSIFY', // Using existing task code
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, InventiveFramingSchema);
  
  if (!parsed.success) {
    // Return empty framing if parsing fails - don't block the pipeline
    const fallback: InventiveFraming = {
      technicalContradictions: [],
      nonTechnicalTensions: [],
      assumptionToChallenge: undefined,
      patentableProblemStatement: undefined,
    };
    return fallback;
  }

  // Store inventive framing
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      classificationJson: {
        inventiveFraming: parsed.data,
      },
      status: 'EXPANDING',
    },
  });

  return {
    technicalContradictions: parsed.data.technicalContradictions ?? [],
    nonTechnicalTensions: parsed.data.nonTechnicalTensions ?? [],
    assumptionToChallenge: parsed.data.assumptionToChallenge,
    patentableProblemStatement: parsed.data.patentableProblemStatement,
  };
}

// Legacy alias
export const classifyInvention = inventiveFraming;

// =============================================================================
// STAGE 3: DIMENSION_DISCOVERY (Replaces fixed dimension families)
// =============================================================================

/**
 * DIMENSION_DISCOVERY - Discover invention-specific dimensions.
 * 
 * CANONICAL PROMPT - DO NOT MODIFY WITHOUT REVIEW
 */
export async function dimensionDiscovery(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<DimensionDiscovery> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
  });

  if (!session.normalizationJson) {
    throw new Error('Session must have grounding context');
  }

  const groundingContext = session.normalizationJson as SemanticGrounding;
  const inventiveFraming = (session.classificationJson as any)?.inventiveFraming || {};

  const prompt = `ROLE: Dimension Discovery Agent

INPUT:
Grounding Context:
${JSON.stringify(groundingContext, null, 2)}

Inventive Framing:
${JSON.stringify(inventiveFraming, null, 2)}

TASK:
Identify invention-specific dimensions that control success or failure.

OUTPUT (VALID JSON):
${getSchemaDescription('DimensionDiscovery')}

RULES:
- Generate 4 to 6 dimensions ONLY
- Dimensions must emerge FROM THE INVENTION
- No generic/template dimensions allowed
- Each dimension must have:
  * A specific name relevant to THIS invention
  * Why it matters for THIS specific problem
  * The typical assumption people make about this dimension
- excludedDimensions: List dimensions that are NOT relevant (to show intentional scoping)`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_EXPAND',
    sessionId,
    requestHeaders,
  );

  const parsed = safeParseJson(response, DimensionDiscoverySchema);
  
  if (!parsed.success) {
    throw new Error(`Dimension discovery failed: ${parsed.error}`);
  }

  // Store discovered dimensions
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      classificationJson: {
        ...(session.classificationJson as object || {}),
        dimensionDiscovery: parsed.data,
      },
    },
  });

  return {
    inventionArchetype: parsed.data.inventionArchetype,
    primaryDimensions: parsed.data.primaryDimensions,
    excludedDimensions: parsed.data.excludedDimensions ?? [],
  };
}

// =============================================================================
// DIMENSION INITIALIZATION (Creates mind map nodes from discovered dimensions)
// =============================================================================

export async function initializeDimensions(sessionId: string): Promise<MindMapNode[]> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: sessionId },
    include: { nodes: true },
  });

  const dimensionDiscovery = (session.classificationJson as any)?.dimensionDiscovery as DimensionDiscovery | undefined;

  if (!dimensionDiscovery) {
    throw new Error('Session must have dimension discovery before initialization');
  }

  const primaryDimensions = dimensionDiscovery.primaryDimensions;
  const groundingContext = session.normalizationJson as SemanticGrounding;

  const nodesToCreate: Prisma.MindMapNodeCreateManyInput[] = [];
  const edgesToCreate: Prisma.MindMapEdgeCreateManyInput[] = [];

  const LEVEL_WIDTH = 480;
  const NODE_HEIGHT = 390; // Large spacing (340 + 50px gap) to prevent overlap
  const START_X = 100;
  const START_Y = 100;

  const seedY = START_Y + (primaryDimensions.length * NODE_HEIGHT) / 2;

  // Update existing seed node
  await prisma.mindMapNode.update({
    where: {
      sessionId_nodeId: {
        sessionId,
        nodeId: 'seed-root',
      },
    },
    data: {
      title: groundingContext?.coreEntity || 'Seed Idea',
      positionX: START_X,
      positionY: seedY,
    },
  });

  // Create dimension nodes from discovered dimensions
  primaryDimensions.forEach((dim, idx) => {
    const yPos = START_Y + (idx * NODE_HEIGHT);
    
    nodesToCreate.push({
      sessionId,
      nodeId: dim.dimensionId,
      type: 'DIMENSION_FAMILY', // Discovered dimensions
      title: dim.name,
      description: dim.whyItMatters,
      family: dim.name,
      state: 'COLLAPSED',
      selectable: false,
      defaultExpanded: false,
      depth: 1,
      parentNodeId: 'seed-root',
      positionX: START_X + LEVEL_WIDTH,
      positionY: yPos,
      payloadJson: {
        whyItMatters: dim.whyItMatters,
        typicalAssumption: dim.typicalAssumption,
        dimensionId: dim.dimensionId,
      },
    });

    edgesToCreate.push({
      sessionId,
      fromNodeId: 'seed-root',
      toNodeId: dim.dimensionId,
      relation: 'has_dimension',
    });
  });

  // Store TRIZ operators for the combine tray (keeping for backward compatibility)
  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      classificationJson: {
        ...(session.classificationJson as object),
        applicableOperators: TRIZ_OPERATORS.slice(0, 10).map(op => ({
          id: op.id,
          name: op.name,
          description: op.description,
          examples: op.examples,
        })),
      },
    },
  });

  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  await prisma.ideationSession.update({
    where: { id: sessionId },
    data: { status: 'EXPLORING' },
  });

  return prisma.mindMapNode.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
  });
}

// =============================================================================
// STAGE 4: DIMENSION_EXPANSION (Assumption-breaking moves)
// =============================================================================

/**
 * Get context from previously selected dimensions
 */
async function getSelectedDimensionsContext(sessionId: string): Promise<{
  selectedMoves: Array<{ id: string; title: string; impact: string; family: string }>;
  hasContext: boolean;
}> {
  const combineTray = await prisma.combineTray.findUnique({
    where: { sessionId },
  });

  const selectedDimensionIds = combineTray?.selectedDimensions ?? [];
  if (!combineTray || selectedDimensionIds.length === 0) {
    return { selectedMoves: [], hasContext: false };
  }

  const selectedNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId,
      nodeId: { in: selectedDimensionIds },
    },
  });

  const selectedMoves = selectedNodes.map(n => ({
    id: n.nodeId,
    title: n.title,
    impact: (n.payloadJson as any)?.impact || n.description || '',
    family: n.family || '',
  }));

  return { selectedMoves, hasContext: selectedMoves.length > 0 };
}

/**
 * DIMENSION_EXPANSION - Generate assumption-breaking moves, NOT features.
 * 
 * CANONICAL PROMPT - DO NOT MODIFY WITHOUT REVIEW
 */
export async function expandDimensionNode(input: ExpandNodeInput): Promise<DimensionGraph> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { nodes: true },
  });

  const node = session.nodes.find(n => n.nodeId === input.nodeId);
  if (!node) {
    throw new Error(`Node ${input.nodeId} not found`);
  }

  const groundingContext = session.normalizationJson as SemanticGrounding;
  const inventiveFraming = (session.classificationJson as any)?.inventiveFraming || {};
  const nodePayload = node.payloadJson as any || {};

  const { selectedMoves, hasContext } = await getSelectedDimensionsContext(input.sessionId);

  const contextSection = hasContext 
    ? `
PREVIOUSLY SELECTED MOVES (Consider for context):
${selectedMoves.map((m, i) => `${i + 1}. [${m.family}] ${m.title} → ${m.impact}`).join('\n')}
`
    : '';

  const userInputSection = input.userInput?.trim() 
    ? `
⚡ USER DIRECTION (HIGH PRIORITY - MUST ADDRESS):
"${input.userInput.trim()}"
`
    : '';

  const prompt = `ROLE: Assumption-Breaking Inventor

DIMENSION:
${node.title}

TYPICAL ASSUMPTION:
${nodePayload.typicalAssumption || 'Not specified'}

RELATED TENSION:
${inventiveFraming.assumptionToChallenge || 'None identified'}

INVENTION CONTEXT:
- Core Entity: ${groundingContext?.coreEntity || 'Not specified'}
- User Intent: ${groundingContext?.userIntent || 'Not specified'}
${contextSection}${userInputSection}

TASK:
Generate 3–5 assumption-breaking invention moves.

OUTPUT (VALID JSON ARRAY):
[
  {
    "moveText": "What if we...",
    "primaryChange": "REMOVE | INVERT | DECOUPLE | RELOCATE | DELAY | REPLACE | COMBINE | SIMPLIFY",
    "immediateEffect": "what happens immediately",
    "newProblemCreated": "what new problem this creates",
    "contradictionAddressed": "which tension this addresses (optional)"
  }
]

FORBIDDEN:
- Feature addition
- Parameter tuning
- AI / sensor / cloud stacking
- Generic "optimize" or "improve" suggestions

Each move must represent a STRUCTURAL CHANGE, not an incremental improvement.`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_EXPAND',
    input.sessionId,
    input.requestHeaders,
  );

  // Try to parse as array of moves
  const arraySchema = z.array(z.object({
    moveText: z.string(),
    primaryChange: z.enum(['REMOVE', 'INVERT', 'DECOUPLE', 'RELOCATE', 'DELAY', 'REPLACE', 'COMBINE', 'SIMPLIFY']),
    immediateEffect: z.string(),
    newProblemCreated: z.string(),
    contradictionAddressed: z.string().optional(),
  }));

  let moves: z.infer<typeof arraySchema>;
  const parsed = safeParseJson(response, arraySchema);
  
  if (!parsed.success) {
    // Fallback to legacy format
    const legacyParsed = safeParseJson(response, SuggestedMovesResponseSchema);
    if (legacyParsed.success) {
      moves = legacyParsed.data.moves.map(m => ({
        moveText: m.move,
        primaryChange: 'INVERT' as const,
        immediateEffect: m.impact,
        newProblemCreated: m.leadsTo,
        contradictionAddressed: m.tension,
      }));
    } else {
        throw new Error(`Expansion failed: ${parsed.error}`);
      }
  } else {
    moves = parsed.data;
  }

  // Generate unique IDs
  const parentSlug = input.nodeId.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 30);
  const uniqueSuffix = Date.now().toString(36);
  
  const existingNodeIds = session.nodes.map(n => n.nodeId);
  const newMoves = moves.map((m, idx) => ({
    ...m,
    id: `${parentSlug}-${uniqueSuffix}-${idx}`,
  })).filter(m => !existingNodeIds.includes(m.id));
  
  // Layout calculations
  const LEVEL_WIDTH = 480;
  const NODE_HEIGHT = 430; // Large spacing (380 + 50px gap) to prevent overlap
  const parentX = node.positionX || 50;
  const parentY = node.positionY || 200;
  const parentDepth = node.depth || 0;
  
  const totalHeight = (newMoves.length - 1) * NODE_HEIGHT;
  let currentY = parentY - (totalHeight / 2);

  const nodesToCreate = newMoves.map((m) => {
    const nodeY = currentY;
    currentY += NODE_HEIGHT;
    
    return {
      sessionId: input.sessionId,
      nodeId: m.id,
      type: 'DIMENSION_OPTION' as const, // Assumption-breaking moves (uses DimensionNode for proper formatting)
      title: m.moveText,
      description: m.immediateEffect,
      family: node.family || node.title,
      tags: [m.primaryChange],
      state: 'COLLAPSED' as const,
      selectable: true,
      defaultExpanded: false,
      depth: parentDepth + 1,
      parentNodeId: input.nodeId,
      positionX: parentX + LEVEL_WIDTH,
      positionY: nodeY,
      payloadJson: {
        move: m.moveText,
        impact: m.immediateEffect,
        leadsTo: m.newProblemCreated,
        tension: m.contradictionAddressed,
        primaryChange: m.primaryChange,
        newProblemCreated: m.newProblemCreated,
        contradictionAddressed: m.contradictionAddressed,
        isSuggestedMove: true,
      },
    };
  });

  const edgesToCreate = newMoves.map(m => ({
    sessionId: input.sessionId,
    fromNodeId: input.nodeId,
    toNodeId: m.id,
    relation: 'suggests_move',
  }));

  if (nodesToCreate.length > 0) {
    await prisma.mindMapNode.createMany({ 
      data: nodesToCreate,
      skipDuplicates: true,
    });
  }
  
  if (edgesToCreate.length > 0) {
    await prisma.mindMapEdge.createMany({ 
      data: edgesToCreate,
      skipDuplicates: true,
    });
  }

  await prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state: 'EXPANDED' },
  });
    
  const createdNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId: input.sessionId,
      OR: [
        { nodeId: { in: newMoves.map(m => m.id) } },
        { parentNodeId: input.nodeId },
      ],
    },
  });

  const createdEdges = await prisma.mindMapEdge.findMany({
    where: {
      sessionId: input.sessionId,
      fromNodeId: input.nodeId,
    },
  });

  const result: ExpandedDimensionGraph = {
    nodes: createdNodes.map(n => ({
      id: n.nodeId,
      type: n.type,
      title: n.title,
      descriptionShort: n.description || undefined,
      family: n.family || undefined,
      selectable: n.selectable,
      defaultExpanded: n.defaultExpanded,
      tags: n.tags,
      parentId: n.parentNodeId || undefined,
      positionX: n.positionX,
      positionY: n.positionY,
      state: n.state,
      depth: n.depth,
      payloadJson: n.payloadJson as SuggestedMovePayloadType | Record<string, unknown> | undefined,
      whyItMatters: (n.payloadJson as any)?.whyItMatters,
      typicalAssumption: (n.payloadJson as any)?.typicalAssumption,
    })),
    edges: createdEdges.map(e => ({
      from: e.fromNodeId,
      to: e.toNodeId,
      relation: e.relation || 'suggests_move',
    })),
  };

  return result as DimensionGraph;
}

// =============================================================================
// COMBINE TRAY
// =============================================================================

export async function updateCombineTray(
  sessionId: string,
  components: string[],
  dimensions: string[],
  operators: string[],
  intent: string = 'DIVERGENT',
  count: number = 5
) {
  const recipe = {
    selectedComponents: components,
    selectedDimensions: dimensions,
    selectedOperators: operators,
    recipeIntent: intent,
    count,
  };

  return prisma.combineTray.upsert({
    where: { sessionId },
    create: {
      sessionId,
      selectedComponents: components,
      selectedDimensions: dimensions,
      selectedOperators: operators,
      recipeIntent: intent.toLowerCase(),
      requestedCount: count,
      recipeJson: recipe,
    },
    update: {
      selectedComponents: components,
      selectedDimensions: dimensions,
      selectedOperators: operators,
      recipeIntent: intent.toLowerCase(),
      requestedCount: count,
      recipeJson: recipe,
    },
  });
}

// =============================================================================
// STAGE 5: IDEA_GENERATION (Mechanism-Pure)
// =============================================================================

/**
 * IDEA_GENERATION - Generate patent ideas with EXACTLY ONE causal mechanism.
 * 
 * CANONICAL PROMPT - DO NOT MODIFY WITHOUT REVIEW
 */
export async function generateIdeas(input: GenerateIdeasInput): Promise<IdeaFrame[]> {
  const session = await prisma.ideationSession.findUniqueOrThrow({
    where: { id: input.sessionId },
    include: { nodes: true, combineTray: true },
  });

  const groundingContext = session.normalizationJson as SemanticGrounding;
  const inventiveFraming = (session.classificationJson as any)?.inventiveFraming || {};

  // Get selected node details
  const selectedNodes = session.nodes.filter(n => 
    input.recipe.selectedComponents.includes(n.nodeId) ||
    input.recipe.selectedDimensions.includes(n.nodeId) ||
    input.recipe.selectedOperators.includes(n.nodeId)
  );

  const dimensionDetails = selectedNodes
    .filter(n => n.type === 'DIMENSION_FAMILY' || n.type === 'OPERATOR' || n.type === 'DIMENSION_OPTION')
    .map(n => {
      const payload = n.payloadJson as any || {};
      return `${n.title}: ${payload.impact || n.description || 'No description'}`;
    });

  const prompt = `ROLE: Patent Idea Generator

TASK:
Generate ${input.recipe.count} patent-worthy ideas.

EACH IDEA MUST CONTAIN EXACTLY ONE CAUSAL MECHANISM.

INVENTION CONTEXT:
- Core Entity: ${groundingContext?.coreEntity || 'Not specified'}
- User Intent: ${groundingContext?.userIntent || 'Not specified'}
- Assumption to Challenge: ${inventiveFraming.assumptionToChallenge || 'None identified'}
${inventiveFraming.patentableProblemStatement ? `- Problem Statement: ${inventiveFraming.patentableProblemStatement}` : ''}

SELECTED DIMENSIONS/MOVES:
${dimensionDetails.join('\n') || 'None selected - generate broadly'}

${input.userGuidance ? `USER GUIDANCE (HIGH PRIORITY): ${input.userGuidance}` : ''}

OUTPUT (VALID JSON ARRAY):
[
  {
    "ideaId": "unique-id",
    "coreMechanism": "A single sentence describing the ONE primary inventive mechanism (REQUIRED)",
    "inventiveLeap": "The non-obvious insight (REQUIRED)",
    "eliminatedAssumption": "What traditional assumption is eliminated",
    "contradictionResolved": "Which contradiction this resolves",
    "whyNotObvious": "Why a skilled person would NOT arrive at this (REQUIRED)",
    "mechanismBoundaryTest": {
      "whatItDoesNotSolve": "Explicit non-goals",
      "outOfScope": "Areas outside scope"
    },
    "title": "Short title for display",
    "problem": "Problem being solved",
    "principle": "One-liner core principle"
  }
]

RULE:
If more than ONE causal mechanism is required → discard and regenerate.

FORBIDDEN:
- Additive mechanisms (add sensor + add AI + add cloud)
- Multiple independent mechanisms in one idea
- Vague mechanisms like "optimize" or "improve"`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_GENERATE',
    input.sessionId,
    input.requestHeaders,
  );

  let ideas: IdeaFrame[];
  try {
    const cleaned = response.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : cleaned;
    
    const firstBracket = jsonStr.indexOf('[');
    const lastBracket = jsonStr.lastIndexOf(']');
    const arrayStr = jsonStr.slice(firstBracket, lastBracket + 1);
    
    const parsed = JSON.parse(arrayStr);
    ideas = parsed.map((idea: any) => ({
      ...idea,
      ideaId: idea.ideaId || `idea-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      coreMechanism: idea.coreMechanism || idea.principle || '',
      inventiveLeap: idea.inventiveLeap || '',
      whyNotObvious: idea.whyNotObvious || '',
      title: idea.title || idea.coreMechanism?.slice(0, 100) || 'Untitled Idea',
      problem: idea.problem || groundingContext?.userIntent || '',
      principle: idea.principle || idea.coreMechanism || '',
      classLabels: idea.classLabels || [],
      components: idea.components || [],
      mechanismSteps: idea.mechanismSteps || [],
      constraintsSatisfied: idea.constraintsSatisfied || [],
      operatorsUsed: idea.operatorsUsed || [],
      dimensionsUsed: idea.dimensionsUsed || [],
      variants: idea.variants || [],
      claimHooks: idea.claimHooks || [],
      riskNotes: idea.riskNotes || [],
      searchQueries: idea.searchQueries || [],
    }));
  } catch (e) {
    console.error('Failed to parse ideas:', e);
    throw new Error('Failed to generate valid ideas');
  }

  // Store ideas in database
  const createdFrames = await Promise.all(
    ideas.map(async (idea) => {
      return prisma.ideaFrame.create({
        data: {
          sessionId: input.sessionId,
          ideaFrameJson: idea as any,
          title: idea.title,
          problem: idea.problem,
          principle: idea.principle,
          technicalEffect: idea.coreMechanism, // Map coreMechanism to technicalEffect for display
          classLabels: idea.classLabels,
          operatorsUsed: idea.operatorsUsed,
          dimensionsUsed: idea.dimensionsUsed,
          componentsUsed: idea.components,
          status: 'DRAFT',
        },
      });
    })
  );

  await prisma.ideationSession.update({
    where: { id: input.sessionId },
    data: { status: 'REVIEWING' },
  });

  return ideas;
}

// =============================================================================
// STAGE 6: PRELIMINARY_NOVELTY_ASSESSMENT (LLM-Only, No Prior Art)
// =============================================================================

/**
 * PRELIMINARY_NOVELTY_ASSESSMENT - LLM-only assessment of conceptual originality.
 * 
 * IMPORTANT: This is NOT a legal novelty determination.
 * No patent databases are searched. No clearance is implied.
 * 
 * CANONICAL PROMPT - DO NOT MODIFY WITHOUT REVIEW
 */
export async function checkNovelty(input: NoveltyCheckInput): Promise<NoveltyGate> {
  const ideaFrame = await prisma.ideaFrame.findUniqueOrThrow({
    where: { id: input.ideaFrameId },
    include: { session: true },
  });

  const idea = ideaFrame.ideaFrameJson as IdeaFrame;

  // Get the grounding context for problem domain understanding
  const groundingContext = ideaFrame.session.normalizationJson as any || {};
  
  const prompt = `ROLE: Examiner Simulation Agent & Invention Advisor

IMPORTANT:
This is a PRELIMINARY NOVELTY ASSESSMENT.
No patent databases are available.

PROBLEM DOMAIN CONTEXT:
- Core Problem: ${groundingContext.userIntent || idea.problem || 'Not specified'}
- Core Entity: ${groundingContext.coreEntity || 'Not specified'}
- Constraints: ${groundingContext.explicitConstraints?.join(', ') || 'None specified'}
- Assumptions: ${groundingContext.implicitAssumptions?.join(', ') || 'None specified'}

IDEA BEING ASSESSED:
${JSON.stringify({
    coreMechanism: idea.coreMechanism,
    inventiveLeap: idea.inventiveLeap,
    whyNotObvious: idea.whyNotObvious,
    eliminatedAssumption: idea.eliminatedAssumption,
    contradictionResolved: idea.contradictionResolved,
    title: idea.title,
    problem: idea.problem,
    principle: idea.principle,
  }, null, 2)}

TASK:
1. Assess conceptual originality and novelty risk
2. Provide HOLISTIC improvement directions that focus on the PROBLEM DOMAIN, not just the specific solution

For improvementDirections, generate 4-6 suggestions that:
- Address the CORE PROBLEM from different angles
- Consider alternative technical approaches within the problem domain
- Suggest complementary mechanisms that could strengthen the invention
- Identify opportunities to broaden or narrow scope strategically
- Focus on practical enhancements the inventor can act upon

Each suggestion should be a complete, actionable idea statement (not a generic tip).

OUTPUT (VALID JSON):
${getSchemaDescription('PreliminaryNoveltyAssessment')}

RULES:
- Do NOT claim legal novelty
- Do NOT reference patents
- Prefer conservative judgments
- Focus on CONCEPTUAL originality
- improvementDirections should be HOLISTIC ideas considering the full problem domain
- Each improvement direction should be specific enough to be actionable`;

  const { response } = await callLLM(
    prompt,
    'IDEATION_NOVELTY',
    ideaFrame.session.id,
    input.requestHeaders,
  );

  const parsed = safeParseJson(response, PreliminaryNoveltyAssessmentSchema);
  
  if (!parsed.success) {
    // Return default assessment
    const fallback: NoveltyGate = {
      query: '',
      results: [],
      conceptSaturation: 'MEDIUM',
      solutionSaturation: 'MEDIUM',
      noveltyScore: 50,
      recommendedAction: 'KEEP',
      reasoning: 'Assessment could not be completed',
      originalityStrength: 'MEDIUM',
      noveltyRiskLevel: 'MODERATE',
      likelyExaminerObjection: 'Unable to assess',
      redundancyRisk: 'Unknown',
      strongestNovelAspect: idea.inventiveLeap || 'Not identified',
      weakestNovelAspect: 'Not identified',
      improvementDirections: [],
      closestPriorArt: [],
      obviousnessFlags: [],
      suggestedIterations: [],
    };

    await prisma.ideaFrame.update({
      where: { id: input.ideaFrameId },
      data: {
        noveltyScore: fallback.noveltyScore,
        noveltySummaryJson: fallback as any,
      },
    });
    
    return fallback;
  }

  // Map preliminary assessment to NoveltyGate format for backward compatibility
  const assessment = parsed.data;

  // Convert originality strength to numeric score
  const scoreMap = { 'HIGH': 80, 'MEDIUM': 50, 'LOW': 25 };
  const noveltyScore = scoreMap[assessment.originalityStrength] || 50;

  const result: NoveltyGate = {
    query: '',
    results: [],
    conceptSaturation: assessment.originalityStrength === 'LOW' ? 'HIGH' : assessment.originalityStrength === 'HIGH' ? 'LOW' : 'MEDIUM',
    solutionSaturation: assessment.noveltyRiskLevel === 'HIGH' ? 'HIGH' : assessment.noveltyRiskLevel === 'LOW' ? 'LOW' : 'MEDIUM',
    noveltyScore,
    recommendedAction: noveltyScore >= 60 ? 'KEEP' : 'MUTATE_DIMENSION',
    reasoning: `Originality: ${assessment.originalityStrength}, Risk: ${assessment.noveltyRiskLevel}`,

    // New fields from preliminary assessment
    originalityStrength: assessment.originalityStrength,
    noveltyRiskLevel: assessment.noveltyRiskLevel,
    likelyExaminerObjection: assessment.likelyExaminerObjection,
    redundancyRisk: assessment.redundancyRisk,
    strongestNovelAspect: assessment.strongestNovelAspect,
    weakestNovelAspect: assessment.weakestNovelAspect,
    improvementDirections: assessment.improvementDirections ?? [],

    // Legacy fields (empty - no prior art search)
    patentsAnalyzed: 0,
    closestPriorArt: [],
    priorArtSummary: 'This is a preliminary assessment. Perform exhaustive prior-art search before filing.',
    obviousnessFlags: [],
    suggestedIterations: assessment.improvementDirections ?? [],
  };
  
  await prisma.ideaFrame.update({
    where: { id: input.ideaFrameId },
    data: {
      noveltyScore: result.noveltyScore,
      noveltySummaryJson: result as any,
      conceptSaturation: result.conceptSaturation,
      solutionSaturation: result.solutionSaturation,
    },
  });

  return result;
}

// =============================================================================
// ALIAS FUNCTIONS FOR API ROUTES
// =============================================================================

/**
 * generateMechanismPureIdeas - Alias for generateIdeas (SRS Section 3.6)
 * 
 * Each idea MUST contain exactly ONE causal mechanism.
 */
export async function generateMechanismPureIdeas(input: GenerateIdeasInput): Promise<IdeaFrame[]> {
  return generateIdeas(input);
}

/**
 * preliminaryNoveltyAssessment - Alias for checkNovelty (SRS Section 3.7)
 * 
 * IMPORTANT: This is a PRELIMINARY assessment only.
 * No patent databases are searched. No clearance is implied.
 */
export async function preliminaryNoveltyAssessment(input: NoveltyCheckInput): Promise<NoveltyGate> {
  return checkNovelty(input);
}

// =============================================================================
// LEGACY: CONTRADICTION MAPPING (Kept for backward compatibility)
// =============================================================================

export async function mapContradictions(
  sessionId: string,
  requestHeaders: Record<string, string>
): Promise<any> {
  // Redirect to inventive framing
  return inventiveFraming(sessionId, requestHeaders);
}

// =============================================================================
// LEGACY: OBVIOUSNESS FILTER (DEPRECATED - Returns pass-through)
// =============================================================================

export async function checkObviousness(
  sessionId: string,
  selectedDimensions: string[],
  requestHeaders: Record<string, string>
): Promise<any> {
  // Per SRS: No obviousness gating logic
  // Return a pass-through result
  return {
    combinationNovelty: 70,
    obviousnessFlags: [],
    dimensionQualityScores: [],
    suggestedAnalogySources: [],
    shouldProceed: true,
  };
}

// =============================================================================
// EXPORT TO IDEA BANK
// =============================================================================

export async function exportToIdeaBank(input: ExportToIdeaBankInput): Promise<string[]> {
  const ideaFrames = await prisma.ideaFrame.findMany({
    where: {
      id: { in: input.ideaFrameIds },
      sessionId: { not: undefined },
    },
    include: { session: true },
  });

  const createdIds: string[] = [];

  for (const frame of ideaFrames) {
    const idea = frame.ideaFrameJson as IdeaFrame;
    const noveltyData = frame.noveltySummaryJson as any;
    
    // Build description with core mechanism, inventive leap, and selected suggestions
    let description = `Core Mechanism:\n${idea.coreMechanism || idea.principle || ''}\n\n`;
    description += `Inventive Leap:\n${idea.inventiveLeap || ''}\n\n`;
    description += `Why Non-Obvious:\n${idea.whyNotObvious || ''}\n\n`;
    
    if (idea.eliminatedAssumption) {
      description += `Eliminated Assumption:\n${idea.eliminatedAssumption}\n\n`;
    }
    
    // Include user-selected improvement suggestions if any
    const selectedForThisIdea = input.selectedSuggestions?.[frame.id] || [];
    if (selectedForThisIdea.length > 0) {
      description += `Selected Improvement Directions:\n`;
      selectedForThisIdea.forEach((suggestion, idx) => {
        description += `${idx + 1}. ${suggestion}\n`;
      });
      description += '\n';
    }
    
    // Include preliminary assessment summary if available
    if (noveltyData?.originalityStrength) {
      description += `Preliminary Assessment:\n`;
      description += `- Originality: ${noveltyData.originalityStrength}\n`;
      description += `- Risk Level: ${noveltyData.noveltyRiskLevel}\n`;
      if (noveltyData.strongestNovelAspect) {
        description += `- Strongest Aspect: ${noveltyData.strongestNovelAspect}\n`;
      }
    }

    // potentialApplications should contain actual applications/uses of the invention, NOT improvement suggestions
    // Improvement suggestions are assessment feedback and stay in the description only
    const actualApplications = idea.variants?.map(v => v.title).filter(Boolean) || [];
    
    const ideaBankIdea = await prisma.ideaBankIdea.create({
      data: {
        title: idea.title || idea.coreMechanism?.slice(0, 100) || 'Untitled Idea',
        description: description.trim(),
        abstract: idea.coreMechanism || idea.technicalEffect || '',
        domainTags: idea.classLabels,
        technicalField: frame.classLabels[0] || 'General',
        noveltyScore: frame.noveltyScore ? frame.noveltyScore / 100 : null,
        status: 'PUBLIC',
        generatedBy: 'ideation-engine',
        keyFeatures: idea.components || [],
        potentialApplications: actualApplications, // Only actual applications, not improvement suggestions
        createdBy: input.userId,
        tenantId: input.tenantId,
        publishedAt: new Date(),
      },
    });

    createdIds.push(ideaBankIdea.id);

    await prisma.ideaFrame.update({
      where: { id: frame.id },
      data: {
        status: 'EXPORTED',
        exportedToIdeaId: ideaBankIdea.id,
        exportedAt: new Date(),
      },
    });
  }

  if (ideaFrames.length > 0) {
    await prisma.ideationHistory.create({
      data: {
        sessionId: ideaFrames[0].sessionId,
        action: 'EXPORTED_TO_IDEA_BANK',
        outputJson: { exportedIds: createdIds },
        userId: input.userId,
      },
    });
  }

  return createdIds;
}

// =============================================================================
// NODE OPERATIONS
// =============================================================================

export async function updateNodeState(
  sessionId: string,
  nodeId: string,
  state: 'EXPANDED' | 'COLLAPSED' | 'HIDDEN' | 'REMOVED' | 'SELECTED'
) {
  const node = await prisma.mindMapNode.findFirst({
    where: { sessionId, nodeId },
  });

  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  return prisma.mindMapNode.update({
    where: { id: node.id },
    data: { state },
  });
}

export async function updateNodePosition(
  sessionId: string,
  nodeId: string,
  x: number,
  y: number
) {
  const node = await prisma.mindMapNode.findFirst({
    where: { sessionId, nodeId },
  });

  if (!node) {
    throw new Error(`Node ${nodeId} not found`);
  }

  return prisma.mindMapNode.update({
    where: { id: node.id },
    data: { positionX: x, positionY: y },
  });
}

export async function undoNodeChanges(sessionId: string) {
  const hiddenNodes = await prisma.mindMapNode.findMany({
    where: {
      sessionId,
      state: { in: ['HIDDEN', 'REMOVED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 10,
  });

  await prisma.mindMapNode.updateMany({
    where: {
      id: { in: hiddenNodes.map(n => n.id) },
    },
    data: { state: 'COLLAPSED' },
  });

  return hiddenNodes.length;
}

// =============================================================================
// IDEA FRAME OPERATIONS
// =============================================================================

export async function updateIdeaStatus(
  ideaFrameId: string,
  status: 'DRAFT' | 'SHORTLISTED' | 'REJECTED' | 'ARCHIVED',
  notes?: string
) {
  return prisma.ideaFrame.update({
    where: { id: ideaFrameId },
    data: {
      status,
      userNotes: notes,
    },
  });
}

export async function rateIdea(ideaFrameId: string, rating: number) {
  if (rating < 1 || rating > 5) {
    throw new Error('Rating must be between 1 and 5');
  }

  return prisma.ideaFrame.update({
    where: { id: ideaFrameId },
    data: { userRating: rating },
  });
}

// =============================================================================
// SESSION CLEANUP
// =============================================================================

export async function archiveSession(sessionId: string) {
  return prisma.ideationSession.update({
    where: { id: sessionId },
    data: {
      status: 'ARCHIVED',
      completedAt: new Date(),
    },
  });
}

export async function deleteSession(sessionId: string) {
  return prisma.ideationSession.delete({
    where: { id: sessionId },
  });
}

// =============================================================================
// LEGACY EXPORTS (For backward compatibility)
// =============================================================================

export function getApplicableDimensions(): any[] {
  // Per SRS: No fixed dimension families
  return [];
}

export function getApplicableOperators(): TrizOperator[] {
  return TRIZ_OPERATORS.slice(0, 10);
}
