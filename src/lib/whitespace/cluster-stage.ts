/**
 * Whitespace Studio — stage 2, the cluster pass.
 *
 * Draws a capped uniform sample of scope-matching families that carry binary
 * embeddings, clusters them with binary k-majority (see binary-kmeans.ts), names
 * the clusters with one batched cheap-tier call, and persists the result.
 *
 * Two honesty rules govern this stage:
 *   - Field-scale counts are sample-weight extrapolations and are stored as
 *     `fieldEstimate`, never as counts. The weight is uniform because the sample
 *     is uniform (hash order), which keeps per-cluster extrapolation unbiased.
 *   - The map layout is a selector, never evidence (WIPO Pub. 946 §8.6.2). No
 *     downstream stage reads meaning into an empty region of it.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TaskCode } from '@prisma/client'
import {
  BITS,
  WORDS,
  binaryKMeans,
  clusterGeometry,
  coherenceGrade,
  layoutCentroids,
  packBitString,
  wordsToHex,
} from './binary-kmeans'
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '@/lib/patent-corpus-service'
import { canonicaliseAssignee, extractApplicantNames, narrowingAdvice } from './field-map'
import { resolveFieldDefinition } from './field-definition'
import { ladderSummary, wideningAdviceFor } from './field-rule'
import { comparableVectorSql } from './embedding'
import { runWhitespaceLLM, parseModelJson, type WhitespaceLLMContext } from './llm'
import { WhitespacePermanentError } from './run-lease'
import { buildClusterLabelPrompt, WS_CLUSTER_LABEL_STAGE_CODE } from './prompts'
import { stableJson, type ClusterStageResult, type WhitespaceScope } from './types'
import type { RunReporter } from './run-reporter'

/** Sample ceiling. 20k × 64B vectors ≈ 1.3MB packed; k-means cost is trivial. */
const SAMPLE_CAP = Math.max(1000, Number(process.env.WHITESPACE_CLUSTER_SAMPLE_CAP) || 20_000)
const STAGE_TIMEOUT_MS = 60_000
/** Lloyd pass ceiling — also the total the "passes" counter is narrated against. */
const KMEANS_MAX_ITERATIONS = 20

const CLUSTER_STEPS = [
  { key: 'field', label: 'Loading the field definition' },
  { key: 'sample', label: 'Drawing a uniform sample' },
  { key: 'cluster', label: 'Grouping similar families' },
  { key: 'geometry', label: 'Measuring how tight each group is' },
  { key: 'name', label: 'Naming the areas' },
  { key: 'persist', label: 'Saving the areas' },
]
const CLUSTER_COUNTERS = [
  { key: 'sampled', label: 'Sampled families' },
  { key: 'areas', label: 'Areas' },
  { key: 'passes', label: 'Clustering passes', total: KMEANS_MAX_ITERATIONS },
  { key: 'saved', label: 'Areas saved' },
]
/**
 * Area names narrated one per line, the rest aggregated: k reaches 24 and the
 * reporter's feed window holds 20 events between two awaited writes.
 */
const NAME_EVENT_BUDGET = 18

interface SampleRow {
  id: string
  familyKey: string
  publicationNumber: string
  title: string | null
  abstract: string | null
  classifications: string[] | null
  filingYear: number | null
  applicants: unknown
  bits: string
}

function chooseK(n: number): number {
  // Small fields get few areas; the ceiling of 24 is a browsing limit, not math.
  return Math.min(24, Math.max(4, Math.floor(Math.sqrt(n / 40))))
}

