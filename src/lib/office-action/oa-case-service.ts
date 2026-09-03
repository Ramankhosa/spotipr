import { prisma } from '../prisma'
import { getCountryProfile } from '../country-profile-service'
import { officeActionProfileSchema, type OfficeActionProfile } from './oa-profile-schema'
import { computeDeadlines, mostUrgentDeadline, officeToday, refreshDeadlines, type ComputedDeadline } from './deadline-engine'
import { parseOfficeActionDocument, cleanOfficeActionText, safeIsoDate } from './oa-parser'
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

// The office's calendar day, not the server's UTC day. A UTC "today" is a day
// behind IST between 00:00 and 05:30, which overstates every computed deadline
// by one day for filings made in that window.
const ISO_TODAY_FALLBACK = () => officeToday()

export interface CaseActor {
  userId: string
  tenantId?: string | null
  requestHeaders?: Record<string, string>
}

/** The jurisdiction has no usable office-action profile — a deployment/config fault, not a user error. */
export class OaProfileUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OaProfileUnavailableError'
  }
}

/** Where a loaded profile came from, and — when it could not be loaded — why. */
export interface OaProfileLoad {
  profile: OfficeActionProfile | null
  source: 'database' | 'repository' | null
  /** Attorney-facing explanation, present only when profile is null. */
  reason?: string
}

// Repository fallback is parsed once per process — the JSON never changes at runtime.
const repoProfileCache = new Map<string, OfficeActionProfile | null>()

/**
 * Read the officeActionProfile straight out of Countries/<CODE>.json.
 *
 * The DB copy (CountryProfile.profileData.officeActionProfile) is authoritative,
 * but it only gets there via `npm run oa:sync-profile <CODE>`. Any environment
 * where that script has not been run — a fresh deploy, a restored dump, or a
 * country re-imported through the jurisdictions hub from a JSON that predates
 * the OA block — would otherwise refuse to open a case at all. Falling back to
 * the shipped profile makes the module work everywhere the code is deployed.
 */
async function loadProfileFromRepo(code: string): Promise<OfficeActionProfile | null> {
  if (repoProfileCache.has(code)) return repoProfileCache.get(code) || null

  let parsedProfile: OfficeActionProfile | null = null
  try {
    const { readFile } = await import('fs/promises')
    const { join } = await import('path')
    const raw = await readFile(join(process.cwd(), 'Countries', `${code}.json`), 'utf-8')
    const block = JSON.parse(raw)?.officeActionProfile
    if (block) {
      const parsed = officeActionProfileSchema.safeParse(block)
      if (parsed.success) parsedProfile = parsed.data
      else {
        console.warn(`[OA profile] Countries/${code}.json officeActionProfile failed validation:`,
          parsed.error.errors.slice(0, 5).map(e => `${e.path.join('.')}: ${e.message}`).join('; '))
      }
    }
  } catch (err) {
    // ENOENT for most countries is expected — only some ship an OA block.
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn(`[OA profile] Could not read Countries/${code}.json:`, err instanceof Error ? err.message : err)
    }
  }

  repoProfileCache.set(code, parsedProfile)
  return parsedProfile
}

/**
 * Load + validate the officeActionProfile for a jurisdiction, reporting where it
 * came from and — on failure — a reason the attorney can act on.
 */
export async function loadOfficeActionProfileDetailed(jurisdictionCode: string): Promise<OaProfileLoad> {
  const code = jurisdictionCode.toUpperCase()

  const country = await getCountryProfile(code)
  const block = (country?.profileData as any)?.officeActionProfile
  if (block) {
    const parsed = officeActionProfileSchema.safeParse(block)
    if (parsed.success) return { profile: parsed.data, source: 'database' }
    console.warn(`[OA profile] officeActionProfile for "${code}" failed validation:`,
      parsed.error.errors.slice(0, 5).map(e => `${e.path.join('.')}: ${e.message}`).join('; '))
  }

  // DB copy absent or unusable — fall back to the profile shipped with the app.
  const repo = await loadProfileFromRepo(code)
  if (repo) {
    console.warn(
      `[OA profile] Using the repository profile for "${code}" — the database copy is ${block ? 'invalid' : 'missing'}. ` +
      `Run: npm run oa:sync-profile ${code}`
    )
    return { profile: repo, source: 'repository' }
  }

  const reason = !country
    ? `"${code}" is not an active jurisdiction on this deployment — activate it in the jurisdictions hub, then run: npm run oa:sync-profile ${code}`
    : block
      ? `The office-action profile for "${code}" is present but invalid — re-run: npm run oa:sync-profile ${code}`
      : `"${code}" has no office-action profile on this deployment — run: npm run oa:sync-profile ${code}`
  console.warn(`[OA profile] ${reason}`)
  return { profile: null, source: null, reason }
}

