import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { patentId: string; jobId: string } }
) {
  const auth = await authenticateUser(request)
  if (auth.error || !auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }

  const job = await (prisma as any).patentDraftingJob.findFirst({
    where: { id: params.jobId, patentId: params.patentId, userId: auth.user.id },
  })
  if (!job) return NextResponse.json({ error: 'Patent drafting job not found.' }, { status: 404 })

  return NextResponse.json({ job })
}
