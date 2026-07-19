import { NextRequest } from 'next/server'
import { PatentApiError, patentApiQueryHash } from '@/lib/patent-api-auth'
import { runPatentApiRoute } from '@/lib/patent-api-route'
import { mapFeaturesToPublicPatent } from '@/lib/patent-api-analysis'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  return runPatentApiRoute(request, '/api/v1/analysis/feature-mapping', async () => {
    let body: any
    try {
      body = await request.json()
    } catch {
      throw new PatentApiError('INVALID_REQUEST', 'The request body must be valid JSON.', 400)
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new PatentApiError('INVALID_REQUEST', 'The request body must be a JSON object.', 400)
    }
    const unsupportedFields = Object.keys(body).filter(key => !['features', 'publicationNumber'].includes(key))
    if (unsupportedFields.length) {
      throw new PatentApiError('INVALID_REQUEST', `Unsupported request field: ${unsupportedFields[0]}.`, 400)
    }
    if (!Array.isArray(body.features)) {
      throw new PatentApiError('INVALID_REQUEST', 'features must be an array of strings.', 400)
    }
    if (typeof body.publicationNumber !== 'string' || !body.publicationNumber.trim()) {
      throw new PatentApiError('INVALID_REQUEST', 'publicationNumber must be a non-empty string.', 400)
    }

    const mapping = await mapFeaturesToPublicPatent({
      features: body.features,
      publicationNumber: body.publicationNumber,
    })
    return {
      data: mapping,
      resultCount: mapping.featureFindings.length,
      queryHash: patentApiQueryHash(`${mapping.publicationNumber}::${mapping.featureFindings.map(f => f.feature).join('|')}`),
    }
  })
}
