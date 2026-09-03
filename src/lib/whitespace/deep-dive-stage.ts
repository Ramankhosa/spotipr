/**
 * Whitespace Studio — stage 4, the deep dive.
 *
 * Reads the claims of one area's most representative families and decomposes
 * them into elements (WIPO-style SAO), then computes co-occurrence residuals
 * deterministically. The LLM extracts and normalises text; every number that
 * follows — supports, expectations, residuals, rarity — is arithmetic.
 *
 * Families with no local claim text are EXCLUDED FROM ELEMENT ANALYSIS AND
 * COUNTED in the coverage record, never silently omitted. The count feeds gate
 * G1 and is surfaced on the claim-element screen.
 */

import { Prisma, TaskCode } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { runWhitespaceLLM, parseModelJson, type WhitespaceLLMContext } from './llm'
import { WhitespacePermanentError } from './run-lease'
import { buildClaimElementsPrompt, WS_CLAIM_ELEMENTS_STAGE_CODE } from './prompts'
import { computeRarePairs, supportFloor } from './rarity'
import type { ClaimElementFamily, DeepDiveResult } from './types'
import type { RunReporter } from './run-reporter'

/** Top-of-area families read at claim level. Plan §9.2 says 30-60; we take 60. */
const FAMILIES_PER_DIVE = 60
const EXTRACTION_BATCH = 8
const CLAIMS_TIMEOUT_MS = 15_000

const DEEP_DIVE_STEPS = [
  { key: 'members', label: "Choosing the area's most representative families" },
  { key: 'claims', label: 'Loading their claims' },
  { key: 'extract', label: 'Reading claims and extracting elements' },
  { key: 'tally', label: 'Counting element combinations' },
  { key: 'save', label: 'Saving the analysis' },
]
const DEEP_DIVE_COUNTERS = [
  { key: 'readable', label: 'Families with readable claims' },
  { key: 'extracted', label: 'Families read' },
  { key: 'elements', label: 'Distinct elements' },
]
/** Publication numbers named in a batch's "model" line before the ellipsis. */
const BATCH_EVENT_PUBLICATIONS = 3

/** z_ref for rarity normalisation (plan 10.3). */

