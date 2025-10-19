import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Force dynamic rendering - this route accesses request headers
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
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

    const { runId } = params;

    // Get the specific run with detailed information
    const run = await prisma.priorArtRun.findFirst({
      where: {
        id: runId,
        userId: payload.sub
      },
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
    });

    if (!run) {
      return NextResponse.json({ error: 'Run not found or access denied' }, { status: 404 });
    }

    // Get novelty assessment for this run if it exists
    let noveltyAssessment = null;
    try {
      const assessment = await prisma.noveltyAssessmentRun.findFirst({
        where: {
          runId: runId,
          userId: payload.sub,
        },
        select: {
          id: true,
          status: true,
          finalDetermination: true,
          finalRemarks: true,
          stage1Results: true,
          stage2Results: true,
          novelAspects: true,
          nonNovelAspects: true,
          confidenceLevel: true,
        },
      });

      if (assessment) {
        noveltyAssessment = {
          id: assessment.id,
          status: assessment.status,
          determination: assessment.finalDetermination,
          remarks: assessment.finalRemarks,
          stage1Results: assessment.stage1Results,
          stage2Results: assessment.stage2Results,
          novelAspects: assessment.novelAspects,
          nonNovelAspects: assessment.nonNovelAspects,
          confidenceLevel: assessment.confidenceLevel,
          reportUrl: (assessment.status === 'NOVEL' || assessment.status === 'NOT_NOVEL' || assessment.status === 'DOUBT_RESOLVED')
            ? `/api/patents/${run.bundle.patentId}/novelty-assessment/${assessment.id}/report`
            : undefined,
        };
      }
    } catch (noveltyError) {
      // Novelty assessment tables don't exist yet - this is expected
      console.log('ℹ️ Novelty assessment tables not available yet');
    }

    return NextResponse.json({
      id: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      creditsConsumed: run.creditsConsumed,
      apiCallsMade: run.apiCallsMade,
      level0Checked: (run as any).level0Checked,
      level0Determination: (run as any).level0Determination,
      level0Results: (run as any).level0Results,
      level0ReportUrl: (run as any).level0ReportUrl,
      resultsCount: run._count.rawResults,
      bundle: {
        inventionBrief: run.bundle.inventionBrief,
        bundleData: run.bundle.bundleData,
      },
      noveltyAssessment,
    });

  } catch (error) {
    console.error('Get run error:', error);
    return NextResponse.json({
      error: 'Failed to retrieve search run',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
