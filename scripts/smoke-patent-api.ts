import { NextRequest } from 'next/server'
import { prisma } from '../src/lib/prisma'
import { authenticatePatentApiRequest, createPatentApiKeySecret, PatentApiError } from '../src/lib/patent-api-auth'
import { getPublicIndianPatent } from '../src/lib/patent-public-api'

async function main() {
  const generated = createPatentApiKeySecret()
  const client = await prisma.patentApiClient.create({
    data: {
      name: 'Patent API Smoke Test',
      slug: `patent-api-smoke-${Date.now()}`,
      rateLimitPerMinute: 2,
      dailyRequestLimit: 3,
      monthlyRequestLimit: 4,
    },
  })

  try {
    await prisma.patentApiKey.create({
      data: {
        clientId: client.id,
        name: 'Smoke test',
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        keyLastFour: generated.keyLastFour,
      },
    })
    const makeRequest = () => authenticatePatentApiRequest(new NextRequest('http://local/api/v1/patents/smoke', {
      headers: { Authorization: `Bearer ${generated.secret}` },
    }))
    const concurrent = await Promise.allSettled([makeRequest(), makeRequest(), makeRequest()])
    const accepted = concurrent.filter(result => result.status === 'fulfilled')
    const limited = concurrent.filter(result => result.status === 'rejected' && result.reason instanceof PatentApiError && result.reason.status === 429)
    if (accepted.length !== 2 || limited.length !== 1) {
      throw new Error(`Atomic quota check failed: accepted=${accepted.length}, limited=${limited.length}`)
    }
    const auth = accepted[0].status === 'fulfilled' ? accepted[0].value : null
    if (!auth) throw new Error('Authentication smoke test did not return a context.')
    const sample = await prisma.localPatent.findFirst({
      where: { corpusSources: { has: 'indian-corpus' }, publicationNumberKey: { not: null } },
      select: { publicationNumber: true },
    })
    if (!sample) throw new Error('No normalized Indian patent is available for the lookup smoke test.')
    const originalEnabled = process.env.PATENT_PUBLIC_API_ENABLED
    process.env.PATENT_PUBLIC_API_ENABLED = 'true'
    const patent = await getPublicIndianPatent(sample.publicationNumber)
    process.env.PATENT_PUBLIC_API_ENABLED = originalEnabled
    console.log(JSON.stringify({
      authenticatedClientId: auth.client.id,
      remaining: {
        minute: auth.quota.minute.remaining,
        day: auth.quota.day.remaining,
        month: auth.quota.month.remaining,
      },
      concurrency: { accepted: accepted.length, rateLimited: limited.length },
      lookupPublicationNumber: patent.publicationNumber,
    }))
  } finally {
    await prisma.patentApiClient.delete({ where: { id: client.id } }).catch(() => undefined)
  }
}

main().catch(error => {
  console.error('[PatentApiSmoke] Failed:', error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
