import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { minerApiContext, minerApiError } from '@/lib/whitespace/miner/api'
import { requireMinerEnabled } from '@/lib/whitespace/miner/contracts'
import { readScope, startWhitespaceRun } from '@/lib/whitespace/service'
import { scopeIsRunnable } from '@/lib/whitespace/scope-schema'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { MinerError } from '@/lib/whitespace/miner/contracts'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { studyId: string } }) {
  try {
    requireMinerEnabled()
    const { study, auth } = await minerApiContext(request, params.studyId)
    if (!auth.tenantId) throw new MinerError('Invention Miner requires an organisation account.', 403)
    const access = await enforceServiceAccess(auth.id, auth.tenantId, 'INVENTION_MINER')
    if (!access.allowed) return access.response
    const scope = readScope(study.scope)
    const runnable = scopeIsRunnable(scope)
    if (!runnable.runnable) return NextResponse.json({ error: runnable.reason, code: 'SCOPE_NOT_RUNNABLE' }, { status: 422 })
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => { headers[key] = value })
    const started = await startWhitespaceRun({ studyId: study.id, stage: 'MINER_PREFLIGHT', scope, scopeVersion: study.scopeVersion, requestHeaders: headers, params: {} as Prisma.InputJsonValue })
    return NextResponse.json({ runId: started.runId, status: 'PROCESSING' }, { status: started.existing ? 409 : 202 })
  } catch (error) { return minerApiError(error) }
}
