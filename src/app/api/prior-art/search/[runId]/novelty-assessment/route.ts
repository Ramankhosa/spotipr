import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { NoveltyAssessmentService } from '@/lib/novelty-assessment';
import { PriorArtSearchService } from '@/lib/prior-art-search';
import { prisma } from '@/lib/prisma';

// Force dynamic rendering - this route accesses request headers
export const dynamic = 'force-dynamic';

export async function POST(
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

    // Verify the run exists and belongs to the user
    const run = await prisma.priorArtRun.findFirst({
      where: {
        id: runId,
        userId: payload.sub,
      },
      include: {
        bundle: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: 'Search run not found or access denied' }, { status: 404 });
    }

    if (run.status !== 'COMPLETED' && run.status !== 'COMPLETED_WITH_WARNINGS') {
      return NextResponse.json({
        error: 'Cannot start novelty assessment: search is not completed yet'
      }, { status: 400 });
    }

    // Check if novelty assessment tables exist
    let tablesExist = false;
    try {
      await prisma.noveltyAssessmentRun.findMany({ take: 1 });
      tablesExist = true;
    } catch (tableCheckError) {
      return NextResponse.json({
        error: 'Novelty assessment is not available yet. Please run database migrations first.'
      }, { status: 503 });
    }

    if (!tablesExist) {
      return NextResponse.json({
        error: 'Novelty assessment database tables not found. Please contact administrator.'
      }, { status: 503 });
    }

    console.log(`🧠 Starting manual novelty assessment for run: ${runId}`);

    // Get intersecting patents first, or fallback to top patents
    let level1Patents: Array<{
      publicationNumber: string;
      title: string;
      abstract: string;
      relevance: number;
      foundInVariants: string[];
      intersectionType: string;
    }> = [];

    // Get unified results for intersecting patents first
    const intersectingResults = await prisma.priorArtUnifiedResult.findMany({
      where: {
        runId,
        OR: [
          { intersectionType: 'I2' },
          { intersectionType: 'I3' },
          { shortlisted: true }
        ]
      },
      orderBy: { score: 'desc' },
      take: 25,
    });

    // If no intersecting patents, get top 15 most relevant
    const patentResults = intersectingResults.length > 0 ? intersectingResults : await prisma.priorArtUnifiedResult.findMany({
      where: { runId },
      orderBy: { score: 'desc' },
      take: 15,
    });

    // Build patent data
    for (const result of patentResults) {
      const patentData = await prisma.priorArtPatent.findUnique({
        where: { publicationNumber: result.publicationNumber },
        select: { title: true, abstract: true }
      });

      if (patentData && patentData.title && patentData.abstract) {
        level1Patents.push({
          publicationNumber: result.publicationNumber,
          title: patentData.title,
          abstract: patentData.abstract,
          relevance: result.score ? Math.round(Number(result.score) * 100) : 0,
          foundInVariants: result.foundInVariants,
          intersectionType: result.intersectionType,
        });
      }
    }

    if (level1Patents.length === 0) {
      return NextResponse.json({
        error: 'No patent data available for novelty assessment. Please ensure the search has results.'
      }, { status: 400 });
    }

    console.log(`📋 Analyzing ${level1Patents.length} patents for novelty assessment`);

    // Parse bundle data
    const bundleData = run.bundle.bundleData as any;
    const sourceSummary = bundleData?.source_summary || {};

    // Start the novelty assessment
    const assessmentResult = await NoveltyAssessmentService.performLevel1Assessment({
      patentId: run.bundle.patentId,
      runId: runId,
      jwtToken: token,
      inventionSummary: {
        title: sourceSummary.title || 'Unknown Title',
        problem: sourceSummary.problem_statement || '',
        solution: sourceSummary.solution_summary || '',
      },
      level1Patents: level1Patents,
    });

    console.log(`✅ Manual novelty assessment initiated: ${assessmentResult.determination}`);

    return NextResponse.json({
      success: true,
      message: 'Novelty assessment started successfully',
      determination: assessmentResult.determination,
      confidence: assessmentResult.confidence,
      assessmentId: assessmentResult.level1Results?.assessmentId,
    });

  } catch (error) {
    console.error('❌ Manual novelty assessment error:', error);
    return NextResponse.json({
      error: 'Failed to start novelty assessment',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
