import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Force dynamic rendering - this route accesses request headers
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Extract and verify JWT token
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const payload = verifyJWT(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    // Get all runs for the user with bundle patent info
    const runs = await prisma.priorArtRun.findMany({
      where: { userId: payload.sub },
      include: {
        bundle: {
          select: {
            id: true,
            patentId: true,
            inventionBrief: true,
            bundleData: true,
          },
        },
        _count: {
          select: { rawResults: true, queryVariants: true },
        },
      },
      orderBy: { startedAt: 'desc' },
    });

    // Get novelty assessments for these runs (handle case where tables don't exist yet)
    let assessmentMap = new Map();

    try {
      const runIds = runs.map(run => run.id);
      const noveltyAssessments = await prisma.noveltyAssessmentRun.findMany({
        where: {
          runId: { in: runIds },
          userId: payload.sub,
        },
        select: {
          id: true,
          runId: true,
          status: true,
          finalDetermination: true,
        },
      });

      // Create a map of runId to novelty assessment
      noveltyAssessments.forEach(assessment => {
        if (assessment.runId) {
          const run = runs.find(r => r.id === assessment.runId);
          assessmentMap.set(assessment.runId, {
            id: assessment.id,
            status: assessment.status,
            determination: assessment.finalDetermination,
            reportUrl: (assessment.status === 'NOVEL' || assessment.status === 'NOT_NOVEL' || assessment.status === 'DOUBT_RESOLVED') && run
              ? `/api/patents/${run.bundle.patentId}/novelty-assessment/${assessment.id}/report`
              : undefined,
          });
        }
      });

      console.log(`✅ Found ${noveltyAssessments.length} novelty assessments for ${runIds.length} runs`);
    } catch (noveltyError) {
      // Novelty assessment tables don't exist yet - this is expected before migrations
      console.log('ℹ️ Novelty assessment tables not available yet (run migrations first)');
      console.log('📋 Runs will be returned without novelty assessment data');
    }

    return NextResponse.json({
      runs: runs.map(run => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        creditsConsumed: run.creditsConsumed,
        apiCallsMade: run.apiCallsMade,
        level0: {
          checked: (run as any).level0Checked,
          determination: (run as any).level0Determination,
          reportUrl: (run as any).level0ReportUrl,
        },
        resultsCount: run._count.rawResults,
        bundle: {
          inventionBrief: run.bundle.inventionBrief,
          bundleData: run.bundle.bundleData,
        },
        noveltyAssessment: assessmentMap.get(run.id),
      })),
    });

  } catch (error) {
    console.error('Get runs error:', error);
    return NextResponse.json({
      error: 'Failed to retrieve search runs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