export async function runClusterStage(input: {
  runId: string
  workerId: string
  reporter: RunReporter
  studyId: string
  scope: WhitespaceScope
  llmContext: WhitespaceLLMContext
}): Promise<ClusterStageResult> {
  const { reporter } = input
  await reporter.plan(CLUSTER_STEPS, CLUSTER_COUNTERS)

  // binary-kmeans is a Hamming clusterer over fixed-width bit vectors; it
  // cannot read a float corpus. Refuse up front with the real reason — the
  // old path fell through to "the embedding pipeline has not covered this
  // corpus slice yet", which on a float installation is simply untrue (the
  // pipeline covered it, in float), and sent operators chasing a phantom
  // ingestion gap.
  if (PATENT_CORPUS_EMBEDDING_DTYPE !== 'binary') {
    throw new WhitespacePermanentError(
      `The area map clusters binary (Hamming) vectors, but this installation stores ${PATENT_CORPUS_EMBEDDING_DTYPE} ` +
        `vectors (${PATENT_CORPUS_EMBEDDING_MODEL}). The rest of the study — census, signals, validation — works ` +
        `without it; area clustering needs a binary-embedded corpus.`
    )
  }
  if (PATENT_CORPUS_EMBEDDING_DIMENSIONS !== BITS) {
    throw new WhitespacePermanentError(
      `The area map clusters ${BITS}-bit vectors, but this installation is configured for ` +
        `${PATENT_CORPUS_EMBEDDING_DIMENSIONS}-bit vectors — the sample would fail to pack mid-stage.`
    )
  }

  // The same hybrid field the census counted — same semantic candidates AND the
  // same match rule the census fitted (reuse: true reads it off the census run).
  // Each stage is its own run, and an area map drawn over a narrower field than
  // the census reported would make every area's share of the field wrong.
  await reporter.step('field', 'Reading the match rule the census fitted')
  const field = await resolveFieldDefinition(input.scope, { studyId: input.studyId, reuse: true })
  const where = field.where
  const coverageNotes: string[] = [...field.coverageNotes]

  // --- field size + sample ---------------------------------------------------
  // Field size comes from the completed census when one exists — re-counting the
  // corpus here would repeat the most expensive query in the studio for a number
  // the study already holds. The direct count is only the fallback.
  await reporter.step('sample', `Drawing up to ${SAMPLE_CAP.toLocaleString()} families in family-key hash order`)
  const censusFamilies = await familyCountFromCensus(input.studyId, input.scope)

  // Hash order over the FAMILY KEY (stable business key), not the autoincrement
  // id — the same reason the dimension census samples by md5(familyKey): ids
  // are re-minted by a re-import, and a sample keyed on them redrew the area
  // map for an identical scope.
  let sampleRows: SampleRow[]
  try {
    sampleRows = await withTimeout<SampleRow>(
      Prisma.sql`
        SELECT t.*
        FROM (
          SELECT DISTINCT ON (COALESCE(lp."familyId", lp."publicationNumber"))
                 lp."id"                                        AS id,
                 COALESCE(lp."familyId", lp."publicationNumber") AS "familyKey",
                 lp."publicationNumber"                          AS "publicationNumber",
                 lp."title"                                      AS title,
                 left(coalesce(lp."abstract", ''), 400)          AS abstract,
                 lp."classifications"                            AS classifications,
                 EXTRACT(YEAR FROM lp."filingDate")::int         AS "filingYear",
                 lp."applicants"                                 AS applicants,
                 e."embeddingBinary"::text                       AS bits
          FROM "local_patents" lp
          JOIN "local_patent_embeddings" e ON e."localPatentId" = lp."id"
          WHERE ${where} AND ${comparableVectorSql()}
          ORDER BY COALESCE(lp."familyId", lp."publicationNumber"), lp."publicationDate" DESC NULLS LAST, lp."publicationNumber"
        ) t
        ORDER BY md5(t."familyKey")
        LIMIT ${SAMPLE_CAP}`
    )
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new WhitespacePermanentError(
        `Sampling this field timed out after ${Math.round(STAGE_TIMEOUT_MS / 1000)}s — the scope matches too many families to draw a uniform sample from. ${narrowingAdvice(
          input.scope,
          field.rule
        )}`
      )
    }
    throw error
  }

  let fieldFamilies = censusFamilies ?? 0
  if (censusFamilies === null) {
    try {
      const fieldCountRows = await withTimeout<{ families: bigint }>(
        Prisma.sql`
          SELECT COUNT(DISTINCT COALESCE(lp."familyId", lp."publicationNumber"))::bigint AS families
          FROM "local_patents" lp
          WHERE ${where}`
      )
      fieldFamilies = Number(fieldCountRows[0]?.families ?? 0)
    } catch (error) {
      if (!isStatementTimeout(error)) throw error
      throw new Error(
        'The field size could not be counted — run the field map first so this stage can reuse its census.'
      )
    }
  }
  const n = sampleRows.length
  reporter.count('sampled', n)
  reporter.event('count', `${n.toLocaleString()} families sampled from a field of ${fieldFamilies.toLocaleString()}`)

  if (n < 20) {
    // Two different failures wear the same number, and conflating them sends
    // operators after the wrong thing. A 21-family field with 18 vectors is not
    // an ingestion gap — coverage is 86% — it is simply a small field, and
    // "wait for embedding coverage" is advice that will never come true. Only
    // blame coverage when coverage is actually the shortfall.
    const coverageIsTheProblem = fieldFamilies >= 20 && n < fieldFamilies * 0.7
    throw new WhitespacePermanentError(
      n === 0
        ? fieldFamilies > 0
          ? `None of the ${fieldFamilies.toLocaleString()} families in this scope carry a comparable embedding vector, so the field cannot be clustered. The embedding pipeline has not covered this corpus slice yet.`
          : 'This scope matches no families at all, so there is nothing to cluster. Widen the scope.'
        : coverageIsTheProblem
        ? `Only ${n} of the ${fieldFamilies.toLocaleString()} families in this scope carry a comparable embedding vector — too few to break into areas. Wait for embedding coverage to catch up on this slice.`
        : `This field is only ${fieldFamilies.toLocaleString()} families, which is too small to break into areas — an area map needs at least 20.${ladderSummary(
            field.rule
          )} ${wideningAdviceFor(input.scope, field.rule)}`
    )
  }

  // --- pack + cluster -------------------------------------------------------
  const k = chooseK(n)
  await reporter.step('cluster', `Grouping ${n.toLocaleString()} families into ${k} areas`)
  reporter.count('areas', k)
  reporter.event('note', `${k} areas planned`)

  const data = new Uint32Array(n * WORDS)
  for (let i = 0; i < n; i++) {
    data.set(packBitString(sampleRows[i].bits), i * WORDS)
  }

  // k-means is synchronous, so the passes are a counter that lands in the next
  // flush plus ONE line after the loop — never an event per pass.
  let lastPassChanged = -1
  const result = binaryKMeans(data, n, k, {
    seed: 7,
    maxIterations: KMEANS_MAX_ITERATIONS,
    onIteration: info => {
      lastPassChanged = info.changed
      reporter.count('passes', info.iteration, info.maxIterations)
    },
  })
  reporter.event(
    'note',
    lastPassChanged === 0
      ? `Converged after ${result.iterations} pass${result.iterations === 1 ? '' : 'es'}`
      : `Stopped at the ${KMEANS_MAX_ITERATIONS}-pass limit`
  )
  if (result.k !== k) {
    reporter.count('areas', result.k)
    reporter.event(
      'note',
      `${k - result.k} planned area${k - result.k === 1 ? '' : 's'} had no members and ${k - result.k === 1 ? 'was' : 'were'} dropped`
    )
  }

  await reporter.step('geometry', `Measuring cohesion, separation and medoids of ${result.k} areas`)
  const geometry = clusterGeometry(data, n, result)
  const layout = layoutCentroids(result.centroidMeans, result.k)

  await reporter.heartbeat()

  // --- per-cluster aggregates from the sample -------------------------------
  const memberIndex: number[][] = Array.from({ length: result.k }, () => [])
  for (let i = 0; i < n; i++) memberIndex[result.assignments[i]].push(i)

  const sampleWeight = n > 0 ? Math.max(1, fieldFamilies / n) : 1
  const clusterAggregates = memberIndex.map(members => {
    const cpc = new Map<string, number>()
    const assignees = new Map<string, number>()
    for (const i of members) {
      const row = sampleRows[i]
      for (const code of row.classifications ?? []) {
        const subgroup = code.split('/')[0].replace(/\s+/g, '').toUpperCase()
        if (subgroup) cpc.set(subgroup, (cpc.get(subgroup) ?? 0) + 1)
      }
      const names = new Set(
        extractApplicantNames(row.applicants).map(canonicaliseAssignee).filter(name => name.length > 2)
      )
      for (const name of Array.from(names)) assignees.set(name, (assignees.get(name) ?? 0) + 1)
    }
    const top = (map: Map<string, number>, limit: number) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
    return {
      topCpc: top(cpc, 5).map(([code, families]) => ({ code, families })),
      topAssignees: top(assignees, 5).map(([label, families]) => ({ label, families })),
    }
  })

  // --- naming (one batched cheap call; numbered fallback keeps the run alive) --
  let labels: Array<{ label: string; description: string; keywords: string[] }> = memberIndex.map((_, index) => ({
    label: `Area ${index + 1}`,
    description: '',
    keywords: [],
  }))
  await reporter.step('name', `Naming ${result.k} areas`)
  reporter.event('model', `Naming ${result.k} areas from their most representative titles`)
  // Reporter calls stay outside the try: a lost lease must not be logged as a
  // labelling failure, and the fail() below rethrows it first anyway.
  const namedByModel = new Set<number>()
  let namingFailed = false
  try {
    const prompt = buildClusterLabelPrompt(
      memberIndex.map((members, index) => ({
        index,
        medoidTitles: geometry.medoids[index]
          .map(i => sampleRows[i].title || sampleRows[i].publicationNumber)
          .filter(Boolean) as string[],
        abstractSnippets: geometry.medoids[index]
          .slice(0, 2)
          .map(i => sampleRows[i].abstract || '')
          .filter(Boolean),
        topCpc: clusterAggregates[index].topCpc,
      }))
    )
    const response = await runWhitespaceLLM({
      taskCode: TaskCode.WS_CLUSTER_LABEL,
      stageCode: WS_CLUSTER_LABEL_STAGE_CODE,
      prompt,
      context: input.llmContext,
    })
    const parsed = parseModelJson<{ clusters: Array<{ index: number; label: string; description: string; keywords: string[] }> }>(
      response.output,
      'Cluster labelling'
    )
    for (const entry of parsed.clusters ?? []) {
      if (typeof entry.index === 'number' && labels[entry.index] && typeof entry.label === 'string' && entry.label.trim()) {
        labels[entry.index] = {
          label: entry.label.trim().slice(0, 80),
          description: typeof entry.description === 'string' ? entry.description.trim().slice(0, 300) : '',
          keywords: Array.isArray(entry.keywords)
            ? entry.keywords.filter((keyword): keyword is string => typeof keyword === 'string').slice(0, 6)
            : [],
        }
        namedByModel.add(entry.index)
      }
    }
  } catch (error) {
    coverageNotes.push('Areas are numbered rather than named — the naming call failed; numbers do not affect any metric.')
    console.error('[Whitespace] Cluster labelling failed:', error instanceof Error ? error.message : error)
    namingFailed = true
  }
  if (namingFailed) {
    await reporter.fail('name', 'names unavailable — areas keep their numbers')
  } else {
    // Area names are inputs to persistence, not a finding, so they may be
    // narrated — within the feed window.
    const named = Array.from(namedByModel).sort((a, b) => a - b)
    for (const index of named.slice(0, NAME_EVENT_BUDGET)) {
      reporter.event('note', `Area ${index + 1}: “${labels[index].label}”`)
    }
    if (named.length > NAME_EVENT_BUDGET) {
      reporter.event('note', `…and ${named.length - NAME_EVENT_BUDGET} more areas named`)
    }
  }

  await reporter.heartbeat()

  // --- persist: replace the study's cluster set atomically ------------------
  // Scoped to depth 0: promoted dimension gaps live at depth 1 with their own
  // area analyses, and WhitespaceHypothesis.clusterId has NO relation — a wider
  // wipe would leave those hypotheses dangling and silently fail gate G1.
  await reporter.step('persist', `Saving ${result.k} areas and ${n.toLocaleString()} sampled members`)
  await prisma.$transaction(async tx => {
    // Scoped to depth 0 on BOTH sides. The cluster wipe always was; the member
    // wipe was not, so re-mapping the field deleted the members of every
    // promoted-gap cluster at depth 1 while leaving those clusters standing —
    // their deep dives then read an area with no members, and gate G1 failed on
    // hypotheses the user had already promoted. Members with no cluster are the
    // stage-1/stage-2 gap and belong to depth 0's lifecycle, so they go too.
    await tx.whitespaceClusterMember.deleteMany({
      where: {
        studyId: input.studyId,
        OR: [{ clusterId: null }, { cluster: { is: { depth: 0 } } }],
      },
    })
    await tx.whitespaceCluster.deleteMany({ where: { studyId: input.studyId, depth: 0 } })

    for (let c = 0; c < result.k; c++) {
      const members = memberIndex[c]
      const centroidHex = wordsToHex(result.centroids.subarray(c * WORDS, c * WORDS + WORDS))
      const created = await tx.whitespaceCluster.create({
        data: {
          studyId: input.studyId,
          runId: input.runId,
          depth: 0,
          label: labels[c].label,
          description: labels[c].description || null,
          keywords: labels[c].keywords,
          centroidBits: centroidHex,
          memberCount: members.length,
          fieldEstimate: Math.round(members.length * sampleWeight),
          cohesion: geometry.cohesion[c],
          separation: geometry.separation[c],
          silhouette: geometry.silhouette[c],
          metrics: {
            density: null,
            velocityPct: null,
            hhi: null,
            crowdedness: null,
            recencyShare: null,
            jurisdictions: [],
            topAssignees: clusterAggregates[c].topAssignees,
            cpcMix: clusterAggregates[c].topCpc,
            layout: layout[c],
            grade: coherenceGrade(geometry.cohesion[c], geometry.separation[c], geometry.silhouette[c]),
          } as unknown as Prisma.InputJsonValue,
        },
      })

      const medoidSet = new Set(geometry.medoids[c])
      // createMany in slices; member rows carry their packed vector so
      // re-clustering and deep-dive selection never refetch the corpus.
      const rows = members.map(i => ({
        studyId: input.studyId,
        clusterId: created.id,
        familyKey: sampleRows[i].familyKey,
        publicationNumber: sampleRows[i].publicationNumber,
        title: (sampleRows[i].title || sampleRows[i].publicationNumber).slice(0, 500),
        bits: wordsToHex(data.subarray(i * WORDS, i * WORDS + WORDS)),
        distance: undefined as number | undefined,
        isMedoid: medoidSet.has(i),
        year: sampleRows[i].filingYear,
        assigneeCanonical:
          extractApplicantNames(sampleRows[i].applicants).map(canonicaliseAssignee).find(name => name.length > 2) ?? null,
      }))
      for (let offset = 0; offset < rows.length; offset += 2000) {
        await tx.whitespaceClusterMember.createMany({ data: rows.slice(offset, offset + 2000) })
      }
      reporter.count('saved', c + 1, result.k)
      // The reporter writes on its own pooled connection, outside this
      // transaction: a lease lost mid-save surfaces here and rolls it back
      // rather than letting a zombie worker finish the wipe-and-replace.
      if ((c + 1) % 8 === 0 && c + 1 < result.k) await reporter.heartbeat()
    }
  }, { timeout: 120_000, maxWait: 20_000 })

  if (n >= SAMPLE_CAP) {
    coverageNotes.push(
      `Areas were computed from a ${SAMPLE_CAP.toLocaleString()}-family sample of a ~${fieldFamilies.toLocaleString()}-family field; per-area sizes are estimates.`
    )
  }
  // Embedding coverage measured against the FIELD, not the sample cap. The old
  // n / min(fieldFamilies, SAMPLE_CAP) read 1.0 whenever the sample filled, so
  // in the capped regime the "invisible to the area map" note could never fire
  // — even with 20% of the field embedded — and fieldEstimate extrapolated over
  // unembedded families without caveat. When the sample did not fill, n IS the
  // embedded-family count; when it did, one bounded count over the same field
  // filter answers it.
  let embeddedFamilies: number | null = n
  if (n >= SAMPLE_CAP) {
    reporter.detail('Measuring embedding coverage of the field')
    try {
      const embeddedRows = await withTimeout<{ families: bigint }>(
        Prisma.sql`
          SELECT COUNT(DISTINCT COALESCE(lp."familyId", lp."publicationNumber"))::bigint AS families
          FROM "local_patents" lp
          JOIN "local_patent_embeddings" e ON e."localPatentId" = lp."id"
          WHERE ${where} AND ${comparableVectorSql()}`
      )
      embeddedFamilies = Number(embeddedRows[0]?.families ?? 0)
    } catch (error) {
      if (!isStatementTimeout(error)) throw error
      embeddedFamilies = null
    }
  }
  if (embeddedFamilies === null) {
    coverageNotes.push(
      'Embedding coverage of this field could not be measured within the stage budget — per-area field estimates assume the sample is representative.'
    )
  } else if (fieldFamilies > n && embeddedFamilies / Math.max(1, fieldFamilies) < 0.7) {
    coverageNotes.push('A substantial share of this field carries no embedding vector yet and is invisible to the area map.')
  }

  reporter.done()
  return {
    clusterCount: result.k,
    sampledFamilies: n,
    fieldFamilies,
    sampleWeight,
    k: result.k,
    iterations: result.iterations,
    coverageNotes,
    generatedAt: new Date().toISOString(),
  }
}

