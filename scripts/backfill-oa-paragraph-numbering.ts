import './load-env'
import { prisma } from '../src/lib/prisma'
import {
  analyzeParagraphMarkers, splitParagraphs, chunkParagraphs, normalizeInvention,
  extractCitedParagraphNumbers
} from '../src/lib/office-action/document-intake'
import { embedChunks } from '../src/lib/office-action/case-document-service'
import { normalizeLegacyDraftJson } from '../src/lib/office-action/oa-json-schema'

/**
 * Office Action Studio — paragraph numbering backfill
 *
 * Paragraph anchors used to be positional: `¶0038` meant "the 38th block we
 * happened to parse", and the reply filed that to the Controller as
 * "paragraph [0038] of the specification as filed". Anchors now come from the
 * document's own markers where it has them, and are never filed where it does
 * not.
 *
 * Existing cases therefore carry three kinds of stale data:
 *   - OaDocumentChunk.sectionRef labels built from the old anchors;
 *   - OfficeActionCase.inventionDigest, whose basis pointers are those anchors;
 *   - drafted sections containing [NNNN] citations that pointed at the old
 *     numbering.
 *
 * The first two are repairable. The third is NOT: the old [0038] and the new
 * [0038] are different paragraphs, so a mechanical remap would produce a
 * citation that LOOKS verified and is wrong — strictly worse than leaving it
 * visibly stale. Affected sections are un-approved so the attorney re-reads
 * them, and the citation lint blocks export until they do.
 *
 *   npm run oa:backfill-numbering -- --dry-run
 *   npm run oa:backfill-numbering -- --case=<id>
 *
 * Idempotent: re-running changes nothing.
 */

