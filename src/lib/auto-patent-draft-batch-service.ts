import AdmZip from 'adm-zip'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/prisma'
import { resolveAllowRefineFromIdeaHandling } from '@/lib/source-fidelity'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { generateToken, hashToken } from '@/lib/token-utils'
import {
  AUTO_PATENT_DRAFTING_PROJECT_NAME,
  AUTO_DRAFTING_MAX_UPLOAD_ROWS,
  EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS,
  AUTO_DRAFTING_DOCUMENT_FILE_EXTENSIONS,
  AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_BYTES,
  AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_MB,
  MAX_DRAFTING_UPLOAD_BYTES,
  MAX_DRAFTING_UPLOAD_MB,
} from '@/lib/drafting-constants'
import {
  enqueuePatentDraftingJob,
  type PatentDraftingAutomationPayload,
  type UploadedFigureRef,
} from '@/lib/patent-drafting-job-service'
import {
  extractDraftIdeaTextFromBuffer,
  DraftIdeaFileIngestionError,
  type DraftIdeaExtractedImage,
  type DraftIdeaFileFormat,
} from '@/lib/draft-idea-file-ingestion'

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
  // Stage-0 idea handling: false = PRESERVE ("keep my idea exactly as provided").
  // Undefined keeps the historical structure-and-polish default.
  allowRefine?: boolean
  // Document-mode (one-patent-per-file) fields.
  sourceFilename?: string
  // Figure-handling choices (global default + per-file override). generateDiagrams
  // is undefined for spreadsheet ideas (treated as true for back-compat).
  useUploadedFigures?: boolean
  generateDiagrams?: boolean
  // Images extracted from the uploaded document. Held in-memory during batch
  // creation only; persisted to disk and replaced by lightweight uploadedFigures
  // references before the job payload is built (never stored as base64 in the DB).
  extractedImages?: DraftIdeaExtractedImage[]
  uploadedFigures?: UploadedFigureRef[]
}

