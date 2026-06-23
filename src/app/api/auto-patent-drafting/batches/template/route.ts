import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { buildAutoPatentDraftBatchTemplate } from '@/lib/auto-patent-draft-batch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }
    if (!auth.user.tenantId) {
      return NextResponse.json({ error: 'Tenant context is required.' }, { status: 400 })
    }

    const serviceCheck = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'PATENT_DRAFTING')
    if (!serviceCheck.allowed) return serviceCheck.response

    const formatParam = request.nextUrl.searchParams.get('format')?.toLowerCase()
    const format = formatParam === 'csv' ? 'csv' : 'xlsx'
    const template = buildAutoPatentDraftBatchTemplate(format)

    return new NextResponse(template.buffer as any, {
      status: 200,
      headers: {
        'Content-Type': template.mimeType,
        'Content-Disposition': `attachment; filename="${template.filename}"`,
        'Cache-Control': 'private, no-store',
      }
    })
  } catch (error) {
    console.error('[AutoPatentDraftBatch] Failed to generate batch template:', error)
    return NextResponse.json({ error: 'Failed to generate automated patent drafting batch template.' }, { status: 500 })
  }
}
