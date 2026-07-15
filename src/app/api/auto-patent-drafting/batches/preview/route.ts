import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import {
  type AutoPatentDraftBatchDefaults,
  assertDocumentBatchLimits,
  parseAutoPatentDraftDocuments,
  parseAutoPatentDraftIdeasFromJson,
  parseAutoPatentDraftIdeasFromUpload,
  previewAutoPatentDraftBatchIdeas,
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

async function readUploadedDocumentFiles(formData: FormData) {
  const entries = formData.getAll('files')
  const files = entries.filter(
    (entry): entry is File => typeof entry !== 'string' && !!entry && typeof (entry as File).arrayBuffer === 'function'
  )
  return Promise.all(files.map(async (file) => ({
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    buffer: Buffer.from(await file.arrayBuffer()),
  })))
}

// Document mode: one uploaded disclosure file (Word/PDF/text) previews as one
// idea. Image bytes are intentionally NOT returned — only counts — so the
// preview stays light; the create call re-extracts and persists them.
async function previewDocuments(formData: FormData) {
  const files = await readUploadedDocumentFiles(formData)
  assertDocumentBatchLimits(files.map(file => ({ filename: file.filename, size: file.size })))

  const rows = await parseAutoPatentDraftDocuments(files)
  const previewRows = rows.map(row => {
    const errors: string[] = []
    const warnings: string[] = []
    if (row.extractionError) errors.push(row.extractionError)
    else if (!row.ideaDetails.trim()) errors.push('No readable text was extracted from this file.')
    if (row.warning) warnings.push(row.warning)
    return {
      rowNo: row.rowNo,
      sourceFilename: row.sourceFilename,
      detectedFormat: row.detectedFormat,
      title: row.title,
      ideaDetails: row.ideaDetails,
      imageCount: row.imageCount,
      errors,
      warnings,
    }
  })

  return {
    success: true,
    mode: 'documents' as const,
    rows: previewRows,
    totalRows: previewRows.length,
    validRows: previewRows.filter(row => row.errors.length === 0).length,
    invalidRows: previewRows.filter(row => row.errors.length > 0).length,
    warnings: previewRows.reduce((count, row) => count + row.warnings.length, 0),
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

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const mode = typeof formData.get('mode') === 'string' ? String(formData.get('mode')) : ''
      const hasDocumentFiles = formData.getAll('files').length > 0

      if (mode === 'documents' || hasDocumentFiles) {
        const preview = await previewDocuments(formData)
        return NextResponse.json(preview)
      }

      const file = formData.get('file')
      const defaults = readDefaults(Object.fromEntries(formData.entries()))
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
        return NextResponse.json({ error: 'Upload a .json, .csv, .tsv, or .xlsx batch file.' }, { status: 400 })
      }
      const ideas = parseAutoPatentDraftIdeasFromUpload({
        filename: file.name,
        mimeType: file.type,
        buffer: Buffer.from(await file.arrayBuffer()),
      })
      if (!ideas.length) {
        return NextResponse.json({
          error: 'No ideas found. Provide ideas[]/items[] JSON or upload a table with idea details.'
        }, { status: 400 })
      }
      if (ideas.length > AUTO_DRAFTING_MAX_UPLOAD_ROWS) {
        return NextResponse.json({ error: `A batch can include at most ${AUTO_DRAFTING_MAX_UPLOAD_ROWS} ideas.` }, { status: 400 })
      }
      const preview = previewAutoPatentDraftBatchIdeas(ideas, defaults)
      return NextResponse.json({ success: true, sourceFilename: file.name, ...preview })
    }

    const body = await request.json()
    const defaults = readDefaults(body || {})
    const ideas = parseAutoPatentDraftIdeasFromJson(body)
    if (!ideas.length) {
      return NextResponse.json({
        error: 'No ideas found. Provide ideas[]/items[] JSON or upload a table with idea details.'
      }, { status: 400 })
    }
    if (ideas.length > AUTO_DRAFTING_MAX_UPLOAD_ROWS) {
      return NextResponse.json({ error: `A batch can include at most ${AUTO_DRAFTING_MAX_UPLOAD_ROWS} ideas.` }, { status: 400 })
    }
    const preview = previewAutoPatentDraftBatchIdeas(ideas, defaults)
    return NextResponse.json({ success: true, ...preview })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to preview automated patent drafting batch.'
    console.error('[AutoPatentDraftBatch] Failed to preview batch:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
