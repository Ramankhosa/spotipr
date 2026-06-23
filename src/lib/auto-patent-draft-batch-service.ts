import AdmZip from 'adm-zip'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { generateToken, hashToken } from '@/lib/token-utils'
import {
  AUTO_DRAFTING_BULK_RECIPIENT,
  AUTO_DRAFTING_MAX_UPLOAD_ROWS,
  EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS,
  MAX_DRAFTING_INPUT_CHARS,
} from '@/lib/drafting-constants'
import type { EmailDraftPayload } from '@/lib/email-drafting-service'

type BatchCreateUser = {
  id: string
  tenantId?: string | null
  email: string
  name?: string | null
}

export type AutoPatentDraftIdeaInput = {
  title?: string
  ideaDetails?: string
  noveltyDetails?: string
  literatureReviewInstructions?: string
  literatureReviewContent?: string
  figureRemarks?: string
  draftingRemarks?: string
  jurisdictions?: string[] | string
  filingType?: string
  claimsText?: string
  claimsHandling?: EmailDraftPayload['claimsHandling']
  claimsNotes?: string
  priorArtHandling?: EmailDraftPayload['priorArtHandling']
  illustrativeData?: string
}

type CreateBatchInput = {
  user: BatchCreateUser
  name?: string
  projectId?: string | null
  sourceFilename?: string
  ideas: AutoPatentDraftIdeaInput[]
}

const FINAL_REQUEST_STATUSES = ['DELIVERED', 'DELIVERED_WITH_WARNINGS', 'REJECTED', 'FAILED', 'CANCELED']
const SUCCESS_REQUEST_STATUSES = ['DELIVERED', 'DELIVERED_WITH_WARNINGS']

function sha256(input: Buffer | string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function firstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = safeString(row[key])
    if (value) return value
  }
  return ''
}

function normalizeJurisdictions(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : safeString(value).split(/[,\s;]+/)
  const jurisdictions = raw
    .map(item => safeString(item).toUpperCase())
    .filter(Boolean)
  return Array.from(new Set(jurisdictions)).slice(0, 8)
}

function normalizeClaimsHandling(value: unknown): EmailDraftPayload['claimsHandling'] {
  const normalized = safeString(value).toLowerCase()
  if (normalized === 'use as is') return 'use as is'
  if (normalized === 'improve') return 'improve'
  if (normalized === 'auto') return 'auto'
  return 'draft from brief'
}

function normalizePriorArtHandling(value: unknown, hasPriorArtText: boolean): EmailDraftPayload['priorArtHandling'] {
  const normalized = safeString(value).toLowerCase()
  if (normalized === 'expand with search') return 'expand with search'
  if (normalized === 'auto') return 'auto'
  return hasPriorArtText ? 'use only' : 'auto'
}

function condenseForNormalization(text: string) {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_DRAFTING_INPUT_CHARS) return trimmed
  const head = trimmed.slice(0, 10000).trimEnd()
  const tail = trimmed.slice(-4500).trimStart()
  return `${head}\n\n[Condensed for automated patent drafting. Full disclosure retained in batch metadata.]\n\n${tail}`.slice(0, MAX_DRAFTING_INPUT_CHARS)
}

function section(label: string, value: string) {
  return value ? `${label}:\n${value}` : ''
}