export async function runDeepDiveStage(input: {
  runId: string
  workerId: string
  reporter: RunReporter
  studyId: string
  clusterId: string
  llmContext: WhitespaceLLMContext
}): Promise<DeepDiveResult> {
  const { reporter } = input
  await reporter.plan(DEEP_DIVE_STEPS, DEEP_DIVE_COUNTERS)
  const coverageNotes: string[] = []

  await reporter.step('members')
  const cluster = await prisma.whitespaceCluster.findUnique({ where: { id: input.clusterId } })
  if (!cluster || cluster.studyId !== input.studyId) {
    throw new WhitespacePermanentError('That area no longer exists — the field may have been re-clustered since.')
  }

  // Medoids first — they are the area's most representative documents — then
  // the rest of the sample in stored order.
  const members = await prisma.whitespaceClusterMember.findMany({
    where: { studyId: input.studyId, clusterId: input.clusterId },
    orderBy: [{ isMedoid: 'desc' }, { id: 'asc' }],
    take: FAMILIES_PER_DIVE,
    select: { familyKey: true, publicationNumber: true, title: true },
  })
  if (!members.length) {
    throw new WhitespacePermanentError('This area has no sampled members to read.')
  }
  reporter.event('count', `${members.length} representative families of “${cluster.label}” chosen, medoids first`)

  // --- claims assembly, entirely from local storage -------------------------
  await reporter.step('claims', `Loading the claims of ${members.length} families`)
  const publicationNumbers = members.map(member => member.publicationNumber)
  const claimRows = await withTimeout<{
    publicationNumber: string
    title: string | null
    claimsText: string | null
    claimsAvailability: string
  }>(Prisma.sql`
    SELECT lp."publicationNumber",
           lp."title",
           lp."claimsText",
           COALESCE(lp."claimsCompleteness", CASE WHEN lp."claimsText" IS NOT NULL THEN 'FIRST_CLAIM_ONLY' ELSE 'NONE' END)
             AS "claimsAvailability"
    FROM "local_patents" lp
    WHERE lp."publicationNumber" IN (${Prisma.join(publicationNumbers.map(value => Prisma.sql`${value}`), ', ')})`)

  const claimsByPublication = new Map(claimRows.map(row => [row.publicationNumber, row]))

  const readable: Array<{ familyKey: string; publicationNumber: string; title: string; claimsText: string; claimsAvailability: string }> = []
  let withoutClaims = 0
  for (const member of members) {
    const row = claimsByPublication.get(member.publicationNumber)
    const text = row?.claimsText?.trim()
    if (text) {
      readable.push({
        familyKey: member.familyKey,
        publicationNumber: member.publicationNumber,
        title: row?.title || member.title,
        claimsText: text,
        claimsAvailability: row?.claimsAvailability || 'FIRST_CLAIM_ONLY',
      })
    } else {
      withoutClaims++
    }
  }

  reporter.count('readable', readable.length, members.length)
  reporter.event('count', `${readable.length} of ${members.length} families have readable claims locally`)

  if (withoutClaims > 0) {
    coverageNotes.push(
      `${withoutClaims} of ${members.length} representative families have no readable claims locally and are excluded from element analysis — they are counted here, not hidden.`
    )
  }
  if (!readable.length) {
    // Nothing to read: the rail says so rather than marking the steps done.
    await reporter.skip('extract', 'no readable claims')
    await reporter.skip('tally', 'no readable claims')
    await reporter.step('save', 'Saving the empty analysis')
    // Persist the empty analysis so G1 has a record to read, then stop honestly.
    await upsertAreaAnalysis(input.studyId, input.clusterId, {
      status: 'COMPLETED',
      claimElements: { families: [] } as unknown as Prisma.InputJsonValue,
      textCoverage: {
        familiesTotal: members.length,
        withClaims: 0,
        bySource: {},
      } as unknown as Prisma.InputJsonValue,
      results: null,
    })
    reporter.done()
    return {
      clusterId: input.clusterId,
      clusterLabel: cluster.label,
      familiesConsidered: members.length,
      familiesWithClaims: 0,
      familiesExtracted: 0,
      elementSupport: [],
      rarePairs: [],
      supportFloor: 0,
      problemSolution: [],
      coverageNotes: [
        ...coverageNotes,
        'No claims are readable for this area, so element-level analysis cannot run. This is a data gap, not a finding.',
      ],
      generatedAt: new Date().toISOString(),
    }
  }

  // --- extraction, batched, with a shared normalised vocabulary -------------
  const extracted: ClaimElementFamily[] = []
  const vocabulary: string[] = []
  // Extractions whose familyKey matched nothing in the batch, counted rather
  // than silently dropped — the module header promises families are never
  // silently omitted, and a garbled echo is a data gap like any other.
  let unmatchedExtractions = 0
  const batchTotal = Math.ceil(readable.length / EXTRACTION_BATCH)
  for (let offset = 0; offset < readable.length; offset += EXTRACTION_BATCH) {
    const batch = readable.slice(offset, offset + EXTRACTION_BATCH)
    const batchIndex = Math.floor(offset / EXTRACTION_BATCH)
    await reporter.step('extract', undefined, { n: batchIndex + 1, total: batchTotal })
    reporter.event('model', `Reading claims of ${batch.length} families: ${describeBatch(batch)}`)
    // Narration is buffered and emitted after the try: a lost lease must not
    // be logged as an extraction failure, and the heartbeat below rethrows it.
    const readLines: string[] = []
    let batchFailed = false
    try {
      const response = await runWhitespaceLLM({
        taskCode: TaskCode.WS_CLAIM_ELEMENTS,
        stageCode: WS_CLAIM_ELEMENTS_STAGE_CODE,
        prompt: buildClaimElementsPrompt(batch, vocabulary.slice(0, 80)),
        context: input.llmContext,
      })
      const parsed = parseModelJson<{
        families: Array<{
          familyKey: string
          elements: unknown
          problem?: unknown
          solution?: unknown
          constraint?: unknown
        }>
      }>(response.output, 'Claim-element extraction')

      for (const entry of parsed.families ?? []) {
        // The prompt shows "FAMILY {familyKey} ({publicationNumber})", and the
        // model sometimes echoes the publication number where the family key
        // was asked for — matching on it keeps the extraction.
        const source =
          batch.find(item => item.familyKey === entry.familyKey) ??
          batch.find(item => item.publicationNumber === entry.familyKey)
        if (!source) {
          unmatchedExtractions++
          continue
        }
        const elements = Array.isArray(entry.elements)
          ? Array.from(
              new Set(
                entry.elements
                  .filter((element): element is string => typeof element === 'string')
                  .map(normalizeElement)
                  .filter(element => element.length > 2)
              )
            ).slice(0, 12)
          : []
        if (!elements.length) continue
        for (const element of elements) {
          if (!vocabulary.includes(element)) vocabulary.push(element)
        }
        extracted.push({
          familyKey: source.familyKey,
          publicationNumber: source.publicationNumber,
          title: source.title,
          elements,
          problem: typeof entry.problem === 'string' ? entry.problem.trim().slice(0, 200) || null : null,
          solution: typeof entry.solution === 'string' ? entry.solution.trim().slice(0, 200) || null : null,
          constraint: typeof entry.constraint === 'string' ? entry.constraint.trim().slice(0, 200) || null : null,
          claimsAvailability: source.claimsAvailability,
        })
        readLines.push(
          `${source.publicationNumber} — ${source.title.slice(0, 70)}: ${elements.length} element${elements.length === 1 ? '' : 's'}`
        )
      }
    } catch (error) {
      console.error('[Whitespace] Element extraction batch failed:', error instanceof Error ? error.message : error)
      coverageNotes.push(`One extraction batch of ${batch.length} families failed and is missing from the analysis.`)
      batchFailed = true
    }
    if (batchFailed) {
      reporter.event('note', `One batch of ${batch.length} families failed and is excluded`)
    } else {
      for (const line of readLines) reporter.event('read', line)
    }
    reporter.count('extracted', extracted.length, readable.length)
    reporter.count('elements', vocabulary.length)
    await reporter.heartbeat()
  }

  if (unmatchedExtractions > 0) {
    coverageNotes.push(
      `${unmatchedExtractions} extraction${
        unmatchedExtractions === 1 ? '' : 's'
      } named a family that was not in the batch put to the model and ${
        unmatchedExtractions === 1 ? 'was' : 'were'
      } dropped — element analysis may under-read this area.`
    )
  }

  if (!extracted.length) {
    throw new Error('Claim-element extraction produced nothing usable. Run the dive again.')
  }

  // --- deterministic co-occurrence + residuals (plan 10.3) ------------------
  await reporter.step('tally', `Counting element combinations across ${extracted.length} families`)
  const N = extracted.length
  const support = new Map<string, number>()
  for (const family of extracted) {
    for (const element of family.elements) support.set(element, (support.get(element) ?? 0) + 1)
  }
  // The distinct-element count is work done; which pairs are rare is a finding
  // and stays hidden until the run completes.
  reporter.count('elements', support.size)
  reporter.event('count', `${support.size} distinct elements tallied`)

  // The floor and the residual math live in rarity.ts so tests pin them down.
  const floor = supportFloor(N)
  const rarePairs = computeRarePairs(extracted.map(family => family.elements), floor)

  // --- SAO problem-solution matrix ------------------------------------------
  const problems = new Map<string, { solutions: Set<string>; families: number }>()
  for (const family of extracted) {
    if (!family.problem) continue
    const key = family.problem.toLowerCase()
    const entry = problems.get(key) ?? { solutions: new Set<string>(), families: 0 }
    entry.families++
    if (family.solution) entry.solutions.add(family.solution)
    problems.set(key, entry)
  }
  const problemSolution = Array.from(problems.entries())
    .map(([problem, entry]) => ({ problem, solutions: Array.from(entry.solutions).slice(0, 6), families: entry.families }))
    .sort((a, b) => b.families - a.families)
    .slice(0, 25)

  // --- text coverage by source, for G1 --------------------------------------
  const bySource: Record<string, number> = {}
  for (const family of extracted) {
    bySource[family.claimsAvailability] = (bySource[family.claimsAvailability] ?? 0) + 1
  }

  const result: DeepDiveResult = {
    clusterId: input.clusterId,
    clusterLabel: cluster.label,
    familiesConsidered: members.length,
    familiesWithClaims: readable.length,
    familiesExtracted: N,
    elementSupport: Array.from(support.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([element, families]) => ({ element, families })),
    rarePairs: rarePairs.slice(0, 40),
    supportFloor: floor,
    problemSolution,
    coverageNotes: [
      ...coverageNotes,
      `Element analysis reads ${N} families of an area estimated at ${cluster.fieldEstimate.toLocaleString()}; rarity is computed within this read set only.`,
    ],
    generatedAt: new Date().toISOString(),
  }

  await reporter.step('save', `Saving the analysis of ${N} families`)
  await upsertAreaAnalysis(input.studyId, input.clusterId, {
    status: 'COMPLETED',
    claimElements: { families: extracted } as unknown as Prisma.InputJsonValue,
    problemSolutionMatrix: { problems: problemSolution } as unknown as Prisma.InputJsonValue,
    textCoverage: {
      familiesTotal: members.length,
      withClaims: readable.length,
      bySource,
    } as unknown as Prisma.InputJsonValue,
    results: result as unknown as Prisma.InputJsonValue,
  })

  reporter.done()
  return result
}

