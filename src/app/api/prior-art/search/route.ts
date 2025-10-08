import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { priorArtSearchService } from '@/lib/prior-art-search';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Force dynamic rendering - this route accesses request headers
export const dynamic = 'force-dynamic';

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

    const { bundleId, includeScholar = false } = await request.json();

    if (!bundleId) {
      return NextResponse.json({ error: 'Bundle ID required' }, { status: 400 });
    }

    // Verify bundle exists and is approved
    const bundle = await prisma.priorArtSearchBundle.findUnique({
      where: { id: bundleId },
      select: {
        id: true,
        status: true,
        createdBy: true,
      },
    });

    if (!bundle) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
    }

    if (bundle.status !== 'APPROVED') {
      return NextResponse.json({ error: 'Bundle must be approved before search' }, { status: 400 });
    }

    if (bundle.createdBy !== payload.sub) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Check user credits
    const credits = await prisma.userCredit.findUnique({
      where: { userId: payload.sub },
    });

    if (!credits || credits.usedCredits >= credits.totalCredits) {
      return NextResponse.json({
        error: 'Insufficient credits',
        remaining: credits ? credits.totalCredits - credits.usedCredits : 0
      }, { status: 402 });
    }

    // Start the search (async)
    const runId = await priorArtSearchService.executeSearch(bundleId, payload.sub, includeScholar);

    // Update credits
    await prisma.userCredit.update({
      where: { userId: payload.sub },
      data: {
        usedCredits: { increment: 1 },
        lastSearchAt: new Date(),
      },
    });

    return NextResponse.json({
      runId,
      message: 'Search started successfully',
      creditsRemaining: (credits.totalCredits - credits.usedCredits - 1),
    });

  } catch (error) {
    console.error('Search execution error:', error);
    return NextResponse.json({
      error: 'Search execution failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
