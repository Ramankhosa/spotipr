import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { handoffPayloadSchema, MinerError } from '@/lib/whitespace/miner/contracts'
import { minerApiError } from '@/lib/whitespace/miner/api'
import { currentSnapshot } from '@/lib/whitespace/miner/snapshots'

async function owned(request: NextRequest, token: string) {
  const auth = await authenticateUser(request)
  if (!auth.user) throw new MinerError(auth.error?.message || 'Unauthorized', auth.error?.status || 401)
  const handoff = await prisma.minerHandoff.findUnique({ where: { id: token }, include: { lead: true } })
  if (!handoff || handoff.userId !== auth.user.id || (handoff.tenantId && handoff.tenantId !== auth.user.tenantId)) throw new MinerError('Handoff not found.', 404)
  if (handoff.expiresAt <= new Date() && !handoff.consumedAt) throw new MinerError('This handoff expired. Create a fresh one from the Miner lead.', 410)
  return { handoff, auth: auth.user }
}

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { handoff } = await owned(request, params.token)
    return NextResponse.json({ target: handoff.target, office: handoff.office, payload: handoff.payload, expiresAt: handoff.expiresAt, consumed: !!handoff.consumedAt, destination: handoff.destination })
  } catch (error) { return minerApiError(error) }
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const { handoff } = await owned(request, params.token)
    if (handoff.consumedAt) return NextResponse.json({ consumed: true, destination: handoff.destination })
    const body = await request.json().catch(() => ({}))
    const destination = handoff.target === 'novelty'
      ? { searchId: String(body.searchId || '') }
      : { patentId: String(body.patentId || ''), sessionId: String(body.sessionId || '') }
    if (Object.values(destination).some(value => !value)) throw new MinerError('The destination must be created before consuming this handoff.', 422)
    const lead = handoff.lead
    const parsedPayload = handoffPayloadSchema.safeParse(handoff.payload)
    if (!parsedPayload.success) throw new MinerError('This handoff uses an unsupported payload contract. Create a fresh handoff.', 409)
    const payload = parsedPayload.data
    await currentSnapshot(String(payload.studyId || ''), String(payload.snapshotId || ''))
    const assessments = (lead.currentAssessments ?? {}) as Record<string, any>
    const briefs = (lead.currentBriefs ?? {}) as Record<string, any>
    const assessment = assessments[String(handoff.office)]
    const brief = briefs[String(handoff.office)]
    const fresh = lead.currentProposalId === handoff.proposalRevisionId &&
      assessment?.proposalRevisionId === handoff.proposalRevisionId && assessment?.runId === payload.assessmentRunId &&
      (handoff.target !== 'drafting' || (brief?.proposalRevisionId === handoff.proposalRevisionId && brief?.runId === payload.briefRunId && brief?.assessmentRunId === assessment.runId))
    if (!fresh) throw new MinerError('The proposal or assessment changed while this form was open. Create a fresh handoff.', 409)
    const updated = await prisma.minerHandoff.updateMany({ where: { id: handoff.id, consumedAt: null }, data: { consumedAt: new Date(), destination: destination as Prisma.InputJsonValue } })
    if (!updated.count) {
      const replay = await prisma.minerHandoff.findUnique({ where: { id: handoff.id } })
      return NextResponse.json({ consumed: true, destination: replay?.destination })
    }
    await prisma.inventionLead.update({ where: { id: lead.id }, data: { handoffs: { ...((lead.handoffs as any) ?? {}), [String(handoff.target)]: destination } as Prisma.InputJsonValue } })
    return NextResponse.json({ consumed: true, destination })
  } catch (error) { return minerApiError(error) }
}
