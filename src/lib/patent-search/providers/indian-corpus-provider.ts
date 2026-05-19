import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_MODEL,
} from '@/lib/patent-corpus-service'
import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentResultScores,
  PatentSearchCapabilities,
  PatentSearchFilters,
  PatentSearchProvider,
} from '../types'
import {
  clampLimit,
  compactPatentKey,
  asStringArray,
  normalizeClassification,
  normalizeWhitespace,
  uniqueStrings,
  yearFromDate,
} from '../utils'

async function requestOpenAIEmbedding(text: string) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.')

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PATENT_CORPUS_EMBEDDING_MODEL,
      input: text,
      dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI embedding request failed: ${response.status} ${body}`)
  }

  const json = await response.json()
  const embedding = json?.data?.[0]?.embedding
  if (!Array.isArray(embedding) || embedding.length !== PATENT_CORPUS_EMBEDDING_DIMENSIONS) {
    throw new Error('OpenAI embedding response did not contain the expected vector.')
  }
  return embedding as number[]
}

function validDate(value?: string) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function validDateText(value?: string) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = validDate(value)
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

function commonSelectSql(extra: Prisma.Sql = Prisma.empty) {
  return Prisma.sql`
    p."id",
    p."publicationNumber",
    p."applicationNumberRaw",
    p."kind",
    p."country",
    p."filingDate",
    p."publicationDate",
    p."title",
    p."abstract",
    p."applicants",
    p."inventors",
    p."classifications",
    p."numberOfPages",
    p."numberOfClaims",
    p."sourcePdfName",
    p."sourcePageNumber",
    p."extractionConfidence"
    ${extra}
  `
}

function addDateConditions(conditions: Prisma.Sql[], filters: PatentSearchFilters) {
  const filingFrom = validDateText(filters.filingDateFrom)
  const filingTo = validDateText(filters.filingDateTo)
  const publicationFrom = validDateText(filters.publicationDateFrom)
  const publicationTo = validDateText(filters.publicationDateTo)
  if (filingFrom) conditions.push(Prisma.sql`p."filingDate"::date >= ${filingFrom}::date`)
  if (filingTo) conditions.push(Prisma.sql`p."filingDate"::date <= ${filingTo}::date`)
  if (publicationFrom) conditions.push(Prisma.sql`p."publicationDate"::date >= ${publicationFrom}::date`)
  if (publicationTo) conditions.push(Prisma.sql`p."publicationDate"::date <= ${publicationTo}::date`)
}

function addNumericConditions(conditions: Prisma.Sql[], filters: PatentSearchFilters) {
  if (typeof filters.numberOfPagesMin === 'number') conditions.push(Prisma.sql`p."numberOfPages" >= ${filters.numberOfPagesMin}`)
  if (typeof filters.numberOfPagesMax === 'number') conditions.push(Prisma.sql`p."numberOfPages" <= ${filters.numberOfPagesMax}`)
  if (typeof filters.numberOfClaimsMin === 'number') conditions.push(Prisma.sql`p."numberOfClaims" >= ${filters.numberOfClaimsMin}`)
  if (typeof filters.numberOfClaimsMax === 'number') conditions.push(Prisma.sql`p."numberOfClaims" <= ${filters.numberOfClaimsMax}`)
}

function likePattern(value: string) {
  return `%${normalizeWhitespace(value).replace(/[\\%_]/g, '\\$&')}%`
}

function valuesFor(value: unknown) {
  return asStringArray(value).map(normalizeWhitespace).filter(Boolean)
}

function containsAnyCondition(expression: Prisma.Sql, values: unknown) {
  const terms = valuesFor(values)
  if (!terms.length) return null
  return Prisma.sql`(${Prisma.join(
    terms.map(value => Prisma.sql`${expression} ILIKE ${likePattern(value)} ESCAPE '\\'`),
    ' OR '
  )})`
}

function notContainsAnyCondition(expression: Prisma.Sql, values: unknown) {
  const terms = valuesFor(values)
  if (!terms.length) return null
  return Prisma.sql`(${Prisma.join(
    terms.map(value => Prisma.sql`NOT (${expression} ILIKE ${likePattern(value)} ESCAPE '\\')`),
    ' AND '
  )})`
}

function titleExpression() {
  return Prisma.sql`coalesce(p."title", '')`
}

function abstractExpression() {
  return Prisma.sql`coalesce(p."abstract", '') || ' ' || coalesce(p."abstractOriginal", '')`
}

function patentTextExpression() {
  return Prisma.sql`
    coalesce(p."title", '') || ' ' ||
    coalesce(p."abstract", '') || ' ' ||
    coalesce(p."abstractOriginal", '') || ' ' ||
    coalesce(p."ragText", '') || ' ' ||
    coalesce(p."rawText", '') || ' ' ||
    array_to_string(p."classifications", ' ')
  `
}

function anyTextExpression() {
  return Prisma.sql`
    ${patentTextExpression()} || ' ' ||
    array_to_string(p."inventors", ' ') || ' ' ||
    coalesce(p."applicants"::text, '')
  `
}

function buildClassificationCondition(values: string[]) {
  const normalized = uniqueStrings(values.map(normalizeClassification).filter(Boolean))
  if (!normalized.length) return null
  const parts = normalized.map(value => {
    const compact = `%${compactPatentKey(value)}%`
    return Prisma.sql`EXISTS (
      SELECT 1
      FROM unnest(p."classifications") AS cls
      WHERE upper(regexp_replace(cls, '[^A-Za-z0-9]', '', 'g')) LIKE ${compact}
    )`
  })
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`
}

