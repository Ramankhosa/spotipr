import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

async function getUserFromRequest(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No auth header or not Bearer token')
    return null
  }

  const token = authHeader.substring(7)
  console.log('Token received:', token.substring(0, 20) + '...')
  const payload = verifyJWT(token)
  console.log('JWT payload:', payload)
  if (!payload || !payload.email) {
    console.log('Invalid payload or missing email')
    return null
  }

  return payload.email
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { patentId: string; bundleId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId, bundleId } = params;
    const body = await request.json();
    const { bundleData, action } = body;

    // Get user details
    const user = await prisma.user.findUnique({ where: { email: userEmail } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify patent access and bundle ownership
    const bundle = await prisma.priorArtSearchBundle.findFirst({
      where: {
        id: bundleId,
        patent: {
          id: patentId,
          OR: [
            { createdBy: user.id },
            {
              project: {
                OR: [
                  { userId: user.id },
                  { collaborators: { some: { userId: user.id } } }
                ]
              }
            }
          ]
        }
      }
    });

    if (!bundle) {
      return NextResponse.json({ error: 'Bundle not found or access denied' }, { status: 404 });
    }

    if (action === 'validate') {
      // Validate the bundle data
      const { PriorArtValidation } = await import('@/lib/prior-art-schema');
      const validation = PriorArtValidation.validateBundle(bundleData);

      return NextResponse.json({
        validation,
        bundle: bundleData
      });
    }

    if (action === 'approve') {
      // Update bundle status to APPROVED
      const updatedBundle = await prisma.priorArtSearchBundle.update({
        where: { id: bundleId },
        data: {
          bundleData,
          status: 'APPROVED',
          approvedBy: user.id,
          approvedAt: new Date()
        },
        include: {
          creator: { select: { id: true, name: true, email: true } },
          approver: { select: { id: true, name: true, email: true } }
        }
      });

      return NextResponse.json({ bundle: updatedBundle });
    }

    // Regular update (save changes)
    const updatedBundle = await prisma.priorArtSearchBundle.update({
      where: { id: bundleId },
      data: {
        bundleData,
        status: bundle.status === 'DRAFT' ? 'READY_FOR_REVIEW' : bundle.status
      },
      include: {
        creator: { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true, email: true } }
      }
    });

    return NextResponse.json({ bundle: updatedBundle });

  } catch (error) {
    console.error('PUT /api/patents/[patentId]/prior-art/[bundleId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { patentId: string; bundleId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)
    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patentId, bundleId } = params;

    // Get user details
    const user = await prisma.user.findUnique({ where: { email: userEmail } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify patent access and bundle ownership
    const bundle = await prisma.priorArtSearchBundle.findFirst({
      where: {
        id: bundleId,
        patent: {
          id: patentId,
          OR: [
            { createdBy: user.id },
            {
              project: {
                OR: [
                  { userId: user.id },
                  { collaborators: { some: { userId: user.id } } }
                ]
              }
            }
          ]
        }
      }
    });

    if (!bundle) {
      return NextResponse.json({ error: 'Bundle not found or access denied' }, { status: 404 });
    }

    // Delete the bundle (cascade will handle related records)
    await prisma.priorArtSearchBundle.delete({
      where: { id: bundleId }
    });

    return NextResponse.json({ message: 'Bundle deleted successfully' });

  } catch (error) {
    console.error('DELETE /api/patents/[patentId]/prior-art/[bundleId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}