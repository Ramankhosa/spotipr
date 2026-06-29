import AdmZip from 'adm-zip'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { generateToken, hashToken } from '@/lib/token-utils'
import {
  AUTO_PATENT_DRAFTING_PROJECT_NAME,
  AUTO_DRAFTING_MAX_UPLOAD_ROWS,
  EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS,
} from '@/lib/drafting-constants'
import { enqueuePatentDraftingJob, type PatentDraftingAutomationPayload } from '@/lib/patent-drafting-job-service'

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
  jurisdictions?: string[] | string
  filingType?: string
  claimsText?: string
  claimsHandling?: PatentDraftingAutomationPayload['claimsHandling']
  claimsNotes?: string
  priorArtHandling?: PatentDraftingAutomationPayload['priorArtHandling']
  illustrativeData?: string
}

export type AutoPatentDraftBatchDefaults = {
  defaultJurisdictions?: string[] | string
  defaultFilingType?: string
  defaultClaimsHandling?: PatentDraftingAutomationPayload['claimsHandling'] | string
  defaultPriorArtHandling?: PatentDraftingAutomationPayload['priorArtHandling'] | string
}

export type AutoPatentDraftBatchPreviewRow = AutoPatentDraftIdeaInput & {
  rowNo: number
  title: string
  ideaDetails: string
  noveltyDetails: string
  jurisdictions: string[]
  filingType: string
  claimsHandling: PatentDraftingAutomationPayload['claimsHandling']
  priorArtHandling: PatentDraftingAutomationPayload['priorArtHandling']
  errors: string[]
  warnings: string[]
}

type CreateBatchInput = {
  user: BatchCreateUser
  name?: string
  projectId?: string | null
  sourceFilename?: string
  ideas: AutoPatentDraftIdeaInput[]
  defaults?: AutoPatentDraftBatchDefaults
}

const FINAL_JOB_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED']
const SUCCESS_JOB_STATUSES = ['COMPLETED']
const FINAL_REQUEST_STATUSES = ['DELIVERED', 'DELIVERED_WITH_WARNINGS', 'REJECTED', 'FAILED', 'CANCELED']
const SUCCESS_REQUEST_STATUSES = ['DELIVERED', 'DELIVERED_WITH_WARNINGS']

export const AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS = [
  'title',
  'ideaDetails',
  'noveltyDetails',
  'literatureReviewInstructions',
  'literatureReviewContent',
  'figureRemarks',
  'jurisdictions',
  'filingType',
  'claimsText',
  'claimsHandling',
  'claimsNotes',
  'priorArtHandling',
  'illustrativeData',
] as const

const TEMPLATE_GUIDE_ROWS = [
  ['Column', 'Required', 'How it is used', 'Example'],
  ['title', 'Recommended', 'Patent title and batch item label.', 'Smart inhaler dose tracker'],
  ['ideaDetails', 'Yes', 'Main invention disclosure. Each row with ideaDetails creates one patent draft.', 'A dose tracking inhaler having a sensor, controller, and usage log...'],
  ['noveltyDetails', 'Recommended', 'Novelty/inventive distinction appended to the invention brief.', 'Low-power dose event detection using a split sensor path.'],
  ['literatureReviewInstructions', 'Optional', 'Instructions for how the prior-art/literature content should influence drafting.', 'Treat the cited inhaler counters as closest prior art; avoid admitting equivalence.'],
  ['literatureReviewContent', 'Optional', 'User-provided prior-art review content saved into prior-art context.', 'US1234567 discloses a mechanical counter but not wireless dose validation.'],
  ['figureRemarks', 'Optional', 'Instructions for figure/diagram planning.', 'Generate a system block diagram and a dose event flow chart.'],
  ['jurisdictions', 'Optional', 'Comma-separated jurisdiction codes. Defaults to IN when omitted.', 'IN,US'],
  ['filingType', 'Optional', 'utility, provisional, or design. Defaults to utility.', 'utility'],
  ['claimsText', 'Optional', 'Existing claims to use/improve depending on claimsHandling.', '1. A dose tracking inhaler comprising...'],
  ['claimsHandling', 'Optional', 'use as is, improve, draft from brief, or auto. Defaults to draft from brief.', 'draft from brief'],
  ['claimsNotes', 'Optional', 'Specific instructions for claims drafting.', 'Include one broad system claim and dependent sensing claims.'],
  ['priorArtHandling', 'Optional', 'use only, expand with search, or auto. Defaults based on prior-art text.', 'use only'],
  ['illustrativeData', 'Optional', 'Additional support data for detailed description.', 'Prototype detected 98% of actuation events over 30 days.'],
]

