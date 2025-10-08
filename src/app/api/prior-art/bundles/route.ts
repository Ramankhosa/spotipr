import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PrismaClient, PriorArtSearchMode, PriorArtSearchStatus } from '@prisma/client';

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

    const bundles = await prisma.priorArtSearchBundle.findMany({
      where: { createdBy: payload.sub },
      include: {
        _count: {
          select: { runs: true },
        },
        runs: {
          select: {
            id: true,
            status: true,
            startedAt: true,
            finishedAt: true,
          },
          orderBy: { startedAt: 'desc' },
          take: 1, // Latest run
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      bundles: bundles.map(bundle => ({
        id: bundle.id,
        patentId: bundle.patentId,
        mode: bundle.mode,
        status: bundle.status,
        inventionBrief: bundle.inventionBrief,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
        runCount: bundle._count.runs,
        latestRun: bundle.runs[0] || null,
      })),
    });

  } catch (error) {
    console.error('Get bundles error:', error);
    return NextResponse.json({
      error: 'Failed to retrieve bundles',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const { patentId, mode, brief, bundleData } = await request.json();

    if (!patentId || !mode) {
      return NextResponse.json({ error: 'Patent ID and mode required' }, { status: 400 });
    }

    // Verify patent exists and user has access
    const patent = await prisma.patent.findUnique({
      where: { id: patentId },
      select: { createdBy: true, project: { select: { userId: true } } },
    });

    if (!patent || (patent.createdBy !== payload.sub && patent.project.userId !== payload.sub)) {
      return NextResponse.json({ error: 'Patent not found or access denied' }, { status: 404 });
    }

    const bundle = await prisma.priorArtSearchBundle.create({
      data: {
        patentId,
        mode: mode as PriorArtSearchMode,
        status: mode === 'LLM' ? PriorArtSearchStatus.DRAFT : PriorArtSearchStatus.READY_FOR_REVIEW,
        briefRaw: mode === 'LLM' ? brief : null,
        inventionBrief: mode === 'MANUAL' ? brief : '',
        bundleData: bundleData || null,
        createdBy: payload.sub,
      },
    });

    return NextResponse.json({
      bundle: {
        id: bundle.id,
        patentId: bundle.patentId,
        mode: bundle.mode,
        status: bundle.status,
        inventionBrief: bundle.inventionBrief,
        createdAt: bundle.createdAt,
      },
    });

  } catch (error) {
    console.error('Create bundle error:', error);
    return NextResponse.json({
      error: 'Failed to create bundle',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
