import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    const { patentId } = params

    // Get patent with project and creator details
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      },
      include: {
        project: {
          include: {
            user: true,
            applicantProfile: true
          }
        },
        creator: true
      }
    })

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      )
    }

    return NextResponse.json({ patent })

  } catch (error) {
    console.error('GET /api/patents/[patentId] error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  try {
    const authResult = await authenticateUser(request)
    if (!authResult.user) {
      return NextResponse.json(
        { error: authResult.error?.message },
        { status: authResult.error?.status || 401 }
      )
    }

    const { patentId } = params
    const body = await request.json()
    const { title } = body

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }

    // Check patent access
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        OR: [
          { createdBy: authResult.user.id },
          {
            project: {
              OR: [
                { userId: authResult.user.id },
                { collaborators: { some: { userId: authResult.user.id } } }
              ]
            }
          }
        ]
      }
    })

    if (!patent) {
      return NextResponse.json(
        { error: 'Patent not found or access denied' },
        { status: 404 }
      )
    }

    // Update patent
    const updatedPatent = await prisma.patent.update({
      where: { id: patentId },
      data: { title: title.trim() },
      include: {
        project: {
          include: {
            user: true,
            applicantProfile: true
          }
        },
        creator: true
      }
    })

    return NextResponse.json({ patent: updatedPatent })

  } catch (error) {
    console.error('PATCH /api/patents/[patentId] error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { patentId: string } }
) {
  // Patent deletion is disabled to prevent abuse
  // Users must contact support to delete patents
  return NextResponse.json(
    { 
      error: 'Patent deletion is disabled. Please contact support if you need to remove a patent.',
      code: 'DELETION_DISABLED'
    }, 
    { status: 403 }
  )
}
