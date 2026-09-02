import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { appendTrail, getOwnedStudy } from '@/lib/whitespace/service'
import { quotePhrase } from '@/lib/whitespace/field-map'
import { WhitespaceHttpError, whitespaceErrorResponse } from '@/app/api/whitespace/route-errors'
import type { DimensionGap, DimensionMapResult, HypothesisScores } from '@/lib/whitespace/types'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

/** Each promoted gap later costs a full metered validation run; keep batches deliberate. */
const MAX_PROMOTIONS_PER_CALL = 5

const NOT_PROMOTABLE = "This run's results are not in a promotable shape."

/**
 * Stored run results are client-shaped jsonb from an older writer, not a typed
 * row. Everything this handler dereferences — registry values, familyCount for
 * the rationale, the limitations list — is checked here, so a malformed legacy
 * payload refuses with the curated 400 instead of a TypeError.
 */
function readPromotableResults(value: unknown): DimensionMapResult {
  const results =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  if (
    !results ||
    !Array.isArray(results.registry) ||
    !results.registry.every(
      dimension =>
        Boolean(dimension) &&
        typeof dimension === 'object' &&
        Array.isArray((dimension as { values?: unknown }).values)
    ) ||
    !Array.isArray(results.gaps) ||
    typeof results.familyCount !== 'number' ||
    !Number.isFinite(results.familyCount) ||
    !Array.isArray(results.limitations)
  ) {
    throw new WhitespaceHttpError(400, NOT_PROMOTABLE)
  }
  if (!results.gaps.length) {
    throw new WhitespaceHttpError(400, 'That run holds no candidate gaps.')
  }
  return results as unknown as DimensionMapResult
}

/** The fields buildStatement/buildRationale and the evidence passage dereference. */
function assertPromotableGap(gap: DimensionGap): void {
  const ok =
    typeof gap.aValueLabel === 'string' &&
    typeof gap.bValueLabel === 'string' &&
    [gap.observed, gap.marginA, gap.marginB, gap.expected, gap.z].every(
      entry => typeof entry === 'number' && Number.isFinite(entry)
    ) &&
    (!gap.nearMissB || (typeof gap.nearMissB === 'object' && Number.isFinite(gap.nearMissB.families)))
  if (!ok) throw new WhitespaceHttpError(400, NOT_PROMOTABLE)
}

/**
 * Promotes selected dimension gaps into WhitespaceHypothesis rows the EXISTING
 * validation stage can attack unmodified.
 *
 * The one structural requirement comes from gate G1: evaluateGates resolves
 * claim coverage ONLY through a WhitespaceAreaAnalysis found by clusterId, and
 * a hypothesis without one is typed DATA_WHITESPACE/INCONCLUSIVE before any
 * attack result is read. So every promotion writes a depth-1 cluster plus an
 * area analysis whose textCoverage carries the GENUINELY MEASURED claims
 * readability of the gap's surrounding families (census armClaims). When that
 * facet could not run, familiesTotal stays 0 and G1 fails honestly — unknown
 * readability must not pass as readable.
 */
