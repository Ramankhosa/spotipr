import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyJWT } from '@/lib/auth'

async function getUserFromRequest(request: NextRequest) {
  // Extract token from Authorization header
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null
  }

  const token = authHeader.substring(7) // Remove 'Bearer ' prefix

  // Verify JWT
  const payload = verifyJWT(token)
  if (!payload || !payload.email) {
    return null
  }

  return payload.email
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, patentId } = params
    const body = await request.json()
    const { html, textPlain } = body

    if (!html || typeof html !== 'string' || html.trim().length === 0) {
      return NextResponse.json({ error: 'Annexure content cannot be empty' }, { status: 400 })
    }

    // Check if user has access to the project (owner or collaborator)
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: userEmail } },
          { collaborators: { some: { user: { email: userEmail } } } }
        ]
      }
    })

    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Verify patent exists and belongs to the project
    const patent = await prisma.patent.findFirst({
      where: {
        id: patentId,
        projectId
      }
    })

    if (!patent) {
      return NextResponse.json({ error: 'Patent not found' }, { status: 404 })
    }

    // Get the latest revision number
    const latestVersion = await prisma.annexureVersion.findFirst({
      where: { patentId },
      orderBy: { rev: 'desc' }
    })

    const nextRev = latestVersion ? latestVersion.rev + 1 : 1

    // Get user ID
    const user = await prisma.user.findUnique({ where: { email: userEmail } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Create new annexure version
    const annexureVersion = await prisma.annexureVersion.create({
      data: {
        patentId,
        rev: nextRev,
        html: html.trim(),
        textPlain: textPlain || '',
        createdBy: user.id,
      },
    })

    return NextResponse.json({
      annexureVersion,
      message: 'Annexure saved successfully'
    }, { status: 201 })
  } catch (error) {
    console.error('Failed to save annexure:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string; patentId: string } }
) {
  try {
    const userEmail = await getUserFromRequest(request)

    if (!userEmail) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { projectId, patentId } = params

    // Check if user has access to the project (owner or collaborator)
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: userEmail } },
          { collaborators: { some: { user: { email: userEmail } } } }
        ]
      }
    })

    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Get the latest annexure version
    const latestVersion = await prisma.annexureVersion.findFirst({
      where: { patentId },
      orderBy: { rev: 'desc' }
    })

    if (!latestVersion) {
      return NextResponse.json({ annexure: null, message: 'No annexure found' })
    }

    return NextResponse.json({ annexure: latestVersion })
  } catch (error) {
    console.error('Failed to fetch annexure:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
