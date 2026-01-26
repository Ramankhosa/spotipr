export type PaidSignupState = {
  planCode: 'BASIC' | 'PRO' | 'ENTERPRISE'
  billingCycle: 'monthly' | 'yearly'
}

const PLAN_CODES = new Set(['BASIC', 'PRO', 'ENTERPRISE'])
const BILLING_CYCLES = new Set(['monthly', 'yearly'])

export function normalizePaidSignupParams(
  planCode?: string | null,
  billingCycle?: string | null
): PaidSignupState | null {
  if (!planCode || !billingCycle) return null

  const normalizedPlan = planCode.toUpperCase()
  const normalizedCycle = billingCycle.toLowerCase()

  if (!PLAN_CODES.has(normalizedPlan) || !BILLING_CYCLES.has(normalizedCycle)) {
    return null
  }

  return {
    planCode: normalizedPlan as PaidSignupState['planCode'],
    billingCycle: normalizedCycle as PaidSignupState['billingCycle'],
  }
}

export function encodeOAuthState(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

export function decodeOAuthState(state?: string | null): Record<string, any> | null {
  if (!state) return null
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString())
  } catch {
    return null
  }
}

export function parsePaidSignupState(state?: string | null): PaidSignupState | null {
  const decoded = decodeOAuthState(state)
  if (!decoded || decoded.flow !== 'paid') return null
  return normalizePaidSignupParams(decoded.planCode, decoded.billingCycle)
}

export function parsePaidSignupStateFromObject(obj?: Record<string, any> | null): PaidSignupState | null {
  if (!obj || obj.flow !== 'paid') return null
  return normalizePaidSignupParams(obj.planCode, obj.billingCycle)
}
