import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { toAttorneyView } from '@/lib/office-action/citation-resolver'

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
