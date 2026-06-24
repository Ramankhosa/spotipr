import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import {
  createAutoPatentDraftBatch,
  type AutoPatentDraftBatchDefaults,
  listAutoPatentDraftBatchesForUser,
  parseAutoPatentDraftIdeasFromJson,
  parseAutoPatentDraftIdeasFromUpload,
} from '@/lib/auto-patent-draft-batch-service'
import { AUTO_DRAFTING_MAX_UPLOAD_ROWS } from '@/lib/drafting-constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function readDefaults(value: Record<string, unknown>): AutoPatentDraftBatchDefaults {
  return {
    defaultJurisdictions: typeof value.defaultJurisdictions === 'string' || Array.isArray(value.defaultJurisdictions) ? value.defaultJurisdictions : undefined,
    defaultFilingType: typeof value.defaultFilingType === 'string' ? value.defaultFilingType : undefined,
    defaultClaimsHandling: typeof value.defaultClaimsHandling === 'string' ? value.defaultClaimsHandling : undefined,
    defaultPriorArtHandling: typeof value.defaultPriorArtHandling === 'string' ? value.defaultPriorArtHandling : undefined,
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }

    const batches = await listAutoPatentDraftBatchesForUser(auth.user.id)
    return NextResponse.json({ batches })
  } catch (error) {
    console.error('[AutoPatentDraftBatch] Failed to list batches:', error)
    return NextResponse.json({ error: 'Failed to list automated patent drafting batches.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
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

    const contentType = request.headers.get('content-type') || ''
    let name: string | undefined
    let projectId: string | null | undefined
    let sourceFilename: string | undefined
    let ideas: any[] = []
    let defaults: AutoPatentDraftBatchDefaults = {}

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file')
      name = typeof formData.get('name') === 'string' ? String(formData.get('name')) : undefined
      projectId = typeof formData.get('projectId') === 'string' ? String(formData.get('projectId')) : undefined
      defaults = readDefaults(Object.fromEntries(formData.entries()))
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
        return NextResponse.json({ error: 'Upload a .json, .csv, .tsv, or .xlsx batch file.' }, { status: 400 })
      }
      sourceFilename = file.name
      ideas = parseAutoPatentDraftIdeasFromUpload({
        filename: file.name,
        mimeType: file.type,
        buffer: Buffer.from(await file.arrayBuffer())
      })
    } else {
      const body = await request.json()
      name = typeof body?.name === 'string' ? body.name : undefined
      projectId = typeof body?.projectId === 'string' ? body.projectId : undefined
      defaults = readDefaults(body || {})
      ideas = parseAutoPatentDraftIdeasFromJson(body)
    }

    if (!ideas.length) {
      return NextResponse.json({
        error: 'No ideas found. Provide ideas[]/items[] JSON or upload a table with idea details.'
      }, { status: 400 })
    }
    if (ideas.length > AUTO_DRAFTING_MAX_UPLOAD_ROWS) {
      return NextResponse.json({ error: `A batch can include at most ${AUTO_DRAFTING_MAX_UPLOAD_ROWS} ideas.` }, { status: 400 })
    }

    const result = await createAutoPatentDraftBatch({
      user: auth.user as any,
      name,
      projectId,
      sourceFilename,
      ideas,
      defaults,
    })

    return NextResponse.json({ success: true, ...result }, { status: 202 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create automated patent drafting batch.'
    console.error('[AutoPatentDraftBatch] Failed to create batch:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
