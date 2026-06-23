import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateJWT } from '@/lib/auth'
import { checkServiceAccess } from '@/lib/org-access-service'
import { upsertUserInstruction } from '@/lib/user-instruction-service'

const LOCK_MINUTES = Math.max(5, Number(process.env.PATENT_DRAFTING_LOCK_MINUTES || 45))
const DEFAULT_JURISDICTION = 'IN'

type JsonRecord = Record<string, any>

export type PatentDraftingAutomationPayload = {
  sessionId?: string
  title: string
  ideaDetails?: string | JsonRecord
  rawIdea?: string
  novelty?: string
  jurisdictions?: string[]
  activeJurisdiction?: string
  filingType?: string
  allowRefine?: boolean
  areaOfInvention?: string
  literatureReview?: {
    instructions?: string
    content?: string
    priorArtEntries?: any[]
  }
  priorArtReview?: {
    instructions?: string
    content?: string
    entries?: any[]
  }
  claimRemarks?: string
  claimScopeStyle?: string
  figureRemarks?: string
  figureMode?: 'generate' | 'skip'
  figureCount?: number
  draftingRemarks?: string | Record<string, string>
  languageMode?: 'common' | 'individual_english_figures'
  commonLanguage?: string
  figuresLanguage?: string
  languageByJurisdiction?: Record<string, string>
  runReview?: boolean
}

class PatentDraftingJobLeaseLostError extends Error {
  constructor() {
    super('Patent drafting job was cancelled or its worker lease was lost')
    this.name = 'PatentDraftingJobLeaseLostError'
  }
}

function lockExpiry() {
  return new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
}

function retryDelay(attempt: number) {
  const delays = [60_000, 5 * 60_000, 15 * 60_000]
  return delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)]
}

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim() : ''
}

function normalizeJurisdictions(payload: PatentDraftingAutomationPayload) {
  const source = Array.isArray(payload.jurisdictions) && payload.jurisdictions.length
    ? payload.jurisdictions
    : [payload.activeJurisdiction || DEFAULT_JURISDICTION]
  const list = Array.from(new Set(source.map(code => String(code || '').trim().toUpperCase()).filter(Boolean)))
  return list.length ? list : [DEFAULT_JURISDICTION]
}

function stringifyIdeaDetails(value: unknown) {
  if (!value) return ''
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value !== 'object' || Array.isArray(value)) return String(value)
  const entries = Object.entries(value as JsonRecord)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim())
    .map(([key, v]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
  return entries.join('\n')
}

export function buildAutomationIdeaText(payload: PatentDraftingAutomationPayload) {
  const parts = [
    `Title: ${payload.title}`,
    normalizeText(payload.rawIdea),
    stringifyIdeaDetails(payload.ideaDetails),
    normalizeText(payload.novelty) ? `Novelty / inventive contribution:\n${normalizeText(payload.novelty)}` : '',
  ].filter(Boolean)
  return parts.join('\n\n').trim()
}

function hasIdeaDisclosure(payload: PatentDraftingAutomationPayload) {
  return !![
    normalizeText(payload.rawIdea),
    stringifyIdeaDetails(payload.ideaDetails),
    normalizeText(payload.novelty),
  ].find(Boolean)
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function normalizePriorArtEntries(payload: PatentDraftingAutomationPayload) {
  const entries = [
    ...(Array.isArray(payload.literatureReview?.priorArtEntries) ? payload.literatureReview!.priorArtEntries! : []),
    ...(Array.isArray(payload.priorArtReview?.entries) ? payload.priorArtReview!.entries! : []),
  ]

  return entries.map((entry, index) => {
    const raw = entry && typeof entry === 'object' ? entry : { snippet: String(entry || '') }
    const patentNumber = String(
      raw.patentNumber ||
      raw.publicationNumber ||
      raw.publication_number ||
      raw.reference ||
      raw.id ||
      `LIT-${index + 1}`
    ).trim()
    return {
      ...raw,
      patentNumber,
      title: raw.title || raw.name || `Literature review reference ${index + 1}`,
      snippet: raw.snippet || raw.summary || raw.abstract || raw.content || '',
      userNotes: raw.userNotes || raw.notes || raw.analysis || '',
    }
  })
}

function buildPriorArtText(payload: PatentDraftingAutomationPayload) {
  const reviewInstructions = normalizeText(payload.literatureReview?.instructions || payload.priorArtReview?.instructions)
  const reviewContent = normalizeText(payload.literatureReview?.content || payload.priorArtReview?.content)
  const entries = normalizePriorArtEntries(payload)
  const entryText = entries.length
    ? entries.map((entry, index) => [
        `Reference ${index + 1}: ${entry.patentNumber}`,
        entry.title ? `Title: ${entry.title}` : '',
        entry.snippet ? `Summary: ${entry.snippet}` : '',
        entry.userNotes ? `Review remarks: ${entry.userNotes}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')
    : ''

  return [
    reviewInstructions ? `Literature review instructions:\n${reviewInstructions}` : '',
    reviewContent ? `Literature review content:\n${reviewContent}` : '',
    entryText,
  ].filter(Boolean).join('\n\n').trim()
}

function buildDraftingRemarksForSection(payload: PatentDraftingAutomationPayload, section: string) {
  const remarks = payload.draftingRemarks
  if (!remarks) return ''
  if (typeof remarks === 'string') return remarks.trim()
  return normalizeText(remarks[section] || remarks.all || remarks['*'])
}

function buildInternalUserJwt(user: any) {
  return generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  })
}

async function invokeDraftingAction(params: {
  user: any
  patentId: string
  body: Record<string, unknown>
}) {
  const routeModule = await import('@/app/api/patents/[patentId]/drafting/route')
  const token = buildInternalUserJwt(params.user)
  const request = new NextRequest(`http://local/api/patents/${params.patentId}/drafting`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(params.body),
  })

  const response = await routeModule.POST(request, { params: { patentId: params.patentId } })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const errorBody = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : { error: await response.text().catch(() => 'Unknown drafting error') }
    throw Object.assign(new Error(errorBody.error || errorBody.message || 'Drafting action failed'), {
      status: response.status,
      body: errorBody,
    })
  }

  if (contentType.includes('application/json')) {
    return { response, json: await response.json() }
  }
  return { response, json: null as any }
}

async function setStep(jobId: string, workerId: string, currentStep: string) {
  const updated = await (prisma as any).patentDraftingJob.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: { currentStep, heartbeatAt: new Date(), lockedUntil: lockExpiry() },
  })
  if (updated.count !== 1) throw new PatentDraftingJobLeaseLostError()
}

