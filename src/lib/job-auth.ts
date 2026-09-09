// Internal credentials for background work that calls the LLM gateway.
//
// The gateway resolves the tenant and plan from the request's bearer token
// exactly as it would for an interactive request, so a background job that
// mints a short-lived JWT for the owning user is metered and quota-checked as
// that user. Nothing sensitive is stored at rest. Shared by the office-action
// job worker and the claim-strategy job.

import { prisma } from '@/lib/prisma'

/**
 * How long a job's internal credential lives, and how often it is re-minted.
 * A long run of LLM calls outlived the 15-minute session default and every
 * stage after the expiry failed with "Unable to resolve tenant context".
 */
export const JOB_TOKEN_TTL = '90m'
export const JOB_TOKEN_REFRESH_MS = 10 * 60_000

export async function buildJobRequestHeaders(userId: string): Promise<Record<string, string>> {
  const user = await (prisma as any).user.findUnique({
    where: { id: userId },
    include: { tenant: { select: { atiId: true } } },
  })
  if (!user) throw new Error(`Job user ${userId} not found`)
  const { generateJWT } = await import('./auth')
  const token = generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  } as any, JOB_TOKEN_TTL)
  return { authorization: `Bearer ${token}` }
}

/**
 * Run `work` with a credential that stays valid for the whole job.
 *
 * The headers object is mutated in place and shared by every stage, so a
 * re-mint reaches calls already in flight down the pipeline.
 */
export async function withFreshAuth<T>(
  userId: string,
  work: (headers: Record<string, string>) => Promise<T>,
  label = 'job'
): Promise<T> {
  const headers = await buildJobRequestHeaders(userId)
  const timer = setInterval(() => {
    void buildJobRequestHeaders(userId)
      .then(fresh => Object.assign(headers, fresh))
      .catch(err => console.warn(`[${label}] could not refresh the job credential:`, err instanceof Error ? err.message : err))
  }, JOB_TOKEN_REFRESH_MS)
  try {
    return await work(headers)
  } finally {
    clearInterval(timer)
  }
}
