/**
 * Preliminary Novelty Assessment API (SRS Section 3.7)
 * 
 * POST - Run LLM-only preliminary novelty assessment on an idea frame
 * 
 * IMPORTANT: This is a PRELIMINARY assessment only.
 * NO patent databases are searched. NO legal novelty is claimed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticateUser } from '@/lib/auth-middleware';
import { prisma } from '@/lib/prisma';
import * as IdeationService from '@/lib/ideation/ideation-service';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

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
    const body = await request.json();
    const { ideaFrameId } = body;

    if (!ideaFrameId) {
      return NextResponse.json(
        { error: 'ideaFrameId is required' },
        { status: 400 }
      );
    }

    const ideationSession = await prisma.ideationSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });

    if (!ideationSession) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (ideationSession.userId !== authResult.user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Verify idea frame belongs to session
    const ideaFrame = await prisma.ideaFrame.findFirst({
      where: { id: ideaFrameId, sessionId },
    });

    if (!ideaFrame) {
      return NextResponse.json(
        { error: 'Idea frame not found in this session' },
        { status: 404 }
      );
    }

    // Extract request headers for LLM gateway authentication
    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      requestHeaders[key] = value;
    });

    // Run preliminary novelty assessment (LLM-only, no prior art search)
    const noveltyAssessment = await IdeationService.preliminaryNoveltyAssessment({
      sessionId,
      ideaFrameId,
      requestHeaders,
    });

    return NextResponse.json({
      success: true,
      noveltyAssessment,
      // NOTE: This does NOT claim legal novelty per SRS
      disclaimer: 'This is a preliminary novelty assessment. Perform exhaustive prior-art search before filing.',
    });
  } catch (error) {
    console.error('Failed to assess novelty:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to assess novelty' },
      { status: 500 }
    );
  }
}

