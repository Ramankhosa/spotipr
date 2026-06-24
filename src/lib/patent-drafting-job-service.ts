import { NextRequest } from 'next/server'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { generateJWT } from '@/lib/auth'
import { checkServiceAccess } from '@/lib/org-access-service'
import { isProtectedAIReviewIssue } from '@/lib/ai-review-protection'

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
  claimsText?: string
  claimsHandling?: 'draft from brief' | 'use as is' | 'improve' | 'auto'
  claimsNotes?: string
  priorArtHandling?: 'use only' | 'expand with search' | 'auto'
  claimRemarks?: string
  claimScopeStyle?: string
  figureRemarks?: string
  figureMode?: 'generate' | 'skip'
  figureCount?: number
  illustrativeData?: string
  languageMode?: 'common' | 'individual_english_figures'
  commonLanguage?: string
  figuresLanguage?: string
  languageByJurisdiction?: Record<string, string>
  runReview?: boolean
  projectId?: string
  batchId?: string
  batchItemId?: string
  batchItemNo?: number
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

function sha256(input: Buffer | string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function sanitizeFilename(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 160) || 'patent-draft'
}

function filenameFromDisposition(disposition: string | null, fallback: string) {
  const match = disposition?.match(/filename="?([^"]+)"?/i)
  return sanitizeFilename(match?.[1] || fallback)
}

async function storeExportArtifact(params: {
  jobId: string
  batchId?: string
  batchItemId?: string
  batchItemNo?: number
  user: any
  tenantId: string
  filename: string
  buffer: Buffer
  mimeType: string
}) {
  const scopeDir = params.batchId && params.batchItemId
    ? path.join(process.cwd(), 'uploads', 'auto-patent-batches', params.batchId, params.batchItemId)
    : path.join(process.cwd(), 'uploads', 'patent-drafting-jobs', params.jobId)
  await fs.mkdir(scopeDir, { recursive: true })
  const filePath = path.join(scopeDir, sanitizeFilename(params.filename))
  await fs.writeFile(filePath, params.buffer)

  return prisma.document.create({
    data: {
      tenantId: params.tenantId,
      userId: params.user.id,
      type: 'PATENT_DRAFT_EXPORT',
      filename: sanitizeFilename(params.filename),
      contentPtr: filePath,
      hash: sha256(params.buffer),
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
    }
  })
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

function isDiagramReviewIssue(issue: any) {
  const text = [
    issue?.category,
    issue?.sectionKey,
    issue?.sectionLabel,
    issue?.title,
    issue?.description,
    issue?.suggestion,
    issue?.fix,
    issue?.fixPrompt,
  ].filter(Boolean).join(' ').toLowerCase()
  return /\b(diagram|figure|drawing|sketch|plantuml|briefdescriptionofdrawings|brief description of drawings)\b/.test(text)
}

function draftToSectionMap(draft: any) {
  if (!draft) return {}
  return {
    title: draft.title || '',
    fieldOfInvention: draft.fieldOfInvention || '',
    background: draft.background || '',
    summary: draft.summary || '',
    briefDescriptionOfDrawings: draft.briefDescriptionOfDrawings || '',
    detailedDescription: draft.detailedDescription || '',
    bestMethod: draft.bestMethod || '',
    claims: draft.claims || '',
    abstract: draft.abstract || '',
    industrialApplicability: draft.industrialApplicability || '',
    listOfNumerals: draft.listOfNumerals || '',
    ...((draft.extraSections as any) || {}),
  }
}

async function setActiveDraftingJurisdiction(sessionId: string, jurisdiction: string) {
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { activeJurisdiction: jurisdiction.toUpperCase() } as any,
  })
}

async function getLatestDraftForJurisdiction(sessionId: string, jurisdiction: string) {
  return prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: jurisdiction.toUpperCase() },
    orderBy: { version: 'desc' },
  })
}