async function heartbeat(jobId: string, workerId: string) {
  await (prisma as any).patentDraftingJob.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: { heartbeatAt: new Date(), lockedUntil: lockExpiry() },
  })
}

async function withHeartbeat<T>(jobId: string, workerId: string, work: () => Promise<T>) {
  const timer = setInterval(() => void heartbeat(jobId, workerId).catch(() => undefined), 60_000)
  try {
    return await work()
  } finally {
    clearInterval(timer)
  }
}

async function loadSession(sessionId: string) {
  return prisma.draftingSession.findUnique({
    where: { id: sessionId },
    include: {
      ideaRecord: true,
      referenceMap: true,
      figurePlans: true,
      diagramSources: true,
      annexureDrafts: { orderBy: { version: 'desc' } },
    },
  })
}

function getNormalizedData(session: any) {
  return (session?.ideaRecord?.normalizedData || {}) as JsonRecord
}

function getIdeaComponents(session: any) {
  const normalized = getNormalizedData(session)
  if (Array.isArray(normalized.components) && normalized.components.length) return normalized.components
  if (Array.isArray(session?.ideaRecord?.components) && session.ideaRecord.components.length) return session.ideaRecord.components
  return []
}

function hasFrozenClaims(session: any) {
  const normalized = getNormalizedData(session)
  return !!(normalized.claimsApprovedAt || normalized.claimsFinal)
}

function hasGeneratedDraft(session: any, jurisdiction: string) {
  return (session?.annexureDrafts || []).some((draft: any) =>
    draft.jurisdiction === jurisdiction &&
    (draft.detailedDescription || draft.claims || draft.fullDraftText)
  )
}

async function persistAutomationInstructions(user: any, sessionId: string, payload: PatentDraftingAutomationPayload) {
  const priorArtInstruction = normalizeText(payload.literatureReview?.instructions || payload.priorArtReview?.instructions)
  if (priorArtInstruction) {
    await upsertUserInstruction({
      sessionId,
      userId: user.id,
      jurisdiction: '*',
      sectionKey: 'background',
      instruction: priorArtInstruction,
      isPersistent: false,
    })
  }

  const figureRemarks = normalizeText(payload.figureRemarks)
  if (figureRemarks) {
    for (const sectionKey of ['briefDescriptionOfDrawings', 'detailedDescription']) {
      await upsertUserInstruction({
        sessionId,
        userId: user.id,
        jurisdiction: '*',
        sectionKey,
        instruction: figureRemarks,
        isPersistent: false,
      })
    }
  }

  const coreSections = [
    'title',
    'fieldOfInvention',
    'background',
    'summary',
    'detailedDescription',
    'claims',
    'abstract',
  ]
  for (const sectionKey of coreSections) {
    const instruction = buildDraftingRemarksForSection(payload, sectionKey)
    if (!instruction) continue
    await upsertUserInstruction({
      sessionId,
      userId: user.id,
      jurisdiction: '*',
      sectionKey,
      instruction,
      isPersistent: false,
    })
  }
}