/** Load + validate the officeActionProfile for a jurisdiction. */
export async function loadOfficeActionProfile(jurisdictionCode: string): Promise<OfficeActionProfile | null> {
  return (await loadOfficeActionProfileDetailed(jurisdictionCode)).profile
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
  const loaded = await loadOfficeActionProfileDetailed(input.jurisdictionCode)
  if (!loaded.profile) {
    throw new OaProfileUnavailableError(
      loaded.reason || `No active office-action profile for jurisdiction "${input.jurisdictionCode}"`
    )
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
  /** Fatal: the document could not be parsed at all (route maps this to 422). */
  error?: string
  /** Degraded but usable: e.g. classification fell back to unclassified cards. */
  warning?: string
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

  const loaded = await loadOfficeActionProfileDetailed(oaCase.jurisdictionCode)
  const profile = loaded.profile
  if (!profile) {
    throw new OaProfileUnavailableError(
      loaded.reason || `No office-action profile for "${oaCase.jurisdictionCode}"`
    )
  }

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

    // 3. Classify objections + verify quotes. On classification failure the
    // classifier returns deterministic fallback cards (code OTHER) — the
    // objections are never lost, the run is just degraded.
    const classification = await classifyObjections(
      profile, parseResult.parsed.objections, cleanText,
      { tenantId: actor.tenantId || undefined, userId: actor.userId, requestHeaders: actor.requestHeaders },
      opts.gateway
    )
    const objections = classification.objections
    const unverified = objections.filter(o => !o.quoteVerified).length

    // 4. Persist (document + objections + citations) atomically.
    // Dates from the LLM are guarded — an unparseable date must not fail the ingest.
    const issueIso = safeIsoDate(parseResult.parsed.dateOfReport) || safeIsoDate(parseResult.parsed.dateOfDispatch)
    const issueDate = issueIso ? new Date(`${issueIso}T00:00:00Z`) : null
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
          // officeNumber = the FER's own numbering; the reply letter answers under it.
          analysisJson: (o.rationale || o.officeNumber)
            ? ({ ...(o.rationale ? { rationale: o.rationale } : {}), ...(o.officeNumber ? { officeNumber: o.officeNumber } : {}) } as any)
            : undefined
        }
      })),
      // A cited document with no label cannot be referenced by any objection and
      // cannot be written (label is a required column) — dropping it here beats
      // throwing out of the transaction and failing the whole ingest, which is
      // what an undefined label from the parse used to do.
      ...parseResult.parsed.citedDocuments.filter(c => String(c?.label || '').trim()).map(c => prisma.oaCitation.create({
        data: {
          documentId: doc.id,
          label: String(c.label).trim(),
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
      warning: [
        classification.success
          ? ''
          : `Objections were extracted but could not be auto-classified (${classification.error || 'classification failed'}) — review each card's category.`,
        /**
         * A deadline that could not be computed is the one omission the attorney
         * must not discover by its absence. The trigger date is dropped whenever
         * it does not extract as ISO ("15.03.2026" from an OCR'd PDF), and the
         * ingest then returned 201 with an empty deadline list and nothing said —
         * no strip in the workspace, no statutory clock, on a deemed-abandonment
         * deadline.
         *
         * This used to be guarded on the instrument having been detected — but
         * detection is a literal substring match against the profile's hints, so
         * the case where it fails is exactly the case where no deadline rule can
         * run, and that case said nothing at all. Warn whenever the list is
         * empty, and name which of the two reasons it was.
         */
        deadlines.length === 0
          ? (parseResult.instrument.instrumentId
              ? `No response deadline could be computed — the date of the report was not readable, so the ${profile.meta.office} time limit is NOT being tracked for this document. Check the report date and diarise the deadline yourself.`
              : `This document could not be identified as a communication ${profile.meta.office} issues deadlines for, so NO time limit is being tracked for it. Confirm what it is and diarise the deadline yourself.`)
          : ''
      ].filter(Boolean).join(' ') || undefined
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

  // Recomputed against today, never served as stored: daysRemaining/urgency were
  // frozen at ingest, so a case opened months later reported the days it had
  // left on the day the report was uploaded.
  const allDeadlines: ComputedDeadline[] = refreshDeadlines(
    oaCase.documents.flatMap(d => (d.deadlinesJson as any as ComputedDeadline[]) || [])
  ) as ComputedDeadline[]

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

  // How the as-filed specification is numbered, and whether it survived
  // extraction. Surfaced to the attorney rather than left in a JSON field:
  // a mis-read is the one failure no downstream check can catch, because the
  // citation resolves in our own table and the lint passes. A human spots it
  // in one glance.
  const { analyzeParagraphMarkers, splitParagraphs, assessStructureUsable } = await import('./document-intake')
  const specText = oaCase.specificationText || ''
  const markerAnalysis = analyzeParagraphMarkers(specText)
  const specParagraphs = splitParagraphs(specText, markerAnalysis)

  return {
    case: { ...oaCase, documents },
    deadlines: allDeadlines,
    mostUrgent: mostUrgentDeadline(allDeadlines),
    citedDocuments,
    latestDraft,
    numbering: {
      mode: markerAnalysis.mode,
      confidence: markerAnalysis.confidence,
      reasons: markerAnalysis.reasons,
      firstMarker: markerAnalysis.firstMarker,
      lastMarker: markerAnalysis.lastMarker,
      paragraphCount: specParagraphs.length,
      structureUsable: specText ? assessStructureUsable(specText, specParagraphs) : true
    }
  }
}
