import { prisma } from '../src/lib/prisma'

async function main() {
  const now = Date.now()
  const detailedLogCutoff = new Date(now - 90 * 24 * 60 * 60 * 1000)
  const minuteBucketCutoff = new Date(now - 7 * 24 * 60 * 60 * 1000)
  const aggregateBucketCutoff = new Date(now - 730 * 24 * 60 * 60 * 1000)

  const [logs, minuteBuckets, aggregateBuckets] = await prisma.$transaction([
    prisma.patentApiRequestLog.deleteMany({ where: { createdAt: { lt: detailedLogCutoff } } }),
    prisma.patentApiUsageBucket.deleteMany({ where: { periodType: 'MINUTE', periodStart: { lt: minuteBucketCutoff } } }),
    prisma.patentApiUsageBucket.deleteMany({ where: { periodType: { in: ['DAY', 'MONTH'] }, periodStart: { lt: aggregateBucketCutoff } } }),
  ])

  console.log(JSON.stringify({ deletedRequestLogs: logs.count, deletedMinuteBuckets: minuteBuckets.count, deletedAggregateBuckets: aggregateBuckets.count }))
}

main().catch(error => {
  console.error('[PatentApiCleanup] Failed:', error)
  process.exitCode = 1
}).finally(() => prisma.$disconnect())

