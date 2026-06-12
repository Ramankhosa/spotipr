import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_MODEL,
  requestOpenAIEmbeddings,
} from '@/lib/patent-corpus-service'
import type {
  NormalizedPatentResult,
  PatentProviderSearchRequest,
  PatentRetrievalMatch,
  PatentRetrievalQuery,
  PatentRetrievalQueryType,
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
    coalesce(p."claimsText", '') || ' ' ||
    coalesce(p."descriptionText", '') || ' ' ||
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

type LocalRetrievalQuery = PatentRetrievalQuery & {
  type: PatentRetrievalQueryType
  text: string
  weight: number
}

interface IndianRankAccumulator {
  rrfScore: number
  vectorRank?: number
  textRank?: number
  titleRank?: number
  fieldRank?: number
  conceptVectorScore?: number
  bestFeatureVectorScore?: number
  bestVectorScore?: number
  textScore?: number
  titleScore?: number
  fieldScore?: number
  classificationScore?: number
  matchedFeatures: Set<string>
  retrievalMatches: PatentRetrievalMatch[]
}

const FEATURE_VECTOR_MATCH_THRESHOLD = 0.42

function clampScore(value: unknown) {
  const score = Number(value)
  if (!Number.isFinite(score)) return 0
  return Math.max(0, Math.min(1, score))
}

function trimRetrievalText(value: unknown, maxWords = 36) {
  return normalizeWhitespace(value).split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ')
}

function retrievalQueryLimit(query: LocalRetrievalQuery, safeLimit: number) {
  if (query.type === 'concept' || query.type === 'semantic') return Math.max(40, Math.min(80, safeLimit * 2))
  if (query.type === 'feature_pair') return 30
  return 25
}

function buildFallbackRetrievalQueries(queryPlan: PatentProviderSearchRequest['queryPlan'], title?: string): LocalRetrievalQuery[] {
  const supplied = (queryPlan.retrievalQueries || [])
    .map((query, index): LocalRetrievalQuery | null => {
      const text = trimRetrievalText(query.text)
      if (!text) return null
      return {
        ...query,
        id: query.id || `retrieval-${index + 1}`,
        type: query.type || 'semantic',
        text,
        weight: typeof query.weight === 'number' ? query.weight : 1,
      }
    })
    .filter((query): query is LocalRetrievalQuery => Boolean(query))

  if (supplied.length) return supplied.slice(0, 12)

  const searchQuery = trimRetrievalText(queryPlan.searchQuery || queryPlan.normalizedQuery || title)
  const semanticQuery = trimRetrievalText(queryPlan.semanticQuery || searchQuery)
  const features = (queryPlan.inventionFeatures || []).map(feature => trimRetrievalText(feature, 18)).filter(Boolean).slice(0, 8)
  const queries: LocalRetrievalQuery[] = []
  const seen = new Set<string>()
  const add = (query: LocalRetrievalQuery) => {
    const text = trimRetrievalText(query.text)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) return
    seen.add(key)
    queries.push({ ...query, text })
  }

  if (searchQuery) {
    add({ id: 'concept', type: 'concept', text: searchQuery, weight: 1.25, label: 'Core concept' })
  }
  features.forEach((feature, index) => {
    add({
      id: `feature-${index + 1}`,
      type: 'feature',
      text: feature,
      weight: 1.1,
      featureIndex: index,
      featureIndexes: [index],
      label: feature,
    })
  })
  for (let index = 0; index < Math.min(features.length - 1, 3); index += 1) {
    add({
      id: `feature-pair-${index + 1}`,
      type: 'feature_pair',
      text: `${features[index]} ${features[index + 1]}`,
      weight: 1.15,
      featureIndexes: [index, index + 1],
      label: `${features[index]} + ${features[index + 1]}`,
    })
  }
  if (!queries.length && semanticQuery) {
    add({ id: 'semantic', type: 'semantic', text: semanticQuery, weight: 1, label: 'Semantic query' })
  }
  return queries
}

function featureLabelsFor(query: LocalRetrievalQuery, inventionFeatures: string[]) {
  const indexes = query.featureIndexes || (typeof query.featureIndex === 'number' ? [query.featureIndex] : [])
  return uniqueStrings(indexes.map(index => inventionFeatures[index] || query.label || '').filter(Boolean))
}