async function ensureSession(job: any, user: any, payload: PatentDraftingAutomationPayload) {
  if (job.sessionId) {
    const existing = await prisma.draftingSession.findFirst({
      where: { id: job.sessionId, patentId: job.patentId, userId: user.id },
    })
    if (existing) return existing.id
  }

  if (payload.sessionId) {
    const supplied = await prisma.draftingSession.findFirst({
      where: { id: payload.sessionId, patentId: job.patentId, userId: user.id },
    })
    if (!supplied) throw new Error('Supplied drafting session not found or access denied')
    await (prisma as any).patentDraftingJob.update({ where: { id: job.id }, data: { sessionId: supplied.id } })
    return supplied.id
  }

  const start = await invokeDraftingAction({
    user,
    patentId: job.patentId,
    body: { action: 'start_session' },
  })
  const sessionId = start.json?.session?.id
  if (!sessionId) throw new Error('Failed to create drafting session')
  await (prisma as any).patentDraftingJob.update({ where: { id: job.id }, data: { sessionId } })
  return sessionId
}

async function runPipeline(job: any, workerId: string) {
  const payload = job.payload as PatentDraftingAutomationPayload
  const user = await prisma.user.findUnique({ where: { id: job.userId }, include: { tenant: true } })
  if (!user || !user.tenantId) throw new Error('Draft owner or tenant is unavailable')

  const access = await checkServiceAccess(user.id, user.tenantId, 'PATENT_DRAFTING')
  if (!access.allowed) throw new Error(access.reason || 'Patent drafting access is no longer available')

  const jurisdictions = normalizeJurisdictions(payload)
  const activeJurisdiction = (payload.activeJurisdiction || jurisdictions[0] || DEFAULT_JURISDICTION).toUpperCase()
  const languageByJurisdiction = payload.languageByJurisdiction || Object.fromEntries(jurisdictions.map(code => [code, 'en']))

  await setStep(job.id, workerId, 'INITIALIZING')
  const sessionId = await ensureSession(job, user, payload)

  await invokeDraftingAction({
    user,
    patentId: job.patentId,
    body: {
      action: 'set_stage',
      sessionId,
      stage: 'IDEA_ENTRY',
      draftingJurisdictions: jurisdictions,
      activeJurisdiction,
      languageMode: payload.languageMode || 'common',
      languageByJurisdiction,
      figuresLanguage: payload.figuresLanguage || payload.commonLanguage || 'en',
      commonLanguage: payload.commonLanguage || 'en',
    },
  })

  await persistAutomationInstructions(user, sessionId, payload)

  let session = await loadSession(sessionId)
  if (!session?.ideaRecord) {
    await setStep(job.id, workerId, 'NORMALIZING')
    const ideaText = buildAutomationIdeaText(payload)
    if (!ideaText || !payload.title?.trim()) throw new Error('Title and idea details are required')
    await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'normalize_idea',
        sessionId,
        rawIdea: ideaText,
        title: payload.title,
        areaOfInvention: payload.areaOfInvention,
        allowRefine: payload.allowRefine !== false,
      },
    }))
    session = await loadSession(sessionId)
  }

  if (!hasFrozenClaims(session)) {
    await setStep(job.id, workerId, 'CLAIMS')
    const claimRemarks = [
      normalizeText(payload.claimRemarks),
      normalizeText(payload.novelty) ? `Draft claims around this novelty contribution:\n${normalizeText(payload.novelty)}` : '',
      buildDraftingRemarksForSection(payload, 'claims'),
    ].filter(Boolean).join('\n\n')

    const claims = await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'generate_claims',
        sessionId,
        jurisdiction: activeJurisdiction,
        userClaimRemarks: claimRemarks,
        claimScopeStyle: payload.claimScopeStyle,
        acceptPersonaWarnings: true,
      },
    }))

    await invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'freeze_claims',
        sessionId,
        claims: claims.json?.claimsHtml,
        jurisdiction: activeJurisdiction,
        skipPriorArt: true,
        useInitialClaimsForDrafting: true,
      },
    })
    session = await loadSession(sessionId)
  }

  await setStep(job.id, workerId, 'PRIOR_ART_REVIEW')
  const priorArtText = buildPriorArtText(payload)
  const selectedPatents = normalizePriorArtEntries(payload)
  if (priorArtText) {
    await invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'save_manual_prior_art',
        sessionId,
        manualPriorArt: {
          text: priorArtText,
          manualPriorArtText: priorArtText,
          source: 'patent_drafting_automation',
        },
      },
    })
  }
  await invokeDraftingAction({
    user,
    patentId: job.patentId,
    body: {
      action: 'save_prior_art_config',
      sessionId,
      priorArtConfig: {
        mode: selectedPatents.length ? 'selected' : (priorArtText ? 'manual' : 'none'),
        selectedPatents,
        manualText: priorArtText,
      },
      skipClaimRefinement: true,
    },
  })

  await setStep(job.id, workerId, 'COMPONENTS')
  await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'proceed_to_components', sessionId } })
  session = await loadSession(sessionId)
  const components = getIdeaComponents(session)
  if (components.length) {
    await invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'update_component_map',
        sessionId,
        components,
        autoAssign: true,
      },
    })
  }

  await setStep(job.id, workerId, 'FIGURES')
  session = await loadSession(sessionId)
  const hasDiagram = (session?.diagramSources || []).some((source: any) => String(source.plantumlCode || '').trim())
  if (payload.figureMode === 'skip') {
    await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'skip_figures', sessionId } })
  } else if (!hasDiagram) {
    await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'plan_and_generate_diagrams_llm',
        sessionId,
        figureCount: payload.figureCount,
        figureRemarks: payload.figureRemarks,
      },
    }))
  }

  await setStep(job.id, workerId, 'DRAFTING')
  session = await loadSession(sessionId)
  if (jurisdictions.length > 1) {
    const hasReferenceDraft = hasGeneratedDraft(session, 'REFERENCE')
    if (!hasReferenceDraft) {
      await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: { action: 'generate_reference_draft', sessionId, acceptPersonaWarnings: true },
      }))
    }
    for (const jurisdiction of jurisdictions) {
      session = await loadSession(sessionId)
      if (hasGeneratedDraft(session, jurisdiction)) continue
      await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: {
          action: 'translate_to_jurisdiction',
          sessionId,
          targetJurisdiction: jurisdiction,
          targetLanguage: languageByJurisdiction[jurisdiction] || 'en',
        },
      }))
    }
  } else if (!hasGeneratedDraft(session, activeJurisdiction)) {
    await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'generate_draft',
        sessionId,
        jurisdiction: activeJurisdiction,
        filingType: payload.filingType || 'utility',
        acceptPersonaWarnings: true,
      },
    }))
  }

  if (payload.runReview) {
    await setStep(job.id, workerId, 'REVIEW')
    try {
      await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: { action: 'run_ai_review', sessionId, jurisdiction: activeJurisdiction },
      }))
    } catch (error) {
      console.warn('[PatentDraftingJob] AI review failed; completing draft with warning:', error)
    }
  }

  await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'set_stage', sessionId, stage: 'COMPLETED' } })
  session = await loadSession(sessionId)

  return {
    sessionId,
    patentId: job.patentId,
    jurisdictions,
    activeJurisdiction,
    draftIds: (session?.annexureDrafts || []).map((draft: any) => draft.id),
  }
}

