/**
 * Generate Mechanism-Pure Ideas API (SRS Section 3.6)
 * 
 * POST - Generate idea frames with exactly ONE causal mechanism each
 * 
 * RULE: If more than ONE causal mechanism is required → discard and regenerate.
 * NO prior art search. NO obviousness gating.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';
import type { IdeaFrame, NoveltyGate } from '@/lib/ideation/schemas';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

interface GenerateRequestBody {
  recipe?: {
    selectedComponents?: string[];
    selectedDimensions: string[];
    selectedOperators?: string[];
    recipeIntent: string;
    count: number;
    buckets?: any[];
    userGuidance?: string;  // User's guidance for idea generation
  };
  intent?: string;
  count?: number;
  userGuidance?: string;  // User's guidance for idea generation (alternative location)
}

// SRS: Each idea MUST contain exactly ONE causal mechanism

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const { sessionId } = await params;
    const body: GenerateRequestBody = await request.json();
    
    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      include: { combineTray: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Valid recipe intents
    type RecipeIntent = 'DIVERGENT' | 'CONVERGENT' | 'RISK_REDUCTION' | 'COST_REDUCTION';
    const validIntents: RecipeIntent[] = ['DIVERGENT', 'CONVERGENT', 'RISK_REDUCTION', 'COST_REDUCTION'];
    
    // Use tray from request or database
    const rawIntent = body.recipe?.recipeIntent || body.intent || ideationSession.combineTray?.recipeIntent || 'DIVERGENT';
    const recipeIntent: RecipeIntent = validIntents.includes(rawIntent as RecipeIntent) 
      ? (rawIntent as RecipeIntent) 
      : 'DIVERGENT';
    
    // Get user guidance from recipe or top-level body
    const userGuidance = body.recipe?.userGuidance || body.userGuidance || undefined;
    
    const recipe = {
      selectedComponents: body.recipe?.selectedComponents || ideationSession.combineTray?.selectedComponents || [],
      selectedDimensions: body.recipe?.selectedDimensions || ideationSession.combineTray?.selectedDimensions || [],
      selectedOperators: body.recipe?.selectedOperators || ideationSession.combineTray?.selectedOperators || [],
      recipeIntent,
      count: body.recipe?.count || body.count || ideationSession.combineTray?.requestedCount || 5,
      userGuidance,
    };

    // Validate minimum selections
    if (recipe.selectedDimensions.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one dimension' },
        { status: 400 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // =========================================================================
    // Generate mechanism-pure ideas (SRS Section 3.6)
    // Each idea MUST contain exactly ONE causal mechanism
    // =========================================================================
    let ideas = await IdeationService.generateMechanismPureIdeas({
      sessionId,
      recipe,
      requestHeaders,
      userGuidance: userGuidance?.trim() || undefined,
    });

    // =========================================================================
    // Prepare response with mechanism-pure idea data (SRS Section 5)
    // =========================================================================
    const enhancedIdeas = ideas.map(idea => ({
      ideaId: idea.ideaId,
      // Core mechanism-pure fields
      coreMechanism: idea.coreMechanism,
      inventiveLeap: idea.inventiveLeap,
      eliminatedAssumption: idea.eliminatedAssumption,
      contradictionResolved: idea.contradictionResolved,
      whyNotObvious: idea.whyNotObvious,
      mechanismBoundaryTest: idea.mechanismBoundaryTest,
    }));

    // Calculate quality metrics
    const ideasWithBoundaryTest = enhancedIdeas.filter(i => i.mechanismBoundaryTest).length;

    return NextResponse.json({
      success: true,
      ideas: enhancedIdeas,
      count: ideas.length,
      // Quality metrics
      qualityMetrics: {
        ideasWithBoundaryTest,
        boundaryTestRatio: ideas.length > 0 ? ideasWithBoundaryTest / ideas.length : 0,
      },
    });
  } catch (error) {
    console.error('Failed to generate ideas:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate ideas' },
      { status: 500 }
    );
  }
}
