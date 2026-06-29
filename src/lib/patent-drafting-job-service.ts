import { NextRequest } from 'next/server'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { generateJWT } from '@/lib/auth'
import { checkServiceAccess } from '@/lib/org-access-service'
import { isProtectedAIReviewIssue } from '@/lib/ai-review-protection'
import { renderPlantUml } from '@/lib/plantuml-renderer'

const LOCK_MINUTES = Math.max(5, Number(process.env.PATENT_DRAFTING_LOCK_MINUTES || 45))
const DEFAULT_JURISDICTION = 'IN'
const BATCH_PRIOR_ART_PROVIDER_IDS = ['indian-corpus', 'pqai-corpus']
const BATCH_PRIOR_ART_LIMIT = 5

const DRAFTING_ACTION_STAGE_LABELS: Record<string, string> = {
  normalize_idea: 'DRAFT_IDEA_ENTRY',
  generate_claims: 'CLAIM_GENERATION',
  related_art_llm_review: 'RELATED_ART_LLM_REVIEW',
  plan_and_generate_diagrams_llm: 'DIAGRAM_GENERATION',
  generate_sections: 'SECTION_DRAFTING',
  ai_review: 'AI_REVIEW',
  apply_ai_fix: 'AI_REVIEW_FIX',
}

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
  skipQualityGate?: boolean
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
    normalizeText(payload.title) ? `Title: ${normalizeText(payload.title)}` : '',
    normalizeText(payload.rawIdea) || stringifyIdeaDetails(payload.ideaDetails),
    normalizeText(payload.novelty) ? `Novelty / inventive contribution:\n${normalizeText(payload.novelty)}` : '',
  ].filter(Boolean)
  return parts.join('\n\n').trim()
}

export function validateAutomationPayloadForPipeline(payload: PatentDraftingAutomationPayload) {
  const jurisdictions = normalizeJurisdictions(payload)
  const suppliedClaimsText = normalizeText(payload.claimsText)
  const claimsHandling = payload.claimsHandling || (suppliedClaimsText ? 'improve' : 'draft from brief')
  if (jurisdictions.length > 1 && !(claimsHandling === 'use as is' && suppliedClaimsText)) {
    throw new Error(
      'Multi-jurisdiction automated drafting requires caller-supplied claims with claimsHandling="use as is" until per-jurisdiction claim freezing is supported.'
    )
  }
  return { jurisdictions, suppliedClaimsText, claimsHandling }
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

function mimeTypeForFilename(filename: string) {
  const ext = path.extname(filename).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.svg') return 'image/svg+xml'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.puml' || ext === '.plantuml' || ext === '.txt') return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function extensionForContentType(contentType: string) {
  if (contentType.includes('svg')) return '.svg'
  if (contentType.includes('png')) return '.png'
  return ''
}

function isDocxEmbeddableRaster(filenameOrPath?: string | null) {
  const ext = path.extname(String(filenameOrPath || '')).toLowerCase()
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg'
}

function localFileCandidates(params: { rawPath?: string | null; filename?: string | null; patentId?: string | null }) {
  const candidates: string[] = []
  const rawPath = String(params.rawPath || '').trim()
  const filename = String(params.filename || '').trim()

  if (rawPath) {
    candidates.push(path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath.replace(/^[/\\]+/, '')))
    if (rawPath.startsWith('/uploads/')) {
      candidates.push(path.join(process.cwd(), 'public', rawPath.replace(/^[/\\]+/, '')))
    }
  }

  if (filename && params.patentId) {
    candidates.push(path.join(process.cwd(), 'uploads', 'patents', params.patentId, 'figures', filename))
    candidates.push(path.join(process.cwd(), 'public', 'uploads', 'patents', params.patentId, 'figures', filename))
  }

  return Array.from(new Set(candidates))
}

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate)
    } catch {
      // Try the next likely storage path.
    }
  }
  return null
}

async function renderDiagramSourceToFile(params: {
  source: any
  job: any
  format: 'png' | 'svg'
  persistOnSource?: boolean
}) {
  const code = String(params.source?.plantumlCode || '').trim()
  if (!code) return null

  const rendered = await renderPlantUml(code, params.format)
  const language = String(params.source.language || 'en').trim().toLowerCase() || 'en'
  const suffix = language !== 'en' ? `_${language}` : ''
  const filename = `figure_${params.source.figureNo}${suffix}_${Date.now()}.${params.format}`
  const baseDir = path.join(process.cwd(), 'uploads', 'patents', params.job.patentId, 'figures')
  await fs.mkdir(baseDir, { recursive: true })
  const imagePath = path.join(baseDir, filename)
  await fs.writeFile(imagePath, rendered.buffer)

  if (params.persistOnSource) {
    await prisma.diagramSource.update({
      where: {
        sessionId_figureNo_language: {
          sessionId: params.source.sessionId,
          figureNo: params.source.figureNo,
          language,
        }
      },
      data: {
        imageFilename: filename,
        imagePath,
        imageChecksum: rendered.checksum,
        imageUploadedAt: new Date(),
      }
    })
  }

  return {
    filename,
    imagePath,
    buffer: rendered.buffer,
    contentType: rendered.contentType,
  }
}

