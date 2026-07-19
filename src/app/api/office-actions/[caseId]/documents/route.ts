import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { ingestDocument } from '@/lib/office-action/oa-case-service'
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

  // Accepts either a PDF/text upload (multipart) or { rawText } JSON.
  const contentType = request.headers.get('content-type') || ''
  let rawText = ''
  let fileName: string | undefined
  let body: any = {}

  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
      fileName = file.name
      const buf = Buffer.from(await file.arrayBuffer())
      if (file.name?.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf') {
        const { extractPdfText } = await import('@/lib/office-action/pdf-extract')
        const extracted = await extractPdfText(buf)
        if (extracted.likelyScanned) {
          return NextResponse.json({
            error: 'This examination report appears to be a scan with no text layer. Paste the text instead, or upload a text-based PDF.',
            pageCount: extracted.pageCount, charsPerPage: extracted.charsPerPage
          }, { status: 422 })
        }
        rawText = extracted.text
      } else {
        rawText = buf.toString('utf-8')
      }
    } catch {
      return NextResponse.json({ error: 'Could not read the uploaded file' }, { status: 400 })
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
    return NextResponse.json(result, { status: result.error ? 207 : 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingest failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