export type AutoPatentDraftBatchDefaults = {
  defaultJurisdictions?: string[] | string
  defaultFilingType?: string
  defaultClaimsHandling?: PatentDraftingAutomationPayload['claimsHandling'] | string
  defaultPriorArtHandling?: PatentDraftingAutomationPayload['priorArtHandling'] | string
  /** 'keep as is' / 'preserve' => PRESERVE mode for rows that do not override it. */
  defaultIdeaHandling?: string
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
const PAUSABLE_BATCH_STATUSES = ['QUEUED', 'PROCESSING']
const CANCELLABLE_BATCH_STATUSES = ['QUEUED', 'PROCESSING', 'PAUSED']
const PRESERVED_BATCH_STATUSES = ['PAUSED', 'CANCELLED']
const BATCH_REVIEW_STATUSES = ['NEEDS_REVIEW', 'REVIEWED', 'ACCEPTED', 'REJECTED'] as const
type BatchReviewStatus = typeof BATCH_REVIEW_STATUSES[number]

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
  'ideaHandling',
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
  ['ideaHandling', 'Optional', 'Keep as is / preserve to draft strictly within the inventor wording; anything else structures and polishes. Defaults to the batch setting.', 'keep as is'],
  ['claimsNotes', 'Optional', 'Specific instructions for claims drafting.', 'Include one broad system claim and dependent sensing claims.'],
  ['priorArtHandling', 'Optional', 'use only, expand with search, or auto. Defaults to auto.', 'auto'],
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
      priorArtHandling: 'auto',
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
  const ideaHandling = firstString(row, ['ideaHandling', 'idea_handling', 'ideaTreatment', 'idea_treatment', 'sourceHandling', 'source_handling'])

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
    ideaHandling,
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
    // Row wording wins; otherwise the batch-level setting decides. An explicit
    // input.allowRefine (JSON API callers) outranks both.
    allowRefine: input.allowRefine
      ?? resolveAllowRefineFromIdeaHandling(fields.ideaHandling)
      ?? resolveAllowRefineFromIdeaHandling(defaults.defaultIdeaHandling),
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

  // Figure handling: uploaded document images and/or AI-generated diagrams.
  // generateDiagrams defaults to true (spreadsheet ideas and legacy callers keep
  // the previous "always generate" behaviour). figureMode is only 'skip' when the
  // caller wants neither uploaded images nor generated diagrams.
  const uploadedFigures = Array.isArray(input.uploadedFigures) ? input.uploadedFigures : []
  const useUploadedFigures = input.useUploadedFigures === true && uploadedFigures.length > 0
  const generateDiagrams = input.generateDiagrams !== false
  const figuresWanted = useUploadedFigures || generateDiagrams

  return {
    title,
    ideaDetails,
    rawIdea: sourceDisclosureText,
    novelty: noveltyDetails,
    jurisdictions: fields.jurisdictions.length ? fields.jurisdictions : ['IN'],
    activeJurisdiction: (fields.jurisdictions[0] || 'IN').toUpperCase(),
    filingType: fields.filingType || 'utility',
    allowRefine: input.allowRefine !== false,
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
    figureMode: figuresWanted ? 'generate' : 'skip',
    uploadedFigures,
    useUploadedFigures,
    generateDiagrams,
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

const DOCUMENT_TITLE_MAX_LENGTH = 200

function documentTitleFromFilename(filename: string) {
  const base = (filename || '').split(/[\\/]/).pop() || filename || ''
  const stem = base.replace(/\.[a-z0-9]+$/i, '')
  return stem.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, DOCUMENT_TITLE_MAX_LENGTH)
}

function firstNonEmptyLine(text: string) {
  for (const line of (text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed.slice(0, DOCUMENT_TITLE_MAX_LENGTH)
  }
  return ''
}

export type AutoPatentDraftDocumentRow = {
  rowNo: number
  sourceFilename: string
  detectedFormat?: DraftIdeaFileFormat
  title: string
  ideaDetails: string
  imageCount: number
  warning?: string
  extractionError?: string
  // Server-only: images extracted from the file, consumed during batch creation.
  extractedImages: DraftIdeaExtractedImage[]
}

// Document mode: one uploaded disclosure file (Word/PDF/text) becomes one idea.
// Each file is run through the shared "normal path" extractor. A failed file is
// captured as extractionError so the rest of the batch can still proceed.
export async function parseAutoPatentDraftDocuments(
  files: { filename: string; mimeType?: string; buffer: Buffer }[]
): Promise<AutoPatentDraftDocumentRow[]> {
  const rows: AutoPatentDraftDocumentRow[] = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const fallbackTitle = documentTitleFromFilename(file.filename) || `Patent Draft ${index + 1}`
    try {
      const extracted = await extractDraftIdeaTextFromBuffer({
        fileName: file.filename,
        mimeType: file.mimeType,
        buffer: file.buffer,
      })
      rows.push({
        rowNo: index + 1,
        sourceFilename: file.filename,
        detectedFormat: extracted.detectedFormat,
        title: fallbackTitle || firstNonEmptyLine(extracted.textContent) || `Patent Draft ${index + 1}`,
        ideaDetails: extracted.textContent,
        imageCount: extracted.images.length,
        ...(extracted.warning ? { warning: extracted.warning } : {}),
        extractedImages: extracted.images,
      })
    } catch (error) {
      const message = error instanceof DraftIdeaFileIngestionError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Failed to extract content from this file.'
      rows.push({
        rowNo: index + 1,
        sourceFilename: file.filename,
        title: fallbackTitle,
        ideaDetails: '',
        imageCount: 0,
        extractionError: message,
        extractedImages: [],
      })
    }
  }
  return rows
}

export type DocumentIdeaEdit = {
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
  useUploadedFigures?: boolean
  generateDiagrams?: boolean
}

// Merges extracted document rows with the user's per-file edits (matched by
// position) and the global figure defaults into ideas ready for
// createAutoPatentDraftBatch. Files with no usable idea text are reported in
// `skipped` so the caller can block the batch with a clear message.
export function buildDocumentIdeasFromRows(
  rows: AutoPatentDraftDocumentRow[],
  edits: DocumentIdeaEdit[],
  globals: { useUploadedFigures: boolean; generateDiagrams: boolean }
): {
  ideas: AutoPatentDraftIdeaInput[]
  skipped: { rowNo: number; sourceFilename: string; reason: string }[]
} {
  const ideas: AutoPatentDraftIdeaInput[] = []
  const skipped: { rowNo: number; sourceFilename: string; reason: string }[] = []
  rows.forEach((row, index) => {
    const edit = edits[index] || {}
    const ideaDetails = safeString(edit.ideaDetails) || row.ideaDetails
    if (!ideaDetails) {
      skipped.push({
        rowNo: row.rowNo,
        sourceFilename: row.sourceFilename,
        reason: row.extractionError || 'No readable text was extracted from this file.',
      })
      return
    }
    const useUploadedFigures = typeof edit.useUploadedFigures === 'boolean' ? edit.useUploadedFigures : globals.useUploadedFigures
    const generateDiagrams = typeof edit.generateDiagrams === 'boolean' ? edit.generateDiagrams : globals.generateDiagrams
    ideas.push({
      title: safeString(edit.title) || row.title,
      ideaDetails,
      noveltyDetails: safeString(edit.noveltyDetails),
      literatureReviewInstructions: safeString(edit.literatureReviewInstructions),
      literatureReviewContent: safeString(edit.literatureReviewContent),
      figureRemarks: safeString(edit.figureRemarks),
      jurisdictions: edit.jurisdictions,
      filingType: safeString(edit.filingType) || undefined,
      claimsText: safeString(edit.claimsText),
      claimsHandling: edit.claimsHandling,
      claimsNotes: safeString(edit.claimsNotes),
      priorArtHandling: edit.priorArtHandling,
      illustrativeData: safeString(edit.illustrativeData),
      sourceFilename: row.sourceFilename,
      useUploadedFigures,
      generateDiagrams,
      // Only carry image bytes forward when this item will actually use them.
      extractedImages: useUploadedFigures ? row.extractedImages : [],
    })
  })
  return { ideas, skipped }
}

export function assertDocumentBatchLimits(files: { filename: string; size: number }[]) {
  if (!files.length) {
    throw new Error(`Upload at least one document (${AUTO_DRAFTING_DOCUMENT_FILE_EXTENSIONS.join(', ')}).`)
  }
  if (files.length > AUTO_DRAFTING_MAX_UPLOAD_ROWS) {
    throw new Error(`A batch can include at most ${AUTO_DRAFTING_MAX_UPLOAD_ROWS} documents.`)
  }
  let totalBytes = 0
  for (const file of files) {
    const lower = (file.filename || '').toLowerCase()
    if (!AUTO_DRAFTING_DOCUMENT_FILE_EXTENSIONS.some(ext => lower.endsWith(ext))) {
      throw new Error(`Unsupported file "${file.filename}". Upload ${AUTO_DRAFTING_DOCUMENT_FILE_EXTENSIONS.join(', ')} files.`)
    }
    if (file.size > MAX_DRAFTING_UPLOAD_BYTES) {
      throw new Error(`"${file.filename}" exceeds the ${MAX_DRAFTING_UPLOAD_MB}MB per-file limit.`)
    }
    totalBytes += file.size
  }
  if (totalBytes > AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_BYTES) {
    throw new Error(`Total upload size exceeds ${AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_MB}MB. Upload fewer or smaller files.`)
  }
}

function base64FromDataUrl(dataUrl: string) {
  const comma = (dataUrl || '').indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : (dataUrl || '')
}

// Writes each extracted image to the patent's figures directory (the same
// location the interactive single-draft upload route uses) and returns
// lightweight references for the job payload — no base64 is persisted.
async function persistUploadedFiguresForPatent(
  projectId: string,
  patentId: string,
  images: DraftIdeaExtractedImage[]
): Promise<UploadedFigureRef[]> {
  if (!images.length) return []
  const baseDir = path.join(process.cwd(), 'uploads', 'projects', projectId, 'patents', patentId, 'figures')
  await fs.mkdir(baseDir, { recursive: true })
  const refs: UploadedFigureRef[] = []
  for (const image of images) {
    const buffer = Buffer.from(base64FromDataUrl(image.dataUrl), 'base64')
    if (!buffer.byteLength) continue
    const filePath = path.join(baseDir, image.fileName)
    await fs.writeFile(filePath, buffer)
    refs.push({
      filename: image.fileName,
      checksum: sha256(buffer),
      imagePath: filePath,
      mimeType: image.mimeType,
      label: image.label || image.fileName,
    })
  }
  return refs
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
  const appliedIdeas = input.ideas.map(idea => applyBatchDefaults(idea, input.defaults))
  // Validate every idea and derive titles/jurisdictions up front (fail fast before
  // any patents/jobs are created). Uploaded figures are attached per item inside
  // the loop, once each patent id exists.
  const basePayloads = appliedIdeas.map(buildPayload)
  const batch = await (prisma as any).autoPatentDraftBatch.create({
    data: {
      tenantId: input.user.tenantId,
      userId: input.user.id,
      projectId: project.id,
      name: input.name || (basePayloads.length === 1 ? basePayloads[0].title : `Patent draft batch - ${new Date().toISOString().slice(0, 10)}`),
      sourceFilename: input.sourceFilename,
      totalItems: basePayloads.length,
      status: 'QUEUED',
      itemSummaries: basePayloads.map((payload, index) => ({
        itemNo: index + 1,
        title: payload.title,
        jurisdictions: payload.jurisdictions?.length ? payload.jurisdictions : ['IN'],
        status: 'QUEUED'
      }))
    }
  })

  const jobs: any[] = []
  for (let index = 0; index < appliedIdeas.length; index += 1) {
    const appliedIdea = appliedIdeas[index]
    const patent = await prisma.patent.create({
      data: {
        projectId: project.id,
        createdBy: input.user.id,
        title: basePayloads[index].title,
      }
    })
    // Persist uploaded document images as figure files for this patent, then build
    // the final payload carrying only lightweight references (no base64 in the DB).
    const uploadedFigures = appliedIdea.useUploadedFigures && Array.isArray(appliedIdea.extractedImages) && appliedIdea.extractedImages.length
      ? await persistUploadedFiguresForPatent(project.id, patent.id, appliedIdea.extractedImages)
      : []
    const payload = buildPayload({ ...appliedIdea, uploadedFigures, extractedImages: undefined }, index)
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

function sanitizePathPart(value: unknown, fallback = 'document', maxLength = 90) {
  const clean = safeString(value)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
  return (clean || fallback).slice(0, maxLength)
}

function generatedTitleForRecord(record: any) {
  return safeString(record.generatedTitle) ||
    safeString(record.result?.generatedTitle) ||
    safeString(record.title) ||
    safeString(record.subject) ||
    'Patent Draft'
}

function originalTitleForRecord(record: any) {
  return safeString(record.title) || safeString(record.subject) || generatedTitleForRecord(record)
}

function itemNoForRecord(record: any, fallbackIndex: number) {
  return Number(record.itemNo || record.autoPatentDraftBatchItemNo || fallbackIndex + 1) || fallbackIndex + 1
}

function itemPrefix(record: any, fallbackIndex: number) {
  return String(itemNoForRecord(record, fallbackIndex)).padStart(2, '0')
}

function extensionOf(filename: string) {
  return path.extname(filename || '').toLowerCase()
}

function classifyBatchArtifact(document: any) {
  const filename = safeString(document.filename)
  const mimeType = safeString(document.mimeType).toLowerCase()
  const ext = extensionOf(filename)
  if (ext === '.png' || mimeType.includes('png')) return 'PNG'
  if (ext === '.svg' || mimeType.includes('svg')) return 'SVG'
  if (ext === '.docx' || ext === '.doc' || ext === '.pdf' || mimeType.includes('wordprocessingml') || mimeType.includes('pdf')) return 'Drafts'
  return 'Other'
}

function inferJurisdictionFromFilename(filename: string, jurisdictions: unknown) {
  const known = Array.isArray(jurisdictions)
    ? jurisdictions.map(code => safeString(code).toUpperCase()).filter(Boolean)
    : []
  const normalized = safeString(filename).toUpperCase()
  const firstToken = normalized.split(/[_\-\s.]+/)[0]
  if (known.includes(firstToken)) return firstToken
  const match = normalized.match(/(?:^|[_\-\s.])([A-Z]{2})(?:[_\-\s.]|$)/)
  return match?.[1] || known[0] || 'IN'
}

function figureExportName(filename: string) {
  const ext = extensionOf(filename) || '.png'
  const stem = path.basename(filename, path.extname(filename))
    .replace(/^([A-Z]+-\d{1,3})(?:[_\-\s]+)?/i, (_match, prefix) => `${prefix.toUpperCase()} - `)
    .replace(/_/g, ' ')
  return `${sanitizePathPart(stem, 'figure', 120)}${ext}`
}

function artifactExportName(document: any, record: any, recordIndex: number) {
  const category = classifyBatchArtifact(document)
  const original = safeString(document.filename) || 'document'
  const ext = extensionOf(original) || ''
  if (category === 'Drafts') {
    const jurisdiction = inferJurisdictionFromFilename(original, record.jurisdictions)
    return `${itemPrefix(record, recordIndex)} - ${jurisdiction} - ${sanitizePathPart(generatedTitleForRecord(record), 'Patent Draft', 110)}${ext || '.docx'}`
  }
  if (category === 'PNG' || category === 'SVG') return figureExportName(original)
  return sanitizePathPart(original, 'document', 140)
}

function uniqueZipPath(basePath: string, usedPaths: Set<string>) {
  if (!usedPaths.has(basePath)) {
    usedPaths.add(basePath)
    return basePath
  }
  const parsed = path.parse(basePath)
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`).replace(/\\/g, '/')
    if (!usedPaths.has(candidate)) {
      usedPaths.add(candidate)
      return candidate
    }
  }
  const fallback = path.join(parsed.dir, `${parsed.name} (${Date.now()})${parsed.ext}`).replace(/\\/g, '/')
  usedPaths.add(fallback)
  return fallback
}

function artifactDownloadCategory(document: any) {
  const category = classifyBatchArtifact(document)
  if (category === 'Drafts') return 'drafts'
  if (category === 'PNG') return 'png'
  if (category === 'SVG') return 'svg'
  return 'other'
}

function batchItemFolderName(record: any, recordIndex: number) {
  return `${itemPrefix(record, recordIndex)} - ${sanitizePathPart(generatedTitleForRecord(record), 'Patent Draft', 90)}`
}

function csvRows(rows: unknown[][]) {
  return `${rows.map(row => row.map(csvEscape).join(',')).join('\r\n')}\r\n`
}

function jsonText(value: unknown) {
  return `${JSON.stringify(value ?? {}, null, 2)}\n`
}

function buildBatchManifestRows(records: any[], docsByRecordId: Map<string, any[]>) {
  const rows: unknown[][] = [[
    'Item No',
    'Generated Title',
    'Original Title',
    'Jurisdictions',
    'Status',
    'Review Status',
    'Warnings',
    'Error',
    'Patent ID',
    'Session ID',
    'Artifacts',
    'Completed At',
  ]]
  records.forEach((record, index) => {
    const recordKey = record.id || record.itemId || `record-${index}`
    const docs = docsByRecordId.get(recordKey) || []
    rows.push([
      itemPrefix(record, index),
      generatedTitleForRecord(record),
      originalTitleForRecord(record),
      Array.isArray(record.jurisdictions) ? record.jurisdictions.join('; ') : '',
      record.status || '',
      record.reviewStatus || 'NEEDS_REVIEW',
      Array.isArray(record.warnings) ? record.warnings.join('; ') : '',
      record.errorMessage || record.error || '',
      record.patentId || '',
      record.sessionId || '',
      docs.map(document => document.filename).join('; '),
      record.completedAt || '',
    ])
  })
  return rows
}

function priorArtAuditRows(audit: any) {
  const rows: unknown[][] = [[
    'Provider',
    'Candidate Count',
    'Fallback Used',
    'Selected References',
    'Remote Count',
    'Unknown Count',
    'Below Threshold Count',
  ]]
  const counts = audit?.providerCandidateCounts && typeof audit.providerCandidateCounts === 'object'
    ? audit.providerCandidateCounts
    : {}
  const providers = Object.keys(counts).length ? Object.keys(counts) : [
    ...(Array.isArray(audit?.primaryProviders) ? audit.primaryProviders : []),
    ...(Array.isArray(audit?.fallbackProviders) && audit.googleFallbackUsed ? audit.fallbackProviders : []),
  ]
  for (const provider of providers) {
    rows.push([
      provider,
      counts[provider] || 0,
      audit?.googleFallbackUsed ? 'yes' : 'no',
      Array.isArray(audit?.selectedReferences) ? audit.selectedReferences.length : 0,
      audit?.excludedCounts?.remote || 0,
      audit?.excludedCounts?.unknown || 0,
      audit?.excludedCounts?.belowThreshold || 0,
    ])
  }
  return rows
}

function normalizeReviewStatus(value: unknown): BatchReviewStatus {
  const normalized = safeString(value).toUpperCase().replace(/[\s-]+/g, '_')
  return (BATCH_REVIEW_STATUSES as readonly string[]).includes(normalized)
    ? normalized as BatchReviewStatus
    : 'NEEDS_REVIEW'
}

function computeStatusFromJobItems(items: any[]) {
  const completedItems = items.filter((item: any) => SUCCESS_JOB_STATUSES.includes(item.status)).length
  const failedItems = items.filter((item: any) => ['FAILED', 'CANCELLED'].includes(item.status)).length
  const warningItems = items.filter((item: any) => Array.isArray(item.warnings) && item.warnings.length > 0).length
  const allFinal = items.length > 0 && items.every((item: any) => FINAL_JOB_STATUSES.includes(item.status))
  const anyStarted = items.some((item: any) => !['QUEUED'].includes(item.status))
  const status = allFinal
    ? failedItems > 0
      ? completedItems > 0 ? 'COMPLETED_WITH_ERRORS' : 'FAILED'
      : 'COMPLETED'
    : anyStarted
      ? 'PROCESSING'
      : 'QUEUED'

  return { status, completedItems, failedItems, warningItems, allFinal }
}

function computeStatusFromEmailRequests(requests: any[]) {
  const completedItems = requests.filter((request: any) => SUCCESS_REQUEST_STATUSES.includes(request.status)).length
  const failedItems = requests.filter((request: any) => ['REJECTED', 'FAILED', 'CANCELED'].includes(request.status)).length
  const warningItems = requests.filter((request: any) => request.status === 'DELIVERED_WITH_WARNINGS').length
  const allFinal = requests.length > 0 && requests.every((request: any) => FINAL_REQUEST_STATUSES.includes(request.status))
  const anyStarted = requests.some((request: any) => request.status !== 'RECEIVED')
  const status = allFinal
    ? failedItems > 0
      ? completedItems > 0 ? 'COMPLETED_WITH_ERRORS' : 'FAILED'
      : 'COMPLETED'
    : anyStarted
      ? 'PROCESSING'
      : 'QUEUED'

  return { status, completedItems, failedItems, warningItems, allFinal }
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

async function createBatchZip(batch: any, records: any[], options: { forceRebuild?: boolean } = {}) {
  if (batch.zipDocumentId && !options.forceRebuild) {
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
  let exportEntryCount = 0
  const usedZipPaths = new Set<string>()
  const docsByRecordId = new Map<string, any[]>()
  for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
    const record = records[recordIndex]
    const recordKey = record.id || record.itemId || `record-${recordIndex}`
    const recordArtifactIds = Array.isArray(record.artifactIds) ? record.artifactIds : []
    const recordDocs = recordArtifactIds.length
      ? documents.filter(document => recordArtifactIds.includes(document.id))
      : documents.filter(document => String(document.contentPtr || '').includes(record.id))
    docsByRecordId.set(recordKey, recordDocs)
    const folder = batchItemFolderName(record, recordIndex)
    for (const document of recordDocs) {
      if (!document.contentPtr) continue
      let buffer: Buffer
      try {
        buffer = await fs.readFile(document.contentPtr)
      } catch (readError) {
        // A single missing/unreadable artifact on disk must not abort the whole
        // batch export (which would otherwise propagate up through
        // refreshReadyAutoPatentDraftBatches and crash-loop the worker). Skip it.
        console.error(`[Batch] Skipping unreadable artifact ${document.id} (${document.contentPtr}):`, readError instanceof Error ? readError.message : readError)
        continue
      }
      const category = classifyBatchArtifact(document)
      zip.addFile(uniqueZipPath(`${folder}/${category}/${artifactExportName(document, record, recordIndex)}`, usedZipPaths), buffer)
      exportEntryCount += 1
    }

    const audit = record.priorArtAudit && typeof record.priorArtAudit === 'object' ? record.priorArtAudit : null
    if (audit) {
      zip.addFile(`${folder}/Prior Art/prior-art-summary.csv`, Buffer.from(csvRows(priorArtAuditRows(audit)), 'utf8'))
      zip.addFile(`${folder}/Prior Art/prior-art-summary.json`, Buffer.from(jsonText(audit), 'utf8'))
      exportEntryCount += 2
    }

    if (safeString(record.attorneyNotes)) {
      zip.addFile(`${folder}/Review Notes/attorney-notes.txt`, Buffer.from(`${safeString(record.attorneyNotes)}\n`, 'utf8'))
      exportEntryCount += 1
    }
  }

  zip.addFile('Batch Manifest.csv', Buffer.from(csvRows(buildBatchManifestRows(records, docsByRecordId)), 'utf8'))

  if (exportEntryCount === 0) {
    throw new Error('No completed draft artifacts were found for this batch.')
  }

  const buffer = zip.toBuffer()
  const outDir = path.join(process.cwd(), 'uploads', 'auto-patent-batches', batch.id)
  await fs.mkdir(outDir, { recursive: true })
  const filename = `${sanitizeZipName(batch.name)}-organized.zip`
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
      const generatedTitle = safeString(result.generatedTitle) || item.generatedTitle
      const priorArtAudit = result.priorArtAudit && typeof result.priorArtAudit === 'object' ? result.priorArtAudit : item.priorArtAudit
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
        item.generatedTitle !== generatedTitle ||
        JSON.stringify(item.priorArtAudit || null) !== JSON.stringify(priorArtAudit || null) ||
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
            generatedTitle: generatedTitle || null,
            priorArtAudit: priorArtAudit || undefined,
            errorMessage: errorMessage || null,
            progressPct: nextStatus === 'COMPLETED' ? 100 : nextStatus === 'FAILED' || nextStatus === 'CANCELLED' ? 100 : item.progressPct,
          }
        }))
      } else {
        syncedItems.push(item)
      }
    }

    const computed = computeStatusFromJobItems(syncedItems)
    const completedItems = computed.completedItems
    const failedItems = computed.failedItems
    const warningItems = computed.warningItems
    const allFinal = computed.allFinal
    const nextStatus = PRESERVED_BATCH_STATUSES.includes(batch.status) ? batch.status : computed.status

    const itemSummaries = syncedItems.map((item: any) => ({
      itemId: item.id,
      jobId: item.jobId,
      itemNo: item.itemNo,
      title: item.title,
      generatedTitle: item.generatedTitle,
      jurisdictions: item.jurisdictions,
      status: item.status,
      currentStep: item.currentStep,
      patentId: item.patentId,
      sessionId: item.sessionId,
      artifactIds: item.artifactIds,
      priorArtAudit: item.priorArtAudit,
      reviewStatus: item.reviewStatus,
      attorneyNotes: item.attorneyNotes,
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
        completedAt: batch.status === 'CANCELLED'
          ? (batch.completedAt || batch.cancelledAt || new Date())
          : allFinal && !PRESERVED_BATCH_STATUSES.includes(batch.status)
            ? (batch.completedAt || new Date())
            : batch.completedAt
      }
    })

    if (PRESERVED_BATCH_STATUSES.includes(nextStatus) || !allFinal) return updated

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

  const computed = computeStatusFromEmailRequests(requests)
  const completedItems = computed.completedItems
  const failedItems = computed.failedItems
  const warningItems = computed.warningItems
  const allFinal = computed.allFinal
  const nextStatus = PRESERVED_BATCH_STATUSES.includes(batch.status) ? batch.status : computed.status

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
      completedAt: batch.status === 'CANCELLED'
        ? (batch.completedAt || batch.cancelledAt || new Date())
        : allFinal && !PRESERVED_BATCH_STATUSES.includes(batch.status)
          ? (batch.completedAt || new Date())
          : batch.completedAt
    }
  })

  if (PRESERVED_BATCH_STATUSES.includes(nextStatus) || !allFinal) return updated

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

async function getBatchForUser(batchId: string, userId: string) {
  return (prisma as any).autoPatentDraftBatch.findFirst({
    where: { id: batchId, userId }
  })
}

async function computeResumeStatus(batchId: string) {
  const items = await (prisma as any).autoPatentDraftBatchItem.findMany({
    where: { batchId },
    orderBy: { itemNo: 'asc' }
  })
  if (items.length > 0) return computeStatusFromJobItems(items).status

  const requests = await (prisma as any).emailDraftRequest.findMany({
    where: { autoPatentDraftBatchId: batchId },
    orderBy: { autoPatentDraftBatchItemNo: 'asc' }
  })
  if (requests.length > 0) return computeStatusFromEmailRequests(requests).status
  return 'QUEUED'
}

export async function pauseAutoPatentDraftBatch(batchId: string, userId: string) {
  const batch = await getBatchForUser(batchId, userId)
  if (!batch) return { outcome: 'not_found' as const }
  if (batch.status === 'PAUSED') return { outcome: 'paused' as const, batchId, status: 'PAUSED' as const }
  if (!PAUSABLE_BATCH_STATUSES.includes(batch.status)) {
    return { outcome: 'not_pausable' as const, status: batch.status }
  }

  const pausedAt = new Date()
  const updated = await (prisma as any).autoPatentDraftBatch.updateMany({
    where: { id: batchId, userId, status: { in: PAUSABLE_BATCH_STATUSES } },
    data: {
      status: 'PAUSED',
      pausedAt,
      pausedById: userId,
      resumedAt: null,
      resumedById: null,
    }
  })
  if (updated.count !== 1) {
    const current = await getBatchForUser(batchId, userId)
    return current?.status === 'PAUSED'
      ? { outcome: 'paused' as const, batchId, status: 'PAUSED' as const }
      : { outcome: 'not_pausable' as const, status: current?.status || 'UNKNOWN' }
  }
  const refreshed = await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return { outcome: 'paused' as const, batchId, status: refreshed?.status || 'PAUSED' as const }
}

export async function resumeAutoPatentDraftBatch(batchId: string, userId: string) {
  const batch = await getBatchForUser(batchId, userId)
  if (!batch) return { outcome: 'not_found' as const }
  if (batch.status !== 'PAUSED') return { outcome: 'not_resumable' as const, status: batch.status }

  const nextStatus = await computeResumeStatus(batchId)
  const resumedAt = new Date()
  const updated = await (prisma as any).autoPatentDraftBatch.updateMany({
    where: { id: batchId, userId, status: 'PAUSED' },
    data: {
      status: nextStatus,
      resumedAt,
      resumedById: userId,
      pausedAt: null,
      pausedById: null,
      completedAt: ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'].includes(nextStatus) ? (batch.completedAt || resumedAt) : null,
    }
  })
  if (updated.count !== 1) {
    const current = await getBatchForUser(batchId, userId)
    return current?.status !== 'PAUSED'
      ? { outcome: 'resumed' as const, batchId, status: current?.status || nextStatus }
      : { outcome: 'not_resumable' as const, status: current?.status || 'UNKNOWN' }
  }
  const refreshed = await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return { outcome: 'resumed' as const, batchId, status: refreshed?.status || nextStatus }
}

export async function cancelAutoPatentDraftBatch(batchId: string, userId: string, reason?: string) {
  const batch = await getBatchForUser(batchId, userId)
  if (!batch) return { outcome: 'not_found' as const }
  if (batch.status === 'CANCELLED') return { outcome: 'cancelled' as const, batchId, status: 'CANCELLED' as const }
  if (!CANCELLABLE_BATCH_STATUSES.includes(batch.status)) {
    return { outcome: 'not_cancellable' as const, status: batch.status }
  }

  const cancelledAt = new Date()
  const message = safeString(reason) || 'Cancelled by user.'
  const batchUpdate = await (prisma as any).autoPatentDraftBatch.updateMany({
    where: { id: batchId, userId, status: { in: CANCELLABLE_BATCH_STATUSES } },
    data: {
      status: 'CANCELLED',
      cancelledAt,
      cancelledById: userId,
      cancelReason: message,
      completedAt: batch.completedAt || cancelledAt,
      pausedAt: null,
      pausedById: null,
    }
  })
  if (batchUpdate.count !== 1) {
    const current = await getBatchForUser(batchId, userId)
    return current?.status === 'CANCELLED'
      ? { outcome: 'cancelled' as const, batchId, status: 'CANCELLED' as const }
      : { outcome: 'not_cancellable' as const, status: current?.status || 'UNKNOWN' }
  }

  await (prisma as any).patentDraftingJob.updateMany({
    where: {
      autoPatentDraftBatchId: batchId,
      userId,
      status: { in: ['QUEUED', 'PROCESSING'] }
    },
    data: {
      status: 'CANCELLED',
      currentStep: 'CANCELLED',
      cancelledAt,
      cancelledById: userId,
      lockedBy: null,
      lockedUntil: null,
      lastError: null,
    }
  })

  await (prisma as any).autoPatentDraftBatchItem.updateMany({
    where: {
      batchId,
      userId,
      status: { in: ['QUEUED', 'PROCESSING'] }
    },
    data: {
      status: 'CANCELLED',
      currentStep: 'CANCELLED',
      progressPct: 100,
      errorMessage: message,
    }
  })

  const refreshed = await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return { outcome: 'cancelled' as const, batchId, status: refreshed?.status || 'CANCELLED' as const }
}

async function getBatchItemsForUser(batchId: string, userId: string) {
  const batch = await getBatchForUser(batchId, userId)
  if (!batch) return null
  const items = await (prisma as any).autoPatentDraftBatchItem.findMany({
    where: { batchId, userId },
    orderBy: { itemNo: 'asc' }
  })
  return { batch, items }
}

async function documentsForItems(userId: string, items: any[]) {
  const artifactIds = Array.from(new Set(items.flatMap(item => Array.isArray(item.artifactIds) ? item.artifactIds : [])))
  if (!artifactIds.length) return []
  return prisma.document.findMany({
    where: {
      id: { in: artifactIds },
      userId,
      type: 'PATENT_DRAFT_EXPORT',
    },
    orderBy: { createdAt: 'asc' }
  })
}

export async function rebuildAutoPatentDraftBatchZip(batchId: string, userId: string) {
  const data = await getBatchItemsForUser(batchId, userId)
  if (!data) return { outcome: 'not_found' as const }
  const completedOrPartialItems = data.items.filter((item: any) =>
    (Array.isArray(item.artifactIds) && item.artifactIds.length > 0) || item.priorArtAudit || safeString(item.attorneyNotes)
  )
  if (!completedOrPartialItems.length) return { outcome: 'no_artifacts' as const }
  const result = await createBatchZip(data.batch, completedOrPartialItems, { forceRebuild: true })
  return { outcome: 'rebuilt' as const, batchId, documentId: result.documentId, token: result.token }
}

export async function getAutoPatentDraftBatchArtifactsForUser(batchId: string, userId: string) {
  const data = await getBatchItemsForUser(batchId, userId)
  if (!data) return null
  const documents = await documentsForItems(userId, data.items)
  const documentsById = new Map(documents.map((document: any) => [document.id, document]))

  return {
    batch: data.batch,
    items: data.items.map((item: any, index: number) => {
      const itemDocs = (Array.isArray(item.artifactIds) ? item.artifactIds : [])
        .map((id: string) => documentsById.get(id))
        .filter(Boolean)
      const artifacts = itemDocs.map((document: any) => ({
        id: document.id,
        filename: document.filename,
        category: artifactDownloadCategory(document),
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        createdAt: document.createdAt,
        downloadUrl: `/api/auto-patent-drafting/batches/${batchId}/artifacts/${document.id}`,
      }))
      return {
        itemId: item.id,
        itemNo: item.itemNo || index + 1,
        title: item.title,
        generatedTitle: item.generatedTitle || generatedTitleForRecord(item),
        jurisdictions: item.jurisdictions,
        status: item.status,
        currentStep: item.currentStep,
        progressPct: item.progressPct,
        reviewStatus: item.reviewStatus || 'NEEDS_REVIEW',
        attorneyNotes: item.attorneyNotes || '',
        warnings: item.warnings || [],
        error: item.errorMessage || undefined,
        patentId: item.patentId,
        sessionId: item.sessionId,
        priorArtAudit: item.priorArtAudit,
        artifacts,
        artifactGroups: {
          drafts: artifacts.filter((artifact: any) => artifact.category === 'drafts'),
          png: artifacts.filter((artifact: any) => artifact.category === 'png'),
          svg: artifacts.filter((artifact: any) => artifact.category === 'svg'),
          other: artifacts.filter((artifact: any) => artifact.category === 'other'),
        },
      }
    })
  }
}

export async function getAutoPatentDraftBatchArtifactForUser(batchId: string, documentId: string, userId: string) {
  const data = await getBatchItemsForUser(batchId, userId)
  if (!data) return null
  const allowedArtifactIds = new Set(data.items.flatMap((item: any) => Array.isArray(item.artifactIds) ? item.artifactIds : []))
  if (!allowedArtifactIds.has(documentId)) return null
  return prisma.document.findFirst({
    where: {
      id: documentId,
      userId,
      type: 'PATENT_DRAFT_EXPORT',
    }
  })
}

export async function updateAutoPatentDraftBatchItemReview(
  batchId: string,
  itemId: string,
  userId: string,
  input: { reviewStatus?: unknown; attorneyNotes?: unknown }
) {
  const batch = await getBatchForUser(batchId, userId)
  if (!batch) return { outcome: 'not_found' as const }
  const item = await (prisma as any).autoPatentDraftBatchItem.findFirst({ where: { id: itemId, batchId, userId } })
  if (!item) return { outcome: 'item_not_found' as const }
  const reviewStatus = input.reviewStatus === undefined ? item.reviewStatus || 'NEEDS_REVIEW' : normalizeReviewStatus(input.reviewStatus)
  const notes = input.attorneyNotes === undefined ? item.attorneyNotes : safeString(input.attorneyNotes).slice(0, 12000)
  const reviewed = reviewStatus !== 'NEEDS_REVIEW'
  const updated = await (prisma as any).autoPatentDraftBatchItem.update({
    where: { id: item.id },
    data: {
      reviewStatus,
      attorneyNotes: notes || null,
      reviewedAt: reviewed ? new Date() : null,
      reviewedById: reviewed ? userId : null,
    }
  })
  await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return { outcome: 'updated' as const, item: updated }
}

export async function retryAutoPatentDraftBatchItem(batchId: string, itemId: string, userId: string) {
  const batch = await getBatchForUser(batchId, userId)
  if (!batch) return { outcome: 'not_found' as const }
  const item = await (prisma as any).autoPatentDraftBatchItem.findFirst({ where: { id: itemId, batchId, userId } })
  if (!item) return { outcome: 'item_not_found' as const }
  if (!['FAILED', 'CANCELLED'].includes(item.status)) return { outcome: 'not_retryable' as const, status: item.status }
  if (!item.jobId) return { outcome: 'not_retryable' as const, status: 'NO_JOB' }

  const jobUpdate = await (prisma as any).patentDraftingJob.updateMany({
    where: { id: item.jobId, userId, autoPatentDraftBatchId: batchId, status: { in: ['FAILED', 'CANCELLED'] } },
    data: {
      status: 'QUEUED',
      currentStep: 'QUEUED',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      lastError: null,
      cancelledAt: null,
      cancelledById: null,
      completedAt: null,
      result: undefined,
    }
  })
  if (jobUpdate.count !== 1) return { outcome: 'not_retryable' as const, status: item.status }

  await (prisma as any).autoPatentDraftBatchItem.update({
    where: { id: item.id },
    data: {
      status: 'QUEUED',
      currentStep: 'QUEUED',
      progressPct: 5,
      errorMessage: null,
      warnings: null,
      artifactIds: [],
      priorArtAudit: null,
    }
  })
  await (prisma as any).autoPatentDraftBatch.update({
    where: { id: batchId },
    data: {
      status: 'QUEUED',
      completedAt: null,
      cancelledAt: null,
      cancelledById: null,
      cancelReason: null,
      completionEmailSentAt: null,
      zipDocumentId: null,
    }
  })
  const refreshed = await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return { outcome: 'retried' as const, batchId, itemId, status: refreshed?.status || 'QUEUED' }
}

export async function retryFailedAutoPatentDraftBatchItems(batchId: string, userId: string) {
  const data = await getBatchItemsForUser(batchId, userId)
  if (!data) return { outcome: 'not_found' as const }
  const retryable = data.items.filter((item: any) => ['FAILED', 'CANCELLED'].includes(item.status))
  let retried = 0
  for (const item of retryable) {
    const result = await retryAutoPatentDraftBatchItem(batchId, item.id, userId)
    if (result.outcome === 'retried') retried += 1
  }
  if (!retried) return { outcome: 'none_retryable' as const }
  const refreshed = await refreshAutoPatentDraftBatch(batchId, { sendEmail: false })
  return { outcome: 'retried' as const, batchId, retried, status: refreshed?.status || 'QUEUED' }
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

export type AutoPatentDraftBatchListOptions = {
  limit?: number
  cursor?: string
  status?: string
  q?: string
  from?: Date
  to?: Date
  attentionOnly?: boolean
}

function normalizeBatchListLimit(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 20
  return Math.max(1, Math.min(100, Math.floor(parsed)))
}

function buildBatchListWhere(userId: string, options: AutoPatentDraftBatchListOptions) {
  const where: any = { userId }
  const status = safeString(options.status).toUpperCase()
  if (status && status !== 'ALL') where.status = status
  const q = safeString(options.q)
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { sourceFilename: { contains: q, mode: 'insensitive' } },
    ]
  }
  if (options.from || options.to) {
    where.createdAt = {
      ...(options.from ? { gte: options.from } : {}),
      ...(options.to ? { lte: options.to } : {}),
    }
  }
  if (options.attentionOnly) {
    const attention = [
      { failedItems: { gt: 0 } },
      { warningItems: { gt: 0 } },
      { status: { in: ['FAILED', 'COMPLETED_WITH_ERRORS', 'CANCELLED'] } },
    ]
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: attention }]
  }
  return where
}

export async function listAutoPatentDraftBatchesForUser(userId: string, options: AutoPatentDraftBatchListOptions = {}) {
  const limit = normalizeBatchListLimit(options.limit)
  const where = buildBatchListWhere(userId, options)
  const countWhere = buildBatchListWhere(userId, { ...options, status: undefined })
  const [rows, statusGroups, totalCount] = await Promise.all([
    (prisma as any).autoPatentDraftBatch.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    }),
    (prisma as any).autoPatentDraftBatch.groupBy({
      by: ['status'],
      where: countWhere,
      _count: { _all: true },
    }),
    (prisma as any).autoPatentDraftBatch.count({ where }),
  ])
  const hasMore = rows.length > limit
  const batches = hasMore ? rows.slice(0, limit) : rows
  const statusCounts = Object.fromEntries((statusGroups || []).map((group: any) => [group.status, group._count?._all || 0]))
  return {
    batches,
    nextCursor: hasMore ? batches[batches.length - 1]?.id || null : null,
    hasMore,
    totalCount,
    statusCounts,
  }
}