function csvEscape(value: unknown) {
  const text = safeString(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildAutoPatentDraftBatchTemplate(format: 'xlsx' | 'csv' = 'xlsx') {
  if (format === 'csv') {
    const csv = `${AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS.map(csvEscape).join(',')}\r\n`
    return {
      filename: 'patent-drafting-batch-template.csv',
      mimeType: 'text/csv; charset=utf-8',
      buffer: Buffer.from(csv, 'utf8'),
    }
  }

  const workbook = XLSX.utils.book_new()
  const blankRows = Array.from({ length: 10 }, () => AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS.map(() => ''))
  const uploadSheet = XLSX.utils.aoa_to_sheet([
    [...AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS],
    ...blankRows,
  ])
  XLSX.utils.book_append_sheet(workbook, uploadSheet, 'Batch Upload')

  const guideSheet = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE_ROWS)
  XLSX.utils.book_append_sheet(workbook, guideSheet, 'Instructions')

  const exampleSheet = XLSX.utils.json_to_sheet([
    {
      title: 'Smart inhaler dose tracker',
      ideaDetails: 'A dose tracking inhaler having a sensor, controller, memory, and wireless interface for logging dose events.',
      noveltyDetails: 'Low-power dose event detection using a split sensor path.',
      literatureReviewInstructions: 'Use cited inhaler counters as closest prior art; avoid admitting equivalence.',
      literatureReviewContent: 'US1234567 discloses a mechanical counter but not wireless dose validation.',
      figureRemarks: 'Generate a system block diagram and a dose event flow chart.',
      jurisdictions: 'IN,US',
      filingType: 'utility',
      claimsText: '',
      claimsHandling: 'draft from brief',
      claimsNotes: 'Include one broad system claim and dependent sensing claims.',
      priorArtHandling: 'use only',
      illustrativeData: 'Prototype detected 98% of actuation events over 30 days.',
    }
  ], { header: [...AUTO_PATENT_DRAFT_BATCH_TEMPLATE_COLUMNS] })
  XLSX.utils.book_append_sheet(workbook, exampleSheet, 'Example')

  return {
    filename: 'patent-drafting-batch-template.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
  }
}

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

function normalizeClaimsHandling(value: unknown): NonNullable<PatentDraftingAutomationPayload['claimsHandling']> {
  const normalized = safeString(value).toLowerCase()
  if (normalized === 'use as is') return 'use as is'
  if (normalized === 'improve') return 'improve'
  if (normalized === 'auto') return 'auto'
  return 'draft from brief'
}

function normalizePriorArtHandling(value: unknown, hasPriorArtText: boolean): NonNullable<PatentDraftingAutomationPayload['priorArtHandling']> {
  const normalized = safeString(value).toLowerCase()
  if (normalized === 'use only') return 'use only'
  if (normalized === 'expand with search') return 'expand with search'
  if (normalized === 'auto') return 'auto'
  return 'auto'
}

function readIdeaFields(input: AutoPatentDraftIdeaInput, index: number) {
  const row = input as Record<string, unknown>
  const title = safeString(input.title) || firstString(row, ['name', 'inventionTitle']) || `Patent Draft ${index + 1}`
  const ideaDetails = safeString(input.ideaDetails) || firstString(row, ['idea', 'idea_detail', 'idea_details', 'invention', 'description', 'mainBrief', 'main_brief'])
  const noveltyDetails = safeString(input.noveltyDetails) || firstString(row, ['novelty', 'novelty_detail', 'novelty_details', 'noveltySummary'])
  const literatureReviewInstructions = safeString(input.literatureReviewInstructions) || firstString(row, ['literatureReviewInstructions', 'literature_review_instructions', 'priorArtInstructions'])
  const literatureReviewContent = safeString(input.literatureReviewContent) || firstString(row, ['literatureReviewContent', 'literature_review_content', 'literatureReview', 'priorArtReview', 'prior_art_review', 'priorArt', 'prior_art'])
  const figureRemarks = safeString(input.figureRemarks) || firstString(row, ['figureDirections', 'figure_remarks', 'diagramRemarks', 'diagram_generation_remarks'])
  const claimsText = safeString(input.claimsText) || firstString(row, ['claims', 'claimsText', 'claims_text'])
  const claimsNotes = safeString(input.claimsNotes) || firstString(row, ['claimsNotes', 'claims_notes'])
  const illustrativeData = safeString(input.illustrativeData) || firstString(row, ['illustrativeData', 'detailedDescriptionData', 'supportData'])
  const jurisdictions = normalizeJurisdictions(input.jurisdictions ?? row.jurisdictions ?? row.jurisdiction)
  const filingType = safeString(input.filingType) || firstString(row, ['filingType', 'filing_type'])

  return {
    title,
    ideaDetails,
    noveltyDetails,
    literatureReviewInstructions,
    literatureReviewContent,
    figureRemarks,
    claimsText,
    claimsNotes,
    illustrativeData,
    jurisdictions,
    filingType,
    claimsHandling: input.claimsHandling ?? row.claimsHandling ?? row.claims_handling,
    priorArtHandling: input.priorArtHandling ?? row.priorArtHandling ?? row.prior_art_handling,
  }
}

function applyBatchDefaults(input: AutoPatentDraftIdeaInput, defaults: AutoPatentDraftBatchDefaults = {}): AutoPatentDraftIdeaInput {
  const fields = readIdeaFields(input, 0)
  const defaultJurisdictions = normalizeJurisdictions(defaults.defaultJurisdictions)
  return {
    ...input,
    jurisdictions: fields.jurisdictions.length ? fields.jurisdictions : (defaultJurisdictions.length ? defaultJurisdictions : ['IN']),
    filingType: fields.filingType || safeString(defaults.defaultFilingType) || 'utility',
    claimsHandling: safeString(fields.claimsHandling) ? fields.claimsHandling as PatentDraftingAutomationPayload['claimsHandling'] : normalizeClaimsHandling(defaults.defaultClaimsHandling),
    priorArtHandling: safeString(fields.priorArtHandling) ? fields.priorArtHandling as PatentDraftingAutomationPayload['priorArtHandling'] : normalizePriorArtHandling(defaults.defaultPriorArtHandling, !!(fields.literatureReviewInstructions || fields.literatureReviewContent)),
  }
}

export function previewAutoPatentDraftBatchIdeas(
  ideas: AutoPatentDraftIdeaInput[],
  defaults: AutoPatentDraftBatchDefaults = {}
) {
  const rows = ideas.map((idea, index): AutoPatentDraftBatchPreviewRow => {
    const applied = applyBatchDefaults(idea, defaults)
    const fields = readIdeaFields(applied, index)
    const priorArtText = [fields.literatureReviewInstructions, fields.literatureReviewContent].filter(Boolean).join('\n\n')
    const errors: string[] = []
    const warnings: string[] = []

    if (!fields.ideaDetails) errors.push('ideaDetails is required.')
    if (!safeString(idea.title) && !firstString(idea as Record<string, unknown>, ['name', 'inventionTitle'])) warnings.push('Title is blank; a fallback title will be used.')
    if (!fields.noveltyDetails) warnings.push('Novelty details are blank.')
    if (!fields.jurisdictions.length) warnings.push('No jurisdiction supplied; IN will be used.')

    return {
      ...applied,
      rowNo: index + 1,
      title: fields.title,
      ideaDetails: fields.ideaDetails,
      noveltyDetails: fields.noveltyDetails,
      literatureReviewInstructions: fields.literatureReviewInstructions,
      literatureReviewContent: fields.literatureReviewContent,
      figureRemarks: fields.figureRemarks,
      claimsText: fields.claimsText,
      claimsNotes: fields.claimsNotes,
      illustrativeData: fields.illustrativeData,
      jurisdictions: fields.jurisdictions.length ? fields.jurisdictions : ['IN'],
      filingType: fields.filingType || 'utility',
      claimsHandling: normalizeClaimsHandling(fields.claimsHandling),
      priorArtHandling: normalizePriorArtHandling(fields.priorArtHandling, !!priorArtText),
      errors,
      warnings,
    }
  })

  return {
    rows,
    totalRows: rows.length,
    validRows: rows.filter(row => row.errors.length === 0).length,
    invalidRows: rows.filter(row => row.errors.length > 0).length,
    warnings: rows.reduce((count, row) => count + row.warnings.length, 0),
  }
}

function buildPayload(input: AutoPatentDraftIdeaInput, index: number): PatentDraftingAutomationPayload {
  const fields = readIdeaFields(input, index)
  const {
    title,
    ideaDetails,
    noveltyDetails,
    literatureReviewInstructions,
    literatureReviewContent,
    figureRemarks,
    claimsText,
    claimsNotes,
    illustrativeData,
  } = fields

  if (!ideaDetails) {
    throw new Error(`Idea ${index + 1} is missing ideaDetails/idea/description content.`)
  }

  const sourceDisclosureText = [
    ideaDetails,
    noveltyDetails,
  ].filter(Boolean).join('\n\n')
  const priorArtText = [
    literatureReviewInstructions,
    literatureReviewContent,
  ].filter(Boolean).join('\n\n')

  return {
    title,
    ideaDetails,
    rawIdea: sourceDisclosureText,
    novelty: noveltyDetails,
    jurisdictions: fields.jurisdictions.length ? fields.jurisdictions : ['IN'],
    activeJurisdiction: (fields.jurisdictions[0] || 'IN').toUpperCase(),
    filingType: fields.filingType || 'utility',
    allowRefine: true,
    claimsText,
    claimsHandling: normalizeClaimsHandling(fields.claimsHandling),
    claimsNotes,
    claimRemarks: claimsNotes,
    priorArtHandling: normalizePriorArtHandling(fields.priorArtHandling, !!priorArtText),
    literatureReview: {
      instructions: literatureReviewInstructions,
      content: literatureReviewContent,
    },
    priorArtReview: {
      instructions: literatureReviewInstructions,
      content: literatureReviewContent,
    },
    figureRemarks,
    figureMode: 'generate',
    illustrativeData,
    languageMode: 'common',
    commonLanguage: 'en',
    figuresLanguage: 'en',
    languageByJurisdiction: Object.fromEntries((fields.jurisdictions.length ? fields.jurisdictions : ['IN']).map(code => [code.toUpperCase(), 'en'])),
    runReview: true,
  }
}

function rowsFromWorksheet(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const lower = filename.toLowerCase()
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    .filter(row => Object.values(row).some(value => safeString(value)))
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

async function getOrCreateAutoDraftingProject(userId: string, projectId?: string | null) {
  if (projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { userId },
          { collaborators: { some: { userId } } }
        ]
      }
    })
    if (!project) throw new Error('Project not found or access denied.')
    return project
  }

  const existing = await prisma.project.findFirst({
    where: { userId, name: AUTO_PATENT_DRAFTING_PROJECT_NAME }
  })
  if (existing) return existing
  return prisma.project.create({
    data: {
      userId,
      name: AUTO_PATENT_DRAFTING_PROJECT_NAME
    }
  })
}