export async function POST(request: NextRequest, { params }: { params: { studyId: string } }) {
  try {
    const auth = await authenticateUser(request)
    if (!auth.user) {
      return NextResponse.json(
        { error: auth.error?.message || 'Unauthorized' },
        { status: auth.error?.status || 401 }
      )
    }

    const study = await getOwnedStudy(params.studyId, auth.user.id, auth.user.tenantId)
    if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const runId = typeof body?.runId === 'string' ? body.runId : ''
    const gapIds = Array.isArray(body?.gapIds)
      ? (body.gapIds as unknown[]).filter((id): id is string => typeof id === 'string').slice(0, MAX_PROMOTIONS_PER_CALL)
      : []
    if (!runId || !gapIds.length) {
      return NextResponse.json({ error: 'Pass runId and at least one gapId.' }, { status: 400 })
    }

    const run = await prisma.whitespaceRun.findUnique({
      where: { id: runId },
      select: { id: true, studyId: true, stage: true, status: true },
    })
    if (!run || run.studyId !== study.id || run.stage !== 'DIMENSION_MAP' || run.status !== 'COMPLETED') {
      return NextResponse.json({ error: 'That dimension map run is not available.' }, { status: 404 })
    }

    const promoted: Array<{ gapId: string; hypothesisId: string; existing: boolean }> = []
    const userId = auth.user.id

    await prisma.$transaction(async tx => {
      // The whole read-check-create-stamp sequence runs under a row lock on the
      // run. Without it, two concurrent promotions of the same gap both read
      // hypothesisId === null and both create; and because the stamp below
      // rewrites the whole results object, whichever wrote last erased the
      // other's stamps, so even sequential re-promotes duplicated.
      await tx.$queryRaw`SELECT "id" FROM "whitespace_runs" WHERE "id" = ${run.id} FOR UPDATE`

      const locked = await tx.whitespaceRun.findUnique({
        where: { id: run.id },
        select: { results: true },
      })
      const results = readPromotableResults(locked?.results)

      const valueById = new Map(
        results.registry.flatMap(dimension => dimension.values.map(value => [value.id, value] as const))
      )

      for (const gapId of gapIds) {
        const gap = results.gaps.find(entry => entry.id === gapId)
        if (!gap) continue
        if (gap.hypothesisId) {
          promoted.push({ gapId, hypothesisId: gap.hypothesisId, existing: true })
          continue
        }
        assertPromotableGap(gap)

        const aValue = valueById.get(gap.aValueId)
        const bValue = valueById.get(gap.bValueId)

        const cluster = await tx.whitespaceCluster.create({
          data: {
            studyId: study.id,
            runId: run.id,
            // Depth 1 keeps these out of the landscape pipeline's depth-0 world;
            // runClusterStage's wipe is scoped to depth 0 for exactly this reason.
            depth: 1,
            label: `${gap.aValueLabel} × ${gap.bValueLabel}`.slice(0, 200),
            description:
              `Empty cell: ${gap.aDimensionLabel} = "${gap.aValueLabel}" against ${gap.bDimensionLabel} = "${gap.bValueLabel}".`,
            keywords: [...(aValue?.synonyms ?? []).slice(0, 3), ...(bValue?.synonyms ?? []).slice(0, 3)].slice(0, 6),
            centroidBits: null,
            memberCount: 0,
            // Exact SQL count of the A-arm — legitimate here, unlike the sampled
            // extrapolation the field pipeline labels an estimate.
            fieldEstimate: gap.marginA,
            metrics: {
              density: null,
              velocityPct: null,
              hhi: null,
              crowdedness: null,
              recencyShare: null,
              jurisdictions: [],
              topAssignees: [],
              cpcMix: [],
              layout: { x: 0.5, y: 0.5 },
              grade: 'usable',
            } as unknown as Prisma.InputJsonValue,
          },
        })

        const area = await tx.whitespaceAreaAnalysis.create({
          data: {
            studyId: study.id,
            clusterId: cluster.id,
            status: 'COMPLETED',
            claimElements: { families: [] } as unknown as Prisma.InputJsonValue,
            // Exactly the shape gate G1 reads. Unmeasured arms leave zeros, and
            // G1 fails honestly rather than passing unknown readability.
            textCoverage: {
              familiesTotal: gap.armFamilies ?? 0,
              withClaims: gap.armClaimsReadable ?? 0,
              bySource: {},
            } as unknown as Prisma.InputJsonValue,
          },
        })

        const hypothesis = await tx.whitespaceHypothesis.create({
          data: {
            studyId: study.id,
            clusterId: cluster.id,
            areaAnalysisId: area.id,
            type: 'UNDETERMINED',
            status: 'DRAFT',
            statement: buildStatement(gap),
            rationale: buildRationale(gap, results.familyCount),
            elementCombination: {
              // Non-empty by construction — validate throws on an empty list.
              elements: [gap.aValueLabel, gap.bValueLabel],
              // PRE-QUOTED: the validate fallback joins these with ' OR ' into
              // one websearch string, where an unquoted multi-word phrase
              // mis-parses (implicit AND binds tighter than OR).
              searchTerms: buildSearchTerms(
                [gap.aValueLabel, ...(aValue?.synonyms ?? [])],
                [gap.bValueLabel, ...(bValue?.synonyms ?? [])]
              ),
              strategy: 'DIMENSION_CELL',
              dimensionGap: {
                runId: run.id,
                gapId: gap.id,
                aDimensionId: gap.aDimensionId,
                aValueId: gap.aValueId,
                bDimensionId: gap.bDimensionId,
                bValueId: gap.bValueId,
                observed: gap.observed,
                marginA: gap.marginA,
                marginB: gap.marginB,
                expected: gap.expected,
                z: gap.z,
              },
            } as unknown as Prisma.InputJsonValue,
            scores: {
              density: null,
              rarity: gap.rarity,
              semanticNovelty: null,
              evidenceQuality: null,
              confidence: null,
              crowdedness: null,
              strength: null,
            } satisfies HypothesisScores as unknown as Prisma.InputJsonValue,
            coverageLimitations: buildLimitations(gap, results) as unknown as Prisma.InputJsonValue,
            createdBy: userId,
          },
        })

        await tx.whitespaceEvidence.create({
          data: {
            studyId: study.id,
            hypothesisId: hypothesis.id,
            clusterId: cluster.id,
            kind: 'STATISTIC',
            stance: 'CONTEXT',
            passage:
              `"${gap.aValueLabel}" and "${gap.bValueLabel}" co-occur in ${gap.observed} of ${gap.marginA}+${gap.marginB} ` +
              `supporting families vs ${gap.expected.toFixed(1)} expected by chance (z = ${gap.z.toFixed(2)}).`,
            data: {
              a: gap.aValueLabel,
              b: gap.bValueLabel,
              supportA: gap.marginA,
              supportB: gap.marginB,
              observed: gap.observed,
              expected: gap.expected,
              z: gap.z,
              rarity: gap.rarity,
            } as unknown as Prisma.InputJsonValue,
          },
        })

        gap.hypothesisId = hypothesis.id
        promoted.push({ gapId, hypothesisId: hypothesis.id, existing: false })
      }

      // Stamp the promotions back onto the run so the gap list survives reloads.
      if (promoted.some(entry => !entry.existing)) {
        await tx.whitespaceRun.update({
          where: { id: run.id },
          data: { results: results as unknown as Prisma.InputJsonValue },
        })
      }
    },
    // Five promotions are four writes each plus the run update — twenty-one
    // round trips, which does not reliably fit Prisma's 5s default. Exceeding it
    // rolls the whole batch back and reports a bare "Transaction already closed"
    // to a user who has just chosen five gaps to pursue.
    { timeout: 60_000, maxWait: 15_000 })

    const created = promoted.filter(entry => !entry.existing)
    if (created.length) {
      await appendTrail(
        study.id,
        'HYPOTHESIS',
        `user:${userId}`,
        `${created.length} dimension gap${created.length === 1 ? '' : 's'} promoted for validation`
      )
    }

    if (!promoted.length) {
      return NextResponse.json({ error: 'None of those gaps exist on that run.' }, { status: 400 })
    }
    return NextResponse.json({ promoted }, { status: 201 })
  } catch (error) {
    return whitespaceErrorResponse(error, 'Gap promotion')
  }
}

