/**
 * Generate Mechanism-Pure Ideas API (SRS Section 3.6)
 * 
 * POST - Generate idea frames with exactly ONE causal mechanism each
 * 
 * RULE: If more than ONE causal mechanism is required → discard and regenerate.
 * NO prior art search. NO obviousness gating.
 * 
 * QUOTA ENFORCEMENT: Each successful idea generation counts as one "ideation run"
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';
import type { IdeaFrame, NoveltyGate } from '@/lib/ideation/schemas';
import { enforceServiceAccess } from '@/lib/service-access-middleware';
import { checkTrialQuota } from '@/lib/trial-plan-service';
import { trackServiceUsage } from '@/lib/service-usage-tracker';

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

    // Get user's tenant info for quota checks
    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      select: { id: true, tenantId: true },
    });

    if (!user?.tenantId) {
      return NextResponse.json(
        { error: 'User not associated with tenant' },
        { status: 403 }
      );
    }

    // ENFORCEMENT: Check organizational service access (Tenant Admin controlled)
    const serviceCheck = await enforceServiceAccess(
      user.id,
      user.tenantId,
      'IDEATION'
    );
    if (!serviceCheck.allowed) {
      return serviceCheck.response;
    }

    // ENFORCEMENT: Check trial-specific quotas (ideation run limits)
    const trialQuotaCheck = await checkTrialQuota(user.id, 'ideation');
    if (!trialQuotaCheck.allowed) {
      return NextResponse.json(
        { 
          error: trialQuotaCheck.reason,
          code: 'QUOTA_EXCEEDED',
          remaining: trialQuotaCheck.remaining 
        },
        { status: 403 }
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
    // TRACKING: Record successful ideation run completion for quota enforcement
    // One "ideation run" = one successful call to generateIdeas
    // =========================================================================
    // NOTE: Wrapped in try-catch to prevent tracking failures from breaking
    // successful generations. Tracking is important but not worth failing
    // an otherwise successful operation.
    if (ideas.length > 0 && user.tenantId) {
      try {
        await trackServiceUsage({
          tenantId: user.tenantId,
          userId: user.id,
          serviceType: 'IDEATION',
          operationId: `${sessionId}-generate-${Date.now()}`, // Unique per generation
          operationType: 'IDEA_GENERATION',
          isCompleted: true, // Each successful generation is a completion
          metadata: {
            sessionId,
            ideasGenerated: ideas.length,
            recipeIntent: recipe.recipeIntent,
          }
        });
      } catch (trackingError) {
        // Log the error but don't fail the request - the user's generation succeeded
        console.error('[IdeationGenerate] Failed to track service usage (non-blocking):', trackingError);
      }
    }

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