export async function createAutoPatentDraftBatch(input: CreateBatchInput) {
  if (!input.user.tenantId) throw new Error('User tenant is required for automated patent drafting.')
  if (!input.ideas.length) throw new Error('At least one idea is required.')
  if (input.ideas.length > AUTO_DRAFTING_MAX_UPLOAD_ROWS) {
    throw new Error(`A batch can include at most ${AUTO_DRAFTING_MAX_UPLOAD_ROWS} ideas.`)
  }

  const project = await getOrCreateAutoDraftingProject(input.user.id, input.projectId)
  const payloads = input.ideas.map(idea => applyBatchDefaults(idea, input.defaults)).map(buildPayload)
  const batch = await (prisma as any).autoPatentDraftBatch.create({
    data: {
      tenantId: input.user.tenantId,
      userId: input.user.id,
      projectId: project.id,
      name: input.name || (payloads.length === 1 ? payloads[0].title : `Patent draft batch - ${new Date().toISOString().slice(0, 10)}`),
      sourceFilename: input.sourceFilename,
      totalItems: payloads.length,
      status: 'QUEUED',
      itemSummaries: payloads.map((payload, index) => ({
        itemNo: index + 1,
        title: payload.title,
        jurisdictions: payload.jurisdictions?.length ? payload.jurisdictions : ['IN'],
        status: 'QUEUED'
      }))
    }
  })

  const jobs: any[] = []
  for (let index = 0; index < payloads.length; index += 1) {
    const payload = payloads[index]
    const patent = await prisma.patent.create({
      data: {
        projectId: project.id,
        createdBy: input.user.id,
        title: payload.title,
      }
    })
    const item = await (prisma as any).autoPatentDraftBatchItem.create({
      data: {
        batchId: batch.id,
        tenantId: input.user.tenantId,
        userId: input.user.id,
        projectId: project.id,
        patentId: patent.id,
        itemNo: index + 1,
        title: payload.title,
        jurisdictions: payload.jurisdictions?.length ? payload.jurisdictions : ['IN'],
        status: 'QUEUED',
        currentStep: 'QUEUED',
        progressPct: 5,
      }
    })
    const job = await enqueuePatentDraftingJob({
      patentId: patent.id,
      userId: input.user.id,
      payload: {
        ...payload,
        projectId: project.id,
        batchId: batch.id,
        batchItemId: item.id,
        batchItemNo: index + 1,
      }
    })
    await (prisma as any).autoPatentDraftBatchItem.update({
      where: { id: item.id },
      data: { jobId: job.id }
    })
    jobs.push(job)
  }

  await (prisma as any).autoPatentDraftBatch.update({
    where: { id: batch.id },
    data: { jobIds: jobs.map(job => job.id) }
  })

  return {
    batchId: batch.id,
    status: 'QUEUED',
    totalItems: jobs.length,
    jobIds: jobs.map(job => job.id)
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

async function createBatchZip(batch: any, records: any[]) {
  if (batch.zipDocumentId) {
    const token = await createZipAccessLink(batch.zipDocumentId, batch.userId)
    return { documentId: batch.zipDocumentId, token }
  }

  const artifactIds = Array.from(new Set(records.flatMap(record => Array.isArray(record.artifactIds) ? record.artifactIds : [])))
  const requestIds = records.map(record => record.id).filter(Boolean)
  if (!artifactIds.length && !requestIds.length) {
    throw new Error('No completed draft artifacts were found for this batch.')
  }
  const documents = artifactIds.length
    ? await prisma.document.findMany({
        where: {
          id: { in: artifactIds },
          userId: batch.userId,
          type: 'PATENT_DRAFT_EXPORT',
        },
        orderBy: { createdAt: 'asc' }
      })
    : await prisma.document.findMany({
        where: {
          userId: batch.userId,
          type: 'PATENT_DRAFT_EXPORT',
          OR: requestIds.map(requestId => ({ contentPtr: { contains: requestId } }))
        },
        orderBy: { createdAt: 'asc' }
      })

  const zip = new AdmZip()
  for (const record of records) {
    const itemNo = record.itemNo || record.autoPatentDraftBatchItemNo || requestIds.indexOf(record.id) + 1
    const recordArtifactIds = Array.isArray(record.artifactIds) ? record.artifactIds : []
    const recordDocs = recordArtifactIds.length
      ? documents.filter(document => recordArtifactIds.includes(document.id))
      : documents.filter(document => String(document.contentPtr || '').includes(record.id))
    for (const document of recordDocs) {
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
  const link = `${SITE_URL}/patents/draft/batch/download/${token}`
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

  const items = await (prisma as any).autoPatentDraftBatchItem.findMany({
    where: { batchId },
    orderBy: { itemNo: 'asc' }
  })

  if (items.length > 0) {
    const jobs = await (prisma as any).patentDraftingJob.findMany({
      where: { id: { in: items.map((item: any) => item.jobId).filter(Boolean) } }
    })
    const jobsById = new Map<string, any>(jobs.map((job: any) => [job.id, job]))
    const syncedItems = []
    for (const item of items) {
      const job: any = item.jobId ? jobsById.get(item.jobId) : null
      const result: Record<string, any> = job?.result && typeof job.result === 'object' ? job.result : {}
      const artifactIds = Array.isArray(result.artifactIds) ? result.artifactIds : item.artifactIds
      const warnings = Array.isArray(result.warnings) ? result.warnings : item.warnings
      const nextStatus = job?.status || item.status
      const nextStep = job?.currentStep || item.currentStep
      const nextSessionId = job?.sessionId || result.sessionId || item.sessionId
      const errorMessage = job?.lastError || item.errorMessage
      if (
        item.status !== nextStatus ||
        item.currentStep !== nextStep ||
        item.sessionId !== nextSessionId ||
        JSON.stringify(item.artifactIds || []) !== JSON.stringify(artifactIds || []) ||
        JSON.stringify(item.warnings || null) !== JSON.stringify(warnings || null) ||
        item.errorMessage !== errorMessage
      ) {
        syncedItems.push(await (prisma as any).autoPatentDraftBatchItem.update({
          where: { id: item.id },
          data: {
            status: nextStatus,
            currentStep: nextStep,
            sessionId: nextSessionId || null,
            artifactIds: artifactIds || [],
            warnings: warnings || undefined,
            errorMessage: errorMessage || null,
            progressPct: nextStatus === 'COMPLETED' ? 100 : nextStatus === 'FAILED' || nextStatus === 'CANCELLED' ? 100 : item.progressPct,
          }
        }))
      } else {
        syncedItems.push(item)
      }
    }

    const completedItems = syncedItems.filter((item: any) => SUCCESS_JOB_STATUSES.includes(item.status)).length
    const failedItems = syncedItems.filter((item: any) => ['FAILED', 'CANCELLED'].includes(item.status)).length
    const warningItems = syncedItems.filter((item: any) => Array.isArray(item.warnings) && item.warnings.length > 0).length
    const allFinal = syncedItems.length > 0 && syncedItems.every((item: any) => FINAL_JOB_STATUSES.includes(item.status))
    const anyStarted = syncedItems.some((item: any) => !['QUEUED'].includes(item.status))
    const nextStatus = allFinal
      ? failedItems > 0
        ? completedItems > 0 ? 'COMPLETED_WITH_ERRORS' : 'FAILED'
        : 'COMPLETED'
      : anyStarted
        ? 'PROCESSING'
        : 'QUEUED'

    const itemSummaries = syncedItems.map((item: any) => ({
      itemId: item.id,
      jobId: item.jobId,
      itemNo: item.itemNo,
      title: item.title,
      jurisdictions: item.jurisdictions,
      status: item.status,
      currentStep: item.currentStep,
      patentId: item.patentId,
      sessionId: item.sessionId,
      artifactIds: item.artifactIds,
      warnings: item.warnings,
      error: item.errorMessage || undefined
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

    const { token } = await createBatchZip(updated, syncedItems)
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
      status: { in: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'] }
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