function buildPayload(input: AutoPatentDraftIdeaInput, index: number): EmailDraftPayload {
  const row = input as Record<string, unknown>
  const title = safeString(input.title) || firstString(row, ['name', 'inventionTitle']) || `Patent Draft ${index + 1}`
  const ideaDetails = safeString(input.ideaDetails) || firstString(row, ['idea', 'idea_detail', 'idea_details', 'invention', 'description', 'mainBrief', 'main_brief'])
  const noveltyDetails = safeString(input.noveltyDetails) || firstString(row, ['novelty', 'novelty_detail', 'novelty_details', 'noveltySummary'])
  const literatureReviewInstructions = safeString(input.literatureReviewInstructions) || firstString(row, ['literatureReviewInstructions', 'literature_review_instructions', 'priorArtInstructions'])
  const literatureReviewContent = safeString(input.literatureReviewContent) || firstString(row, ['literatureReviewContent', 'literature_review_content', 'literatureReview', 'priorArtReview', 'prior_art_review', 'priorArt', 'prior_art'])
  const figureRemarks = safeString(input.figureRemarks) || firstString(row, ['figureDirections', 'figure_remarks', 'diagramRemarks', 'diagram_generation_remarks'])
  const draftingRemarks = safeString(input.draftingRemarks) || firstString(row, ['patentDraftingRemarks', 'drafting_remarks', 'draftingInstructions', 'drafting_instructions'])
  const claimsText = safeString(input.claimsText) || firstString(row, ['claims', 'claimsText', 'claims_text'])
  const claimsNotes = safeString(input.claimsNotes) || firstString(row, ['claimsNotes', 'claims_notes'])
  const illustrativeData = safeString(input.illustrativeData) || firstString(row, ['illustrativeData', 'detailedDescriptionData', 'supportData'])

  if (!ideaDetails) {
    throw new Error(`Idea ${index + 1} is missing ideaDetails/idea/description content.`)
  }

  const mainBriefText = [
    section('Idea details', ideaDetails),
    section('Novelty supplied by user', noveltyDetails),
    section('Patent drafting remarks', draftingRemarks),
  ].filter(Boolean).join('\n\n')

  const priorArtText = [
    section('Literature review instructions', literatureReviewInstructions),
    section('Literature review content', literatureReviewContent),
  ].filter(Boolean).join('\n\n')

  const jurisdictions = normalizeJurisdictions(input.jurisdictions ?? row.jurisdictions ?? row.jurisdiction)

  return {
    parserVersion: 1,
    source: 'bulk_upload',
    suppressNotificationEmails: true,
    title,
    jurisdictions,
    filingType: safeString(input.filingType) || firstString(row, ['filingType', 'filing_type']) || 'utility',
    allowRefine: true,
    coverMemo: draftingRemarks,
    mainBriefText,
    normalizationBrief: condenseForNormalization(mainBriefText),
    claimsText,
    claimsHandling: normalizeClaimsHandling(input.claimsHandling ?? row.claimsHandling ?? row.claims_handling),
    claimsNotes: [claimsNotes, draftingRemarks].filter(Boolean).join('\n\n'),
    priorArtText,
    priorArtHandling: normalizePriorArtHandling(input.priorArtHandling ?? row.priorArtHandling ?? row.prior_art_handling, !!priorArtText),
    figureDirections: figureRemarks,
    illustrativeData,
    draftingRemarks,
    literatureReviewInstructions,
    literatureReviewContent,
    warnings: [],
    attachments: []
  } as EmailDraftPayload
}

function rowsFromWorksheet(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const lower = filename.toLowerCase()
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (!rows.length && (lower.endsWith('.csv') || lower.endsWith('.tsv'))) {
    throw new Error('The uploaded table is empty.')
  }
  return rows
}

export function parseAutoPatentDraftIdeasFromJson(value: unknown): AutoPatentDraftIdeaInput[] {
  const container = value && typeof value === 'object' ? value as any : {}
  const ideas = Array.isArray(value)
    ? value
    : Array.isArray(container.ideas)
      ? container.ideas
      : Array.isArray(container.items)
        ? container.items
        : []
  return ideas.map((item: unknown) => item && typeof item === 'object' ? item as AutoPatentDraftIdeaInput : { ideaDetails: safeString(item) })
}

export function parseAutoPatentDraftIdeasFromUpload(input: {
  filename: string
  mimeType?: string
  buffer: Buffer
}): AutoPatentDraftIdeaInput[] {
  const lower = input.filename.toLowerCase()
  if (lower.endsWith('.json')) {
    return parseAutoPatentDraftIdeasFromJson(JSON.parse(input.buffer.toString('utf8')))
  }
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.xlsx')) {
    return rowsFromWorksheet(input.buffer, input.filename) as AutoPatentDraftIdeaInput[]
  }
  throw new Error('Unsupported batch file type. Upload .json, .csv, .tsv, or .xlsx.')
}

