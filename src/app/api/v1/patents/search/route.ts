import { NextRequest } from 'next/server'
import { PatentApiError, patentApiQueryHash } from '@/lib/patent-api-auth'
import { runPatentApiRoute } from '@/lib/patent-api-route'
import { getPublicSearchCoverage, searchPublicIndianPatents } from '@/lib/patent-public-api'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  return runPatentApiRoute(request, '/api/v1/patents/search', async () => {
    let body: any
    try {
      body = await request.json()
    } catch {
      throw new PatentApiError('INVALID_REQUEST', 'The request body must be valid JSON.', 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new PatentApiError('INVALID_REQUEST', 'The request body must be a JSON object.', 400)
    }
    const unsupportedFields = Object.keys(body).filter(key => !['query', 'limit'].includes(key))
    if (unsupportedFields.length) {
      throw new PatentApiError('INVALID_REQUEST', `Unsupported request field: ${unsupportedFields[0]}.`, 400)
    }
    const query = typeof body?.query === 'string' ? body.query.trim() : ''
    if (query.length < 2 || query.length > 2000) {
      throw new PatentApiError('INVALID_REQUEST', 'query must contain between 2 and 2,000 characters.', 400)
    }
    const rawLimit = body?.limit === undefined ? 20 : body.limit
    if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      throw new PatentApiError('INVALID_REQUEST', 'limit must be an integer between 1 and 50.', 400)
    }

    const results = await searchPublicIndianPatents(query, rawLimit)
    const coverage = await getPublicSearchCoverage()
    return {
      data: { query, count: results.length, results, coverage },
      resultCount: results.length,
      queryHash: patentApiQueryHash(query),
    }
  })
}
