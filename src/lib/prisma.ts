import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * Prisma's default pool is num_physical_cpus * 2 + 1 — on a 4-vCPU box that is 9
 * connections for the whole application. A deep patent search alone runs two
 * corpus providers x 3 concurrent vector probes, each holding a pooled
 * connection inside a transaction for the length of its lane, plus the corpus
 * estimate queries; add the run's own status poller and the pool saturates,
 * surfacing as P2024 "Timed out fetching a new connection from the connection
 * pool" in whichever query loses the race. Set an explicit floor so search depth
 * is bounded by the database, not by an implicit default.
 *
 * Override with DATABASE_CONNECTION_LIMIT; a connection_limit already present in
 * DATABASE_URL always wins.
 */
function databaseUrlWithPoolFloor(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url || url.includes('connection_limit=')) return url
  const limit = Math.max(1, Number(process.env.DATABASE_CONNECTION_LIMIT || '20') || 20)
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('connection_limit', String(limit))
    return parsed.toString()
  } catch {
    return url
  }
}

const datasourceUrl = databaseUrlWithPoolFloor()

const prismaBase =
  globalForPrisma.prisma ??
  new PrismaClient(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : undefined)

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prismaBase

// Extended type for SketchRecord model
// This ensures TypeScript recognizes the model even if types are cached
// The actual model exists in the database and generated Prisma client
interface SketchRecordDelegate {
  create: (args: { data: any }) => Promise<any>
  findUnique: (args: { where: any; include?: any }) => Promise<any>
  findFirst: (args: { where: any; include?: any }) => Promise<any>
  findMany: (args: { where?: any; orderBy?: any; take?: number; skip?: number; include?: any }) => Promise<any[]>
  update: (args: { where: any; data: any }) => Promise<any>
  delete: (args: { where: any }) => Promise<any>
  deleteMany: (args: { where?: any }) => Promise<{ count: number }>
  count: (args: { where?: any }) => Promise<number>
  upsert: (args: { where: any; update: any; create: any }) => Promise<any>
}

// Extended type for DDUserData model (Detailed Description user data sidecar)
interface DDUserDataDelegate {
  create: (args: { data: any }) => Promise<any>
  findUnique: (args: { where: any }) => Promise<any>
  findFirst: (args: { where: any }) => Promise<any>
  findMany: (args: { where?: any }) => Promise<any[]>
  update: (args: { where: any; data: any }) => Promise<any>
  delete: (args: { where: any }) => Promise<any>
  deleteMany: (args: { where?: any }) => Promise<{ count: number }>
  upsert: (args: { where: any; update: any; create: any }) => Promise<any>
}

// Export prisma with extended types
export const prisma = prismaBase as PrismaClient & {
  sketchRecord: SketchRecordDelegate
  dDUserData: DDUserDataDelegate
}

