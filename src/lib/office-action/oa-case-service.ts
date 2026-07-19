import { prisma } from '../prisma'
import { getCountryProfile } from '../country-profile-service'
import { officeActionProfileSchema, type OfficeActionProfile } from './oa-profile-schema'
import { computeDeadlines, mostUrgentDeadline, type ComputedDeadline } from './deadline-engine'
import { parseOfficeActionDocument, cleanOfficeActionText } from './oa-parser'
import { classifyObjections } from './objection-classifier'
import type { OaGateway } from './oa-llm-service'

/**
 * Office Action Studio — case orchestration
 *
 * Ties the intake + objection-map pipeline together over persistence:
 *   createCase → ingestDocument (detect → parse → deadlines → classify →
 *   persist objections) → getCaseView.
 * All jurisdiction behavior comes from the country profile's officeActionProfile
 * block; this service has no country branches.
 */

const ISO_TODAY_FALLBACK = () => new Date().toISOString().slice(0, 10)

export interface CaseActor {
  userId: string
  tenantId?: string | null
  requestHeaders?: Record<string, string>
}

/** Load + validate the officeActionProfile for a jurisdiction. */
export async function loadOfficeActionProfile(jurisdictionCode: string): Promise<OfficeActionProfile | null> {
  const country = await getCountryProfile(jurisdictionCode.toUpperCase())
  const block = (country?.profileData as any)?.officeActionProfile
  if (!block) return null
  const parsed = officeActionProfileSchema.safeParse(block)
  return parsed.success ? parsed.data : null
}

export async function createCase(actor: CaseActor, input: {
  jurisdictionCode: string
  applicationNumber: string
  applicantName?: string
  title?: string
  patentId?: string
  specificationText?: string
  claimsText?: string
}) {
  const profile = await loadOfficeActionProfile(input.jurisdictionCode)
  if (!profile) {
    throw new Error(`No active office-action profile for jurisdiction "${input.jurisdictionCode}"`)
  }
  return prisma.officeActionCase.create({
    data: {
      userId: actor.userId,
      tenantId: actor.tenantId || null,
      jurisdictionCode: input.jurisdictionCode.toUpperCase(),
      applicationNumber: input.applicationNumber,
      applicantName: input.applicantName || null,
      title: input.title || null,
      patentId: input.patentId || null,
      specificationText: input.specificationText || null,
      claimsText: input.claimsText || null
    }
  })
}

export interface IngestResult {
  documentId: string
  instrument: { instrumentId: string | null; label: string | null; confidence: number }
  deadlines: ComputedDeadline[]
  mostUrgent: ComputedDeadline | null
  objectionCount: number
  unverifiedQuotes: number
  error?: string
}

/**
 * Ingest one uploaded office communication: detect instrument, parse, compute
 * deadlines, classify objections, and persist everything. `today` is injectable
 * for testing. `gateway` is injectable so this runs without API keys in tests.
 */