export async function createAutoPatentDraftBatch(input: CreateBatchInput) {
  if (!input.user.tenantId) throw new Error('User tenant is required for automated patent drafting.')
  if (!input.ideas.length) throw new Error('At least one idea is required.')
  if (input.ideas.length > AUTO_DRAFTING_MAX_UPLOAD_ROWS) {
    throw new Error(`A batch can include at most ${AUTO_DRAFTING_MAX_UPLOAD_ROWS} ideas.`)
  }

  const payloads = input.ideas.map(buildPayload)
  const batch = await (prisma as any).autoPatentDraftBatch.create({
    data: {
      tenantId: input.user.tenantId,
      userId: input.user.id,
      projectId: input.projectId || null,
      name: input.name || (payloads.length === 1 ? payloads[0].title : `Patent draft batch - ${new Date().toISOString().slice(0, 10)}`),
      sourceFilename: input.sourceFilename,
      totalItems: payloads.length,
      status: 'QUEUED',
      itemSummaries: payloads.map((payload, index) => ({
        itemNo: index + 1,
        title: payload.title,
        jurisdictions: payload.jurisdictions.length ? payload.jurisdictions : ['IN'],
        status: 'RECEIVED'
      }))
    }
  })

  const requests: any[] = []
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index]
    const requestHash = sha256(JSON.stringify(payload))
    const request = await (prisma as any).emailDraftRequest.create({
      data: {
        tenantId: input.user.tenantId,
        userId: input.user.id,
        projectId: input.projectId || null,
        autoPatentDraftBatchId: batch.id,
        autoPatentDraftBatchItemNo: index + 1,
        subject: payload.title,
        senderEmail: input.user.email,
        senderDisplayName: input.user.name || undefined,
        recipientEmail: AUTO_DRAFTING_BULK_RECIPIENT,
        requestHash,
        dedupeKey: `auto-batch:${batch.id}:${index + 1}:${requestHash.slice(0, 16)}`,
        parsedPayload: payload,
        normalizationBrief: payload.normalizationBrief,
        warnings: payload.warnings,
        status: 'RECEIVED',
        currentStage: 'RECEIVED',
        progressPct: 5
      }
    })
    requests.push(request)
  }

  await (prisma as any).autoPatentDraftBatch.update({
    where: { id: batch.id },
    data: { requestIds: requests.map(request => request.id) }
  })

  return {
    batchId: batch.id,
    status: 'QUEUED',
    totalItems: requests.length,
    requestIds: requests.map(request => request.id)
  }
}

function sanitizeZipName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140) || 'document'
}

async function createZipAccessLink(documentId: string, userId: string) {
  const token = generateToken()
  await (prisma as any).documentAccessLink.create({
    data: {
      documentId,
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS * 24 * 60 * 60 * 1000)
    }
  })
  return token
}

async function createBatchZip(batch: any, requests: any[]) {
  if (batch.zipDocumentId) {
    const token = await createZipAccessLink(batch.zipDocumentId, batch.userId)
    return { documentId: batch.zipDocumentId, token }
  }

  const requestIds = requests.map(request => request.id)
  const documents = await prisma.document.findMany({
    where: {
      userId: batch.userId,
      type: 'PATENT_DRAFT_EXPORT',
      OR: requestIds.map(requestId => ({ contentPtr: { contains: requestId } }))
    },
    orderBy: { createdAt: 'asc' }
  })

  const zip = new AdmZip()
  for (const request of requests) {
    const itemNo = request.autoPatentDraftBatchItemNo || requestIds.indexOf(request.id) + 1
    const requestDocs = documents.filter(document => String(document.contentPtr || '').includes(request.id))
    for (const document of requestDocs) {
      if (!document.contentPtr) continue
      const buffer = await fs.readFile(document.contentPtr)
      const prefix = String(itemNo).padStart(2, '0')
      zip.addFile(`${prefix}-${sanitizeZipName(document.filename)}`, buffer)
    }
  }

  if (zip.getEntries().length === 0) {
    throw new Error('No completed draft artifacts were found for this batch.')
  }

  const buffer = zip.toBuffer()
  const outDir = path.join(process.cwd(), 'uploads', 'auto-patent-batches', batch.id)
  await fs.mkdir(outDir, { recursive: true })
  const filename = `${sanitizeZipName(batch.name)}.zip`
  const filePath = path.join(outDir, filename)
  await fs.writeFile(filePath, buffer)

  const document = await prisma.document.create({
    data: {
      tenantId: batch.tenantId,
      userId: batch.userId,
      type: 'PATENT_DRAFT_EXPORT',
      filename,
      contentPtr: filePath,
      hash: sha256(buffer),
      mimeType: 'application/zip',
      sizeBytes: buffer.length
    }
  })

  await (prisma as any).autoPatentDraftBatch.update({
    where: { id: batch.id },
    data: { zipDocumentId: document.id }
  })
  const token = await createZipAccessLink(document.id, batch.userId)
  return { documentId: document.id, token }
}