function argValue(name: string): string | null {
  const prefix = `${name}=`
  const found = process.argv.find(arg => arg.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}
const hasFlag = (name: string) => process.argv.includes(name)

const DRY_RUN = hasFlag('--dry-run')
const NO_REEMBED = hasFlag('--no-reembed')
const NO_UNAPPROVE = hasFlag('--no-unapprove')
const ONLY_CASE = argValue('--case')
const LIMIT = Number(argValue('--limit') || 0) || Infinity

/** Blocks this short in bulk mean the old extractor split on line wraps. */
const LINE_SPLIT_MEDIAN_CHARS = 120

type DocClass = 'no-op' | 'relabel' | 'rechunk' | 'stale-unrepairable'

interface Summary {
  casesScanned: number
  documents: Record<DocClass, number>
  chunksRelabelled: number
  chunksRebuilt: number
  documentsReembedded: number
  digestsCleared: number
  sectionsUnapproved: number
  casesFlaggedStale: string[]
}

const summary: Summary = {
  casesScanned: 0,
  documents: { 'no-op': 0, relabel: 0, rechunk: 0, 'stale-unrepairable': 0 },
  chunksRelabelled: 0, chunksRebuilt: 0, documentsReembedded: 0,
  digestsCleared: 0, sectionsUnapproved: 0, casesFlaggedStale: []
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * Was this text extracted by the old PDF path, one paragraph per printed line?
 *
 * Source-agnostic by necessity — `fileKey` is never set by the upload route, so
 * provenance is unavailable. Measuring the defect directly is more reliable
 * than metadata would have been anyway.
 */
function looksLineSplit(text: string): boolean {
  const blocks = (text || '').replace(/\r\n/g, '\n').split(/\n\s*\n+/).map(b => b.trim()).filter(Boolean)
  if (blocks.length < 20) return false
  return median(blocks.map(b => b.length)) < LINE_SPLIT_MEDIAN_CHARS
}

async function processDocument(doc: { id: string; caseId: string; kind: string; text: string | null }): Promise<{ cls: DocClass; idsChanged: boolean }> {
  const text = doc.text || ''
  if (!text.trim()) return { cls: 'no-op', idsChanged: false }

  const analysis = analyzeParagraphMarkers(text)
  const paragraphs = splitParagraphs(text, analysis)

  // Line-split text with no markers of its own cannot be repaired from what we
  // stored — the paragraph boundaries were destroyed at extraction time, and
  // guessing at them would just be a different wrong answer.
  if (analysis.mode === 'DERIVED' && looksLineSplit(text)) {
    if (!DRY_RUN) {
      const existing = await prisma.oaCaseDocument.findUnique({ where: { id: doc.id }, select: { sectionsJson: true } })
      await prisma.oaCaseDocument.update({
        where: { id: doc.id },
        data: { sectionsJson: { ...((existing?.sectionsJson as any) || {}), numberingStale: true, structureUsable: false } as any }
      })
    }
    return { cls: 'stale-unrepairable', idsChanged: true }
  }

  const rebuilt = chunkParagraphs(paragraphs)
  const stored = await prisma.oaDocumentChunk.findMany({
    where: { documentId: doc.id }, orderBy: { id: 'asc' },
    select: { id: true, text: true, sectionRef: true }
  })

  // Chunk TEXT identical means only the labels moved — no re-embedding needed,
  // which is what keeps the common case free.
  const textIdentical = stored.length === rebuilt.length &&
    stored.every((s, i) => s.text === rebuilt[i].text)

  if (textIdentical) {
    const drifted = stored.filter((s, i) => s.sectionRef !== rebuilt[i].sectionRef)
    if (!drifted.length) return { cls: 'no-op', idsChanged: false }
    if (!DRY_RUN) {
      for (let i = 0; i < stored.length; i++) {
        if (stored[i].sectionRef === rebuilt[i].sectionRef) continue
        await prisma.oaDocumentChunk.update({ where: { id: stored[i].id }, data: { sectionRef: rebuilt[i].sectionRef } })
      }
    }
    summary.chunksRelabelled += drifted.length
    return { cls: 'relabel', idsChanged: true }
  }

  // Boundaries moved: the chunk text itself is different, so the vectors no
  // longer describe what is stored.
  if (!DRY_RUN) {
    await prisma.oaDocumentChunk.deleteMany({ where: { documentId: doc.id } })
    if (rebuilt.length) {
      await prisma.oaDocumentChunk.createMany({
        data: rebuilt.map(c => ({
          caseId: doc.caseId, documentId: doc.id, kind: doc.kind,
          sectionRef: c.sectionRef, text: c.text, tokenCount: c.tokenCount
        }))
      })
    }
    if (!NO_REEMBED) {
      const embedded = await embedChunks(doc.id).catch(() => false)
      await prisma.oaCaseDocument.update({
        where: { id: doc.id }, data: { indexStatus: embedded ? 'INDEXED' : 'PENDING' }
      })
      if (embedded) summary.documentsReembedded++
    }
  }
  summary.chunksRebuilt += rebuilt.length
  return { cls: 'rechunk', idsChanged: true }
}

async function processCase(caseId: string): Promise<void> {
  summary.casesScanned++

  const docs = await prisma.oaCaseDocument.findMany({
    where: { caseId, kind: { in: ['SPECIFICATION', 'SUPPLEMENTARY'] } },
    select: { id: true, caseId: true, kind: true, text: true }
  })

  let anyIdsChanged = false
  let anyStale = false
  for (const doc of docs) {
    const { cls, idsChanged } = await processDocument(doc)
    summary.documents[cls]++
    if (idsChanged) anyIdsChanged = true
    if (cls === 'stale-unrepairable') anyStale = true
  }
  if (anyStale) summary.casesFlaggedStale.push(caseId)

  if (!anyIdsChanged) return

  // The digest's basis pointers are old anchors and cannot be remapped once
  // boundaries move. Clearing it costs one cheap rebuild on the next prepare.
  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: caseId }, select: { inventionDigest: true, specificationText: true, claimsText: true }
  })
  if (oaCase?.inventionDigest) {
    if (!DRY_RUN) {
      await prisma.officeActionCase.update({ where: { id: caseId }, data: { inventionDigest: null as any } })
    }
    summary.digestsCleared++
  }

  // Report, never rewrite, a claims divergence: the claim set is the attorney's.
  if (oaCase?.specificationText && oaCase.claimsText) {
    const rederived = normalizeInvention(oaCase.specificationText).claimElements.length
    if (rederived === 0) {
      console.log(`  note  case ${caseId}: claims no longer parse from the stored specification — left untouched, verify by hand`)
    }
  }

  // Drafted sections whose [NNNN] citations pointed at the old numbering.
  if (NO_UNAPPROVE) return
  const drafts = await prisma.oaResponseDraft.findMany({ where: { caseId }, select: { id: true, sectionsJson: true, complianceJson: true } })
  for (const draft of drafts) {
    let sections
    try { sections = normalizeLegacyDraftJson(draft.sectionsJson) } catch { continue }
    const compliance = (draft.complianceJson as any) || {}
    if (compliance.numberingRecheck?.at) continue           // already handled

    const touched: string[] = []
    for (const reply of sections.objectionReplies) {
      const cited = extractCitedParagraphNumbers(String((reply as any).bodyText || ''))
      if (!cited.length || !(reply as any).approved) continue
      ;(reply as any).approved = false
      touched.push(String((reply as any).objectionId))
    }
    for (const [key, body] of Object.entries(sections.namedSections)) {
      if (extractCitedParagraphNumbers(String(body || '')).length) touched.push(`namedSection:${key}`)
    }
    if (!touched.length) continue

    if (!DRY_RUN) {
      await prisma.oaResponseDraft.update({
        where: { id: draft.id },
        data: {
          sectionsJson: sections as any,
          complianceJson: {
            ...compliance,
            numberingRecheck: {
              at: new Date().toISOString(),
              reason: 'Paragraph numbering was corrected; citations in these sections point at the previous numbering and must be re-read.',
              sections: touched
            }
          } as any
        }
      })
      await prisma.oaObjection.updateMany({
        where: { id: { in: touched.filter(t => !t.startsWith('namedSection:')) }, document: { caseId } },
        data: { status: 'DRAFTED' }
      }).catch(() => {})
    }
    summary.sectionsUnapproved += touched.length
  }
}

async function main() {
  console.log(DRY_RUN ? '\nDRY RUN — nothing will be written.\n' : '\nApplying changes.\n')

  const cases = ONLY_CASE
    ? [{ id: ONLY_CASE }]
    : await prisma.officeActionCase.findMany({ select: { id: true }, orderBy: { id: 'asc' } })

  let n = 0
  for (const c of cases) {
    if (n++ >= LIMIT) break
    try {
      await processCase(c.id)
    } catch (err) {
      console.error(`  FAIL  case ${c.id}: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.log('\n' + JSON.stringify(summary, null, 2))
  if (summary.casesFlaggedStale.length) {
    console.log(
      `\n${summary.casesFlaggedStale.length} case(s) hold a specification that was extracted one-paragraph-per-line ` +
      `and carries no numbering of its own. It cannot be repaired from the stored text — the attorney must re-upload ` +
      `the specification before amendment analysis on those cases.`
    )
  }
  if (DRY_RUN) console.log('\nRe-run without --dry-run to apply. Re-running afterwards is a no-op.')
}

main()
  .catch(err => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