export async function enqueuePatentDraftingJob(params: {
  patentId: string
  userId: string
  payload: PatentDraftingAutomationPayload
}) {
  const user = await prisma.user.findUnique({ where: { id: params.userId }, include: { tenant: true } })
  if (!user || !user.tenantId) throw new Error('User or tenant not found')

  const access = await checkServiceAccess(user.id, user.tenantId, 'PATENT_DRAFTING')
  if (!access.allowed) throw new Error(access.reason || 'Patent drafting access denied')

  const patent = await prisma.patent.findFirst({
    where: {
      id: params.patentId,
      OR: [
        { createdBy: user.id },
        { project: { OR: [{ userId: user.id }, { collaborators: { some: { userId: user.id } } }] } },
      ],
    },
    select: { id: true },
  })
  if (!patent) throw new Error('Patent not found or access denied')

  if (!normalizeText(params.payload.title)) throw new Error('Title is required')
  if (!hasIdeaDisclosure(params.payload)) throw new Error('Idea details, raw idea text, or novelty details are required')

  return (prisma as any).patentDraftingJob.create({
    data: {
      patentId: params.patentId,
      userId: user.id,
      sessionId: params.payload.sessionId || null,
      status: 'QUEUED',
      currentStep: 'QUEUED',
      payload: jsonSafe({
        ...params.payload,
        title: params.payload.title.trim(),
        jurisdictions: normalizeJurisdictions(params.payload),
      }),
    },
  })
}