export async function ingestDocument(
  actor: CaseActor,
  caseId: string,
  rawText: string,
  opts: { fileName?: string; today?: string; gateway?: OaGateway } = {}
): Promise<IngestResult> {
  const oaCase = await prisma.officeActionCase.findUnique({ where: { id: caseId } })
  if (!oaCase) throw new Error('Case not found')

  const profile = await loadOfficeActionProfile(oaCase.jurisdictionCode)
  if (!profile) throw new Error(`No office-action profile for "${oaCase.jurisdictionCode}"`)

  const today = opts.today || ISO_TODAY_FALLBACK()

  // Strip PDF page furniture (headers/footers/duplicated boundary lines) so the
  // model reads continuous prose and its verbatim quotes substring-match.
  const cleanText = cleanOfficeActionText(rawText)

  const doc = await prisma.officeActionDocument.create({
    data: {
      caseId,
      fileName: opts.fileName || null,
      rawText: cleanText,
      parseStatus: 'PROCESSING'
    }
  })

  try {
    // 1. Detect + parse
    const parseResult = await parseOfficeActionDocument(
      profile, cleanText,
      { tenantId: actor.tenantId || undefined, userId: actor.userId, requestHeaders: actor.requestHeaders },
      opts.gateway
    )

    if (!parseResult.parsed) {
      await prisma.officeActionDocument.update({
        where: { id: doc.id },
        data: { parseStatus: 'FAILED', parseConfidence: parseResult.instrument.confidence, instrumentType: parseResult.instrument.instrumentId }
      })
      return {
        documentId: doc.id,
        instrument: parseResult.instrument,
        deadlines: [], mostUrgent: null, objectionCount: 0, unverifiedQuotes: 0,
        error: parseResult.error || 'Parse produced no content'
      }
    }

    // 2. Deadlines (deterministic, from profile)
    const deadlines = parseResult.instrument.instrumentId
      ? computeDeadlines(profile, parseResult.instrument.instrumentId, parseResult.triggerDates, today)
      : []
    const urgent = mostUrgentDeadline(deadlines)

    // 3. Classify objections + verify quotes
    const classification = await classifyObjections(
      profile, parseResult.parsed.objections, cleanText,
      { tenantId: actor.tenantId || undefined, userId: actor.userId, requestHeaders: actor.requestHeaders },
      opts.gateway
    )
    const objections = classification.objections
    const unverified = objections.filter(o => !o.quoteVerified).length

    // 4. Persist (document + objections + citations) atomically
    const issueDate = parseResult.parsed.dateOfReport ? new Date(parseResult.parsed.dateOfReport) : null
    await prisma.$transaction([
      prisma.officeActionDocument.update({
        where: { id: doc.id },
        data: {
          instrumentType: parseResult.instrument.instrumentId,
          issueDate,
          parseStatus: 'COMPLETED',
          parseConfidence: parseResult.instrument.confidence,
          parsedJson: parseResult.parsed as any,
          deadlinesJson: deadlines as any
        }
      }),
      ...objections.map(o => prisma.oaObjection.create({
        data: {
          documentId: doc.id,
          sortOrder: o.sortOrder,
          canonicalCode: o.canonicalCode,
          subTypeId: o.subTypeId || null,
          localBasis: o.localBasis || null,
          examinerText: o.examinerText,
          quoteVerified: o.quoteVerified,
          claimsAffected: (o.claimsAffected || []) as any,
          citationLabels: (o.citationLabels || []) as any,
          status: 'EXTRACTED',
          analysisJson: o.rationale ? ({ rationale: o.rationale } as any) : undefined
        }
      })),
      ...parseResult.parsed.citedDocuments.map(c => prisma.oaCitation.create({
        data: {
          documentId: doc.id,
          label: c.label,
          kind: c.kind || 'PATENT',
          docNumber: c.docNumber || null,
          fetchStatus: 'PENDING',
          // Seed the claim chart with the examiner's own pinpoint from the PART-II §A table.
          passagesJson: (c.relevantDescription || c.relevantClaimsOfCited || c.claimsOfAllegedInvention)
            ? ({
                examinerSeed: {
                  relevantDescription: c.relevantDescription,
                  relevantClaimsOfCited: c.relevantClaimsOfCited,
                  claimsOfAllegedInvention: c.claimsOfAllegedInvention,
                  publicationDate: c.publicationDate
                }
              } as any)
            : undefined
        }
      }))
    ])

    // Eagerly resolve the cited documents right after intake so the full patent
    // texts are ready before the attorney opens the citation workbench.
    if (parseResult.parsed.citedDocuments.length) {
      const { kickCitationResolution } = await import('./citation-resolver')
      await kickCitationResolution(caseId, actor.userId)
    }

    return {
      documentId: doc.id,
      instrument: parseResult.instrument,
      deadlines,
      mostUrgent: urgent,
      objectionCount: objections.length,
      unverifiedQuotes: unverified,
      error: classification.success ? undefined : classification.error
    }
  } catch (err) {
    await prisma.officeActionDocument.update({
      where: { id: doc.id },
      data: { parseStatus: 'FAILED' }
    }).catch(() => {})
    throw err
  }
}

/** Assemble the workspace view of a case: documents, deadlines, objection cards. */
export async function getCaseView(caseId: string) {
  const oaCase = await prisma.officeActionCase.findUnique({
    where: { id: caseId },
    include: {
      documents: {
        orderBy: { createdAt: 'asc' },
        include: {
          objections: { orderBy: { sortOrder: 'asc' } },
          citations: { orderBy: { label: 'asc' } }
        }
      }
    }
  })
  if (!oaCase) return null

  const allDeadlines: ComputedDeadline[] = oaCase.documents.flatMap(d => (d.deadlinesJson as any as ComputedDeadline[]) || [])

  // Present cited documents to the attorney as patent documents — full text when
  // resolved, with a neutral source label and no retrieval detail.
  const { toAttorneyView } = await import('./citation-resolver')
  const citedDocuments = oaCase.documents.flatMap(d => d.citations.map(toAttorneyView))

  // Sanitize: internal retrieval fields (resolvedVia et al.) never reach the client.
  const documents = oaCase.documents.map(d => ({
    ...d,
    citations: d.citations.map(({ resolvedVia, normalizedKey, fullTextKey, ...rest }) => rest)
  }))

  // Latest reply draft (what the Draft tab and export consume).
  const latestDraft = await prisma.oaResponseDraft.findFirst({
    where: { caseId },
    orderBy: { version: 'desc' }
  })

  return {
    case: { ...oaCase, documents },
    deadlines: allDeadlines,
    mostUrgent: mostUrgentDeadline(allDeadlines),
    citedDocuments,
    latestDraft
  }
}
