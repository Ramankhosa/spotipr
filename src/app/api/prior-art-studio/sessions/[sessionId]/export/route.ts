import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedSession } from '@/lib/prior-art-studio/service'
import { googlePatentsUrl } from '@/lib/prior-art-studio/patent-links'
import type { StudioPlan, StudioResultFamily } from '@/lib/prior-art-studio/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const TAG_LABEL: Record<string, string> = { RELEVANT: 'Relevant', MAYBE: 'Maybe' }

const LANE_LABEL: Record<string, string> = {
  match: 'keywords',
  cast: 'meaning only',
  both: 'words + meaning',
  other: 'filters',
}

// Excel caps a cell at 32,767 characters; claims text can exceed it.
const EXCEL_CELL_CAP = 32000

function cellText(value: string | null | undefined): string {
  return (value || '').replace(/\r/g, '').slice(0, EXCEL_CELL_CAP)
}

// Exports the attorney's shortlist — every family tagged Relevant or Maybe —
// as a client-shareable workbook: summary, per-element feature comparison,
// element legend, and full claims where the corpus stores them.
export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
    }
    const session = await getOwnedSession(params.sessionId, auth.user.id)
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    const [latestRun, docStates] = await Promise.all([
      prisma.priorArtStudioRun.findFirst({
        where: { sessionId: session.id, status: 'COMPLETE' },
        orderBy: { createdAt: 'desc' },
        select: { results: true },
      }),
      prisma.priorArtStudioDocState.findMany({
        where: { sessionId: session.id, tag: { in: ['RELEVANT', 'MAYBE'] } },
      }),
    ])

    if (!docStates.length) {
      return NextResponse.json({ error: 'No documents are tagged Relevant or Maybe yet.' }, { status: 400 })
    }

    const plan = session.plan as unknown as StudioPlan
    const latestFamilies = (Array.isArray(latestRun?.results) ? latestRun?.results : []) as unknown as StudioResultFamily[]
    const familyByKey = new Map(latestFamilies.map(f => [f.familyKey, f]))
    const rankByKey = new Map(latestFamilies.map((f, i) => [f.familyKey, i]))

    // Relevant first, then Maybe; within a tag, by rank in the latest run;
    // tagged families no longer present in the latest run's results go last.
    const ordered = [...docStates].sort((a, b) => {
      if (a.tag !== b.tag) return a.tag === 'RELEVANT' ? -1 : 1
      const rankA = rankByKey.get(a.familyKey) ?? Number.MAX_SAFE_INTEGER
      const rankB = rankByKey.get(b.familyKey) ?? Number.MAX_SAFE_INTEGER
      return rankA - rankB
    })

    const pubs = ordered.map(s => s.publicationNumber)
    const claimsRows = await prisma.localPatent.findMany({
      where: { publicationNumber: { in: pubs } },
      select: { publicationNumber: true, claimsText: true, numberOfClaims: true },
    })
    const claimsByPub = new Map(claimsRows.map(r => [r.publicationNumber, r]))

    // ---- Sheet 1: Prior Art Summary ---------------------------------------
    const summaryRows = ordered.map(state => {
      const family = familyByKey.get(state.familyKey)
      return {
        'Publication Number': state.publicationNumber,
        Title: family?.title || "(not in the latest run's results)",
        Tag: TAG_LABEL[state.tag || ''] || state.tag || '',
        'Publication Date': family?.publicationDate || '',
        Jurisdiction: family?.jurisdiction || '',
        Applicants: family?.applicants || '',
        'Family Size': family ? family.members.length : '',
        'Found By': family ? LANE_LABEL[family.lane] || family.lane : '',
        'Rerank Score': typeof family?.rerankScore === 'number' ? Number(family.rerankScore.toFixed(3)) : '',
        Note: state.note || '',
        Abstract: cellText(family?.abstract || family?.snippet),
        'Google Patents URL': googlePatentsUrl(state.publicationNumber),
      }
    })
    const summarySheet = XLSX.utils.json_to_sheet(summaryRows)
    summarySheet['!cols'] = [
      { wch: 20 }, { wch: 60 }, { wch: 10 }, { wch: 14 }, { wch: 11 },
      { wch: 32 }, { wch: 11 }, { wch: 16 }, { wch: 12 }, { wch: 32 },
      { wch: 90 }, { wch: 48 },
    ]

    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Prior Art Summary')

    // ---- Sheet 2: Feature Comparison (patents × elements) ------------------
    if (plan.elements.length) {
      const header = ['Publication Number', 'Title', 'Tag', ...plan.elements.map((_, i) => `E${i + 1}`)]
      const rows = ordered.map(state => {
        const family = familyByKey.get(state.familyKey)
        return [
          state.publicationNumber,
          family?.title || "(not in the latest run's results)",
          TAG_LABEL[state.tag || ''] || state.tag || '',
          ...plan.elements.map(element => {
            const cell = family?.elementCells?.[element.id]
            if (!family || !family.elementCells) return 'not scored'
            if (!cell) return 'NONE'
            const terms = cell.matchedTerms?.length ? ` — terms: ${cell.matchedTerms.join(', ')}` : ''
            return `${cell.verdict}${terms}`
          }),
        ]
      })
      const note = [
        'Verdicts are categorical (STRONG / PART / WEAK / NONE) from literal term presence plus semantic similarity. ' +
          '"claims"-tier assessments read the claim text; "abstract"-tier read only title and abstract and are a similarity signal, not a claim mapping. ' +
          '"not scored" means the document ranked outside the per-run element-scoring window.',
      ]
      const comparisonSheet = XLSX.utils.aoa_to_sheet([header, ...rows, [], note])
      comparisonSheet['!cols'] = [
        { wch: 20 }, { wch: 50 }, { wch: 10 },
        ...plan.elements.map(() => ({ wch: 34 })),
      ]
      XLSX.utils.book_append_sheet(workbook, comparisonSheet, 'Feature Comparison')

      // ---- Sheet 3: Elements legend ---------------------------------------
      const elementsSheet = XLSX.utils.aoa_to_sheet([
        ['Element', 'Description'],
        ...plan.elements.map((element, i) => [`E${i + 1}`, element.text]),
      ])
      elementsSheet['!cols'] = [{ wch: 10 }, { wch: 110 }]
      XLSX.utils.book_append_sheet(workbook, elementsSheet, 'Elements')
    }

    // ---- Sheet 4: Claims (where the corpus stores them) --------------------
    const claimsData = ordered
      .map(state => ({ state, stored: claimsByPub.get(state.publicationNumber) }))
      .filter(({ stored }) => stored?.claimsText && stored.claimsText.trim().length > 0)
    if (claimsData.length) {
      const claimsSheet = XLSX.utils.aoa_to_sheet([
        ['Publication Number', 'Claim Count', 'Claims'],
        ...claimsData.map(({ state, stored }) => [
          state.publicationNumber,
          stored?.numberOfClaims ?? '',
          cellText(stored?.claimsText),
        ]),
      ])
      claimsSheet['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 120 }]
      XLSX.utils.book_append_sheet(workbook, claimsSheet, 'Claims')
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
    const titlePart = session.title.replace(/[^A-Za-z0-9-_ ]/g, '').trim().slice(0, 40).replace(/\s+/g, '-') || 'session'
    const filename = `Prior-Art_${titlePart}_${new Date().toISOString().slice(0, 10)}.xlsx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Export-Count': String(ordered.length),
      },
    })
  } catch (error) {
    console.error('[PriorArtStudio] Excel export failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Excel export failed.' },
      { status: 500 }
    )
  }
}