async function ensureRenderedDiagramImages(params: { job: any; session: any }) {
  let renderedCount = 0
  const errors: string[] = []

  for (const info of figureArtifactInfos(params.session)) {
    const existing = await readFirstExistingFile(localFileCandidates({
      rawPath: info.source.imagePath,
      filename: info.source.imageFilename,
      patentId: params.job.patentId,
    }))
    const existingName = info.source.imageFilename || info.source.imagePath
    if (existing && isDocxEmbeddableRaster(existingName)) continue

    try {
      await renderDiagramSourceToFile({
        source: info.source,
        job: params.job,
        format: 'png',
        persistOnSource: true,
      })
      renderedCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'render failed'
      errors.push(`FIG. ${info.finalNo}: ${message}`)
    }
  }

  return { renderedCount, errors }
}

function figureArtifactInfos(session: any) {
  const plans: any[] = Array.isArray(session?.figurePlans) ? session.figurePlans : []
  const sources: any[] = Array.isArray(session?.diagramSources) ? session.diagramSources : []
  const sequence: any[] = Array.isArray(session?.figureSequence) ? session.figureSequence : []
  const plansById = new Map<string, any>(plans.map((plan: any) => [plan.id, plan]))
  const plansByFigureNo = new Map<number, any>(plans.map((plan: any) => [Number(plan.figureNo), plan]))
  const finalNoByFigureNo = new Map<number, number>()

  if (session?.figureSequenceFinalized && sequence.length) {
    for (const item of sequence) {
      if (item?.type !== 'diagram') continue
      const plan = plansById.get(item.sourceId)
      const originalNo = Number(plan?.figureNo || item.figureNo)
      const finalNo = Number(item.finalFigNo || item.figureNo || originalNo)
      if (Number.isFinite(originalNo) && Number.isFinite(finalNo)) {
        finalNoByFigureNo.set(originalNo, finalNo)
      }
    }
  }

  return sources
    .filter((source: any) => String(source?.plantumlCode || '').trim())
    .map((source: any) => {
      const originalNo = Number(source.figureNo)
      const finalNo = finalNoByFigureNo.get(originalNo) || originalNo
      const plan = plansByFigureNo.get(originalNo)
      return {
        source,
        originalNo,
        finalNo,
        title: sanitizeFilename(plan?.title || `Figure ${finalNo}`),
        language: String(source.language || 'en').trim().toLowerCase() || 'en',
      }
    })
    .sort((a: any, b: any) => a.finalNo - b.finalNo || a.language.localeCompare(b.language))
}

async function storeBatchFigureArtifacts(params: {
  job: any
  payload: PatentDraftingAutomationPayload
  user: any
  tenantId: string
  session: any
}) {
  const artifacts: any[] = []
  let renderedImageCount = 0

  for (const info of figureArtifactInfos(params.session)) {
    const figurePrefix = `FIG-${String(info.finalNo).padStart(2, '0')}${info.language !== 'en' ? `_${info.language}` : ''}`
    let imageBuffer = await readFirstExistingFile(localFileCandidates({
      rawPath: info.source.imagePath,
      filename: info.source.imageFilename,
      patentId: params.job.patentId,
    }))
    let sourceFilename = info.source.imageFilename || path.basename(String(info.source.imagePath || '')) || `${figurePrefix}.png`

    if (!imageBuffer) {
      try {
        const renderedPng = await renderDiagramSourceToFile({
          source: info.source,
          job: params.job,
          format: 'png',
          persistOnSource: true,
        })
        if (renderedPng) {
          imageBuffer = renderedPng.buffer
          sourceFilename = renderedPng.filename
        }
      } catch {
        // SVG rendering below may still succeed.
      }
    }

    if (imageBuffer) {
      renderedImageCount += 1
      artifacts.push(await storeExportArtifact({
        jobId: params.job.id,
        batchId: params.payload.batchId,
        batchItemId: params.payload.batchItemId,
        batchItemNo: params.payload.batchItemNo,
        user: params.user,
        tenantId: params.tenantId,
        filename: `${figurePrefix}_${info.title}${path.extname(sourceFilename) || '.png'}`,
        buffer: imageBuffer,
        mimeType: mimeTypeForFilename(sourceFilename),
      }))
    }

    try {
      const renderedSvg = await renderDiagramSourceToFile({
        source: info.source,
        job: params.job,
        format: 'svg',
      })
      if (renderedSvg) {
        artifacts.push(await storeExportArtifact({
          jobId: params.job.id,
          batchId: params.payload.batchId,
          batchItemId: params.payload.batchItemId,
          batchItemNo: params.payload.batchItemNo,
          user: params.user,
          tenantId: params.tenantId,
          filename: `${figurePrefix}_${info.title}${extensionForContentType(renderedSvg.contentType) || '.svg'}`,
          buffer: renderedSvg.buffer,
          mimeType: renderedSvg.contentType,
        }))
      }
    } catch {
      // PNG is the required export format for DOCX; SVG is a convenience artifact.
    }
  }

  return {
    artifacts,
    renderedImageCount,
    figureCount: figureArtifactInfos(params.session).length,
  }
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
      publicationNumber: raw.publicationNumber || raw.publication_number || patentNumber,
      pn: raw.pn || raw.publicationNumber || raw.publication_number || patentNumber,
      title: raw.title || raw.name || `Literature review reference ${index + 1}`,
      snippet: raw.snippet || raw.summary || raw.abstract || raw.content || '',
      userNotes: raw.userNotes || raw.notes || raw.analysis || '',
      tags: Array.from(new Set([...(Array.isArray(raw.tags) ? raw.tags : []), 'USER_SELECTED'])),
    }
  })
}

