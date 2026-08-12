/**
 * The one-click filing bundle.
 *
 * GET /api/patents/[patentId]/filing/bundle?docs=form1,form5,drawings
 *
 * Resolves the cascade, validates, renders each requested document, and streams a ZIP.
 * Blocking validation issues return 422 with the checklist rather than a defective bundle —
 * we would rather refuse than emit a legal document with a missing PIN in it.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  assembleFiling,
  bundleRef,
  loadPatentFigures,
  renderFilingBundle,
  snapshotResolvedSettings,
  type FilingDocKey,
} from '@/lib/filing/filing-service'
import { isAccessDenied, requirePatentAccess } from '@/lib/filing/filing-access'

export const dynamic = 'force-dynamic'

const ALL_DOCS: FilingDocKey[] = ['form1', 'form5', 'drawings']

export async function GET(request: NextRequest, { params }: { params: { patentId: string } }) {
  try {
    const access = await requirePatentAccess(request, params.patentId)
    if (isAccessDenied(access)) return access.response

    const assembled = await assembleFiling(params.patentId)
    if (!assembled.ok) {
      return NextResponse.json({ error: assembled.error }, { status: assembled.status })
    }

    // Forms are ALWAYS generated. Missing particulars render as blank spaces for the
    // attorney to complete by hand, and the outstanding items ship as a note in the zip.
    const outstanding = assembled.data.issues

    // ?docs= narrows the bundle; otherwise the cascade's includeDocs decides.
    const requested = request.nextUrl.searchParams.get('docs')
    const includeDocs = assembled.data.provenance.settings.includeDocs
    const docs: FilingDocKey[] = requested
      ? requested.split(',').map(d => d.trim()).filter((d): d is FilingDocKey => ALL_DOCS.includes(d as FilingDocKey))
      : ALL_DOCS.filter(d => includeDocs[d])

    if (!docs.length) {
      return NextResponse.json({ error: 'No documents selected for the bundle.' }, { status: 400 })
    }

    const figures = docs.includes('drawings') ? await loadPatentFigures(params.patentId) : []
    const { zip, files } = await renderFilingBundle(assembled.data, docs, figures, outstanding)

    if (!files.length) {
      return NextResponse.json(
        { error: 'Nothing to bundle — the selected documents produced no output.' },
        { status: 400 }
      )
    }

    // Freeze what was used, so regenerating after a firm-level house-style change is stable.
    await snapshotResolvedSettings(params.patentId, assembled.data)

    // Same stem as the documents inside the archive.
    const filename = `Filing_${bundleRef(assembled.data)}.zip`

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(zip.length),
        'X-Filing-Documents': files.map(f => f.filename).join(','),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[Filing] bundle failed:', error)
    return NextResponse.json({ error: 'Failed to generate the filing bundle' }, { status: 500 })
  }
}
