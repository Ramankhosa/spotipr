import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail } from '@/lib/whitespace/service'
import { emptyWhitespaceScope } from '@/lib/whitespace/types'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const studies = await prisma.whitespaceStudy.findMany({
    where: { userId: auth.user.id, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
    take: 50,
    select: {
      id: true,
      title: true,
      scopeVersion: true,
      role: true,
      kind: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { runs: true, clusters: true, hypotheses: true } },
    },
  })

  return NextResponse.json({ studies })
}

export async function POST(request: NextRequest) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.error?.message || 'Unauthorized' },
      { status: auth.error?.status || 401 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const kind = body?.kind === 'INVENTION' ? 'INVENTION' : 'FIELD'

  // Invention studies arrive as a structured brief; it is kept verbatim for
  // display and recompiles, and flattened into seedText for the compiler.
  const rawInvention = (body?.invention ?? null) as Record<string, unknown> | null
  const invention =
    kind === 'INVENTION' && rawInvention
      ? {
          problem: typeof rawInvention.problem === 'string' ? rawInvention.problem.trim().slice(0, 4000) : '',
          approach: typeof rawInvention.approach === 'string' ? rawInvention.approach.trim().slice(0, 4000) : '',
          constraints:
            typeof rawInvention.constraints === 'string' ? rawInvention.constraints.trim().slice(0, 2000) : '',
        }
      : null
  const inventionText = invention
    ? [
        invention.problem ? `PROBLEM: ${invention.problem}` : null,
        invention.approach ? `APPROACH: ${invention.approach}` : null,
        invention.constraints ? `CONSTRAINTS: ${invention.constraints}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const seedText =
    typeof body?.seedText === 'string' && body.seedText.trim()
      ? body.seedText.slice(0, 60000)
      : inventionText || null
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : 'Untitled study'

  const scope = emptyWhitespaceScope()
  scope.title = title === 'Untitled study' ? '' : title

  const study = await prisma.whitespaceStudy.create({
    data: {
      userId: auth.user.id,
      tenantId: auth.user.tenantId || null,
      title,
      seedText,
      role: typeof body?.role === 'string' ? body.role.slice(0, 40) : null,
      kind,
      inventionJson: invention ? (invention as unknown as Prisma.InputJsonValue) : undefined,
      scope: scope as unknown as Prisma.InputJsonValue,
    },
  })

  await appendTrail(
    study.id,
    'SYSTEM',
    `user:${auth.user.id}`,
    kind === 'INVENTION' ? 'Invention study created' : 'Study created'
  )
  return NextResponse.json({ study }, { status: 201 })
}