function patentNumberOf(value: any) {
  return String(
    value?.patentNumber ||
    value?.publicationNumber ||
    value?.publication_number ||
    value?.patent_number ||
    value?.pn ||
    value?.id ||
    ''
  ).trim()
}

function compactPatentNumber(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function aiReviewTags(noveltyThreat: string) {
  const tags = ['USER_SELECTED', 'AI_REVIEWED']
  const normalized = noveltyThreat.toLowerCase()
  if (normalized === 'anticipates') tags.push('AI_ANTICIPATES')
  else if (normalized === 'obvious') tags.push('AI_OBVIOUS')
  else if (normalized === 'adjacent') tags.push('AI_ADJACENT')
  else tags.push('AI_REMOTE')
  return tags
}

function normalizeReviewedPriorArtSelection(decision: any, sourceResult?: any) {
  const patentNumber = patentNumberOf(decision) || patentNumberOf(sourceResult)
  const detailedAnalysis = decision?.detailedAnalysis || {}
  const noveltyThreat = String(decision?.novelty_threat || decision?.noveltyThreat || 'adjacent').toLowerCase()
  const score = typeof decision?.relevance === 'number'
    ? Math.max(0, Math.min(1, decision.relevance))
    : typeof sourceResult?.score === 'number'
      ? sourceResult.score
      : undefined
  const title = decision?.title || sourceResult?.title || patentNumber
  const aiSummary = decision?.summary || detailedAnalysis?.summary || ''
  const noveltyComparison = detailedAnalysis?.novelty_comparison || decision?.noveltyComparison || ''
  const userNotes = JSON.stringify({
    summary: aiSummary,
    relevant_parts: Array.isArray(detailedAnalysis?.relevant_parts) ? detailedAnalysis.relevant_parts : [],
    irrelevant_parts: Array.isArray(detailedAnalysis?.irrelevant_parts) ? detailedAnalysis.irrelevant_parts : [],
    novelty_comparison: noveltyComparison,
  })

  return {
    ...(sourceResult || {}),
    patentNumber,
    publicationNumber: sourceResult?.publicationNumber || sourceResult?.publication_number || patentNumber,
    publication_number: sourceResult?.publication_number || sourceResult?.publicationNumber || patentNumber,
    patent_number: sourceResult?.patent_number || patentNumber,
    pn: sourceResult?.pn || patentNumber,
    title,
    snippet: sourceResult?.snippet || sourceResult?.abstract || aiSummary,
    abstract: sourceResult?.abstract || sourceResult?.snippet || '',
    score,
    relevance: score,
    tags: aiReviewTags(noveltyThreat),
    user_notes: userNotes,
    userNotes,
    aiSummary,
    noveltyComparison,
    noveltyThreat,
  }
}

function mergePriorArtSelections(existing: any[], additions: any[]) {
  const byNumber = new Map<string, any>()
  for (const entry of [...existing, ...additions]) {
    const key = compactPatentNumber(patentNumberOf(entry))
    if (!key) continue
    byNumber.set(key, {
      ...(byNumber.get(key) || {}),
      ...entry,
    })
  }
  return Array.from(byNumber.values())
}

export function selectReviewedPriorArtDecisions(decisions: any[], limit = BATCH_PRIOR_ART_LIMIT) {
  return decisions
    .filter((decision: any) => {
      const relevance = typeof decision?.relevance === 'number' ? decision.relevance : 0
      const noveltyThreat = String(decision?.novelty_threat || decision?.noveltyThreat || '').toLowerCase()
      return decision?.analysis_status !== 'unknown' &&
        relevance >= 0.3 &&
        (noveltyThreat === 'anticipates' || noveltyThreat === 'obvious' || noveltyThreat === 'adjacent')
    })
    .sort((a: any, b: any) => Number(b?.relevance || 0) - Number(a?.relevance || 0))
    .slice(0, limit)
}

function addDraftingStageContext(action: unknown, message: string) {
  const actionName = typeof action === 'string' ? action : ''
  const stageLabel = DRAFTING_ACTION_STAGE_LABELS[actionName]
  if (!stageLabel || !/Input exceeds stage limit/i.test(message) || message.includes(stageLabel)) {
    return message
  }
  return `${stageLabel} ${message}`
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
    const rawMessage = errorBody.error || errorBody.message || 'Drafting action failed'
    const message = addDraftingStageContext(params.body.action, rawMessage)
    throw Object.assign(new Error(message), {
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

const DRAFT_LEGACY_FIELDS = new Set([
  'title',
  'fieldOfInvention',
  'background',
  'summary',
  'briefDescriptionOfDrawings',
  'detailedDescription',
  'bestMethod',
  'claims',
  'abstract',
  'industrialApplicability',
  'listOfNumerals',
])

const BATCH_SECTION_KEY_ALIASES: Record<string, string> = {
  field: 'fieldOfInvention',
  technicalField: 'fieldOfInvention',
  techField: 'fieldOfInvention',
  field_of_invention: 'fieldOfInvention',
  technical_field: 'fieldOfInvention',
  brief_drawings: 'briefDescriptionOfDrawings',
  brief_description_of_drawings: 'briefDescriptionOfDrawings',
  drawings: 'briefDescriptionOfDrawings',
  detailed_description: 'detailedDescription',
  description: 'detailedDescription',
  best_mode: 'bestMethod',
  bestMode: 'bestMethod',
  industrial_applicability: 'industrialApplicability',
  list_of_numerals: 'listOfNumerals',
  reference_numerals: 'listOfNumerals',
  objects: 'objectsOfInvention',
  object_of_the_invention: 'objectsOfInvention',
  objects_of_invention: 'objectsOfInvention',
  technical_problem: 'technicalProblem',
  technical_solution: 'technicalSolution',
  advantageous_effects: 'advantageousEffects',
  cross_reference: 'crossReference',
}

function canonicalBatchSectionKey(value: unknown) {
  const key = String(value || '').trim()
  return BATCH_SECTION_KEY_ALIASES[key] || key
}

function isNonApplicableHeadingLocal(value: unknown) {
  const text = String(value || '').trim().toLowerCase()
  return !text || text === 'n/a' || text === 'na' || text === 'not applicable' || text === 'implicit'
}

function isBatchDrawingSection(sectionKey: string) {
  return sectionKey === 'briefDescriptionOfDrawings'
}

async function getDraftingSectionsForJurisdiction(jurisdiction: string, includeDrawingSections = true): Promise<string[]> {
  const mappings = await (prisma as any).countrySectionMapping.findMany({
    where: {
      countryCode: jurisdiction.toUpperCase(),
      isEnabled: true,
    },
    orderBy: [{ displayOrder: 'asc' }, { supersetCode: 'asc' }],
  })

  if (!mappings.length) {
    throw new Error(`Jurisdiction ${jurisdiction.toUpperCase()} is not configured in CountrySectionMapping.`)
  }

  const sections: string[] = Array.from(new Set<string>(
    mappings
      .filter((mapping: any) => !isNonApplicableHeadingLocal(mapping.heading))
      .map((mapping: any) => canonicalBatchSectionKey(mapping.sectionKey))
      .filter(Boolean)
      .filter((sectionKey: string) => includeDrawingSections || !isBatchDrawingSection(sectionKey))
  ))

  if (!sections.includes('claims')) sections.push('claims')
  return sections
}

function getDraftContentForSection(draft: any, sectionKey: string) {
  if (!draft) return ''
  if (DRAFT_LEGACY_FIELDS.has(sectionKey)) {
    return typeof draft[sectionKey] === 'string' ? draft[sectionKey] : ''
  }
  const extraSections = (draft.extraSections as Record<string, unknown>) || {}
  return typeof extraSections[sectionKey] === 'string' ? String(extraSections[sectionKey]) : ''
}

function findMissingDraftSections(draft: any, sections: string[]) {
  return sections.filter(sectionKey => !getDraftContentForSection(draft, sectionKey).trim())
}

export function buildEnabledJurisdictionToggles(jurisdictions: unknown, includeReference = false): Record<string, boolean> {
  const source = Array.isArray(jurisdictions) ? jurisdictions : []
  const entries = source
    .map(code => String(code || '').trim().toUpperCase())
    .filter(Boolean)
    .map(code => [code, true] as const)
  if (includeReference) entries.unshift(['REFERENCE', true])
  return Object.fromEntries(entries)
}

type DraftQualityGateInput = {
  jurisdiction: string
  sections: string[]
  draft: any
  validationReport?: any
  extendedReport?: any
  generationWarnings?: string[]
  reviewAttempted?: boolean
}

function extractSectionGenerationWarnings(result: any) {
  const warnings: string[] = []
  const debugSteps = Array.isArray(result?.json?.debugSteps) ? result.json.debugSteps : []
  for (const step of debugSteps) {
    const stepName = String(step?.step || '')
    if (stepName.startsWith('fallback_')) {
      warnings.push(`${stepName.replace(/^fallback_/, '')} used fallback content`)
    }
    if (stepName.startsWith('guard_') && step?.status === 'warning') {
      warnings.push(`${stepName.replace(/^guard_/, '')} guard warning: ${step?.meta?.note || 'guardrail issue'}`)
    }
    if (stepName === 'integrity_check' && step?.status === 'warning') {
      warnings.push(`Integrity warning: ${step?.meta?.note || 'invalid references detected'}`)
    }
  }
  return Array.from(new Set(warnings.map(warning => warning.trim()).filter(Boolean)))
}

export function evaluateDraftQualityGate(input: DraftQualityGateInput) {
  const problems: string[] = []
  const missing = findMissingDraftSections(input.draft, input.sections)
  if (missing.length) {
    problems.push(`Missing required section(s): ${missing.join(', ')}`)
  }

  const invalidReferences = Array.isArray(input.validationReport?.invalidReferences)
    ? input.validationReport.invalidReferences
    : []
  if (invalidReferences.length) {
    problems.push(`Invalid reference(s): ${invalidReferences.join(', ')}`)
  }

  if (Array.isArray(input.generationWarnings) && input.generationWarnings.length) {
    problems.push(...input.generationWarnings.map(warning => `Generation warning: ${warning}`))
  }

  if (input.extendedReport?.hardFail) {
    const score = typeof input.extendedReport.complianceScore === 'number'
      ? ` Compliance score: ${input.extendedReport.complianceScore}.`
      : ''
    problems.push(`Extended validation reported a hard drafting failure.${score}`)
  }

  if (input.reviewAttempted === false) {
    problems.push('AI review was not run before export.')
  }

  return {
    ok: problems.length === 0,
    problems,
    message: problems.length
      ? `${input.jurisdiction}: automated draft did not pass final quality gate. ${problems.join(' ')}`
      : '',
  }
}

function buildBriefDescriptionOfDrawingsFromSession(session: any) {
  const plans = Array.isArray(session?.figurePlans) ? session.figurePlans : []
  const sources = Array.isArray(session?.diagramSources) ? session.diagramSources : []
  const figureNos = Array.from(new Set([
    ...plans.map((plan: any) => Number(plan.figureNo)).filter(Number.isFinite),
    ...sources.map((source: any) => Number(source.figureNo)).filter(Number.isFinite),
  ])).sort((a, b) => a - b)

  if (!figureNos.length) return ''
  return figureNos.map(figureNo => {
    const plan = plans.find((item: any) => Number(item.figureNo) === figureNo)
    const source = sources.find((item: any) => Number(item.figureNo) === figureNo)
    const rawTitle = String(plan?.title || source?.title || `a diagram of the invention`).trim()
    const cleaned = rawTitle
      .replace(new RegExp(`^(?:FIG\\.?|Figure)\\s*${figureNo}\\s*(?:is\\s*)?`, 'i'), '')
      .trim()
    const title = cleaned || 'a diagram of the invention'
    return `FIG. ${figureNo} is ${/^(a|an|the)\s/i.test(title) ? title : `a ${title}`}.`
  }).join('\n\n')
}

async function ensureBriefDescriptionOfDrawings(params: {
  user: any
  patentId: string
  sessionId: string
  jurisdiction: string
  sections: string[]
}) {
  if (!params.sections.includes('briefDescriptionOfDrawings')) return
  let draft = await getLatestDraftForJurisdiction(params.sessionId, params.jurisdiction)
  if (getDraftContentForSection(draft, 'briefDescriptionOfDrawings').trim()) return
  const session = await loadSession(params.sessionId)
  const brief = buildBriefDescriptionOfDrawingsFromSession(session)
  if (!brief.trim()) return
  await setActiveDraftingJurisdiction(params.sessionId, params.jurisdiction)
  await invokeDraftingAction({
    user: params.user,
    patentId: params.patentId,
    body: {
      action: 'save_sections',
      sessionId: params.sessionId,
      patch: { briefDescriptionOfDrawings: brief },
    },
  })
}

async function ensureDraftSectionsForJurisdiction(params: {
  user: any
  patentId: string
  sessionId: string
  jurisdiction: string
  includeDrawingSections: boolean
  selectedPatents: any[]
}) {
  const warnings: string[] = []
  const sections = await getDraftingSectionsForJurisdiction(params.jurisdiction, params.includeDrawingSections)
  let draft = await getLatestDraftForJurisdiction(params.sessionId, params.jurisdiction)
  let missing = findMissingDraftSections(draft, sections)

  if (missing.length > 0) {
    await setActiveDraftingJurisdiction(params.sessionId, params.jurisdiction)
    const generation = await invokeDraftingAction({
      user: params.user,
      patentId: params.patentId,
      body: {
        action: 'generate_sections',
        sessionId: params.sessionId,
        jurisdiction: params.jurisdiction,
        sections: missing,
        selectedPatents: params.selectedPatents,
        acceptPersonaWarnings: true,
      },
    })
    warnings.push(...extractSectionGenerationWarnings(generation))
  }

  await ensureBriefDescriptionOfDrawings({ ...params, sections })
  draft = await getLatestDraftForJurisdiction(params.sessionId, params.jurisdiction)
  missing = findMissingDraftSections(draft, sections)
  if (missing.length > 0) {
    await setActiveDraftingJurisdiction(params.sessionId, params.jurisdiction)
    const generation = await invokeDraftingAction({
      user: params.user,
      patentId: params.patentId,
      body: {
        action: 'generate_sections',
        sessionId: params.sessionId,
        jurisdiction: params.jurisdiction,
        sections: missing,
        selectedPatents: params.selectedPatents,
        acceptPersonaWarnings: true,
      },
    })
    warnings.push(...extractSectionGenerationWarnings(generation))
    await ensureBriefDescriptionOfDrawings({ ...params, sections })
  }

  draft = await getLatestDraftForJurisdiction(params.sessionId, params.jurisdiction)
  missing = findMissingDraftSections(draft, sections)
  if (missing.length > 0) {
    throw new Error(`${params.jurisdiction}: Missing mapped draft section(s): ${missing.join(', ')}`)
  }

  return { sections, draft, warnings: Array.from(new Set(warnings)) }
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

async function runBatchPriorArtSearchAndReview(params: {
  job: any
  workerId: string
  user: any
  patentId: string
  sessionId: string
}) {
  const searchResult = await withHeartbeat(params.job.id, params.workerId, () => invokeDraftingAction({
    user: params.user,
    patentId: params.patentId,
    body: {
      action: 'related_art_search',
      sessionId: params.sessionId,
      limit: BATCH_PRIOR_ART_LIMIT,
      providerIds: BATCH_PRIOR_ART_PROVIDER_IDS,
      skipTrigramSearch: true,
    },
  }))

  const rawResults = Array.isArray(searchResult.json?.results) ? searchResult.json.results : []
  if (!rawResults.length || !searchResult.json?.runId) return { selections: [], unknownCount: 0 }

  const review = await withHeartbeat(params.job.id, params.workerId, () => invokeDraftingAction({
    user: params.user,
    patentId: params.patentId,
    body: {
      action: 'related_art_llm_review',
      sessionId: params.sessionId,
      runId: searchResult.json.runId,
      batchSize: 6,
    },
  }))

  const resultsByNumber = new Map(
    rawResults
      .map((result: any) => [compactPatentNumber(patentNumberOf(result)), result])
      .filter(([key]: [string, any]) => key)
  )
  const decisions = Array.isArray(review.json?.decisions) ? review.json.decisions : []
  const unknownCount = decisions.filter((decision: any) =>
    decision?.analysis_status === 'unknown' || String(decision?.novelty_threat || '').toLowerCase() === 'unknown'
  ).length
  const reviewedSelections = selectReviewedPriorArtDecisions(decisions)
    .map((decision: any) => {
      const source = resultsByNumber.get(compactPatentNumber(patentNumberOf(decision)))
      return normalizeReviewedPriorArtSelection(decision, source)
    })
    .filter((selection: any) => patentNumberOf(selection))

  if (reviewedSelections.length) {
    await invokeDraftingAction({
      user: params.user,
      patentId: params.patentId,
      body: {
        action: 'related_art_select',
        sessionId: params.sessionId,
        runId: searchResult.json.runId,
        selections: reviewedSelections,
      },
    })

  }

  return { selections: reviewedSelections, unknownCount }
}

async function runPipeline(job: any, workerId: string) {
  const payload = job.payload as PatentDraftingAutomationPayload
  const user = await prisma.user.findUnique({ where: { id: job.userId }, include: { tenant: true } })
  if (!user || !user.tenantId) throw new Error('Draft owner or tenant is unavailable')

  const access = await checkServiceAccess(user.id, user.tenantId, 'PATENT_DRAFTING')
  if (!access.allowed) throw new Error(access.reason || 'Patent drafting access is no longer available')

  const payloadValidation = validateAutomationPayloadForPipeline(payload)
  const jurisdictions = payloadValidation.jurisdictions
  const activeJurisdiction = (payload.activeJurisdiction || jurisdictions[0] || DEFAULT_JURISDICTION).toUpperCase()
  const languageByJurisdiction = payload.languageByJurisdiction || Object.fromEntries(jurisdictions.map(code => [code, 'en']))
  const pipelineWarnings: string[] = []
  const generationWarningsByJurisdiction: Record<string, string[]> = {}
  let reviewAttempted = false
  const { suppliedClaimsText, claimsHandling } = payloadValidation

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
    const claimRemarks = [
      normalizeText(payload.claimRemarks),
      payload.claimRemarks === payload.claimsNotes ? '' : normalizeText(payload.claimsNotes),
      claimsHandling === 'improve' && suppliedClaimsText
        ? `Improve the following draft claims without entering claim-refinement mode:\n\n${suppliedClaimsText}`
        : '',
    ].filter(Boolean).join('\n\n')

    let claimsHtml = suppliedClaimsText
    if (suppliedClaimsText) {
      await invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: { action: 'save_claims', sessionId, claims: suppliedClaimsText },
      })
    }

    if (!(claimsHandling === 'use as is' && suppliedClaimsText)) {
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
    if (!hasFrozenClaims(session)) {
      throw new Error('Claims were generated but could not be frozen for drafting.')
    }
  }

  await setStep(job.id, workerId, 'PRIOR_ART_REVIEW')
  const priorArtText = buildPriorArtText(payload)
  const priorArtHandling = payload.priorArtHandling || 'auto'
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
          useOnlyManualPriorArt: priorArtHandling === 'use only',
          useManualAndAISearch: priorArtHandling !== 'use only',
        },
      },
    })
  }
  if (priorArtHandling !== 'use only') {
    try {
      const priorArtReview = await runBatchPriorArtSearchAndReview({
        job,
        workerId,
        user,
        patentId: job.patentId,
        sessionId,
      })
      if (priorArtReview.selections.length) {
        selectedPatents = mergePriorArtSelections(selectedPatents, priorArtReview.selections)
      }
      if (priorArtReview.unknownCount > 0) pipelineWarnings.push(
        `Prior art analysis: ${priorArtReview.unknownCount} candidate${priorArtReview.unknownCount === 1 ? '' : 's'} remained unknown after retry.`
      )
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
        priorArtForDrafting: {
          mode: selectedPatents.length ? 'selected' : (priorArtText ? 'manual' : 'none'),
          selectedPatents,
          manualText: priorArtText,
          literatureReviewInstructions: normalizeText(payload.literatureReview?.instructions || payload.priorArtReview?.instructions),
        },
      },
      skipClaimRefinement: true,
    },
  })

  await setStep(job.id, workerId, 'COMPONENTS')
  await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'proceed_to_components', sessionId } })
  session = await loadSession(sessionId)
  const components = getIdeaComponents(session)
  if (components.length) {
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Component validation failed'
      pipelineWarnings.push(`Component planning: ${message}`)
    }
  }

  await setStep(job.id, workerId, 'FIGURES')
  let figuresUsable = payload.figureMode !== 'skip'
  session = await loadSession(sessionId)
  const hasDiagram = (session?.diagramSources || []).some((source: any) => String(source.plantumlCode || '').trim())
  if (payload.figureMode === 'skip') {
    await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'skip_figures', sessionId } })
  } else if (!hasDiagram) {
    try {
      await withHeartbeat(job.id, workerId, () => invokeDraftingAction({
        user,
        patentId: job.patentId,
        body: {
          action: 'plan_and_generate_diagrams_llm',
          sessionId,
          figureCount: payload.figureCount,
          figureRemarks: payload.figureRemarks,
          skipSketchSuggestions: true,
        },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Figure generation failed'
      pipelineWarnings.push(`Figure generation: ${message}`)
      figuresUsable = false
    }
  }
  session = await loadSession(sessionId)
  const diagramCount = (session?.diagramSources || []).filter((source: any) => String(source.plantumlCode || '').trim()).length
  if (diagramCount > 0 && !session?.figureSequenceFinalized) {
    try {
      await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'get_combined_figures', sessionId } })
      await invokeDraftingAction({ user, patentId: job.patentId, body: { action: 'finalize_figure_sequence', sessionId } })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Figure finalization failed'
      pipelineWarnings.push(`Figure finalization: ${message}`)
      figuresUsable = false
    }
  } else if (payload.figureMode !== 'skip' && diagramCount === 0) {
    figuresUsable = false
  }
  if (payload.figureMode !== 'skip' && diagramCount > 0) {
    const renderResult = await ensureRenderedDiagramImages({ job, session })
    if (renderResult.errors.length > 0) {
      pipelineWarnings.push(`Figure rendering: ${renderResult.errors.slice(0, 3).join('; ')}`)
      if (renderResult.renderedCount === 0) figuresUsable = false
    }
    if (renderResult.renderedCount > 0) {
      session = await loadSession(sessionId)
    }
  }

  await setStep(job.id, workerId, 'DRAFTING')
  const illustrativeData = normalizeText(payload.illustrativeData)
  if (illustrativeData) {
    const enabledToggles = buildEnabledJurisdictionToggles(jurisdictions)
    const existingDdData = await prisma.dDUserData.findUnique({ where: { sessionId } })
    if (existingDdData) {
      const existingToggles = ((existingDdData as any).jurisdictionToggles || {}) as Record<string, boolean>
      await prisma.dDUserData.update({
        where: { sessionId },
        data: {
          userData: illustrativeData,
          jurisdictionToggles: { ...existingToggles, ...enabledToggles },
          updatedBy: user.id
        }
      })
    } else {
      await prisma.dDUserData.create({
        data: {
          sessionId,
          userData: illustrativeData,
          jurisdictionToggles: enabledToggles,
          createdBy: user.id,
          updatedBy: user.id
        }
      })
    }
  }
  session = await loadSession(sessionId)
  const includeDrawingSections = payload.figureMode !== 'skip' && figuresUsable
  for (const jurisdiction of jurisdictions) {
    const ensured = await withHeartbeat(job.id, workerId, () => ensureDraftSectionsForJurisdiction({
      user,
      patentId: job.patentId,
      sessionId,
      jurisdiction,
      includeDrawingSections,
      selectedPatents,
    }))
    generationWarningsByJurisdiction[jurisdiction] = [
      ...(generationWarningsByJurisdiction[jurisdiction] || []),
      ...ensured.warnings,
    ]
  }

  if (payload.runReview !== false) {
    reviewAttempted = true
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
        generationWarningsByJurisdiction[jurisdiction] = [
          ...(generationWarningsByJurisdiction[jurisdiction] || []),
          `AI review failed: ${message}`,
        ]
      }
    }
  }

  await setStep(job.id, workerId, 'EXPORT')
  const artifacts: any[] = []
  for (const jurisdiction of jurisdictions) {
    await setActiveDraftingJurisdiction(sessionId, jurisdiction)
    const ensured = await withHeartbeat(job.id, workerId, () => ensureDraftSectionsForJurisdiction({
      user,
      patentId: job.patentId,
      sessionId,
      jurisdiction,
      includeDrawingSections,
      selectedPatents,
    }))
    generationWarningsByJurisdiction[jurisdiction] = [
      ...(generationWarningsByJurisdiction[jurisdiction] || []),
      ...ensured.warnings,
    ]
    const validation = await invokeDraftingAction({
      user,
      patentId: job.patentId,
      body: {
        action: 'validate_draft',
        sessionId,
        jurisdiction,
      },
    })
    const qualityGate = evaluateDraftQualityGate({
      jurisdiction,
      sections: ensured.sections,
      draft: ensured.draft,
      validationReport: validation.json?.validationReport,
      extendedReport: validation.json?.extendedReport,
      generationWarnings: generationWarningsByJurisdiction[jurisdiction],
      reviewAttempted,
    })
    if (!qualityGate.ok) {
      if (!payload.skipQualityGate) {
        throw new Error(qualityGate.message)
      }
      pipelineWarnings.push(qualityGate.message)
    }
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

  session = await loadSession(sessionId)
  const figureExport = await storeBatchFigureArtifacts({
    job,
    payload,
    user,
    tenantId: user.tenantId,
    session,
  })
  artifacts.push(...figureExport.artifacts)
  if (figureExport.figureCount > 0 && figureExport.renderedImageCount === 0) {
    pipelineWarnings.push('Figure PlantUML source files were included in the batch ZIP; rendered figure image files were not available for this session.')
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
