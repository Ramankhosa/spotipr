import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateUser } from '@/lib/auth-middleware'

export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    const { projectId } = params

    // Check if user has access to the project (owner or collaborator)
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: user.email } },
          { collaborators: { some: { user: { email: user.email } } } }
        ]
      }
    })

    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Fetch all patents for the project
    const patents = await prisma.patent.findMany({
      where: {
        projectId
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json({ patents })
  } catch (error) {
    console.error('Failed to fetch patents:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  try {
    const { user, error } = await authenticateUser(request)
    if (error) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    const { projectId } = params
    const body = await request.json()
    const { title } = body

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: 'Patent title is required' }, { status: 400 })
    }

    // Check if user has access to the project (owner or collaborator)
    const projectAccess = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { user: { email: user.email } },
          { collaborators: { some: { user: { email: user.email } } } }
        ]
      }
    })

    if (!projectAccess) {
      return NextResponse.json({ error: 'Project not found or access denied' }, { status: 404 })
    }

    // Create patent
    const patent = await prisma.patent.create({
      data: {
        title: title.trim(),
        projectId,
        createdBy: user.id,
      },
    })

    return NextResponse.json({ patent }, { status: 201 })
  } catch (error) {
    console.error('Failed to create patent:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
