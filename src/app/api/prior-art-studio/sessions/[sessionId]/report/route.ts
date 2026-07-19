import { NextRequest, NextResponse } from 'next/server'
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { computeSaturation, getOwnedSession } from '@/lib/prior-art-studio/service'
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
  children.push(para(`Prepared by user ${auth.user.email || auth.user.id} via PatentNest Advanced Search Studio.`, { italics: true }))

  // ---- run outcome, stated before anything else ---------------------------
  // A search that returned nothing previously read as an unfinished review:
  // the report said "221 families / 0 reviewed" and never mentioned that zero
  // documents reached the attorney, nor why.
  const latestWarnings = Array.isArray(latestRun?.warnings) ? (latestRun?.warnings as string[]) : []
  const shownCount = latestFamilies.length
  if (latestRun && shownCount === 0) {
    children.push(heading('Run outcome: NO DOCUMENTS WERE PRESENTED'))
    children.push(
      para(
        'The most recent run of this search presented ZERO documents for review. Nothing in this report should be read as evidence about the state of the art — the search did not complete successfully.',
        { bold: true }
      )
    )
    for (const warning of latestWarnings) children.push(para(`• ${warning}`))
    if (!latestWarnings.length) children.push(para('• No diagnostic was recorded for this run.'))
  } else if (latestWarnings.length) {
    children.push(heading('Run diagnostics'))
    children.push(para('The following conditions affected the most recent run and qualify every figure below:', { italics: true }))
    for (const warning of latestWarnings) children.push(para(`• ${warning}`))
  }

  children.push(heading('1. Scope and coverage'))
  children.push(
    para(
      'Sources searched: the PatentNest stored corpus only — Google Patents public data (worldwide publications from 2000 onward, English titles and abstracts, machine-translated where necessary) together with the Indian patent corpus. No live patent database or external search API was queried.'
    )
  )
  children.push(
    para(
      'Retrieval method: semantic (embedding) retrieval over title and abstract, optionally narrowed by literal keyword requirements and by classification, date and jurisdiction filters, followed by cross-encoder reranking where enabled.'
    )
  )
  children.push(para('Known coverage limits, applying to every query below:', { italics: true }))
  for (const line of [
    'Coverage begins at the year 2000. Art published before 2000 is NOT in this corpus.',
    'Patent documents only — no non-patent literature (journals, standards, datasheets, product manuals) was searched.',
    'No legal-status data: nothing is filtered by whether a patent is granted, lapsed or in force. This is not a clearance search.',
    'Only titles and abstracts are indexed for retrieval. Claims and descriptions are stored for US documents only and are NOT searched, so element evidence for other jurisdictions is abstract-level.',
    'The dataset refreshes quarterly, so publications from the last 0–3 months may be absent.',
  ]) {
    children.push(para(`• ${line}`))
  }

  children.push(heading('2. Search strategy (current plan)'))
  children.push(para(`Query: ${renderBooleanPreview(plan)}`))
  children.push(
    para(
      'MATCH = required vocabulary: documents missing these terms are flagged "misses MATCH" and counted, but every retrieved document is presented. BOTH = the terms widen retrieval and boost ranking. EXPAND = meaning-based only.',
      { italics: true }
    )
  )
  for (const block of plan.blocks) {
    const role = block.mode === 'MATCH' ? 'MATCH — required' : block.mode === 'BOTH' ? 'BOTH — widens' : 'EXPAND — meaning only'
    const terms = activeTerms(block.terms)
    if (terms.length) children.push(para(`• ${block.label} [${role}]: ${terms.join('; ')}`))
  }
  const cpc = plan.cpc.filter(c => c.accepted)
  if (cpc.length) children.push(para(`• Classifications: ${cpc.map(c => c.code).join('; ')}`))
  const excluded = activeTerms(plan.notTerms)
  if (excluded.length) children.push(para(`• Excluded terms: ${excluded.join('; ')}`))
  if (plan.elements.length) {
    children.push(para('Invention elements considered:'))
    plan.elements.forEach((element, i) => children.push(para(`  E${i + 1}. ${element.text}`)))
  }

  let sectionNo = 4
  children.push(heading('3. Queries as run'))
  children.push(
    para(
      'Each run below is recorded verbatim at execution time: the compiled plan (identified by its hash), the gate counts, the per-corpus contribution and every diagnostic. The stored plan can be re-executed independently to verify these results.',
      { italics: true }
    )
  )
  if (!runs.length) children.push(para('No runs recorded.'))
  for (const run of runs) {
    const counts = run.gateCounts as unknown as StudioGateCounts
    const presented = Array.isArray(run.results) ? (run.results as unknown[]).length : 0
    children.push(
      para(
        `${counts.depth === 'fast' ? 'Fast scan' : 'Deep search'} v${run.planVersion} (${run.planHash}) at ${run.createdAt.toISOString()} — retrieved ${counts.recall?.toLocaleString?.() ?? '?'}, presented for review ${presented}${
          typeof counts.matchSatisfied === 'number' && counts.matchRemoved
            ? ` (${counts.matchSatisfied.toLocaleString()} meet every MATCH block, ${counts.matchRemoved.toLocaleString()} do not — ALL presented)`
            : ''
        }${counts.notHits ? `, ${counts.notHits} flagged by NOT terms (hidden by default, not deleted)` : ''}${run.newFamilyCount ? `, +${run.newFamilyCount} new vs prior run` : ''}.${presented === 0 ? ' THIS RUN PRESENTED NOTHING.' : ''}`
      )
    )
    children.push(
      para(
        `   Scope before retrieval: approximately ${counts.filters?.toLocaleString() ?? 'n/a'} documents matched the date, jurisdiction and classification filters. This is a database planner estimate, not an exact count.`,
        { italics: true }
      )
    )
    if (counts.lanes && presented > 0) {
      children.push(
        para(
          `   Recall composition: ${counts.lanes.matchOnly.toLocaleString()} keyword-only, ${counts.lanes.castOnly.toLocaleString()} semantic-only, ${counts.lanes.both.toLocaleString()} both.${
            counts.vocabularyGap ? ` ${Math.round(counts.vocabularyGap * 100)}% of semantic-only hits shared no query term.` : ''
          }${counts.steered ? ' Ranking was steered by marked references.' : ''}`
        )
      )
    }
    const stats = Array.isArray(run.providerStats)
      ? (run.providerStats as Array<{ providerId?: string; label?: string; resultCount?: number }>)
      : []
    if (stats.length) {
      children.push(
        para(
          `   Corpus contribution: ${stats
            .map(s => `${s.label || s.providerId || 'unknown'} ${s.resultCount ?? 0}`)
            .join(' · ')}${typeof run.durationMs === 'number' ? ` · executed in ${(run.durationMs / 1000).toFixed(1)}s` : ''}.`
        )
      )
    }
    const runWarnings = Array.isArray(run.warnings) ? (run.warnings as string[]) : []
    for (const warning of runWarnings) children.push(para(`   ⚠ ${warning}`, { italics: true }))
  }

  // Reviewing depth — the stopping rule, stated for the record.
  const reviewedCount = docStates.filter(s => s.tag).length
  const saturation = computeSaturation(docStates.map(s => ({ tag: s.tag, updatedAt: s.updatedAt })))
  children.push(
    para(
      `Review depth: ${reviewedCount} document families were individually assessed and marked out of ${latestFamilies.length} presented in the final run. Stopping-rule reading at close: ${saturation.suggestion}`
    )
  )

  children.push(heading(`${sectionNo++}. Documents reviewed and marked`))
  const tagged = docStates.filter(s => s.tag || s.excluded || s.note)
  if (!tagged.length) children.push(para('No documents were tagged in this session.'))
  for (const tagName of ['RELEVANT', 'MAYBE', 'NOT_RELEVANT'] as const) {
    const group = tagged.filter(s => s.tag === tagName)
    if (!group.length) continue
    children.push(para(`${TAG_LABEL[tagName]} (${group.length}):`, { bold: true }))
    for (const state of group) {
      const family = latestFamilies.find(f => f.familyKey === state.familyKey)
      const bits = [
        family?.publicationDate,
        family?.applicants,
        family && family.members.length > 1 ? `family of ${family.members.length}` : null,
        family?.lane === 'cast'
          ? 'found by meaning only'
          : family?.lane === 'both'
            ? 'found by words + meaning'
            : family?.lane === 'match'
              ? 'found by keywords'
              : null,
      ].filter(Boolean)
      children.push(
        para(
          `• ${state.publicationNumber}${family ? ` — ${family.title}` : ' — (not in the final run’s result set)'}${
            bits.length ? ` (${bits.join(' · ')})` : ''
          }${state.note ? ` — Note: ${state.note}` : ''}`
        )
      )
    }
  }
  const excludedDocs = tagged.filter(s => s.excluded)
  if (excludedDocs.length) {
    children.push(para(`Excluded families (${excludedDocs.length}): ${excludedDocs.map(s => s.publicationNumber).join(', ')}`))
  }

  // ---- element evidence for the shortlist ---------------------------------
  if (plan.elements.length) {
    children.push(heading(`${sectionNo++}. Element-by-element evidence`))
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
    children.push(heading(`${sectionNo++}. Pinned assessments`))
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

  children.push(heading(`${sectionNo++}. Evidence trail`))
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