async function sendBatchCompletionEmail(batch: any, token: string, hasFailures: boolean) {
  const user = await prisma.user.findUnique({ where: { id: batch.userId } })
  if (!user?.email) return
  const link = `${SITE_URL}/email-drafting/download/${token}`
  const subject = hasFailures
    ? `Patent drafting batch completed with errors: ${batch.name}`
    : `Patent drafting batch ready: ${batch.name}`
  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Patent drafting batch completed</h2>
        <p><strong>Batch:</strong> ${batch.name}</p>
        <p><strong>Completed:</strong> ${batch.completedItems}/${batch.totalItems}</p>
        ${hasFailures ? `<p><strong>Failed:</strong> ${batch.failedItems}. Completed drafts are included in the ZIP.</p>` : ''}
        <p><a href="${link}">${link}</a></p>
      </div>
    `,
    text: `Patent drafting batch completed: ${link}`
  })
}

async function sendBatchFailureEmail(batch: any) {
  const user = await prisma.user.findUnique({ where: { id: batch.userId } })
  if (!user?.email) return
  const link = `${SITE_URL}/dashboard`
  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject: `Patent drafting batch failed: ${batch.name}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Patent drafting batch failed</h2>
        <p><strong>Batch:</strong> ${batch.name}</p>
        <p>No draft artifacts were generated. Sign in to review the failed items and error details.</p>
        <p><a href="${link}">${link}</a></p>
      </div>
    `,
    text: `Patent drafting batch failed. Review failed items here: ${link}`
  })
}

export async function refreshAutoPatentDraftBatch(batchId: string, options: { sendEmail?: boolean } = {}) {
  const batch = await (prisma as any).autoPatentDraftBatch.findUnique({ where: { id: batchId } })
  if (!batch) return null

  const requests = await (prisma as any).emailDraftRequest.findMany({
    where: { autoPatentDraftBatchId: batchId },
    orderBy: { autoPatentDraftBatchItemNo: 'asc' }
  })

  const completedItems = requests.filter((request: any) => SUCCESS_REQUEST_STATUSES.includes(request.status)).length
  const failedItems = requests.filter((request: any) => ['REJECTED', 'FAILED', 'CANCELED'].includes(request.status)).length
  const warningItems = requests.filter((request: any) => request.status === 'DELIVERED_WITH_WARNINGS').length
  const allFinal = requests.length > 0 && requests.every((request: any) => FINAL_REQUEST_STATUSES.includes(request.status))
  const anyStarted = requests.some((request: any) => request.status !== 'RECEIVED')
  const nextStatus = allFinal
    ? failedItems > 0
      ? completedItems > 0 ? 'COMPLETED_WITH_ERRORS' : 'FAILED'
      : 'COMPLETED'
    : anyStarted
      ? 'PROCESSING'
      : 'QUEUED'

  const itemSummaries = requests.map((request: any) => ({
    requestId: request.id,
    itemNo: request.autoPatentDraftBatchItemNo,
    title: request.subject,
    status: request.status,
    patentId: request.patentId,
    sessionId: request.sessionId,
    error: request.errorMessage || undefined
  }))

  let updated = await (prisma as any).autoPatentDraftBatch.update({
    where: { id: batchId },
    data: {
      status: nextStatus,
      completedItems,
      failedItems,
      warningItems,
      itemSummaries,
      completedAt: allFinal ? (batch.completedAt || new Date()) : null
    }
  })

  if (!allFinal) return updated

  if (completedItems === 0) {
    if (options.sendEmail !== false && !updated.completionEmailSentAt) {
      await sendBatchFailureEmail(updated)
      updated = await (prisma as any).autoPatentDraftBatch.update({
        where: { id: batchId },
        data: { completionEmailSentAt: new Date() }
      })
    }
    return updated
  }

  const { token } = await createBatchZip(updated, requests)
  updated = await (prisma as any).autoPatentDraftBatch.findUnique({ where: { id: batchId } })

  if (options.sendEmail !== false && !updated.completionEmailSentAt) {
    await sendBatchCompletionEmail(updated, token, failedItems > 0)
    updated = await (prisma as any).autoPatentDraftBatch.update({
      where: { id: batchId },
      data: { completionEmailSentAt: new Date() }
    })
  }

  return updated
}

export async function refreshReadyAutoPatentDraftBatches(limit = 10) {
  const candidates = await (prisma as any).autoPatentDraftBatch.findMany({
    where: {
      completionEmailSentAt: null,
      status: { in: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS'] }
    },
    orderBy: { createdAt: 'asc' },
    take: Math.max(1, limit)
  })
  const refreshed = []
  for (const batch of candidates) {
    refreshed.push(await refreshAutoPatentDraftBatch(batch.id))
  }
  return refreshed
}

export async function getAutoPatentDraftBatchForUser(batchId: string, userId: string) {
  await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return (prisma as any).autoPatentDraftBatch.findFirst({
    where: { id: batchId, userId }
  })
}

export async function listAutoPatentDraftBatchesForUser(userId: string) {
  return (prisma as any).autoPatentDraftBatch.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50
  })
}