async function withTimeout<T>(query: Prisma.Sql): Promise<T[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config('statement_timeout', ${String(STAGE_TIMEOUT_MS)}, true)`,
    prisma.$queryRaw<T[]>(query),
  ])
  return rows
}

/** True for Postgres 57014 — query_canceled, i.e. the statement timeout fired. */
function isStatementTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as { meta?: { code?: string } })?.meta?.code
  return code === '57014' || /57014|statement timeout|canceling statement/i.test(message)
}

/**
 * Family count from the newest completed census OF THE SAME SCOPE. A census of
 * an earlier scope version answers a different question, so it is ignored and
 * the stage falls back to counting directly (accepting the cost).
 */
async function familyCountFromCensus(studyId: string, scope: WhitespaceScope): Promise<number | null> {
  const run = await prisma.whitespaceRun.findFirst({
    where: { studyId, stage: 'FIELD_MAP', status: 'COMPLETED' },
    orderBy: { createdAt: 'desc' },
    select: { results: true, scopeSnapshot: true },
  })
  // stableJson, not JSON.stringify: the snapshot round-tripped through jsonb,
  // which reorders object keys, so a plain stringify comparison rejected every
  // census — even of the identical scope — and this stage re-ran the most
  // expensive count in the studio on every area map (or refused outright on
  // fields too big to count inside this stage's timeout).
  if (!run || stableJson(run.scopeSnapshot ?? null) !== stableJson(scope)) return null
  const familyCount = (run.results as { familyCount?: unknown } | null)?.familyCount
  return typeof familyCount === 'number' && familyCount > 0 ? familyCount : null
}
