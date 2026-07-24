import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { enforceServiceAccess } from '@/lib/service-access-middleware'
import { prisma } from '@/lib/prisma'
import { addCaseDocument, listCaseDocuments, removeCaseDocument, type CaseDocumentKind, type CaseDocumentSource } from '@/lib/office-action/case-document-service'
import { extractUploadText, UnreadableUploadError } from '@/lib/office-action/file-text-extract'
import { ACCEPTED_UPLOAD_LABEL, MAX_OA_UPLOAD_BYTES, MAX_OA_UPLOAD_LABEL } from '@/lib/office-action/upload-formats'

export const maxDuration = 120

const KINDS: CaseDocumentKind[] = ['SPECIFICATION', 'CLAIMS', 'DRAWINGS', 'SUPPLEMENTARY']

const KIND_LABEL: Record<CaseDocumentKind, string> = {
  SPECIFICATION: 'specification',
  CLAIMS: 'claims',
  DRAWINGS: 'drawings',
  SUPPLEMENTARY: 'supplementary document'
}

async function ownedCase(caseId: string, userId: string) {
  const row = await prisma.officeActionCase.findUnique({ where: { id: caseId }, select: { userId: true } })
  if (!row) return { error: NextResponse.json({ error: 'Case not found' }, { status: 404 }) }
  if (row.userId !== userId) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { ok: true as const }
}

// GET — the invention + supplementary material on this case.
export async function GET(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })
  const guard = await ownedCase(params.caseId, auth.user.id)
  if ('error' in guard) return guard.error
  return NextResponse.json({ documents: await listCaseDocuments(params.caseId) })
}

/**
 * POST — add the invention (specification/claims) or supplementary material.
 * Accepts multipart (PDF/text upload) or JSON { kind, text, title?, intentNote?, targetCodes? }.
 * Documents are chunked and indexed once; only as-filed spec/claims are
 * marked newMatterSafe (usable as amendment basis under Section 59).
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })
  const guard = await ownedCase(params.caseId, auth.user.id)
  if ('error' in guard) return guard.error

  // Indexing embeds every chunk — gate it like the other OA write routes.
  if (auth.user.tenantId) {
    const access = await enforceServiceAccess(auth.user.id, auth.user.tenantId, 'OFFICE_ACTION_RESPONSE')
    if (!access.allowed) return access.response
  }

  const contentType = request.headers.get('content-type') || ''
  let kind: CaseDocumentKind = 'SPECIFICATION'
  let source: CaseDocumentSource = 'PASTE'
  let text = ''
  let title: string | undefined
  let intentNote: string | undefined
  let targetCodes: string[] | undefined

  let uploadWarning: string | undefined

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file') as File | null
      kind = (String(form.get('kind') || 'SPECIFICATION').toUpperCase() as CaseDocumentKind)
      title = (form.get('title') as string) || file?.name
      intentNote = (form.get('intentNote') as string) || undefined
      const codes = form.get('targetCodes') as string | null
      targetCodes = codes ? String(codes).split(',').map(s => s.trim()).filter(Boolean) : undefined
      source = 'UPLOAD'
      if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
      if (file.size > MAX_OA_UPLOAD_BYTES) {
        return NextResponse.json({ error: `File is too large (max ${MAX_OA_UPLOAD_LABEL}). Upload a smaller file or paste the text.` }, { status: 413 })
      }

      // PDF, Word (.docx) and plain text all land here — a full drafted
      // specification is usually a Word file, so DOCX must be first-class.
      const buf = Buffer.from(await file.arrayBuffer())
      try {
        const extracted = await extractUploadText(buf, {
          fileName: file.name,
          mimeType: file.type,
          label: KIND_LABEL[KINDS.includes(kind) ? kind : 'SPECIFICATION']
        })
        text = extracted.text
        uploadWarning = extracted.warning
      } catch (err) {
        if (err instanceof UnreadableUploadError) {
          return NextResponse.json({ error: err.message, ...(err.detail || {}) }, { status: err.status })
        }
        throw err
      }
    } else {
      const body = await request.json()
      kind = (String(body.kind || 'SPECIFICATION').toUpperCase() as CaseDocumentKind)
      text = String(body.text || '')
      title = body.title
      intentNote = body.intentNote
      targetCodes = Array.isArray(body.targetCodes) ? body.targetCodes : undefined
      source = body.source === 'SPOTIPR_PROJECT' ? 'SPOTIPR_PROJECT' : 'PASTE'
    }
  } catch (err) {
    console.error('[OA case-documents] Could not read the upload:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: `Could not read the document. Upload it as ${ACCEPTED_UPLOAD_LABEL}, or paste the text.` }, { status: 400 })
  }

  if (!KINDS.includes(kind)) return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
  if (!text.trim()) return NextResponse.json({ error: 'No text could be read from the document' }, { status: 400 })

  const result = await addCaseDocument({ caseId: params.caseId, kind, source, title, text, intentNote, targetCodes })
  return NextResponse.json({ ...result, ...(uploadWarning ? { warning: uploadWarning } : {}) }, { status: 201 })
}

// DELETE — remove a wrongly-uploaded / superseded document (and its chunks).
// Body or query: { documentId }. Re-points the case's canonical spec/claims text.
export async function DELETE(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })
  const guard = await ownedCase(params.caseId, auth.user.id)
  if ('error' in guard) return guard.error

  let documentId = new URL(request.url).searchParams.get('documentId') || ''
  if (!documentId) {
    const body = await request.json().catch(() => ({}))
    documentId = String(body.documentId || '')
  }
  if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 })

  const removed = await removeCaseDocument(params.caseId, documentId)
  if (!removed) return NextResponse.json({ error: 'Document not found on this case' }, { status: 404 })
  return NextResponse.json({ removed: true })
}