function buildStatement(gap: DimensionGap): string {
  return `"${gap.aValueLabel}" combined with "${gap.bValueLabel}" appears absent from this field.`
}

function buildRationale(gap: DimensionGap, familyCount: number): string {
  const nearMiss = gap.nearMissB
    ? `Families on "${gap.aValueLabel}" most often take "${gap.nearMissB.valueLabel}" on the ${gap.bDimensionLabel} axis instead ` +
      `(${gap.nearMissB.families.toLocaleString()} families) — the cell was reachable and the field chose differently.`
    : `No family on "${gap.aValueLabel}" takes any value of the ${gap.bDimensionLabel} axis, so this cell may reflect vocabulary rather than absence.`
  return (
    `Across ${familyCount.toLocaleString()} families in scope, ${gap.marginA.toLocaleString()} occupy "${gap.aValueLabel}" on the ` +
    `${gap.aDimensionLabel} axis and ${gap.marginB.toLocaleString()} occupy "${gap.bValueLabel}" on the ${gap.bDimensionLabel} axis; ` +
    `${gap.observed === 0 ? 'none occupy both' : `only ${gap.observed} occupy both`}, against ${gap.expected.toFixed(1)} expected ` +
    `if the two axes were independent (z = ${gap.z.toFixed(2)}). ${nearMiss}`
  )
}

/** Both arms' vocabularies, quoted for websearch_to_tsquery, capped at 8. */
function buildSearchTerms(aTerms: string[], bTerms: string[]): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of [...aTerms.slice(0, 4), ...bTerms.slice(0, 4)]) {
    const term = raw.trim()
    if (!term) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(quotePhrase(term))
  }
  return terms.slice(0, 8)
}

function buildLimitations(gap: DimensionGap, results: DimensionMapResult): string[] {
  const limitations = [...results.limitations]
  if (gap.coverageSuspect && gap.suspectReason) limitations.push(gap.suspectReason)
  if (gap.armFamilies === null) {
    limitations.push('Claims readability of the surrounding families was not measured; the data gate will fail until it is.')
  }
  if (gap.observed > 0) {
    limitations.push(`${gap.observed} famil${gap.observed === 1 ? 'y' : 'ies'} already occupy this cell — near-empty, not empty.`)
  }
  return limitations
}
