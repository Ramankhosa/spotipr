import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { ingestDocument, OaProfileUnavailableError } from '@/lib/office-action/oa-case-service'
import { extractUploadText, UnreadableUploadError } from '@/lib/office-action/file-text-extract'
import { ACCEPTED_UPLOAD_LABEL, MAX_OA_UPLOAD_BYTES, MAX_OA_UPLOAD_LABEL } from '@/lib/office-action/upload-formats'
import { prisma } from '@/lib/prisma'

// Long-running: parse + classify are LLM calls.
export const maxDuration = 300

// POST /api/office-actions/:caseId/documents — ingest an office communication.
// Body: { rawText: string, fileName?: string }. (PDF/OCR upload lands text here;
// for now the client supplies extracted text.)
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const owner = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId },
    select: { userId: true, tenantId: true }
  })
  if (!owner) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (owner.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (auth.user.tenantId) {
    const access = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'OFFICE_ACTION_RESPONSE')
    if (!access.allowed) return access.response
  }

  // Accepts a PDF / Word / text upload (multipart) or { rawText } JSON.
  const contentType = request.headers.get('content-type') || ''
  let rawText = ''
  let fileName: string | undefined
  let body: any = {}

  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
      if (file.size > MAX_OA_UPLOAD_BYTES) {
        return NextResponse.json({ error: `File is too large (max ${MAX_OA_UPLOAD_LABEL}). Upload a smaller file or paste the text.` }, { status: 413 })
      }
      fileName = file.name
      const buf = Buffer.from(await file.arrayBuffer())
      const extracted = await extractUploadText(buf, {
        fileName: file.name, mimeType: file.type, label: 'examination report'
      })
      rawText = extracted.text
    } catch (err) {
      if (err instanceof UnreadableUploadError) {
        return NextResponse.json({ error: err.message, ...(err.detail || {}) }, { status: err.status })
      }
      console.error('[OA documents] Could not read the upload:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: `Could not read the uploaded file. Upload it as ${ACCEPTED_UPLOAD_LABEL}, or paste the text.` }, { status: 400 })
    }
  } else {
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    rawText = String(body.rawText || '').trim()
    fileName = body.fileName
  }

  if (!rawText.trim()) return NextResponse.json({ error: 'No text could be read from the report' }, { status: 400 })

  // Forward the auth header so the metering gateway resolves the same tenant.
  const requestHeaders: Record<string, string> = {}
  const authHeader = request.headers.get('authorization')
  if (authHeader) requestHeaders.authorization = authHeader

  try {
    const result = await ingestDocument(
      { userId: auth.user.id, tenantId: auth.user.tenantId, requestHeaders },
      params.caseId,
      rawText,
      { fileName }
    )
    // A parse failure is a real failure — the client must show an error and a
    // retry path, never a green toast. (Was HTTP 207, which res.ok treats as success.)
    if (result.error) {
      return NextResponse.json({ ...result, error: result.error }, { status: 422 })
    }
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingest failed'
    const status = err instanceof OaProfileUnavailableError ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
