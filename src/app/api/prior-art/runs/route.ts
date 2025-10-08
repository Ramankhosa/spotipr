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

    // Get all runs for the user
    const runs = await prisma.priorArtRun.findMany({
      where: { userId: payload.sub },
      include: {
        bundle: {
          select: {
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

    return NextResponse.json({
      runs: runs.map(run => ({
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        creditsConsumed: run.creditsConsumed,
        apiCallsMade: run.apiCallsMade,
        resultsCount: run._count.rawResults,
        bundle: {
          inventionBrief: run.bundle.inventionBrief,
          bundleData: run.bundle.bundleData,
        },
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