function buildWhereConditions(filters: PatentSearchFilters) {
  const conditions: Prisma.Sql[] = []
  if (filters.publicationNumber) {
    const parts = valuesFor(filters.publicationNumber)
      .map(value => compactPatentKey(value))
      .filter(Boolean)
      .map(value => Prisma.sql`upper(p."publicationNumber") LIKE ${`%${value}%`}`)
    if (parts.length) conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  if (filters.applicationNumber) {
    const parts = valuesFor(filters.applicationNumber)
      .map(value => compactPatentKey(value))
      .filter(Boolean)
      .map(value => Prisma.sql`upper(regexp_replace(coalesce(p."applicationNumberRaw", ''), '[^A-Za-z0-9]', '', 'g')) LIKE ${`%${value}%`}`)
    if (parts.length) conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  const anyTextCondition = containsAnyCondition(anyTextExpression(), filters.anyTextContains)
  if (anyTextCondition) conditions.push(anyTextCondition)
  const titleCondition = containsAnyCondition(titleExpression(), filters.titleContains)
  if (titleCondition) conditions.push(titleCondition)
  const abstractCondition = containsAnyCondition(abstractExpression(), filters.abstractContains)
  if (abstractCondition) conditions.push(abstractCondition)
  const patentTextCondition = containsAnyCondition(patentTextExpression(), filters.patentTextContains)
  if (patentTextCondition) conditions.push(patentTextCondition)
  const excludeCondition = notContainsAnyCondition(anyTextExpression(), filters.excludeTerms)
  if (excludeCondition) conditions.push(excludeCondition)
  if (filters.sourcePdfName) {
    const sourceCondition = containsAnyCondition(Prisma.sql`coalesce(p."sourcePdfName", '')`, filters.sourcePdfName)
    if (sourceCondition) conditions.push(sourceCondition)
  }
  if (filters.applicants?.length) {
    const parts = filters.applicants.map(value => Prisma.sql`p."applicants"::text ILIKE ${`%${normalizeWhitespace(value)}%`}`)
    conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  if (filters.inventors?.length) {
    const parts = filters.inventors.map(value => Prisma.sql`array_to_string(p."inventors", ' ') ILIKE ${`%${normalizeWhitespace(value)}%`}`)
    conditions.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`)
  }
  const classificationCondition = buildClassificationCondition([
    ...(filters.classifications || []),
    ...(filters.cpcCodes || []),
    ...(filters.ipcCodes || []),
  ])
  if (classificationCondition) conditions.push(classificationCondition)
  addDateConditions(conditions, filters)
  addNumericConditions(conditions, filters)
  return conditions
}

function whereSql(conditions: Prisma.Sql[]) {
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty
}

function rowToResult(row: any): NormalizedPatentResult {
  const publicationNumber = String(row.publicationNumber || '')
  const publicationDate = row.publicationDate || null
  const scores: PatentResultScores = {
    semantic: typeof row.vectorScore === 'number' ? Number(row.vectorScore) : undefined,
    text: typeof row.textScore === 'number' ? Number(row.textScore) : undefined,
    title: typeof row.titleScore === 'number' ? Number(row.titleScore) : undefined,
    field: typeof row.fieldScore === 'number' ? Number(row.fieldScore) : undefined,
    classification: typeof row.classificationScore === 'number' ? Number(row.classificationScore) : undefined,
  }
  const matchedFields = uniqueStrings([
    row.vectorScore !== undefined ? 'semantic' : '',
    row.textScore !== undefined ? 'fullText' : '',
    row.titleScore !== undefined ? 'titleOrAbstract' : '',
    row.fieldScore !== undefined ? 'fieldFilter' : '',
    row.classificationScore !== undefined ? 'classification' : '',
  ])

  return {
    providerId: 'indian-corpus',
    sourceProvider: 'indian-corpus',
    jurisdiction: row.country || 'IN',
    publicationNumber,
    publication_number: publicationNumber,
    pn: publicationNumber,
    applicationNumber: row.applicationNumberRaw || null,
    applicationNumberRaw: row.applicationNumberRaw || null,
    title: row.title || publicationNumber || 'Untitled Patent',
    abstract: row.abstract || null,
    snippet: row.abstract || null,
    applicants: row.applicants || null,
    inventors: Array.isArray(row.inventors) ? row.inventors : [],
    classifications: Array.isArray(row.classifications) ? row.classifications : [],
    filingDate: row.filingDate || null,
    publicationDate,
    year: yearFromDate(publicationDate),
    link: publicationNumber ? `https://patents.google.com/patent/${publicationNumber}` : null,
    sourceUrl: null,
    sourcePdfName: row.sourcePdfName || null,
    sourcePageNumber: row.sourcePageNumber || null,
    numberOfPages: row.numberOfPages ?? null,
    numberOfClaims: row.numberOfClaims ?? null,
    extractionConfidence: row.extractionConfidence ?? null,
    scores,
    matchedFields,
    matchReasons: matchedFields.map(field => `Matched by ${field}`),
    raw: row,
  }
}

export class IndianCorpusProvider implements PatentSearchProvider {
  id = 'indian-corpus'
  label = 'Indian Patent Corpus'
  jurisdictions = ['IN']
  enabled = true
  capabilities: PatentSearchCapabilities = {
    semantic: true,
    fullText: true,
    classification: true,
    dateFilters: true,
    numberLookup: true,
    applicantFilter: true,
    inventorFilter: true,
  }

  async search(request: PatentProviderSearchRequest): Promise<NormalizedPatentResult[]> {
    const safeLimit = clampLimit(request.limit, 20, 100)
    const candidateLimit = Math.max(safeLimit * 4, 40)
    const queryPlan = request.queryPlan
    const filters = queryPlan.fieldFilters || {}
    const filterConditions = buildWhereConditions(filters)
    const manualMode = request.searchMode === 'manual'
    const rows = new Map<string, NormalizedPatentResult>()
    const ranks = new Map<string, { score: number; vectorRank?: number; textRank?: number }>()

    const merge = (row: any, kind: 'vectorRank' | 'textRank' | 'fieldRank' | 'titleRank', rank: number, weight: number) => {
      const result = rowToResult(row)
      const key = result.publicationNumber
      rows.set(key, { ...(rows.get(key) || {}), ...result })
      const current = ranks.get(key) || { score: 0 }
      current.score += weight / (60 + rank)
      if (kind === 'vectorRank') current.vectorRank = rank
      if (kind === 'textRank') current.textRank = rank
      ranks.set(key, current)
    }

    const textQuery = normalizeWhitespace(queryPlan.searchQuery || queryPlan.normalizedQuery)
    if (textQuery && !manualMode) {
      try {
        const conditions = [
          Prisma.sql`q.query @@ to_tsvector(
            'english'::regconfig,
            coalesce(p."ragText", '') || ' ' ||
            coalesce(p."title", '') || ' ' ||
            coalesce(p."abstract", '') || ' ' ||
            coalesce(p."abstractOriginal", '') || ' ' ||
            array_to_string(p."classifications", ' ') || ' ' ||
            array_to_string(p."inventors", ' ') || ' ' ||
            coalesce(p."applicants"::text, '')
          )`,
          ...filterConditions,
        ]
        const textRows = await prisma.$queryRaw<any[]>`
          WITH q AS (SELECT websearch_to_tsquery('english'::regconfig, ${textQuery}) AS query)
          SELECT ${commonSelectSql(Prisma.sql`,
            ts_rank_cd(
              to_tsvector(
                'english'::regconfig,
                coalesce(p."ragText", '') || ' ' ||
                coalesce(p."title", '') || ' ' ||
                coalesce(p."abstract", '') || ' ' ||
                coalesce(p."abstractOriginal", '') || ' ' ||
                array_to_string(p."classifications", ' ') || ' ' ||
                array_to_string(p."inventors", ' ') || ' ' ||
                coalesce(p."applicants"::text, '')
              ),
              q.query
            ) AS "textScore"`)}
          FROM "local_patents" p, q
          ${whereSql(conditions)}
          ORDER BY "textScore" DESC
          LIMIT ${candidateLimit}
        `
        textRows.forEach((row, index) => merge(row, 'textRank', index + 1, 1))
      } catch (error) {
        console.warn('[IndianCorpusProvider] Full-text search skipped:', error)
      }
    }

    const semanticQuery = normalizeWhitespace(queryPlan.semanticQuery || textQuery)
    if (semanticQuery && process.env.OPENAI_API_KEY && !manualMode) {
      try {
        const vector = await requestOpenAIEmbedding(semanticQuery)
        const vectorLiteral = `[${vector.map(value => Number(value).toFixed(8)).join(',')}]`
        const vectorRows = await prisma.$queryRaw<any[]>`
          SELECT ${commonSelectSql(Prisma.sql`,
            1 - (e."embedding" <=> ${vectorLiteral}::vector) AS "vectorScore"`)}
          FROM "local_patents" p
          JOIN "local_patent_embeddings" e ON e."localPatentId" = p."id"
          ${whereSql([
            Prisma.sql`e."status" = 'COMPLETED'::"PatentEmbeddingStatus"`,
            Prisma.sql`e."model" = ${PATENT_CORPUS_EMBEDDING_MODEL}`,
            Prisma.sql`e."embedding" IS NOT NULL`,
            ...filterConditions,
          ])}
          ORDER BY e."embedding" <=> ${vectorLiteral}::vector
          LIMIT ${candidateLimit}
        `
        vectorRows.forEach((row, index) => merge(row, 'vectorRank', index + 1, 1.25))
      } catch (error) {
        console.warn('[IndianCorpusProvider] Vector search skipped:', error)
      }
    }

    if (textQuery.length >= 3 && !manualMode) {
      try {
        const titleRows = await prisma.$queryRaw<any[]>`
          SELECT ${commonSelectSql(Prisma.sql`,
            GREATEST(
              similarity(coalesce(p."title", ''), ${textQuery}),
              similarity(coalesce(p."abstract", ''), ${textQuery}) * 0.75
            ) AS "titleScore"`)}
          FROM "local_patents" p
          ${whereSql([
            Prisma.sql`(
              similarity(coalesce(p."title", ''), ${textQuery}) > 0.08
              OR similarity(coalesce(p."abstract", ''), ${textQuery}) > 0.08
            )`,
            ...filterConditions,
          ])}
          ORDER BY "titleScore" DESC
          LIMIT ${candidateLimit}
        `
        titleRows.forEach((row, index) => merge(row, 'titleRank', index + 1, 0.85))
      } catch (error) {
        console.warn('[IndianCorpusProvider] Trigram search skipped:', error)
      }
    }

    if (filterConditions.length > 0) {
      try {
        const fieldRows = await prisma.$queryRaw<any[]>`
          SELECT ${commonSelectSql(Prisma.sql`, 1.0 AS "fieldScore"`)}
          FROM "local_patents" p
          ${whereSql(filterConditions)}
          ORDER BY p."publicationDate" DESC NULLS LAST, p."id" DESC
          LIMIT ${candidateLimit}
        `
        fieldRows.forEach((row, index) => merge(row, 'fieldRank', index + 1, 1.1))
      } catch (error) {
        console.warn('[IndianCorpusProvider] Field search skipped:', error)
      }
    }

    const sorted = Array.from(rows.values())
      .map(result => {
        const rank = ranks.get(result.publicationNumber) || { score: 0 }
        return {
          ...result,
          hybridScore: Number(rank.score.toFixed(6)),
          vectorRank: rank.vectorRank,
          textRank: rank.textRank,
        }
      })
      .sort((a, b) => (b.hybridScore || 0) - (a.hybridScore || 0))

    const maxScore = sorted[0]?.hybridScore || 1
    return sorted.slice(0, safeLimit).map(result => {
      const normalizedScore = Math.max(0.01, Math.min(0.99, (result.hybridScore || 0) / maxScore))
      return {
        ...result,
        relevanceScore: Number(normalizedScore.toFixed(3)),
        scores: {
          ...(result.scores || {}),
          hybrid: normalizedScore,
        },
      }
    })
  }
}
