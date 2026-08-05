import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { toAttorneyView } from '@/lib/office-action/citation-resolver'
import { extractUploadText, UnreadableUploadError } from '@/lib/office-action/file-text-extract'
import { ACCEPTED_UPLOAD_LABEL, MAX_OA_UPLOAD_BYTES, MAX_OA_UPLOAD_LABEL, MAX_OA_TEXT_CHARS, MAX_OA_TEXT_LABEL } from '@/lib/office-action/upload-formats'

/**
 * GET /api/office-actions/:caseId/citations
 * The cited documents as patent documents (full text when resolved) plus the
 * resolution progress — the workbench polls this while the worker fetches.
 * The attorney view never carries any retrieval/source detail.
 */
export async function GET(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId },
    select: { userId: true, documents: { select: { citations: true } } }
  })
  if (!oaCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (oaCase.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const citations = oaCase.documents.flatMap(d => d.citations)
  const documents = citations.map(toAttorneyView)
  const progress = {
    total: citations.length,
    available: documents.filter(d => d.status === 'available').length,
    pending: documents.filter(d => d.status === 'pending').length,
    awaitingUpload: documents.filter(d => d.status === 'awaiting-upload').length
  }
  return NextResponse.json({ documents, progress })
}

export const maxDuration = 120

/**
 * POST /api/office-actions/:caseId/citations
 * Attach the attorney's own copy of a cited document (D1, D2…) — the papers and
 * patents the examiner relied on that retrieval could not fetch. Accepts a
 * multipart upload { file, label, title? } or JSON { label, text, title? }.
 *
 * Once attached, the citation reads exactly like a retrieved one: it appears in
 * the source viewer and feeds the claim chart, so an objection built on an NPL
 * paper can be answered on the evidence instead of on the examiner's summary.
 */
export async function POST(request: NextRequest, { params }: { params: { caseId: string } }) {
  const auth = await authenticateUser(request)
  if (auth.error) return NextResponse.json({ error: auth.error.message }, { status: auth.error.status })

  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: params.caseId }, select: { userId: true }
  })
  if (!oaCase) return NextResponse.json({ error: 'Case not found' }, { status: 404 })
  if (oaCase.userId !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let label = ''
  let title: string | undefined
  let text = ''
  // Which communication's citation this copy belongs to, when the label alone is
  // ambiguous across the case.
  let requestedDocumentId = ''

  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    try {
      const form = await request.formData()
      label = String(form.get('label') || '').trim()
      title = String(form.get('title') || '').trim() || undefined
      requestedDocumentId = String(form.get('documentId') || '').trim()
      const file = form.get('file') as File | null
      if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 })
      if (file.size > MAX_OA_UPLOAD_BYTES) {
        return NextResponse.json({ error: `File is too large (max ${MAX_OA_UPLOAD_LABEL}). Upload a smaller file or paste the text.` }, { status: 413 })
      }
      if (!title) title = file.name
      const extracted = await extractUploadText(Buffer.from(await file.arrayBuffer()), {
        fileName: file.name, mimeType: file.type, label: `cited document ${label || ''}`.trim()
      })
      text = extracted.text
    } catch (err) {
      if (err instanceof UnreadableUploadError) {
        return NextResponse.json({ error: err.message, ...(err.detail || {}) }, { status: err.status })
      }
      console.error('[OA citations] Could not read the upload:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: `Could not read the uploaded file. Upload it as ${ACCEPTED_UPLOAD_LABEL}, or paste the text.` }, { status: 400 })
    }
  } else {
    let body: any = {}
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    label = String(body.label || '').trim()
    title = body.title ? String(body.title).trim() : undefined
    text = String(body.text || '')
    requestedDocumentId = String(body.documentId || '').trim()
  }

  if (!label) return NextResponse.json({ error: 'Tell us which cited document this is (e.g. D1).' }, { status: 400 })
  if (!text.trim()) return NextResponse.json({ error: 'No text could be read from the document' }, { status: 400 })
  // The JSON branch had no size bound; this text lands whole in a JSONB column
  // and is fed to the claim chart.
  if (text.length > MAX_OA_TEXT_CHARS) {
    return NextResponse.json({
      error: `That document is too long (max ${MAX_OA_TEXT_LABEL}). Upload it as a file, or split it.`
    }, { status: 413 })
  }

  /**
   * Labels are per communication, so "D1" can name two different documents on a
   * case that has both a FER and a later notice. An unordered findMany + find
   * attached the attorney's copy to whichever row came back first — potentially
   * the wrong instrument's citation, whose claim chart then charts against text
   * the examiner never cited.
   *
   * Resolve deterministically (oldest communication first), and when the label is
   * genuinely ambiguous, ask which one rather than guessing.
   */
  const citations = await prisma.oaCitation.findMany({
    where: { document: { caseId: params.caseId } },
    include: { document: { select: { id: true, createdAt: true, instrumentType: true } } },
    orderBy: [{ document: { createdAt: 'asc' } }, { label: 'asc' }]
  })
  const matches = citations.filter(c => c.label.toLowerCase() === label.toLowerCase())

  const target = requestedDocumentId
    ? matches.find(c => c.documentId === requestedDocumentId)
    : matches[0]

  if (matches.length > 1 && !requestedDocumentId) {
    return NextResponse.json({
      error: `This case has more than one cited document labelled "${label}". Say which communication it belongs to.`,
      ambiguousLabel: label,
      candidates: matches.map(c => ({
        documentId: c.documentId,
        instrumentType: c.document?.instrumentType || null,
        docNumber: c.docNumber
      }))
    }, { status: 409 })
  }

  if (!target) {
    return NextResponse.json({
      error: citations.length
        ? `No cited document labelled "${label}" on this case. It cites ${citations.map(c => c.label).join(', ')}.`
        : `This case has no cited documents yet — upload the examination report first.`
    }, { status: 404 })
  }

  const prev = (target.passagesJson && typeof target.passagesJson === 'object') ? target.passagesJson as any : {}
  await prisma.oaCitation.update({
    where: { id: target.id },
    data: {
      fetchStatus: 'RESOLVED',
      resolvedVia: 'attorney-upload',       // internal only; never sent to the client
      passagesJson: {
        ...prev,
        fullDocument: {
          ...(prev.fullDocument || {}),
          title: title || prev.fullDocument?.title || target.docNumber || target.label,
          // The whole document goes in as description: an NPL paper has no
          // claims, and the claim chart reads claims || description.
          description: text,
          publicationNumber: target.docNumber || prev.fullDocument?.publicationNumber,
          providedByAttorney: true
        }
      } as any
    }
  })

  return NextResponse.json({
    label: target.label,
    chars: text.length,
    message: `${target.label} attached — it now feeds the claim chart and the drafted arguments.`
  }, { status: 201 })
}
