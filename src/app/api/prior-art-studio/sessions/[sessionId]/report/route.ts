import { NextRequest, NextResponse } from 'next/server'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { getOwnedSession } from '@/lib/prior-art-studio/service'
import { renderBooleanPreview } from '@/lib/prior-art-studio/compiler'
import { activeTerms, type StudioGateCounts, type StudioPlan, type StudioResultFamily } from '@/lib/prior-art-studio/types'

export const runtime = 'nodejs'
export const maxDuration = 120

const TAG_LABEL: Record<string, string> = {
  RELEVANT: 'Relevant',
  MAYBE: 'Maybe / review further',
  NOT_RELEVANT: 'Not relevant',
}

function heading(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, children: [new TextRun({ text })], spacing: { before: 240, after: 120 } })
}

function para(text: string, opts: { bold?: boolean; italics?: boolean } = {}) {
  return new Paragraph({ children: [new TextRun({ text, bold: opts.bold, italics: opts.italics })], spacing: { after: 80 } })
}

export async function GET(request: NextRequest, { params }: { params: { sessionId: string } }) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 })
  }
  const session = await getOwnedSession(params.sessionId, auth.user.id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const [runs, docStates, trail, theories] = await Promise.all([
    prisma.priorArtStudioRun.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } }),
    prisma.priorArtStudioDocState.findMany({ where: { sessionId: session.id } }),
    prisma.priorArtStudioTrailEntry.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' }, take: 300 }),
    prisma.priorArtStudioTheory.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' } }),
  ])

  const plan = session.plan as unknown as StudioPlan
  const latestRun = runs[runs.length - 1]
  const latestFamilies = (latestRun?.results as unknown as StudioResultFamily[]) || []
  const stateByFamily = new Map(docStates.map(s => [s.familyKey, s]))

  const children: Paragraph[] = []

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'Prior-Art Search Report' })] }))
  children.push(para(`Search: ${session.title}`))
  children.push(para(`Session ${session.id} · plan v${session.planVersion} · generated ${new Date().toISOString().slice(0, 10)}`))
  children.push(para(`Prepared by user ${auth.user.email || auth.user.id} via PatentNest Prior-Art Studio.`, { italics: true }))

  children.push(heading('1. Scope and coverage'))
  children.push(
    para(
      'Sources searched: PatentNest local corpus (Google Patents public data — global coverage, English titles/abstracts — plus the Indian patent corpus and previously fetched PQAI/EPO documents), via hybrid keyword + semantic retrieval with cross-encoder reranking.'
    )
  )
  children.push(
    para(
      'Known coverage limits: no legal-status data; Google Patents corpus is windowed to recent years; full claims text is available for US documents on demand. These limits apply to every query below.',
      { italics: true }
    )
  )

  children.push(heading('2. Search strategy (current plan)'))
  children.push(para(`Query: ${renderBooleanPreview(plan)}`))
  for (const block of plan.blocks) {
    const terms = activeTerms(block.terms)
    if (terms.length) children.push(para(`• ${block.label} [${block.mode}]: ${terms.join('; ')}`))
  }
  const cpc = plan.cpc.filter(c => c.accepted)
  if (cpc.length) children.push(para(`• Classifications: ${cpc.map(c => c.code).join('; ')}`))
  const excluded = activeTerms(plan.notTerms)
  if (excluded.length) children.push(para(`• Excluded terms: ${excluded.join('; ')}`))
  if (plan.elements.length) {
    children.push(para('Invention elements considered:'))
    plan.elements.forEach((element, i) => children.push(para(`  E${i + 1}. ${element.text}`)))
  }

  children.push(heading('3. Queries as run'))
  if (!runs.length) children.push(para('No runs recorded.'))
  for (const run of runs) {
    const counts = run.gateCounts as unknown as StudioGateCounts
    children.push(
      para(
        `Run v${run.planVersion} (${run.planHash}) at ${run.createdAt.toISOString()} — filters ≈ ${counts.filters?.toLocaleString() ?? 'n/a'}, recall ${counts.recall?.toLocaleString?.() ?? '?'}, families ${counts.families?.toLocaleString?.() ?? '?'}, reviewed set ${run.resultCount}${run.newFamilyCount ? `, +${run.newFamilyCount} new vs prior run` : ''}.`
      )
    )
    if (counts.lanes) {
      children.push(
        para(
          `   Recall composition: ${counts.lanes.matchOnly.toLocaleString()} keyword-only, ${counts.lanes.castOnly.toLocaleString()} semantic-only, ${counts.lanes.both.toLocaleString()} both.${
            counts.vocabularyGap ? ` ${Math.round(counts.vocabularyGap * 100)}% of semantic-only hits shared no query term.` : ''
          }${counts.steered ? ' Ranking was steered by marked references.' : ''}`
        )
      )
    }
  }

  // Reviewing depth — the stopping rule, stated for the record.
  const reviewedCount = docStates.filter(s => s.tag).length
  children.push(
    para(
      `Review depth: ${reviewedCount} document families were individually assessed and marked out of ${latestFamilies.length} presented in the final run.`
    )
  )

  children.push(heading('4. Documents reviewed and marked'))
  const tagged = docStates.filter(s => s.tag || s.excluded || s.note)
  if (!tagged.length) children.push(para('No documents were tagged in this session.'))
  for (const tagName of ['RELEVANT', 'MAYBE', 'NOT_RELEVANT'] as const) {
    const group = tagged.filter(s => s.tag === tagName)
    if (!group.length) continue
    children.push(para(`${TAG_LABEL[tagName]} (${group.length}):`, { bold: true }))
    for (const state of group) {
      const family = latestFamilies.find(f => f.familyKey === state.familyKey)
      children.push(para(`• ${state.publicationNumber}${family ? ` — ${family.title}` : ''}${state.note ? ` — Note: ${state.note}` : ''}`))
    }
  }
  const excludedDocs = tagged.filter(s => s.excluded)
  if (excludedDocs.length) {
    children.push(para(`Excluded families (${excludedDocs.length}): ${excludedDocs.map(s => s.publicationNumber).join(', ')}`))
  }

  // ---- element evidence for the shortlist ---------------------------------
  if (plan.elements.length) {
    children.push(heading('5. Element-by-element evidence'))
    children.push(
      para(
        'Each marked reference below is assessed against every element of the invention. Verdicts are categorical (STRONG / PART / WEAK) and derive from literal term presence plus semantic similarity.',
        { italics: true }
      )
    )
    children.push(
      para(
        'Evidence tier is stated per reference: "claims" means the assessment read the claim text; "abstract" means it read only the title and abstract, and is therefore a similarity signal rather than a claim mapping.',
        { italics: true }
      )
    )
    const shortlist = docStates.filter(s => s.tag === 'RELEVANT' || s.tag === 'MAYBE')
    for (const state of shortlist) {
      const family = latestFamilies.find(f => f.familyKey === state.familyKey)
      if (!family) continue
      const tier = plan.elements.some(e => family.elementCells?.[e.id]?.tier === 'claims') ? 'claims' : 'abstract'
      children.push(para(`${state.publicationNumber} — ${family.title} [${tier}-tier]`, { bold: true }))
      plan.elements.forEach((element, i) => {
        const cell = family.elementCells?.[element.id]
        const found = cell?.matchedTerms?.length ? ` — terms found: ${cell.matchedTerms.join(', ')}` : ''
        children.push(para(`   E${i + 1} [${cell?.verdict || 'NONE'}] ${element.text}${found}`))
      })
    }
    if (!shortlist.length) children.push(para('No references were shortlisted.'))
  }

  // ---- attorney-authored theories -----------------------------------------
  if (theories.length) {
    children.push(heading('6. Pinned assessments'))
    children.push(
      para(
        'Element coverage is computed by the system; the rationale in each entry was authored by the attorney and is the operative legal judgment.',
        { italics: true }
      )
    )
    for (const theory of theories) {
      children.push(
        para(
          `${theory.kind === 'ANTICIPATION' ? 'Single-reference (§102-type) candidate' : 'Combination (§103-type) theory'}: ${theory.publicationNumbers.join(' + ')}`,
          { bold: true }
        )
      )
      children.push(para(`   Rationale: ${theory.motivation}`))
      children.push(para(`   Recorded ${theory.createdAt.toISOString().slice(0, 10)}.`))
    }
  }

  children.push(heading(`${plan.elements.length ? (theories.length ? '7' : '6') : '5'}. Evidence trail`))
  children.push(para('Append-only session log (human and AI actions, with provenance):', { italics: true }))
  for (const entry of trail) {
    children.push(para(`${entry.createdAt.toISOString().replace('T', ' ').slice(0, 19)} · ${entry.kind} · ${entry.actor} — ${entry.summary}`))
  }

  const doc = new Document({ sections: [{ children }] })
  const buffer = await Packer.toBuffer(doc)
  const filename = `Search-Report_${session.id.slice(-6)}_v${session.planVersion}.docx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
