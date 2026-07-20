import { NextRequest } from 'next/server'
import { PatentApiError, patentApiQueryHash } from '@/lib/patent-api-auth'
import { readPatentApiJsonBody, runPatentApiRoute } from '@/lib/patent-api-route'
import { extractPublicInventionFeatures } from '@/lib/patent-api-analysis'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  return runPatentApiRoute(request, '/api/v1/analysis/features', async ({ auth }) => {
    const body = await readPatentApiJsonBody(request)
    const unsupportedFields = Object.keys(body).filter(key => !['title', 'description'].includes(key))
    if (unsupportedFields.length) {
      throw new PatentApiError('INVALID_REQUEST', `Unsupported request field: ${unsupportedFields[0]}.`, 400)
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      throw new PatentApiError('INVALID_REQUEST', 'title must be a string.', 400)
    }
    if (typeof body.description !== 'string') {
      throw new PatentApiError('INVALID_REQUEST', 'description must be a string.', 400)
    }

    const analysis = await extractPublicInventionFeatures({ title: body.title, description: body.description, auth })
    return {
      data: analysis,
      resultCount: analysis.features.length,
      queryHash: patentApiQueryHash(body.description),
    }
  })
}
