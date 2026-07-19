import 'dotenv/config'
import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_COLUMN,
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DISTANCE_OP,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_EMBEDDING_SQL_TYPE,
  corpusEmbeddingToLiteral,
  hasSearchEmbeddingApiKey,
  requestSearchQueryEmbedding,
} from '../src/lib/patent-corpus-service'

const PREFIX = '[EmbeddingSearchDiagnostic]'

function json(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? Number(item) : item)
}

function log(event: string, details: Record<string, unknown> = {}) {
  console.log(`${PREFIX} ${json({ event, ...details })}`)
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorCode: typeof (error as any).code === 'string' ? (error as any).code : undefined,
    }
  }
  return { errorMessage: String(error) }
}

function count(rows: any[], predicate: (row: any) => boolean) {
  return rows.filter(predicate).reduce((total, row) => total + Number(row.rowCount || 0), 0)
}

async function main() {
  const skipOpenAI = process.argv.includes('--skip-openai')
  const queryArgument = process.argv.find(argument => argument.startsWith('--query='))
  const query = queryArgument?.slice('--query='.length).trim() || 'wireless battery thermal management system'
  const findings: string[] = []

  log('runtime_config', {
    nodeEnv: process.env.NODE_ENV || null,
    processId: process.pid,
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasOpenAIKey: hasSearchEmbeddingApiKey(),
    hasDedicatedSearchOpenAIKey: Boolean(process.env.OPENAI_SEARCH_API_KEY),
    embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL,
    expectedDimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    embeddingMode: process.env.PATENT_CORPUS_EMBEDDING_MODE || 'realtime (default)',
    realtimeEmbeddings: process.env.PATENT_CORPUS_REALTIME_EMBEDDINGS || 'true (default)',
    autoWorker: process.env.PATENT_CORPUS_AUTO_WORKER || 'true (default)',
    skipOpenAI,
  })

  if (!hasSearchEmbeddingApiKey()) {
    findings.push('OPENAI_SEARCH_API_KEY and OPENAI_API_KEY are missing in this process; intelligent vector search is skipped before querying PostgreSQL.')
  }

  const databaseInfo = await prisma.$queryRaw<any[]>`
    SELECT
      current_database() AS "databaseName",
      current_user AS "databaseUser",
      current_setting('server_version') AS "serverVersion",
      (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS "vectorExtensionVersion"
  `
  log('database_connection', databaseInfo[0] || {})
  if (!databaseInfo[0]?.vectorExtensionVersion) {
    findings.push('The pgvector extension is not installed in the connected production database.')
  }

  const vectorColumn = await prisma.$queryRaw<any[]>`
    SELECT format_type(a.atttypid, a.atttypmod) AS "columnType"
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relname = 'local_patent_embeddings'
      AND a.attname = 'embedding'
      AND a.attnum > 0
      AND NOT a.attisdropped
  `
  log('vector_column', { columnType: vectorColumn[0]?.columnType || null })
  if (vectorColumn[0]?.columnType !== `vector(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`) {
    findings.push(`Embedding column is ${vectorColumn[0]?.columnType || 'missing'}; the application expects vector(${PATENT_CORPUS_EMBEDDING_DIMENSIONS}).`)
  }

  const vectorIndexes = await prisma.$queryRaw<any[]>`
    SELECT indexname AS "indexName", indexdef AS "indexDefinition"
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'local_patent_embeddings'
      AND indexdef ILIKE '%embedding%'
    ORDER BY indexname
  `
  log('vector_indexes', { count: vectorIndexes.length, indexes: vectorIndexes })

  const searchIndexes = await prisma.$queryRaw<any[]>`
    SELECT tablename AS "tableName", indexname AS "indexName", indexdef AS "indexDefinition"
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename IN ('local_patents', 'local_patent_embeddings')
      AND (
        indexname ILIKE '%search_tsv%'
        OR indexname ILIKE '%metadata_tsv%'
        OR indexname ILIKE '%trgm%'
        OR indexname ILIKE '%embedding_hnsw%'
        OR indexname ILIKE '%embedding_ivfflat%'
        OR indexname ILIKE '%binary_ivf%'
      )
    ORDER BY tablename, indexname
  `
  log('search_indexes', { count: searchIndexes.length, indexes: searchIndexes })
  const searchIndexNames = new Set(searchIndexes.map(row => String(row.indexName || '')))
  // The Google corpus is the primary lane now — its text index was missing from
  // this list, so the check reported green while the 46M-row lane was unindexed.
  const requiredProductionIndexes = [
    'local_patents_google_search_tsv_idx',
    'local_patents_indian_search_tsv_idx',
    'local_patents_indian_metadata_tsv_idx',
    'local_patents_title_trgm_idx',
    'local_patents_abstract_trgm_idx',
  ]
  const missingProductionIndexes = requiredProductionIndexes.filter(indexName => !searchIndexNames.has(indexName))
  // The binary Hamming ANN index (bit_hamming_ops) is named *_binary_ivf_idx and
  // matched neither legacy pattern, so this warned permanently on a healthy prod.
  const hasVectorIndex = searchIndexNames.has('local_patent_embeddings_embedding_hnsw_idx') ||
    searchIndexNames.has('local_patent_embeddings_embedding_ivfflat_idx') ||
    searchIndexNames.has('local_patent_embeddings_binary_ivf_idx')
  if (missingProductionIndexes.length) {
    findings.push(`Production is missing search indexes: ${missingProductionIndexes.join(', ')}. Run pending Prisma migrations before increasing query timeouts.`)
  }
  if (!hasVectorIndex) {
    findings.push('Production is missing a pgvector HNSW/IVFFlat embedding index; nearest-neighbor queries may scan all vectors.')
  }

  const inventory = await prisma.$queryRaw<any[]>`
    SELECT
      e."model",
      e."status"::text AS "status",
      e."dimensions",
      COUNT(*)::int AS "rowCount",
      COUNT(*) FILTER (WHERE e."embedding" IS NOT NULL)::int AS "nonNullVectorCount",
      MIN(e."createdAt") AS "oldestCreatedAt",
      MAX(e."updatedAt") AS "latestUpdatedAt"
    FROM "local_patent_embeddings" e
    GROUP BY e."model", e."status", e."dimensions"
    ORDER BY e."model", e."status", e."dimensions"
  `
  log('embedding_inventory', { rows: inventory })

  const currentCompleted = inventory.reduce((total, row) => (
    row.model === PATENT_CORPUS_EMBEDDING_MODEL && row.status === 'COMPLETED'
      ? total + Number(row.nonNullVectorCount || 0)
      : total
  ), 0)
  const anyCompleted = inventory.reduce((total, row) => (
    row.status === 'COMPLETED' ? total + Number(row.nonNullVectorCount || 0) : total
  ), 0)
  const queued = count(inventory, row => row.model === PATENT_CORPUS_EMBEDDING_MODEL && row.status === 'QUEUED')
  const failed = count(inventory, row => row.model === PATENT_CORPUS_EMBEDDING_MODEL && row.status === 'FAILED')
  const processing = count(inventory, row => row.model === PATENT_CORPUS_EMBEDDING_MODEL && row.status === 'PROCESSING')

  if (currentCompleted === 0 && anyCompleted > 0) {
    findings.push(`No completed vectors use the configured model ${PATENT_CORPUS_EMBEDDING_MODEL}, but ${anyCompleted} completed vectors exist under other model settings.`)
  } else if (currentCompleted === 0) {
    findings.push('There are no completed, non-null vectors for the configured embedding model.')
  }
  if (queued > 0) findings.push(`${queued} embeddings are queued for the configured model; verify that the corpus worker is running with an OpenAI key.`)
  if (failed > 0) findings.push(`${failed} embeddings are failed for the configured model; inspect the failed_embedding_samples event below.`)
  if (processing > 0) findings.push(`${processing} embeddings remain in PROCESSING; stale worker locks may need recovery.`)

  const sourceCoverage = await prisma.$queryRaw<any[]>`
    WITH patent_sources AS (
      SELECT
        p."id",
        unnest(
          CASE
            WHEN cardinality(p."corpusSources") > 0 THEN p."corpusSources"
            ELSE ARRAY['indian-corpus']::text[]
          END
        ) AS "source"
      FROM "local_patents" p
    )
    SELECT
      ps."source",
      COUNT(DISTINCT ps."id")::int AS "patentCount",
      COUNT(DISTINCT ps."id") FILTER (
        WHERE e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
          AND e."status" = 'COMPLETED'::"PatentEmbeddingStatus"
          AND e."embedding" IS NOT NULL
      )::int AS "searchablePatentCount"
    FROM patent_sources ps
    LEFT JOIN "local_patent_embeddings" e ON e."localPatentId" = ps."id"
    GROUP BY ps."source"
    ORDER BY ps."source"
  `
  log('source_coverage', { embeddingModel: PATENT_CORPUS_EMBEDDING_MODEL, rows: sourceCoverage })

  const failedSamples = await prisma.$queryRaw<any[]>`
    SELECT
      e."model",
      e."attemptCount",
      e."errorMessage",
      e."nextAttemptAt",
      e."updatedAt"
    FROM "local_patent_embeddings" e
    WHERE e."status" = 'FAILED'::"PatentEmbeddingStatus"
    ORDER BY e."updatedAt" DESC
    LIMIT 10
  `
  log('failed_embedding_samples', { count: failedSamples.length, rows: failedSamples })

  if (!skipOpenAI && hasSearchEmbeddingApiKey()) {
    try {
      const embeddingStartedAt = Date.now()
      const vector = await requestSearchQueryEmbedding(query)
      log('openai_embedding_ok', {
        queryLength: query.length,
        dimensions: vector.length,
        durationMs: Date.now() - embeddingStartedAt,
      })

      // Derive column/operator/cast/similarity from the configured dtype. This
      // previously hardcoded the float lane (`embedding` / `<=>` / `::vector`,
      // no /DIMENSIONS term), so under the production binary config it reported
      // "no vectors" against a perfectly healthy corpus — actively misleading
      // during an incident, which is exactly when this script gets run.
      const vectorLiteral = corpusEmbeddingToLiteral(vector)
      const col = Prisma.raw(`"${PATENT_CORPUS_EMBEDDING_COLUMN}"`)
      const op = Prisma.raw(PATENT_CORPUS_EMBEDDING_DISTANCE_OP)
      const cast = Prisma.raw(`${PATENT_CORPUS_EMBEDDING_SQL_TYPE}(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`)
      // Hamming distance is 0..DIMENSIONS; cosine distance is 0..2.
      const denom = Prisma.raw(
        PATENT_CORPUS_EMBEDDING_DTYPE === 'binary' ? `/ ${PATENT_CORPUS_EMBEDDING_DIMENSIONS}.0` : ''
      )
      const vectorSearchStartedAt = Date.now()
      const nearest = await prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', '10000', true)`
        return tx.$queryRaw<any[]>(Prisma.sql`
          SELECT
            p."publicationNumber",
            e."model",
            1 - ((e.${col} ${op} ${vectorLiteral}::${cast})::float8 ${denom}) AS "vectorScore"
          FROM "local_patent_embeddings" e
          JOIN "local_patents" p ON p."id" = e."localPatentId"
          WHERE e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}
            AND e."status" = 'COMPLETED'::"PatentEmbeddingStatus"
            AND e.${col} IS NOT NULL
          ORDER BY e.${col} ${op} ${vectorLiteral}::${cast}
          LIMIT 5
        `)
      })
      log('postgres_vector_search_ok', {
        resultCount: nearest.length,
        durationMs: Date.now() - vectorSearchStartedAt,
        rows: nearest,
      })
      if (nearest.length === 0) findings.push('OpenAI embedding creation succeeded, but PostgreSQL returned zero eligible vectors for the configured model.')
    } catch (error) {
      findings.push('The live OpenAI or PostgreSQL vector-search smoke test failed; use the diagnostic_error fields to identify the failing stage.')
      log('diagnostic_error', errorDetails(error))
    }
  }

  log('findings', {
    status: findings.length ? 'attention_required' : 'healthy',
    findings,
  })
}

main()
  .catch(error => {
    log('fatal_error', errorDetails(error))
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
