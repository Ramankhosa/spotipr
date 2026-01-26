/**
 * Ideation Sessions API
 * 
 * GET  - List all ideation sessions for the user
 * POST - Create a new ideation session
 * 
 * QUOTA ENFORCEMENT: Service access is checked before creating sessions
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';
import { enforceServiceAccess } from '@/lib/service-access-middleware';
import { checkTrialQuota } from '@/lib/trial-plan-service';

export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      select: { id: true, tenantId: true },
    });

    if (!user?.tenantId) {
      return NextResponse.json({ error: 'User not associated with tenant' }, { status: 403 });
    }

    const sessions = await IdeationService.listSessions(user.id, user.tenantId);

    return NextResponse.json({
      success: true,
      sessions: sessions.map(s => ({
        id: s.id,
        seedText: s.seedText,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        ideaCount: s._count.ideaFrames,
        nodeCount: s._count.nodes,
      })),
    });
  } catch (error) {
    console.error('Failed to list ideation sessions:', error);
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await authenticateUser(request);
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authResult.user.id },
      select: { id: true, tenantId: true },
    });

    if (!user?.tenantId) {
      return NextResponse.json({ error: 'User not associated with tenant' }, { status: 403 });
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

    // ENFORCEMENT: Check trial-specific quotas before creating session
    // This provides early feedback to trial users who have exhausted their quota
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

    const body = await request.json();
    const { seedText, seedGoal, seedConstraints, budgetCap } = body;

    if (!seedText || typeof seedText !== 'string' || seedText.trim().length < 10) {
      return NextResponse.json(
        { error: 'Seed text must be at least 10 characters' },
        { status: 400 }
      );
    }

    const ideationSession = await IdeationService.createSession({
      tenantId: user.tenantId,
      userId: user.id,
      seedText: seedText.trim(),
      seedGoal: seedGoal?.trim(),
      seedConstraints: Array.isArray(seedConstraints) ? seedConstraints : [],
      budgetCap: budgetCap || 'MEDIUM',
    });

    return NextResponse.json({
      success: true,
      session: {
        id: ideationSession.id,
        status: ideationSession.status,
        seedText: ideationSession.seedText,
      },
    });
  } catch (error) {
    console.error('Failed to create ideation session:', error);
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

