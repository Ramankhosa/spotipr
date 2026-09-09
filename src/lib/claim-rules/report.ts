// The office-form report persisted with a claim set.

import type { DraftClaim } from '@/lib/draft-claims-parser'
import { dependencyFromClaimText } from '@/lib/draft-claims-parser'
import { computeClaimsSignature } from '@/lib/claims-signature'
import type { ClaimFormRepairRecord, ClaimFormReport, ClaimNormalisationChange, ClaimRuleProfile, OfficeFormFinding } from './types'

function isIndependent(claim: DraftClaim): boolean {
  if (claim.type === 'independent') return true
  if (claim.type === 'dependent') return false
  return dependencyFromClaimText(claim.text) === undefined
}

export function buildClaimFormReport(params: {
  claims: DraftClaim[]
  rules: ClaimRuleProfile
  findings: OfficeFormFinding[]
  normalisation?: ClaimNormalisationChange[]
  repair?: ClaimFormRepairRecord | null
  now?: string
}): ClaimFormReport {
  const { claims, rules, findings } = params
  return {
    generatedAt: params.now || new Date().toISOString(),
    jurisdiction: rules.jurisdiction,
    rulesVersion: rules.rulesVersion,
    claimsSignature: computeClaimsSignature(claims),
    findings,
    normalisation: params.normalisation || [],
    repair: params.repair ?? null,
    counts: {
      total: claims.length,
      independent: claims.filter(isIndependent).length,
      freeTotal: rules.freeTotalClaims,
      freeIndependent: rules.freeIndependentClaims,
    },
  }
}

/** True when the stored report describes these exact claims. */
export function claimFormReportMatches(report: ClaimFormReport | null | undefined, claims: DraftClaim[] | null | undefined): boolean {
  if (!report || typeof report !== 'object') return false
  return report.claimsSignature === computeClaimsSignature(claims || [])
}