/** "PUB, PUB, PUB…" — the first few publication numbers of a batch. */
function describeBatch(batch: Array<{ publicationNumber: string }>): string {
  const named = batch
    .slice(0, BATCH_EVENT_PUBLICATIONS)
    .map(item => item.publicationNumber)
    .join(', ')
  return batch.length > BATCH_EVENT_PUBLICATIONS ? `${named}…` : named
}

/**
 * Aggressive normalisation — co-occurrence statistics run over these strings.
 *
 * Exported because every consumer of an element label has to normalise the SAME
 * way to compare against one. The hypothesis generator did not, and so matched
 * the model's freely-written elements ("Capacitive sensing.") against these
 * normalised ones ("capacitive sensing") by strict equality: it essentially
 * never matched, and every hypothesis was written with `rarity: null` plus a
 * limitation saying no measured rarity backed it — while the measurement it
 * needed was sitting in the same array.
 */
export function normalizeElement(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

async function upsertAreaAnalysis(
  studyId: string,
  clusterId: string,
  data: {
    status: string
    claimElements: Prisma.InputJsonValue
    problemSolutionMatrix?: Prisma.InputJsonValue
    textCoverage: Prisma.InputJsonValue
    results: Prisma.InputJsonValue | null
  }
) {
  const existing = await prisma.whitespaceAreaAnalysis.findFirst({ where: { studyId, clusterId } })
  if (existing) {
    await prisma.whitespaceAreaAnalysis.update({
      where: { id: existing.id },
      data: {
        status: data.status,
        claimElements: data.claimElements,
        problemSolutionMatrix: data.problemSolutionMatrix,
        textCoverage: data.textCoverage,
        results: data.results ?? Prisma.DbNull,
      },
    })
  } else {
    await prisma.whitespaceAreaAnalysis.create({
      data: {
        studyId,
        clusterId,
        status: data.status,
        claimElements: data.claimElements,
        problemSolutionMatrix: data.problemSolutionMatrix,
        textCoverage: data.textCoverage,
        results: data.results ?? undefined,
      },
    })
  }
}

async function withTimeout<T>(query: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(CLAIMS_TIMEOUT_MS)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}
