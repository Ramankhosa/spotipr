import { NextResponse } from 'next/server'
import { enforceServiceAccess } from '../service-access-middleware'

/**
 * Office Action Studio — shared route guard
 *
 * Every write path in this module runs paid LLM work, so every one of them has
 * to clear the OFFICE_ACTION_RESPONSE feature gate and the tenant's quota.
 *
 * These checks used to be wrapped in `if (auth.user.tenantId)`. User.tenantId is
 * nullable and `authenticateUser` returns null for it happily, so a tenantless
 * account skipped the feature gate, the daily/monthly quota check AND the quota
 * consumption entirely — the full multi-call reply pipeline ran unmetered and
 * unbilled. The same fail-open shape was already found and fixed in the idea
 * bank; this is that fix, factored so the eight OA call sites cannot drift apart.
 *
 * Fails CLOSED: a user we cannot meter is refused, not silently granted.
 */
export async function enforceOfficeActionAccess(
  user: { id: string; tenantId?: string | null }
): Promise<{ allowed: true; tenantId: string } | { allowed: false; response: NextResponse }> {
  if (!user.tenantId) {
    return {
      allowed: false,
      response: NextResponse.json(
        {
          error: 'Your account is not linked to an organisation, so usage cannot be metered. Please contact your administrator.',
          code: 'TENANT_UNRESOLVED'
        },
        { status: 403 }
      )
    }
  }

  const access = await enforceServiceAccess(user.id, user.tenantId, 'OFFICE_ACTION_RESPONSE')
  if (!access.allowed) return { allowed: false, response: access.response }
  return { allowed: true, tenantId: user.tenantId }
}
