import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, computeSaturation, getOwnedSession } from '@/lib/prior-art-studio/service'
import {
  canonicalStudioFamilyKey,
  mergeCanonicalFamilyStates,
  studioFamilyAliasMap,
  studioFamilyKeyForState,
} from '@/lib/prior-art-studio/family-key'
import { scoreElements } from '@/lib/prior-art-studio/element-scoring'
import { validateStudioPlan } from '@/lib/prior-art-studio/plan-schema'
import type { StudioResultFamily } from '@/lib/prior-art-studio/types'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

const TAGS = new Set(['RELEVANT', 'MAYBE', 'NOT_RELEVANT'])

const TAG_LABEL: Record<string, string> = {
  RELEVANT: 'Relevant',
  MAYBE: 'Maybe',
  NOT_RELEVANT: 'Not relevant',
}

export async function POST(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const suppliedFamilyKey = typeof body?.familyKey === 'string' ? body.familyKey.slice(0, 120) : ''
  const publicationNumber = typeof body?.publicationNumber === 'string' ? body.publicationNumber.slice(0, 60) : ''
  if (!suppliedFamilyKey || !publicationNumber) {
    return NextResponse.json({ error: 'familyKey and publicationNumber are required.' }, { status: 400 })
  }
  const familyKey = canonicalStudioFamilyKey(suppliedFamilyKey, publicationNumber)
  const latestRun = await prisma.priorArtStudioRun.findFirst({
    where: { sessionId: session.id, status: 'COMPLETE' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, planSnapshot: true, results: true },
  })
  const families = Array.isArray(latestRun?.results)
    ? latestRun.results as unknown as StudioResultFamily[]
    : []
  const familyAliases = studioFamilyAliasMap(families)

  const tag = typeof body?.tag === 'string' && TAGS.has(body.tag) ? body.tag : body?.tag === null ? null : undefined
  const excluded = typeof body?.excluded === 'boolean' ? body.excluded : undefined
  const note = typeof body?.note === 'string' ? body.note.slice(0, 2000) : undefined

  const currentStates = await prisma.priorArtStudioDocState.findMany({ where: { sessionId: session.id } })
  const aliases = currentStates
    .filter(row => studioFamilyKeyForState(row, familyAliases) === familyKey)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  const latest = aliases[0]
  const state = await prisma.$transaction(async tx => {
    const saved = await tx.priorArtStudioDocState.upsert({
      where: { sessionId_familyKey: { sessionId: session.id, familyKey } },
      update: {
        publicationNumber,
        ...(tag !== undefined ? { tag } : latest ? { tag: latest.tag } : {}),
        ...(excluded !== undefined ? { excluded } : latest ? { excluded: latest.excluded } : {}),
        ...(note !== undefined ? { note } : latest ? { note: latest.note } : {}),
      },
      create: {
        sessionId: session.id,
        familyKey,
        publicationNumber,
        tag: tag !== undefined ? tag : latest?.tag ?? null,
        excluded: excluded !== undefined ? excluded : latest?.excluded ?? false,
        note: note !== undefined ? note : latest?.note ?? null,
      },
    })
    const duplicateIds = aliases.filter(row => row.id !== saved.id).map(row => row.id)
    if (duplicateIds.length) {
      await tx.priorArtStudioDocState.deleteMany({ where: { id: { in: duplicateIds } } })
    }
    return saved
  })

  const action =
    tag !== undefined
      ? tag
        ? `Tagged ${publicationNumber}: ${TAG_LABEL[tag] || tag}`
        : `Cleared tag on ${publicationNumber}`
      : excluded !== undefined
        ? excluded
          ? `Excluded family of ${publicationNumber}`
          : `Restored family of ${publicationNumber}`
        : `Noted ${publicationNumber}`
  await appendTrail(session.id, tag !== undefined || excluded !== undefined ? 'TAG' : 'NOTE', `user:${auth.user.id}`, action)

  // Recompute the stopping rule on every mark so the meter is always live.
  const allStates = await prisma.priorArtStudioDocState.findMany({
    where: { sessionId: session.id },
    select: { familyKey: true, publicationNumber: true, tag: true, updatedAt: true },
  })

  // A marked document outside the automatic top-40 window is important enough
  // to assess immediately. Persist the assessment on the latest run so every
  // view and export sees the same state.
  let familyAssessment: StudioResultFamily | undefined
  if (tag === 'RELEVANT' || tag === 'MAYBE') {
    const planValidation = latestRun ? validateStudioPlan(latestRun.planSnapshot) : null
    const familyIndex = families.findIndex(f =>
      canonicalStudioFamilyKey(f.familyKey, f.publicationNumber) === familyKey
    )
    if (latestRun && planValidation?.success && planValidation.plan.elements.length && familyIndex >= 0) {
      const family = { ...families[familyIndex] }
      if (family.elementAssessmentStatus !== 'ASSESSED') {
        try {
          const assessment = await scoreElements({
            elements: planValidation.plan.elements,
            publicationNumbers: [family.publicationNumber],
            externalAiUsage: auth.user.tenantId ? {
              tenantId: auth.user.tenantId,
              userId: auth.user.id,
              operationId: latestRun.id,
              sessionId: session.id,
            } : undefined,
          })
          const cells = assessment.cells[family.publicationNumber]
          family.elementAssessmentStatus = assessment.semanticAvailable && cells ? 'ASSESSED' : 'UNAVAILABLE'
          family.elementCells = assessment.semanticAvailable && cells ? cells : undefined
        } catch (error) {
          console.warn('[PriorArtStudio] On-demand element assessment failed:', error)
          family.elementAssessmentStatus = 'UNAVAILABLE'
          family.elementCells = undefined
        }
        families[familyIndex] = family
        await prisma.priorArtStudioRun.update({
          where: { id: latestRun.id },
          data: { results: families as unknown as Prisma.InputJsonValue },
        })
      }
      familyAssessment = families[familyIndex]
    }
  }

  return NextResponse.json({
    state,
    familyAssessment,
    saturation: computeSaturation(mergeCanonicalFamilyStates(allStates, familyAliases)),
  })
}
