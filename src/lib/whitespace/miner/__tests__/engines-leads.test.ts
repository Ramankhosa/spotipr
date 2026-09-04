/**
 * What the user ends up holding: a lead's identity, the cross-engine dedupe,
 * and the write.
 *
 * The write test is the one that matters most and is the least obvious. A lead
 * carries the attorney's review, the gate's verdict and the drafted brief, and
 * a re-run re-measures the numbers underneath them. One extra field in the
 * update payload silently throws all three away, and nobody notices until
 * someone loses a week of review.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const upsert = vi.fn()
const evidenceDeleteMany = vi.fn()
const evidenceCreateMany = vi.fn()
const leadFindMany = vi.fn()
const leadUpdate = vi.fn()

const tx = {
  inventionLead: { upsert, findMany: leadFindMany, update: leadUpdate },
  whitespaceEvidence: { deleteMany: evidenceDeleteMany, createMany: evidenceCreateMany },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    // The stage writes every lead in ONE transaction; the mock runs the
    // callback with a transaction client, exactly as Prisma's interactive
    // transaction does.
    $transaction: (fn: (client: typeof tx) => unknown) => fn(tx),
  },
}))

import {
  LEADS_PER_ENGINE,
  LEADS_TOTAL,
  leadFingerprint,
  NO_MECHANISM,
  normaliseElements,
  primaryTier,
  selectLeads,
  writeLeads,
  type EngineReport,
  type LeadDraft,
} from '../engines-stage'

function draft(over: Partial<LeadDraft> = {}): LeadDraft {
  return {
    origin: 'UNSOLVED_PROBLEM',
    engine: 'unsolved',
    fingerprint: leadFingerprint('component-a', NO_MECHANISM),
    componentKey: 'component-a',
    fallbackTitle: 'Uneven airflow',
    problemStatement: 'uneven airflow in known tray dryers',
    proposedMechanism: null,
    elements: ['perforated tray', 'humidity sensor'],
    rationale: 'measured',
    signals: { engine: 'unsolved', stale: false },
    sourceRefs: { componentKey: 'component-a' },
    scores: { demand: 0.5, novelty: null, obviousnessRisk: null, exclusionRisk: null, claimability: null },
    coverageLimitations: ['Leads are candidates until screened.'],
    evidence: [],
    rank: 1,
    ...over,
  }
}

function engines(): EngineReport[] {
  return (['unsolved', 'transfer', 'frontier', 'expiry'] as const).map(key => ({
    key,
    origin: 'UNSOLVED_PROBLEM' as const,
    ran: true,
    skipReason: null,
    inputs: {},
    leads: 0,
    deduped: 0,
  }))
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

describe('leadFingerprint', () => {
  it('is stable across re-runs for the same component and mechanism', () => {
    expect(leadFingerprint('c', 'm')).toBe(leadFingerprint('c', 'm'))
  })

  it('separates two mechanisms on the same problem', () => {
    expect(leadFingerprint('c', 'm1')).not.toBe(leadFingerprint('c', 'm2'))
  })

  it('separates the same mechanism on two problems', () => {
    expect(leadFingerprint('c1', 'm')).not.toBe(leadFingerprint('c2', 'm'))
  })

  it('cannot be collided by moving the delimiter between the two halves', () => {
    expect(leadFingerprint('a b', 'c')).not.toBe(leadFingerprint('a', 'b c'))
  })

  it('is a fixed-width hex handle, not the inputs in clear', () => {
    expect(leadFingerprint('component-a', NO_MECHANISM)).toMatch(/^[0-9a-f]{32}$/)
  })
})

describe('normaliseElements', () => {
  it('keeps two to six normalised elements', () => {
    expect(normaliseElements(['Perforated Tray.', 'humidity sensor'])).toEqual(['perforated tray', 'humidity sensor'])
    expect(
      normaliseElements(['tray', 'sensor', 'fan', 'duct', 'valve', 'heater', 'controller'])
    ).toHaveLength(6)
  })

  it('de-duplicates after normalisation, not before', () => {
    expect(normaliseElements(['Perforated tray', 'perforated  tray!', 'humidity sensor'])).toEqual([
      'perforated tray',
      'humidity sensor',
    ])
  })

  it('returns null below two — a lead that cannot be described is not written', () => {
    // Padding to reach two would be inventing the combination, which is the one
    // thing the engines exist not to do.
    expect(normaliseElements(['only one'])).toBeNull()
    expect(normaliseElements([])).toBeNull()
    expect(normaliseElements(['ab', 'x'])).toBeNull()
  })
})

describe('primaryTier', () => {
  it('speaks from the RICHEST tier that has enough families', () => {
    expect(
      primaryTier({
        'description-full': { admitting: 4 },
        'description-5k': { admitting: 40 },
        abstract: { admitting: 90 },
      })
    ).toBe('description-full')
  })

  it('falls back to the biggest tier when none is rich enough', () => {
    expect(primaryTier({ 'description-full': { admitting: 1 }, abstract: { admitting: 9 } })).toBe('abstract')
  })

  it('is null when nothing was admitted at any tier', () => {
    expect(primaryTier({})).toBeNull()
    expect(primaryTier({ abstract: { admitting: 0 } })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Dedupe and caps
// ---------------------------------------------------------------------------

describe('selectLeads', () => {
  it('keeps the first engine’s lead on a fingerprint and folds the later one in', () => {
    const report = engines()
    const selected = selectLeads(
      [
        draft(),
        draft({
          engine: 'expiry',
          origin: 'EXPIRY_FRONTIER',
          coverageLimitations: ['We hold no legal-status or renewal data.', 'An expired patent remains prior art.'],
        }),
      ],
      report
    )
    expect(selected).toHaveLength(1)
    expect(selected[0].origin).toBe('UNSOLVED_PROBLEM')
    // The expiry engine's two mandatory sentences must not vanish because an
    // unsolved lead on the same problem happened to be written first.
    expect(selected[0].coverageLimitations).toContain('We hold no legal-status or renewal data.')
    expect(selected[0].coverageLimitations).toContain('An expired patent remains prior art.')
    expect(selected[0].signals.alsoFoundBy).toEqual(['EXPIRY_FRONTIER'])
    expect(report.find(entry => entry.key === 'expiry')?.deduped).toBe(1)
  })

  it('does not duplicate a coverage line the survivor already carries', () => {
    const selected = selectLeads([draft(), draft({ engine: 'expiry', origin: 'EXPIRY_FRONTIER' })], engines())
    expect(selected[0].coverageLimitations).toEqual(['Leads are candidates until screened.'])
  })

  it('caps each engine at eight', () => {
    const report = engines()
    const many = Array.from({ length: 20 }, (_, index) =>
      draft({ fingerprint: leadFingerprint(`c${index}`, NO_MECHANISM), componentKey: `c${index}` })
    )
    expect(selectLeads(many, report)).toHaveLength(LEADS_PER_ENGINE)
    expect(report.find(entry => entry.key === 'unsolved')?.leads).toBe(LEADS_PER_ENGINE)
  })

  it('caps the whole run at twenty-four', () => {
    const drafts: LeadDraft[] = []
    for (const engine of ['unsolved', 'transfer', 'frontier', 'expiry'] as const) {
      for (let index = 0; index < 8; index++) {
        drafts.push(
          draft({ engine, fingerprint: leadFingerprint(`${engine}-${index}`, NO_MECHANISM) })
        )
      }
    }
    expect(selectLeads(drafts, engines())).toHaveLength(LEADS_TOTAL)
    expect(LEADS_TOTAL).toBe(24)
  })

  it('counts each engine’s surviving leads on its report', () => {
    const report = engines()
    selectLeads(
      [draft(), draft({ engine: 'frontier', fingerprint: leadFingerprint('c2', 'mech') })],
      report
    )
    expect(report.find(entry => entry.key === 'unsolved')?.leads).toBe(1)
    expect(report.find(entry => entry.key === 'frontier')?.leads).toBe(1)
    expect(report.find(entry => entry.key === 'transfer')?.leads).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

describe('writeLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsert.mockResolvedValue({ id: 'lead-1' })
    evidenceDeleteMany.mockResolvedValue({ count: 0 })
    evidenceCreateMany.mockResolvedValue({ count: 0 })
    leadFindMany.mockResolvedValue([])
    leadUpdate.mockResolvedValue({})
  })

  const lead = { ...draft(), title: 'Uneven airflow in tray dryers' }

  it('NEVER touches humanReview, gate, brief or status on the update path', async () => {
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    const call = upsert.mock.calls[0][0]
    for (const preserved of ['humanReview', 'gate', 'brief', 'status']) {
      expect(Object.keys(call.update)).not.toContain(preserved)
    }
  })

  it('upserts on (studyId, fingerprint) so a re-run updates rather than duplicates', async () => {
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    expect(upsert.mock.calls[0][0].where).toEqual({
      studyId_fingerprint: { studyId: 's1', fingerprint: lead.fingerprint },
    })
  })

  it('sets status CANDIDATE only on CREATE', async () => {
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    const call = upsert.mock.calls[0][0]
    expect(call.create.status).toBe('CANDIDATE')
    expect(call.update.status).toBeUndefined()
  })

  it('re-measures the numbers, the scope fingerprint and the run on every write', async () => {
    await writeLeads({ studyId: 's1', runId: 'r7', fingerprint: 'fp-2', leads: [lead] })
    const update = upsert.mock.calls[0][0].update
    expect(update.runId).toBe('r7')
    expect(update.scopeFingerprint).toBe('fp-2')
    expect(update.signals).toEqual(lead.signals)
    expect(update.coverageLimitations).toEqual(lead.coverageLimitations)
  })

  it('carries only measured scores — there is no composite grantability number', async () => {
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    const scores = upsert.mock.calls[0][0].update.scores as Record<string, unknown>
    expect(scores.demand).toBe(0.5)
    expect(scores.novelty).toBeNull()
    expect(scores.obviousnessRisk).toBeNull()
    expect(scores.exclusionRisk).toBeNull()
    expect(scores.claimability).toBeNull()
    expect(Object.keys(scores)).not.toContain('grantability')
  })

  it('replaces machine evidence and leaves USER evidence alone', async () => {
    await writeLeads({
      studyId: 's1',
      runId: 'r1',
      fingerprint: 'fp',
      leads: [
        {
          ...lead,
          evidence: [{ kind: 'STATISTIC', refId: null, passage: 'counts', stance: 'CONTEXT' }],
        },
      ],
    })
    expect(evidenceDeleteMany.mock.calls[0][0].where).toEqual({
      leadId: 'lead-1',
      kind: { in: ['STATISTIC', 'PATENT_PASSAGE'] },
    })
    expect(evidenceCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      studyId: 's1',
      leadId: 'lead-1',
      kind: 'STATISTIC',
      stance: 'CONTEXT',
    })
  })

  it('marks a lead this run did not produce STALE rather than deleting it', async () => {
    leadFindMany.mockResolvedValue([{ id: 'old-1', signals: { engine: 'unsolved', admitting: 12 } }])
    const result = await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    expect(result.stale).toBe(1)
    const data = leadUpdate.mock.calls[0][0].data.signals as Record<string, unknown>
    expect(data.stale).toBe(true)
    expect(data.staleReason).toContain('not produced by the most recent engines run')
    // The earlier measurements are kept, not overwritten.
    expect(data.admitting).toBe(12)
  })

  it('does not re-stamp a lead that is already stale', async () => {
    leadFindMany.mockResolvedValue([{ id: 'old-1', signals: { stale: true, staleAt: 'yesterday' } }])
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    expect(leadUpdate).not.toHaveBeenCalled()
  })

  it('excludes exactly the fingerprints it wrote from the stale sweep', async () => {
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [lead] })
    expect(leadFindMany.mock.calls[0][0].where).toEqual({
      studyId: 's1',
      fingerprint: { notIn: [lead.fingerprint] },
    })
  })

  it('sweeps every lead when this run wrote none, without an empty notIn', async () => {
    await writeLeads({ studyId: 's1', runId: 'r1', fingerprint: 'fp', leads: [] })
    // An empty `notIn` matches nothing in Prisma, which would silently leave
    // every stale lead reading as current.
    expect(leadFindMany.mock.calls[0][0].where.fingerprint.notIn).not.toEqual([])
  })
})
