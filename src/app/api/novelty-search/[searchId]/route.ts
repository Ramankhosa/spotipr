import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService } from '@/lib/novelty-search-service';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hydrateNoveltyReportPatentMetadata } from '@/lib/novelty-report-metadata';
import { NoveltySearchStage, NoveltySearchStatus, Prisma } from '@prisma/client';
import { getNoveltyPublicStatus } from '@/lib/novelty-search-background-state';

const noveltySearchService = new NoveltySearchService();

function searchSourceIncludesEpo(mode: unknown): boolean {
  return mode === 'EPO_ONLY' || mode === 'PQAI_PLUS_EPO' || mode === 'PQAI_PLUS_INDIAN_EPO';
}

/**
 * GET /api/novelty-search/[searchId]
 * Get novelty search status and results
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }
    const jwtToken = authHeader.substring(7);

    const payload = verifyJWT(jwtToken);
    if (!payload?.sub) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true }
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const searchRun = await prisma.noveltySearchRun.findFirst({
      where: { id: searchId, userId: user.id },
      include: {
        llmCalls: { orderBy: { calledAt: 'desc' }, take: 10 },
        backgroundJob: true,
      }
    });
    if (!searchRun) return NextResponse.json({ error: 'Novelty search not found' }, { status: 404 });

    const enrichedSearchRun = await hydrateNoveltyReportPatentMetadata(searchRun);
    const publicStatus = getNoveltyPublicStatus(enrichedSearchRun as any);
    const isCancelled = publicStatus === 'CANCELLED';

    return NextResponse.json({
      success: true,
      search: {
        id: enrichedSearchRun.id,
        title: enrichedSearchRun.title,
        status: isCancelled ? 'CANCELLED' : enrichedSearchRun.status,
        publicStatus,
        currentStage: enrichedSearchRun.currentStage,
        jurisdiction: enrichedSearchRun.jurisdiction,
        filingType: enrichedSearchRun.filingType,
        createdAt: enrichedSearchRun.createdAt,
        stage0CompletedAt: enrichedSearchRun.stage0CompletedAt,
        stage1CompletedAt: enrichedSearchRun.stage1CompletedAt,
        stage35CompletedAt: enrichedSearchRun.stage35CompletedAt,
        stage4CompletedAt: enrichedSearchRun.stage4CompletedAt,
        reportUrl: isCancelled ? null : enrichedSearchRun.reportUrl,
        results: {
          stage0: enrichedSearchRun.stage0Results,
          stage1: enrichedSearchRun.stage1Results,
          stage35: enrichedSearchRun.stage35Results,
          stage4: enrichedSearchRun.stage4Results
        },
        recentActivity: searchRun.llmCalls.map(call => ({
          stage: call.stage,
          taskCode: call.taskCode,
          tokensUsed: call.tokensUsed,
          calledAt: call.calledAt
        }))
      }
    });
  } catch (error) {
    console.error('Get novelty search API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/novelty-search/[searchId]/resume
 * Resume a failed novelty search from the last completed stage
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }
    const jwtToken = authHeader.substring(7);

    const payload = verifyJWT(jwtToken);
    if (!payload?.sub) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true }
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const requestHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => { requestHeaders[key] = value; });

    const result = await noveltySearchService.resumeNoveltySearch(searchId, user.id, requestHeaders);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      searchId,
      status: result.status,
      currentStage: result.currentStage,
      results: result.results,
      message: 'Search resumed successfully'
    });
  } catch (error) {
    console.error('Resume search API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/novelty-search/[searchId]
 * Update novelty search stage data (e.g., edit Stage 0 results)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { searchId: string } }
) {
  try {
    const { searchId } = params;

    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Authorization token required' }, { status: 401 });
    }
    const jwtToken = authHeader.substring(7);

    const payload = verifyJWT(jwtToken);
    if (!payload?.sub) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true, tenantId: true }
    });
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const body = await request.json();
    const {
      stage,
      searchQuery,
      inventionFeatures,
      epoTitleKeywords,
      epoAbstractKeywords,
      epoCombinedKeywords,
      paperSearchQuery,
      paperKeywords,
      paperSearchQueries,
      googleScholarSearchQuery,
      academicDatabaseSearchQuery,
      paperYearFrom,
      paperYearTo,
    } = body;

    if (stage === 'stage0') {
      // Preserve LLM-detected archetype so user edits don't wipe it out
      const existing = await prisma.noveltySearchRun.findFirst({
        where: { id: searchId, userId: user.id }
      });
      const existingStage0 = (existing?.stage0Results as any) || {};
      const inventionType = Array.isArray(existingStage0.inventionType)
        ? existingStage0.inventionType
        : (existingStage0.inventionType ? [existingStage0.inventionType] : undefined);
      const cpcCodes = Array.isArray(existingStage0.cpcCodes) ? existingStage0.cpcCodes : undefined;
      const ipcCodes = Array.isArray(existingStage0.ipcCodes) ? existingStage0.ipcCodes : undefined;
      const includeEpoKeywords = searchSourceIncludesEpo((existing?.config as any)?.searchSource?.mode);
      const includePapers = Boolean((existing?.config as any)?.searchSource?.includePapers);
      const approvedSearchQuery = String(searchQuery || '').trim();
      const approvedFeatures = Array.isArray(inventionFeatures)
        ? inventionFeatures.map((feature: unknown) => String(feature || '').trim()).filter(Boolean)
        : [];
      const stage0Input: Record<string, unknown> = {
        ...existingStage0,
        searchQuery: approvedSearchQuery,
        inventionFeatures: approvedFeatures,
        ...(inventionType ? { inventionType } : {}),
        ...(cpcCodes ? { cpcCodes } : {}),
        ...(ipcCodes ? { ipcCodes } : {}),
      };
      if (includeEpoKeywords) {
        stage0Input.epoTitleKeywords = Array.isArray(epoTitleKeywords) ? epoTitleKeywords : existingStage0.epoTitleKeywords;
        stage0Input.epoAbstractKeywords = Array.isArray(epoAbstractKeywords) ? epoAbstractKeywords : existingStage0.epoAbstractKeywords;
        stage0Input.epoCombinedKeywords = Array.isArray(epoCombinedKeywords) ? epoCombinedKeywords : existingStage0.epoCombinedKeywords;
      } else {
        delete stage0Input.epoTitleKeywords;
        delete stage0Input.epo_title_keywords;
        delete stage0Input.epoAbstractKeywords;
        delete stage0Input.epo_abstract_keywords;
        delete stage0Input.epoCombinedKeywords;
        delete stage0Input.epo_combined_keywords;
      }
      if (includePapers) {
        stage0Input.paperSearchQuery = paperSearchQuery !== undefined ? paperSearchQuery : existingStage0.paperSearchQuery;
        stage0Input.paperKeywords = Array.isArray(paperKeywords) ? paperKeywords : existingStage0.paperKeywords;
        stage0Input.paperSearchQueries = Array.isArray(paperSearchQueries) ? paperSearchQueries : existingStage0.paperSearchQueries;
        stage0Input.googleScholarSearchQuery = googleScholarSearchQuery !== undefined ? googleScholarSearchQuery : existingStage0.googleScholarSearchQuery;
        stage0Input.academicDatabaseSearchQuery = academicDatabaseSearchQuery !== undefined ? academicDatabaseSearchQuery : existingStage0.academicDatabaseSearchQuery;
        stage0Input.paperYearFrom = paperYearFrom !== undefined ? paperYearFrom : existingStage0.paperYearFrom;
        stage0Input.paperYearTo = paperYearTo !== undefined ? paperYearTo : existingStage0.paperYearTo;
      } else {
        delete stage0Input.paperSearchQuery;
        delete stage0Input.paper_search_query;
        delete stage0Input.paperKeywords;
        delete stage0Input.paper_keywords;
        delete stage0Input.paperSearchQueries;
        delete stage0Input.paper_search_queries;
        delete stage0Input.googleScholarSearchQuery;
        delete stage0Input.google_scholar_search_query;
        delete stage0Input.academicDatabaseSearchQuery;
        delete stage0Input.academic_database_search_query;
        delete stage0Input.paperYearFrom;
        delete stage0Input.paper_year_from;
        delete stage0Input.paperYearTo;
        delete stage0Input.paper_year_to;
      }
      const normalizedStage0 = noveltySearchService.normalizeApprovedStage0(stage0Input as any, String(existing?.inventionDescription || ''));
      const stage0Changed = approvedSearchQuery !== String(existingStage0.searchQuery || '').trim() ||
        JSON.stringify(approvedFeatures) !== JSON.stringify(existingStage0.inventionFeatures || []) ||
        (includeEpoKeywords && (
          JSON.stringify(normalizedStage0.epoTitleKeywords || []) !== JSON.stringify(existingStage0.epoTitleKeywords || []) ||
          JSON.stringify(normalizedStage0.epoAbstractKeywords || []) !== JSON.stringify(existingStage0.epoAbstractKeywords || []) ||
          JSON.stringify(normalizedStage0.epoCombinedKeywords || []) !== JSON.stringify(existingStage0.epoCombinedKeywords || [])
        )) ||
        (includePapers && (
          String(normalizedStage0.paperSearchQuery || '') !== String(existingStage0.paperSearchQuery || '') ||
          JSON.stringify(normalizedStage0.paperKeywords || []) !== JSON.stringify(existingStage0.paperKeywords || []) ||
          JSON.stringify(normalizedStage0.paperSearchQueries || []) !== JSON.stringify(existingStage0.paperSearchQueries || []) ||
          String(normalizedStage0.googleScholarSearchQuery || '') !== String(existingStage0.googleScholarSearchQuery || '') ||
          String(normalizedStage0.academicDatabaseSearchQuery || '') !== String(existingStage0.academicDatabaseSearchQuery || '') ||
          Number(normalizedStage0.paperYearFrom || 0) !== Number(existingStage0.paperYearFrom || 0) ||
          Number(normalizedStage0.paperYearTo || 0) !== Number(existingStage0.paperYearTo || 0)
        ));

      await prisma.noveltySearchRun.update({
        where: { id: searchId, userId: user.id },
        data: {
          stage0Results: normalizedStage0 as any,
          ...(stage0Changed ? {
            status: NoveltySearchStatus.STAGE_0_COMPLETED,
            currentStage: NoveltySearchStage.STAGE_1,
            stage1CompletedAt: null,
            stage1Results: Prisma.JsonNull,
            stage35CompletedAt: null,
            stage35Results: Prisma.JsonNull,
            stage4CompletedAt: null,
            stage4Results: Prisma.JsonNull,
            reportUrl: null,
          } : {}),
        }
      });
      if (stage0Changed) {
        await (prisma as any).featureMapCell.deleteMany({ where: { searchId } });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Stage data updated successfully'
    });
  } catch (error) {
    console.error('PATCH /api/novelty-search/[searchId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
