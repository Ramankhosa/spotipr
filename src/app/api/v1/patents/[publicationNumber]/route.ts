import { NextRequest } from 'next/server'
import { runPatentApiRoute } from '@/lib/patent-api-route'
import { getPublicIndianPatent } from '@/lib/patent-public-api'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: { publicationNumber: string } }) {
  return runPatentApiRoute(request, '/api/v1/patents/{publicationNumber}', async () => ({
    data: await getPublicIndianPatent(params.publicationNumber || ''),
    resultCount: 1,
  }))
}