async function runAIReviewAndApplyTextFixes(params: {
  user: any
  patentId: string
  sessionId: string
  jurisdiction: string
  maxFixes?: number
}) {
  const review = await invokeDraftingAction({
    user: params.user,
    patentId: params.patentId,
    body: {
      action: 'run_ai_review',
      sessionId: params.sessionId,
      jurisdiction: params.jurisdiction,
    },
  })

  const issues = Array.isArray(review.json?.issues) ? review.json.issues : []
  const fixableIssues = issues
    .filter((issue: any) => issue?.sectionKey && issue.sectionKey !== 'general')
    .filter((issue: any) => issue.status !== 'fixed' && issue.status !== 'ignored')
    .filter((issue: any) => !isProtectedAIReviewIssue(issue))
    .filter((issue: any) => !isDiagramReviewIssue(issue))
    .slice(0, Math.max(1, params.maxFixes || 8))

  let appliedFixes = 0
  for (const issue of fixableIssues) {
    const draft = await getLatestDraftForJurisdiction(params.sessionId, params.jurisdiction)
    const sectionMap = draftToSectionMap(draft)
    const sectionKey = issue.sectionKey
    const currentContent = sectionMap[sectionKey]
    if (!currentContent || typeof currentContent !== 'string') continue

    const relatedContent = Object.fromEntries(Object.entries(sectionMap).filter(([key]) => key !== sectionKey))
    const fix = await invokeDraftingAction({
      user: params.user,
      patentId: params.patentId,
      body: {
        action: 'apply_ai_fix',
        sessionId: params.sessionId,
        jurisdiction: params.jurisdiction,
        sectionKey,
        issue,
        currentContent,
        relatedContent,
      },
    })

    const fixedContent = fix.json?.fixedContent
    if (typeof fixedContent !== 'string' || !fixedContent.trim()) continue

    await setActiveDraftingJurisdiction(params.sessionId, params.jurisdiction)
    await invokeDraftingAction({
      user: params.user,
      patentId: params.patentId,
      body: {
        action: 'save_sections',
        sessionId: params.sessionId,
        patch: { [sectionKey]: fixedContent },
      },
    })
    appliedFixes += 1
  }

  if (appliedFixes > 0) {
    await invokeDraftingAction({
      user: params.user,
      patentId: params.patentId,
      body: {
        action: 'run_ai_review',
        sessionId: params.sessionId,
        jurisdiction: params.jurisdiction,
      },
    })
  }

  return { issueCount: issues.length, appliedFixes }
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
  const pipelineWarnings: string[] = []

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
    const claimsText = normalizeText(payload.claimsText)
    const claimsHandling = payload.claimsHandling || (claimsText ? 'improve' : 'draft from brief')
    const claimRemarks = [
      normalizeText(payload.claimRemarks),
      normalizeText(payload.claimsNotes),
      normalizeText(payload.novelty) ? `Draft claims around this novelty contribution:\n${normalizeText(payload.novelty)}` : '',
      claimsHandling === 'improve' && claimsText
        ? `Improve the following draft claims without entering claim-refinement mode:\n\n${claimsText}`
        : '',
    ].filter(Boolean).join('\n\n')

    let claimsHtml = claimsText
    if (claimsText) {
      await invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: { action: 'save_claims', sessionId, claims: claimsText },
      })
    }

    if (!(claimsHandling === 'use as is' && claimsText)) {
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
      claimsHtml = claims.json?.claimsHtml
    }

    await invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'freeze_claims',
        sessionId,
        claims: claimsHtml,
        jurisdiction: activeJurisdiction,
        skipPriorArt: true,
        useInitialClaimsForDrafting: true,
      },
    })
    session = await loadSession(sessionId)
  }

  await setStep(job.id, workerId, 'PRIOR_ART_REVIEW')
  const priorArtText = buildPriorArtText(payload)
  const priorArtHandling = payload.priorArtHandling || (priorArtText ? 'use only' : 'auto')
  let selectedPatents = normalizePriorArtEntries(payload)
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
  if (priorArtHandling !== 'use only') {
    try {
      const searchResult = await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: {
          action: 'related_art_search',
          sessionId,
          limit: 5,
        },
      }))
      const searchSelections = Array.isArray(searchResult.json?.results) ? searchResult.json.results.slice(0, 5) : []
      if (searchSelections.length) {
        selectedPatents = [...selectedPatents, ...searchSelections]
        await invokeDraftingAction({
          user,
          patentId: job.patentId,
          body: {
            action: 'related_art_select',
            sessionId,
            runId: searchResult.json?.runId,
            selections: searchSelections,
          },
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prior art search failed'
      pipelineWarnings.push(`Prior art search: ${message}`)
    }
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
        literatureReviewInstructions: normalizeText(payload.literatureReview?.instructions || payload.priorArtReview?.instructions),
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
  const illustrativeData = normalizeText(payload.illustrativeData)
  if (illustrativeData) {
    const existingDdData = await prisma.dDUserData.findUnique({ where: { sessionId } })
    if (existingDdData) {
      await prisma.dDUserData.update({
        where: { sessionId },
        data: { userData: illustrativeData, updatedBy: user.id }
      })
    } else {
      await prisma.dDUserData.create({
        data: {
          sessionId,
          userData: illustrativeData,
          createdBy: user.id,
          updatedBy: user.id
        }
      })
    }
  }
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
    for (const jurisdiction of jurisdictions) {
      try {
        await setActiveDraftingJurisdiction(sessionId, jurisdiction)
        const reviewResult = await withHeartbeat(job.id, workerId, () => runAIReviewAndApplyTextFixes({
          user,
          patentId: job.patentId,
          sessionId,
          jurisdiction,
        }))
        if (reviewResult.appliedFixes > 0) {
          pipelineWarnings.push(`${jurisdiction}: Applied ${reviewResult.appliedFixes} AI text fix(es).`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI review failed'
        pipelineWarnings.push(`${jurisdiction}: ${message}`)
      }
    }
  }

  await setStep(job.id, workerId, 'EXPORT')
  const artifacts: any[] = []
  for (const jurisdiction of jurisdictions) {
    await setActiveDraftingJurisdiction(sessionId, jurisdiction)
    const safeTitle = sanitizeFilename(payload.title || 'patent-draft')
    const docxExport = await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'export_docx',
        sessionId,
        jurisdiction,
      },
    }))
    const docxBuffer = Buffer.from(await docxExport.response.arrayBuffer())
    const docxFilename = filenameFromDisposition(
      docxExport.response.headers.get('content-disposition'),
      `${safeTitle}_${jurisdiction}.docx`
    )
    artifacts.push(await storeExportArtifact({
      jobId: job.id,
      batchId: payload.batchId,
      batchItemId: payload.batchItemId,
      batchItemNo: payload.batchItemNo,
      user,
      tenantId: user.tenantId,
      filename: `${jurisdiction}_${docxFilename}`,
      buffer: docxBuffer,
      mimeType: docxExport.response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }))

    try {
      const pdfExport = await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: {
          action: 'export_pdf',
          sessionId,
          jurisdiction,
        },
      }))
      const pdfContentType = pdfExport.response.headers.get('content-type') || ''
      if (pdfContentType.includes('pdf') || pdfContentType.includes('octet-stream')) {
        const pdfBuffer = Buffer.from(await pdfExport.response.arrayBuffer())
        const pdfFilename = filenameFromDisposition(
          pdfExport.response.headers.get('content-disposition'),
          `${safeTitle}_${jurisdiction}.pdf`
        )
        artifacts.push(await storeExportArtifact({
          jobId: job.id,
          batchId: payload.batchId,
          batchItemId: payload.batchItemId,
          batchItemNo: payload.batchItemNo,
          user,
          tenantId: user.tenantId,
          filename: `${jurisdiction}_${pdfFilename}`,
          buffer: pdfBuffer,
          mimeType: pdfContentType,
        }))
      } else {
        pipelineWarnings.push(`${jurisdiction}: PDF export is not available in the current runtime. DOCX was generated successfully.`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF export failed'
      pipelineWarnings.push(`${jurisdiction}: ${message}`)
    }
  }

  await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'set_stage', sessionId, stage: 'COMPLETED' } })
  session = await loadSession(sessionId)

  return {
    sessionId,
    patentId: job.patentId,
    jurisdictions,
    activeJurisdiction,
    artifactIds: artifacts.map(artifact => artifact.id),
    warnings: pipelineWarnings,
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
      autoPatentDraftBatchId: params.payload.batchId || null,
      autoPatentDraftBatchItemId: params.payload.batchItemId || null,
      autoPatentDraftBatchItemNo: params.payload.batchItemNo || null,
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
    const completedJob = await (prisma as any).patentDraftingJob.findUnique({ where: { id: job.id } })
    if (completedJob?.autoPatentDraftBatchId) {
      const { refreshAutoPatentDraftBatch } = await import('@/lib/auto-patent-draft-batch-service')
      await refreshAutoPatentDraftBatch(completedJob.autoPatentDraftBatchId)
    }
    return completedJob
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
    if (freshJob.autoPatentDraftBatchId) {
      const { refreshAutoPatentDraftBatch } = await import('@/lib/auto-patent-draft-batch-service')
      await refreshAutoPatentDraftBatch(freshJob.autoPatentDraftBatchId)
    }
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
  const { refreshReadyAutoPatentDraftBatches } = await import('@/lib/auto-patent-draft-batch-service')
  await refreshReadyAutoPatentDraftBatches()
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
