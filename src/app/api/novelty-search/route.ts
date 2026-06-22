import { NextRequest, NextResponse } from 'next/server';
import { NoveltySearchService, NoveltySearchRequest } from '../../../lib/novelty-search-service';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { enforceServiceAccess } from '@/lib/service-access-middleware';

const noveltySearchService = new NoveltySearchService();

/**
 * POST /api/novelty-search
 * Start a new novelty search
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      patentId,
      projectId,
      inventionDescription,
      title,
      groupId,
      executionMode,
      jurisdiction = 'IN',
      config
    } = body;

    const searchMode = config?.searchSource?.searchMode === 'manual' ? 'manual' : 'intelligent';
    const manualFilters = config?.searchSource?.filters || {};
    const hasManualCriteria = Object.values(manualFilters).some((value: any) => (
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== ''
    ));

    if (searchMode === 'intelligent' && (!inventionDescription || !title)) {
      return NextResponse.json(
        { error: 'inventionDescription and title are required' },
        { status: 400 }
      );
    }

    if (searchMode === 'manual' && !hasManualCriteria) {
      return NextResponse.json(
        { error: 'At least one manual patent search field is required' },
        { status: 400 }
      );
    }

    const manualSummary = Object.entries(manualFilters)
      .filter(([, value]: any) => Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && String(value).trim() !== '')
      .map(([key, value]: any) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('; ');

    const resolvedTitle = searchMode === 'manual'
      ? (String(title || '').trim() || 'Manual Patent Search')
      : title;
    const resolvedDescription = searchMode === 'manual'
      ? (String(inventionDescription || '').trim() || `Manual fielded patent search. ${manualSummary}`)
      : inventionDescription;

    // Get JWT token from authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization token required' },
        { status: 401 }
      );
    }

    const jwtToken = authHeader.substring(7);

    // Check organizational service access (Tenant Admin controlled)
    const payload = verifyJWT(jwtToken);
    if (payload?.sub) {
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, tenantId: true }
      });
      if (user?.tenantId) {
        const serviceCheck = await enforceServiceAccess(user.id, user.tenantId, 'NOVELTY_SEARCH');
        if (!serviceCheck.allowed) {
          return serviceCheck.response;
        }
      }
    }

    const searchRequest: NoveltySearchRequest = {
      patentId,
      projectId,
      groupId,
      jwtToken,
      inventionDescription: resolvedDescription,
      title: resolvedTitle,
      jurisdiction,
      config
    };

    const result = executionMode === 'legacy'
      ? await noveltySearchService.startNoveltySearch(searchRequest)
      : await noveltySearchService.enqueueNoveltySearch(searchRequest);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    if (executionMode === 'legacy') {
      return NextResponse.json({
        success: true,
        searchId: result.searchId,
        status: result.status,
        currentStage: result.currentStage,
        results: result.results,
      });
    }

    return NextResponse.json({
      success: true,
      searchId: result.searchId,
      status: 'QUEUED'
    }, { status: 202 });

  } catch (error) {
    console.error('Novelty search API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