function classificationMatches(result: NormalizedPatentResult, queryPlan: PatentProviderSearchRequest['queryPlan']) {
  const hints = uniqueStrings([
    ...(queryPlan.classificationHints || []),
    ...(queryPlan.cpcCodes || []),
    ...(queryPlan.ipcCodes || []),
  ]).map(compactPatentKey).filter(Boolean)
  if (!hints.length) return []
  return uniqueStrings((result.classifications || []).filter(classification => {
    const compact = compactPatentKey(classification)
    return compact && hints.some(hint => compact.includes(hint) || hint.includes(compact))
  }))
}

function withExcludedTerms(filters: PatentSearchFilters, excludedTerms: string[]) {
  const terms = uniqueStrings([...(filters.excludeTerms || []), ...excludedTerms])
  return terms.length ? { ...filters, excludeTerms: terms } : filters
}

function hasPositiveFieldFilters(filters: PatentSearchFilters) {
  return Object.entries(filters).some(([key, value]) => {
    if (key === 'excludeTerms') return false
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && value !== ''
  })
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
    const filters = withExcludedTerms(queryPlan.fieldFilters || {}, queryPlan.excludedTerms || [])
    const filterConditions = buildWhereConditions(filters)
    const manualMode = request.searchMode === 'manual'
    const rows = new Map<string, NormalizedPatentResult>()
    const ranks = new Map<string, IndianRankAccumulator>()

    const merge = (
      row: any,
      kind: 'vectorRank' | 'textRank' | 'fieldRank' | 'titleRank',
      rank: number,
      weight: number,
      retrievalQuery?: LocalRetrievalQuery
    ) => {
      const result = rowToResult(row)
      const key = result.publicationNumber
      const existing = rows.get(key)
      const featureLabels = retrievalQuery ? featureLabelsFor(retrievalQuery, queryPlan.inventionFeatures || []) : []
      const extraMatchedFields = retrievalQuery
        ? [retrievalQuery.type === 'concept' || retrievalQuery.type === 'semantic' ? 'semantic' : '']
        : []
      const extraMatchReasons = retrievalQuery
        ? (retrievalQuery.type === 'concept' || retrievalQuery.type === 'semantic'
          ? [`Abstract embedding matched ${retrievalQuery.type.replace('_', ' ')} query: ${retrievalQuery.label || retrievalQuery.text}`]
          : [])
        : []
      rows.set(key, {
        ...(existing || {}),
        ...result,
        scores: {
          ...(existing?.scores || {}),
          ...(result.scores || {}),
        },
        matchedFields: uniqueStrings([
          ...(existing?.matchedFields || []),
          ...(result.matchedFields || []),
          ...extraMatchedFields,
        ]),
        matchedFeatures: uniqueStrings([
          ...(existing?.matchedFeatures || []),
        ]),
        matchReasons: uniqueStrings([
          ...(existing?.matchReasons || []),
          ...(result.matchReasons || []),
          ...extraMatchReasons,
        ]),
      })
      const current = ranks.get(key) || {
        rrfScore: 0,
        matchedFeatures: new Set<string>(),
        retrievalMatches: [],
      }
      current.rrfScore += weight / (60 + rank)
      if (kind === 'vectorRank') current.vectorRank = typeof current.vectorRank === 'number' ? Math.min(current.vectorRank, rank) : rank
      if (kind === 'textRank') current.textRank = typeof current.textRank === 'number' ? Math.min(current.textRank, rank) : rank
      if (kind === 'titleRank') current.titleRank = typeof current.titleRank === 'number' ? Math.min(current.titleRank, rank) : rank
      if (kind === 'fieldRank') current.fieldRank = typeof current.fieldRank === 'number' ? Math.min(current.fieldRank, rank) : rank
      if (kind === 'textRank') current.textScore = Math.max(current.textScore || 0, clampScore(row.textScore))
      if (kind === 'titleRank') current.titleScore = Math.max(current.titleScore || 0, clampScore(row.titleScore))
      if (kind === 'fieldRank') current.fieldScore = Math.max(current.fieldScore || 0, clampScore(row.fieldScore))
      if (kind === 'vectorRank') {
        const vectorScore = clampScore(row.vectorScore)
        current.bestVectorScore = Math.max(current.bestVectorScore || 0, vectorScore)
        if (retrievalQuery?.type === 'concept' || retrievalQuery?.type === 'semantic') {
          current.conceptVectorScore = Math.max(current.conceptVectorScore || 0, vectorScore)
        }
        if (retrievalQuery?.type === 'feature' || retrievalQuery?.type === 'feature_pair') {
          current.bestFeatureVectorScore = Math.max(current.bestFeatureVectorScore || 0, vectorScore)
          if (vectorScore >= FEATURE_VECTOR_MATCH_THRESHOLD) {
            featureLabels.forEach(feature => current.matchedFeatures.add(feature))
          }
        }
        if (retrievalQuery && !current.retrievalMatches.some(match => match.queryId === retrievalQuery.id)) {
          const attributedFeatureLabels = vectorScore >= FEATURE_VECTOR_MATCH_THRESHOLD ? featureLabels : []
          current.retrievalMatches.push({
            queryId: retrievalQuery.id,
            queryType: retrievalQuery.type,
            queryText: retrievalQuery.text,
            rank,
            score: vectorScore,
            featureIndexes: attributedFeatureLabels.length
              ? retrievalQuery.featureIndexes || (typeof retrievalQuery.featureIndex === 'number' ? [retrievalQuery.featureIndex] : undefined)
              : undefined,
            featureLabels: attributedFeatureLabels,
          })
        }
      }
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

    const retrievalQueries = buildFallbackRetrievalQueries(queryPlan, request.title)
    if (retrievalQueries.length > 0 && process.env.OPENAI_API_KEY && !manualMode) {
      try {
        const vectors = await requestOpenAIEmbeddings(retrievalQueries.map(query => query.text))
        for (let queryIndex = 0; queryIndex < retrievalQueries.length; queryIndex += 1) {
          const retrievalQuery = retrievalQueries[queryIndex]
          const vector = vectors[queryIndex]
          if (!vector) continue
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
            LIMIT ${retrievalQueryLimit(retrievalQuery, safeLimit)}
          `
          vectorRows.forEach((row, index) => merge(row, 'vectorRank', index + 1, retrievalQuery.weight, retrievalQuery))
        }
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

    if (hasPositiveFieldFilters(filters)) {
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

    const featureCount = (queryPlan.inventionFeatures || []).length
    const sorted = Array.from(rows.values())
      .map(result => {
        const rank = ranks.get(result.publicationNumber) || {
          rrfScore: 0,
          matchedFeatures: new Set<string>(),
          retrievalMatches: [],
        }
        const classMatches = classificationMatches(result, queryPlan)
        const matchedFeatures = uniqueStrings([
          ...(result.matchedFeatures || []),
          ...Array.from(rank.matchedFeatures),
        ])
        const featureCoverage = featureCount > 0
          ? Math.min(1, matchedFeatures.length / Math.min(featureCount, 4))
          : 0
        const conceptSignal = rank.conceptVectorScore || rank.bestVectorScore || 0
        const featureSignal = rank.bestFeatureVectorScore || 0
        const classificationSignal = classMatches.length ? 1 : 0
        const retrievalScore =
          (0.3 * conceptSignal) +
          (0.3 * featureSignal) +
          (0.15 * featureCoverage) +
          (0.1 * (rank.textScore || 0)) +
          (0.1 * (rank.titleScore || 0)) +
          (0.05 * classificationSignal) +
          Math.min(0.05, rank.rrfScore)
        const retrievalMatches = rank.retrievalMatches
          .sort((a, b) => (b.score || 0) - (a.score || 0))
          .slice(0, 8)
        return {
          ...result,
          hybridScore: Number(retrievalScore.toFixed(6)),
          retrievalScore: Number(retrievalScore.toFixed(6)),
          vectorRank: rank.vectorRank,
          textRank: rank.textRank,
          matchedFields: uniqueStrings([
            ...(result.matchedFields || []),
            matchedFeatures.length ? 'featureVector' : '',
            classMatches.length ? 'classification' : '',
          ]),
          matchedFeatures,
          retrievalMatches,
          matchReasons: uniqueStrings([
            ...(result.matchReasons || []),
            matchedFeatures.length ? `Abstract embeddings matched ${matchedFeatures.length} invention feature(s)` : '',
            classMatches.length ? `Classification matched ${classMatches.join(', ')}` : '',
          ]),
          scores: {
            ...(result.scores || {}),
            semantic: rank.bestVectorScore || result.scores?.semantic,
            conceptVector: conceptSignal || undefined,
            bestFeatureVector: featureSignal || undefined,
            featureCoverage,
            text: rank.textScore || result.scores?.text,
            title: rank.titleScore || result.scores?.title,
            field: rank.fieldScore || result.scores?.field,
            classification: classificationSignal || result.scores?.classification,
            retrieval: retrievalScore,
            hybrid: retrievalScore,
          },
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
