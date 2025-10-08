import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { PrismaClient, PriorArtSearchStatus } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(
  request: NextRequest,
  { params }: { params: { bundleId: string } }
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

    const { bundleId } = params;

    const bundle = await prisma.priorArtSearchBundle.findUnique({
      where: { id: bundleId },
      include: {
        creator: {
          select: { name: true, email: true },
        },
        approver: {
          select: { name: true, email: true },
        },
        history: {
          orderBy: { timestamp: 'desc' },
          take: 10,
        },
      },
    });

    if (!bundle) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
    }

    if (bundle.createdBy !== payload.sub) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json({
      bundle: {
        id: bundle.id,
        patentId: bundle.patentId,
        mode: bundle.mode,
        status: bundle.status,
        briefRaw: bundle.briefRaw,
        inventionBrief: bundle.inventionBrief,
        bundleData: bundle.bundleData,
        createdBy: bundle.createdBy,
        approvedBy: bundle.approvedBy,
        approvedAt: bundle.approvedAt,
        createdAt: bundle.createdAt,
        updatedAt: bundle.updatedAt,
        creator: bundle.creator,
        approver: bundle.approver,
        recentHistory: bundle.history,
      },
    });

  } catch (error) {
    console.error('Get bundle error:', error);
    return NextResponse.json({
      error: 'Failed to retrieve bundle',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { bundleId: string } }
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

    const { bundleId } = params;
    const { action, bundleData, notes } = await request.json();

    const bundle = await prisma.priorArtSearchBundle.findUnique({
      where: { id: bundleId },
      select: { createdBy: true, status: true, bundleData: true },
    });

    if (!bundle) {
      return NextResponse.json({ error: 'Bundle not found' }, { status: 404 });
    }

    if (bundle.createdBy !== payload.sub) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    let updateData: any = {};
    let newStatus = bundle.status;

    if (action === 'update') {
      updateData.bundleData = bundleData;
      updateData.inventionBrief = bundleData?.source_summary?.problem_statement || '';

      // Create history entry
      await prisma.priorArtSearchHistory.create({
        data: {
          bundleId,
          action: 'EDITED',
          userId: payload.sub,
          previousData: bundle.bundleData as any,
          newData: bundleData as any,
          notes: notes || 'Bundle data updated',
        },
      });

    } else if (action === 'approve') {
      if (bundle.status !== PriorArtSearchStatus.READY_FOR_REVIEW) {
        return NextResponse.json({ error: 'Bundle not ready for approval' }, { status: 400 });
      }

      // Validate bundle data
      const validation = validateBundleData(bundleData);
      if (!validation.valid) {
        return NextResponse.json({
          error: 'Bundle validation failed',
          details: validation.errors
        }, { status: 400 });
      }

      updateData.status = PriorArtSearchStatus.APPROVED;
      updateData.approvedBy = payload.sub;
      updateData.approvedAt = new Date();
      newStatus = PriorArtSearchStatus.APPROVED;

      // Create history entry
      await prisma.priorArtSearchHistory.create({
        data: {
          bundleId,
          action: 'APPROVED',
          userId: payload.sub,
          previousData: bundle.bundleData as any,
          newData: bundleData as any,
          notes: notes || 'Bundle approved for search',
        },
      });

    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const updatedBundle = await prisma.priorArtSearchBundle.update({
      where: { id: bundleId },
      data: updateData,
    });

    return NextResponse.json({
      bundle: {
        id: updatedBundle.id,
        status: updatedBundle.status,
        approvedAt: updatedBundle.approvedAt,
        updatedAt: updatedBundle.updatedAt,
      },
    });

  } catch (error) {
    console.error('Update bundle error:', error);
    return NextResponse.json({
      error: 'Failed to update bundle',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

function validateBundleData(bundleData: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!bundleData) {
    errors.push('Bundle data is required');
    return { valid: false, errors };
  }

  // Check required fields
  if (!bundleData.source_summary?.title) {
    errors.push('Source summary title is required');
  }

  if (!bundleData.core_concepts || !Array.isArray(bundleData.core_concepts)) {
    errors.push('Core concepts must be an array');
  }

  if (!bundleData.query_variants || !Array.isArray(bundleData.query_variants)) {
    errors.push('Query variants are required');
  } else {
    if (bundleData.query_variants.length !== 3) {
      errors.push('Exactly 3 query variants required');
    }

    const labels = bundleData.query_variants.map((v: any) => v.label);
    if (!labels.includes('broad') || !labels.includes('baseline') || !labels.includes('narrow')) {
      errors.push('Must have broad, baseline, and narrow variants');
    }
  }

  // Check for sensitive tokens
  if (bundleData.sensitive_tokens && bundleData.sensitive_tokens.length > 0) {
    errors.push('Sensitive tokens must be empty before approval');
  }

  return { valid: errors.length === 0, errors };
}