export async function claimNextPatentDraftingJob(workerId: string) {
  const now = new Date()
  const candidates = await (prisma as any).patentDraftingJob.findMany({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: 10,
  })

  for (const candidate of candidates) {
    const claimed = await (prisma as any).patentDraftingJob.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['QUEUED', 'PROCESSING'] },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      },
      data: {
        status: 'PROCESSING',
        lockedBy: workerId,
        lockedUntil: lockExpiry(),
        heartbeatAt: now,
        startedAt: candidate.startedAt || now,
        lastError: null,
      },
    })
    if (claimed.count === 1) {
      return (prisma as any).patentDraftingJob.findUnique({ where: { id: candidate.id } })
    }
  }
  return null
}

export async function processPatentDraftingJob(job: any, workerId: string) {
  try {
    const result = await runPipeline(job, workerId)
    const completed = await (prisma as any).patentDraftingJob.updateMany({
      where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: 'COMPLETED',
        currentStep: 'COMPLETED',
        completedAt: new Date(),
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: new Date(),
        lastError: null,
        result,
      },
    })
    if (completed.count !== 1) return null
    return (prisma as any).patentDraftingJob.findUnique({ where: { id: job.id } })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Patent drafting job failed'
    const freshJob = await (prisma as any).patentDraftingJob.findUnique({ where: { id: job.id } })
    if (!freshJob) throw error
    if (freshJob.status === 'CANCELLED') return null
    if (freshJob.status !== 'PROCESSING' || freshJob.lockedBy !== workerId) return null

    const attempt = freshJob.attemptCount + 1
    const exhausted = attempt >= freshJob.maxAttempts
    await (prisma as any).patentDraftingJob.updateMany({
      where: { id: freshJob.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: exhausted ? 'FAILED' : 'QUEUED',
        attemptCount: attempt,
        nextAttemptAt: exhausted ? freshJob.nextAttemptAt : new Date(Date.now() + retryDelay(attempt)),
        lastError: message.slice(0, 2000),
        lockedBy: null,
        lockedUntil: null,
      },
    })
    return null
  }
}

export async function processPendingPatentDraftingJobs(workerId = `drafting-worker-${process.pid}`, limit = 1) {
  const processed: any[] = []
  for (let index = 0; index < Math.max(1, limit); index += 1) {
    const job = await claimNextPatentDraftingJob(workerId)
    if (!job) break
    processed.push(await processPatentDraftingJob(job, workerId))
  }
  return processed
}

export async function cancelPatentDraftingJob(jobId: string, userId: string, patentId?: string) {
  const job = await (prisma as any).patentDraftingJob.findFirst({
    where: { id: jobId, userId, ...(patentId ? { patentId } : {}) },
    select: { id: true, status: true },
  })
  if (!job) return { outcome: 'not_found' as const }
  if (job.status === 'CANCELLED') return { outcome: 'cancelled' as const, jobId, status: 'CANCELLED' as const }
  if (!['QUEUED', 'PROCESSING'].includes(job.status)) {
    return { outcome: 'not_cancellable' as const, status: job.status }
  }

  const cancelledAt = new Date()
  const updated = await (prisma as any).patentDraftingJob.updateMany({
    where: { id: job.id, status: { in: ['QUEUED', 'PROCESSING'] } },
    data: {
      status: 'CANCELLED',
      currentStep: 'CANCELLED',
      cancelledAt,
      cancelledById: userId,
      lockedBy: null,
      lockedUntil: null,
      lastError: null,
    },
  })
  if (updated.count === 1) return { outcome: 'cancelled' as const, jobId, status: 'CANCELLED' as const }
  const current = await (prisma as any).patentDraftingJob.findUnique({ where: { id: job.id }, select: { status: true } })
  return current?.status === 'CANCELLED'
    ? { outcome: 'cancelled' as const, jobId, status: 'CANCELLED' as const }
    : { outcome: 'not_cancellable' as const, status: current?.status || 'UNKNOWN' }
}

export async function requeuePatentDraftingJob(jobId: string, userId: string, patentId?: string) {
  const job = await (prisma as any).patentDraftingJob.findFirst({
    where: { id: jobId, userId, ...(patentId ? { patentId } : {}) },
  })
  if (!job || job.status !== 'FAILED') return null
  return (prisma as any).patentDraftingJob.update({
    where: { id: job.id },
    data: {
      status: 'QUEUED',
      currentStep: 'QUEUED',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      lockedBy: null,
      lockedUntil: null,
      completedAt: null,
    },
  })
}
