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
import { runWhitespaceLLM, parseModelJson } from './llm'
import { buildClaimElementsPrompt, WS_CLAIM_ELEMENTS_STAGE_CODE } from './prompts'
import { computeRarePairs, supportFloor } from './rarity'
import type { ClaimElementFamily, DeepDiveResult } from './types'

/** Top-of-area families read at claim level. Plan §9.2 says 30-60; we take 60. */
const FAMILIES_PER_DIVE = 60
const EXTRACTION_BATCH = 8
const CLAIMS_TIMEOUT_MS = 15_000

/** z_ref for rarity normalisation (plan 10.3). */

export async function runDeepDiveStage(input: {
  runId: string
  studyId: string
  clusterId: string
  requestHeaders: Record<string, string>
}): Promise<DeepDiveResult> {
  const coverageNotes: string[] = []

  const cluster = await prisma.whitespaceCluster.findUnique({ where: { id: input.clusterId } })
  if (!cluster || cluster.studyId !== input.studyId) {
    throw new Error('That area no longer exists — the field may have been re-clustered since.')
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
    throw new Error('This area has no sampled members to read.')
  }

  // --- claims assembly, entirely from local storage -------------------------
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

  if (withoutClaims > 0) {
    coverageNotes.push(
      `${withoutClaims} of ${members.length} representative families have no readable claims locally and are excluded from element analysis — they are counted here, not hidden.`
    )
  }
  if (!readable.length) {
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
  for (let offset = 0; offset < readable.length; offset += EXTRACTION_BATCH) {
    const batch = readable.slice(offset, offset + EXTRACTION_BATCH)
    try {
      const response = await runWhitespaceLLM({
        taskCode: TaskCode.WS_CLAIM_ELEMENTS,
        stageCode: WS_CLAIM_ELEMENTS_STAGE_CODE,
        prompt: buildClaimElementsPrompt(batch, vocabulary.slice(0, 80)),
        requestHeaders: input.requestHeaders,
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
        const source = batch.find(item => item.familyKey === entry.familyKey)
        if (!source) continue
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
      }
    } catch (error) {
      console.error('[Whitespace] Element extraction batch failed:', error instanceof Error ? error.message : error)
      coverageNotes.push(`One extraction batch of ${batch.length} families failed and is missing from the analysis.`)
    }
    await heartbeat(input.runId)
  }

  if (!extracted.length) {
    throw new Error('Claim-element extraction produced nothing usable. Run the dive again.')
  }

  // --- deterministic co-occurrence + residuals (plan 10.3) ------------------
  const N = extracted.length
  const support = new Map<string, number>()
  for (const family of extracted) {
    for (const element of family.elements) support.set(element, (support.get(element) ?? 0) + 1)
  }

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

  return result
}

/** Aggressive normalisation — co-occurrence statistics run over these strings. */
function normalizeElement(raw: string): string {
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

async function heartbeat(runId: string): Promise<void> {
  try {
    await prisma.whitespaceRun.update({ where: { id: runId }, data: { heartbeatAt: new Date() } })
  } catch {
    // Staleness detection only.
  }
}
