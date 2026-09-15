import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { resolveFieldBand, resolveFieldDefinition } from '../field-definition'
import { stableJson, type WhitespaceScope } from '../types'
import { stageField, allocateTierSample, zeroTierCounts, HARVEST_FAMILY_CAP, MIN_SAMPLING_FRACTION, MIN_DESCRIPTION_SHARE, READ_TOKEN_CEILING } from './harvest-stage'
import { minerRetrievalIdentity } from './retrieval-identity'
import { MinerError } from './contracts'
import type { RunReporter } from '../run-reporter'

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue

export async function createFieldSnapshot(input: { runId: string; studyId: string; scope: WhitespaceScope; reporter: RunReporter }) {
  await input.reporter.plan([{ key: 'field', label: 'Resolving the field' }, { key: 'coverage', label: 'Measuring reading coverage' }], [])
  await input.reporter.step('field', 'Resolving the match rule and representative publications')
  const field = await resolveFieldDefinition(input.scope, { studyId: input.studyId })
  const band = resolveFieldBand()
  const members = await stageField(input.scope, field.where, field.rule, band.maxPublications)
  await input.reporter.step('coverage', 'Calculating the bounded workload')
  const tiers = zeroTierCounts()
  for (const member of members) if (member.tier) tiers[member.tier]++
  const allocation = allocateTierSample(tiers, HARVEST_FAMILY_CAP)
  const sampled = Object.values(allocation).reduce((a, b) => a + b, 0)
  const withDescription = tiers['description-full'] + tiers['description-5k']
  const jurisdictionCounts = new Map<string, number>()
  for (const member of members) if (member.country) jurisdictionCounts.set(member.country, (jurisdictionCounts.get(member.country) ?? 0) + 1)
  const coverage = { familiesTotal: members.length, withDescription, withClaims: members.filter(m => m.hasClaims).length,
    byJurisdiction: Array.from(jurisdictionCounts, ([label, families]) => ({ label, families })).sort((a, b) => b.families - a.families) }
  const limitations = [...field.coverageNotes, 'One representative publication per family is selected. Source availability is not the amount the model will read.']
  if (members.length < band.minFamilies) limitations.push(`At least ${band.minFamilies} families are required.`)
  if (withDescription / Math.max(1, members.length) < MIN_DESCRIPTION_SHARE) limitations.push('Description availability is below the 20% minimum.')
  if (sampled / Math.max(1, members.length) < MIN_SAMPLING_FRACTION) limitations.push('The bounded sample covers less than 5% of the field.')
  const eligible = members.length >= band.minFamilies && withDescription / Math.max(1, members.length) >= MIN_DESCRIPTION_SHARE && sampled / Math.max(1, members.length) >= MIN_SAMPLING_FRACTION
  const workload = { sampledFamilies: sampled, extractionCallsUpperBound: Math.ceil(sampled / 2), cachedReadings: null, tokenCeiling: READ_TOKEN_CEILING, harvestUnits: 1, engineUnits: 1, tierAllocation: allocation }
  const identity = minerRetrievalIdentity(input.scope)
  const exampleMembers = members.slice(0, 12)
  const examplePatents = await prisma.localPatent.findMany({ where: { publicationNumber: { in: exampleMembers.map(member => member.publicationNumber) } }, select: { publicationNumber: true, title: true, abstract: true } })
  const exampleByPublication = new Map(examplePatents.map(patent => [patent.publicationNumber, patent]))
  const examples = exampleMembers.map(member => ({
    ...member,
    title: exampleByPublication.get(member.publicationNumber)?.title ?? member.publicationNumber,
    abstract: exampleByPublication.get(member.publicationNumber)?.abstract?.slice(0, 500) ?? null,
  }))
  // Keep the inspection sample on the immutable snapshot so reopening the
  // study does not depend on the preflight run result still being in memory.
  const persistedWorkload = { ...workload, examples }
  const current = await prisma.whitespaceStudy.findUnique({ where: { id: input.studyId } })
  if (!current || minerRetrievalIdentity(current.scope as unknown as WhitespaceScope) !== identity) throw new MinerError('Field settings changed during preflight. Run preflight again.', 409)
  const snapshot = await prisma.minerFieldSnapshot.upsert({
    where: { runId: input.runId }, update: {}, create: {
      studyId: input.studyId, runId: input.runId, retrievalIdentity: identity,
      scope: json(input.scope), matchingRule: json(field.rule),
      membershipHash: createHash('sha256').update(stableJson(members.map(m => [m.familyKey, m.publicationNumber]).sort())).digest('hex'),
      members: json(members), coverage: json(coverage), workload: json(persistedWorkload), eligible, limitations: json(limitations),
    },
  })
  input.reporter.done()
  return { snapshotId: snapshot.id, eligible, coverage, workload: persistedWorkload, limitations,
    examples, matchingRule: field.rule }
}

export async function currentSnapshot(studyId: string, snapshotId: string) {
  const [study, snapshot] = await Promise.all([
    prisma.whitespaceStudy.findUnique({ where: { id: studyId } }),
    prisma.minerFieldSnapshot.findUnique({ where: { id: snapshotId } }),
  ])
  if (!study || !snapshot || snapshot.studyId !== studyId) throw new MinerError('Field snapshot not found.', 404)
  if (minerRetrievalIdentity(study.scope as unknown as WhitespaceScope) !== snapshot.retrievalIdentity) throw new MinerError('The field has changed. Run and approve a new preflight.', 409)
  return snapshot
}
