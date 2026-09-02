/**
 * Whitespace Studio — stage 7, conversion.
 *
 * Pure transform: a hypothesis the gate ladder let through becomes a
 * WhitespaceConcept in the inventionFeatures shape the novelty-search and
 * drafting handoffs already consume. No model call, no new claims about the
 * idea — the concept says exactly what the hypothesis earned, and its
 * coverage limitations travel with it. A hypothesis that leaves the system
 * without its caveats is a bug.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { HypothesisScores, ValidationRecord } from './types'

export async function convertHypothesis(input: {
  studyId: string
  hypothesisId: string
  userId: string
}): Promise<{ conceptId: string; title: string; existing: boolean }> {
  const hypothesis = await prisma.whitespaceHypothesis.findUnique({
    where: { id: input.hypothesisId },
    include: { evidence: { where: { stance: 'CONTRADICTORY' }, take: 10 } },
  })
  if (!hypothesis || hypothesis.studyId !== input.studyId) {
    throw new Error('That hypothesis no longer exists.')
  }
  if (hypothesis.status === 'REFUTED') {
    throw new Error('A refuted hypothesis cannot be promoted — the record shows why it was refuted.')
  }

  const combination = (hypothesis.elementCombination ?? {}) as Record<string, unknown>
  const elements = Array.isArray(combination.elements)
    ? (combination.elements as unknown[]).filter((element): element is string => typeof element === 'string')
    : []
  const scores = hypothesis.scores as unknown as HypothesisScores | null
  const validation = hypothesis.validation as unknown as ValidationRecord | null
  const limitations = Array.isArray(hypothesis.coverageLimitations)
    ? (hypothesis.coverageLimitations as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : []

  const title = deriveTitle(hypothesis.statement)

  // Differentiation table from the validation mapping: the closest families and
  // how each element fared against them. Present/Partial/Absent, per family.
  const differentiation = hypothesis.evidence
    .filter(evidence => evidence.kind === 'PATENT_PASSAGE' && evidence.refId)
    .map(evidence => {
      const data = (evidence.data ?? {}) as Record<string, unknown>
      return {
        publicationNumber: evidence.refId as string,
        fullCombination: typeof data.fullCombination === 'string' ? data.fullCombination : 'PARTIAL',
        elements: Array.isArray(data.elements) ? data.elements : [],
      }
    })

  const openQuestions = [
    'Is the combination technically realisable at acceptable cost, and by what embodiment?',
    'Would a person skilled in the art consider the combination obvious over the closest partial matches?',
    ...(validation?.gates ?? [])
      .filter(gate => gate.outcome === 'UNASSESSED' || gate.outcome === 'ADVISORY')
      .map(gate => `${gate.basis}`),
  ].slice(0, 8)

  // Conversion is deliberately open to DRAFT and INCONCLUSIVE hypotheses — the
  // attorney's judgment outranks the gate ladder — but a concept promoted past
  // an unrun or unresolved validation must say so, or it leaves the system
  // looking validated.
  const validationNote =
    hypothesis.status === 'INCONCLUSIVE'
      ? 'Validation of this hypothesis was inconclusive. The whitespace claim behind this concept is unconfirmed; it was promoted on attorney judgment, not on a validation result.'
      : !validation
        ? 'Validation was never run against this hypothesis. The whitespace claim behind this concept is untested; it was promoted on attorney judgment, not on a validation result.'
        : null

  const features = {
    // The shape the novelty/drafting handoffs read.
    inventionFeatures: elements,
    problem: null as string | null,
    direction: hypothesis.statement,
    rationale: hypothesis.rationale,
    requiredElements: elements,
    optionalEmbodiments: [] as string[],
    technicalEffect: null as string | null,
    differentiation,
    openQuestions,
    scores,
    whitespaceType: hypothesis.type,
    validationSummary: validation
      ? {
          attacksRun: validation.attacksRun,
          attacksPlanned: validation.attacksPlanned,
          refuting: validation.attacks.filter(attack => attack.outcome === 'REFUTING').length,
          weakening: validation.attacks.filter(attack => attack.outcome === 'WEAKENING').length,
          validatedAt: validation.validatedAt,
        }
      : null,
    validationNote,
    coverageLimitations: limitations,
  }

  // Check-then-create inside one transaction: a double-click (or a retried
  // request) must return the concept the hypothesis already became, not mint a
  // duplicate row.
  const concept = await prisma.$transaction(async tx => {
    const current = await tx.whitespaceConcept.findFirst({
      where: { studyId: input.studyId, hypothesisId: hypothesis.id },
      select: { id: true, title: true },
    })
    if (current) return { id: current.id, title: current.title, existing: true }

    const created = await tx.whitespaceConcept.create({
      data: {
        studyId: input.studyId,
        hypothesisId: hypothesis.id,
        title,
        summary: `${hypothesis.statement}\n\n${hypothesis.rationale}`.slice(0, 4000),
        features: features as unknown as Prisma.InputJsonValue,
        status: 'DRAFT',
      },
    })
    return { id: created.id, title: created.title, existing: false }
  })

  return { conceptId: concept.id, title: concept.title, existing: concept.existing }
}

/** "X combined with Y for Z appears absent…" → "X combined with Y for Z". */
function deriveTitle(statement: string): string {
  const trimmed = statement
    .replace(/\s+appears?\s+(to be\s+)?absent.*$/i, '')
    .replace(/\s+is\s+absent.*$/i, '')
    .trim()
  return (trimmed || statement).slice(0, 180)
}
