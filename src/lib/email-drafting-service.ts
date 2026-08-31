import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import mammoth from 'mammoth'
import { simpleParser } from 'mailparser'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateJWT } from '@/lib/auth'
import { sendEmail, SITE_URL } from '@/lib/mailer'
import { generateToken, hashToken } from '@/lib/token-utils'
import { upsertUserInstruction } from '@/lib/user-instruction-service'
import { checkServiceAccess } from '@/lib/org-access-service'
import { refreshAutoPatentDraftBatch, refreshReadyAutoPatentDraftBatches } from '@/lib/auto-patent-draft-batch-service'
import { isProtectedAIReviewIssue } from '@/lib/ai-review-protection'
import {
  AUTO_DRAFTING_BULK_RECIPIENT,
  EMAIL_DRAFTING_INBOUND_ADDRESS,
  EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS,
  EMAIL_DRAFTING_MAX_REQUESTS_PER_HOUR,
  EMAIL_DRAFTING_PROGRESS,
  EMAIL_DRAFTING_PROJECT_NAME,
  EMAIL_DRAFTING_STALE_LOCK_MINUTES,
  MAX_DRAFTING_INPUT_CHARS,
} from '@/lib/drafting-constants'

type CanonicalAttachment = {
  filename: string
  mimeType?: string
  sizeBytes: number
  kind: 'MAIN_BRIEF' | 'CLAIMS' | 'PRIOR_ART' | 'SUPPLEMENTAL' | 'UNSUPPORTED_IMAGE' | 'UNSUPPORTED_OTHER'
  extractedText?: string
  warning?: string
}

export type EmailDraftPayload = {
  parserVersion: 1
  source?: 'email' | 'bulk_upload'
  suppressNotificationEmails?: boolean
  title: string
  jurisdictions: string[]
  filingType: string
  allowRefine: boolean
  coverMemo: string
  mainBriefText: string
  normalizationBrief: string
  claimsText: string
  claimsHandling: 'use as is' | 'improve' | 'draft from brief' | 'auto'
  claimsNotes: string
  priorArtText: string
  priorArtHandling: 'use only' | 'expand with search' | 'auto'
  noveltyText?: string
  literatureReviewInstructions?: string
  literatureReviewContent?: string
  figureDirections: string
  draftingRemarks?: string
  illustrativeData: string
  warnings: string[]
  attachments: CanonicalAttachment[]
}

type NormalizedInboundEmail = {
  senderEmail: string
  senderDisplayName?: string
  recipientEmail: string
  subject: string
  messageId?: string
  receiptId?: string
  rawMimeText?: string
  directBodyText?: string
  directAttachments?: Array<{
    filename: string
    mimeType?: string
    contentBase64?: string
    contentText?: string
  }>
  verdicts?: {
    dkim?: string
    spf?: string
    dmarc?: string
    spam?: string
    virus?: string
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function sha256(input: Buffer | string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function getFirstParsedAddress(
  addressField: { value?: Array<{ address?: string; name?: string }> } | Array<{ value?: Array<{ address?: string; name?: string }> }> | null | undefined
) {
  if (!addressField) return null
  const normalizedField = Array.isArray(addressField) ? addressField[0] : addressField
  const firstValue = normalizedField?.value?.[0]
  if (!firstValue?.address) return null
  return firstValue
}

function parseAddress(address?: string | null): { localPart: string; domain: string } | null {
  if (!address || !address.includes('@')) return null
  const [localPart, domain] = address.trim().toLowerCase().split('@')
  if (!localPart || !domain) return null
  return { localPart, domain }
}

function toJsonSafe(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null))
}

function condenseForNormalization(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_DRAFTING_INPUT_CHARS) return trimmed
  const head = trimmed.slice(0, 10000).trimEnd()
  const tail = trimmed.slice(-4500).trimStart()
  return `${head}\n\n[Condensed for normalization. Original disclosure retained in request records.]\n\n${tail}`.slice(0, MAX_DRAFTING_INPUT_CHARS)
}

function detectClaimsCompleteness(text: string): boolean {
  if (!text.trim()) return false
  const numberedClaims = Array.from(text.matchAll(/(?:^|\n)\s*(\d+)\./g)).map(match => Number(match[1]))
  return numberedClaims.includes(1) && numberedClaims.some(num => num > 1)
}

function detectPriorArtExhaustive(text: string): boolean {
  if (!text.trim()) return false
  const publicationMatches = text.match(/\b(?:US|EP|WO|CN|JP|KR|IN)?\s?\d{4,}\b/g) || []
  return publicationMatches.length >= 2
}

function parseClaimsHandling(value: string): EmailDraftPayload['claimsHandling'] {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'use as is') return 'use as is'
  if (normalized === 'improve') return 'improve'
  if (normalized === 'draft from brief') return 'draft from brief'
  return 'auto'
}

function parsePriorArtHandling(value: string): EmailDraftPayload['priorArtHandling'] {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'use only') return 'use only'
  if (normalized === 'expand with search') return 'expand with search'
  return 'auto'
}

function parseFilingType(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'utility' || normalized === 'provisional' || normalized === 'design') {
    return normalized
  }
  return 'utility'
}

function extractLabelSections(bodyText: string): Record<string, string> {
  const labels = [
    'Title',
    'Jurisdictions',
    'Filing Type',
    'Idea Handling',
    'Idea Treatment',
    'Main Brief',
    'Claims',
    'Claims Handling',
    'Claims Notes',
    'Novelty',
    'Prior Art',
    'Prior Art Handling',
    'Literature Review Instructions',
    'Literature Review Content',
    'Figure Directions',
    'Figure Remarks',
    'Illustrative Data',
    'Patent Drafting Remarks',
    'Drafting Remarks',
  ]
  const labelMap = new Map(labels.map(label => [label.toLowerCase(), label]))
  const sections: Record<string, string> = {}
  let currentLabel: string | null = null
  let currentLines: string[] = []
  const bodyLines = bodyText.replace(/\r\n/g, '\n').split('\n')

  const flush = () => {
    if (currentLabel) {
      sections[currentLabel] = currentLines.join('\n').trim()
    }
  }

  for (const line of bodyLines) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z ]+):\s*(.*)$/)
    const foundLabel = match ? labelMap.get(match[1].trim().toLowerCase()) : undefined
    if (foundLabel) {
      flush()
      currentLabel = foundLabel
      currentLines = match?.[2] ? [match[2]] : []
      continue
    }
    currentLines.push(line)
  }

  flush()
  return sections
}

async function extractTextFromBuffer(filename: string, mimeType: string | undefined, content: Buffer) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.docx') || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.convertToHtml({ buffer: content })
    return stripHtml(result.value)
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || mimeType?.startsWith('text/')) {
    return content.toString('utf8').replace(/\uFEFF/g, '').trim()
  }
  return ''
}

async function parseRawMimeEmail(rawMimeText: string) {
  const parsed = await simpleParser(rawMimeText)
  const attachments: CanonicalAttachment[] = []

  for (let index = 0; index < parsed.attachments.length; index += 1) {
    const attachment = parsed.attachments[index]
    const lower = (attachment.filename || '').toLowerCase()
    const mimeType = attachment.contentType
    const sizeBytes = attachment.size || attachment.content.length
    const isImage = mimeType?.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.svg', '.webp'].some(ext => lower.endsWith(ext))

    if (isImage) {
      attachments.push({
        filename: attachment.filename || `attachment-${index + 1}`,
        mimeType,
        sizeBytes,
        kind: 'UNSUPPORTED_IMAGE',
        warning: 'Image attachments are ignored in email drafting mode.'
      })
      continue
    }

    const extractedText = await extractTextFromBuffer(attachment.filename || `attachment-${index + 1}`, mimeType, attachment.content)
    if (!extractedText.trim()) {
      attachments.push({
        filename: attachment.filename || `attachment-${index + 1}`,
        mimeType,
        sizeBytes,
        kind: 'UNSUPPORTED_OTHER',
        warning: 'Unsupported attachment type for email drafting.'
      })
      continue
    }

    attachments.push({
      filename: attachment.filename || `attachment-${index + 1}`,
      mimeType,
      sizeBytes,
      kind: 'SUPPLEMENTAL',
      extractedText
    })
  }

  return {
    senderEmail: normalizeEmail(getFirstParsedAddress(parsed.from)?.address || ''),
    senderDisplayName: getFirstParsedAddress(parsed.from)?.name || undefined,
    recipientEmail: normalizeEmail(getFirstParsedAddress(parsed.to)?.address || ''),
    subject: parsed.subject || '',
    messageId: parsed.messageId || undefined,
    bodyText: (parsed.text || parsed.html ? stripHtml(parsed.text || String(parsed.html || '')) : '').trim(),
    attachments,
    headers: parsed.headers,
  }
}

async function parseDirectPayloadEmail(normalized: NormalizedInboundEmail) {
  const attachments: CanonicalAttachment[] = []
  for (let index = 0; index < (normalized.directAttachments || []).length; index += 1) {
    const attachment = normalized.directAttachments?.[index]
    if (!attachment) continue
    const buffer = attachment.contentBase64
      ? Buffer.from(attachment.contentBase64, 'base64')
      : Buffer.from(attachment.contentText || '', 'utf8')
    const lower = attachment.filename.toLowerCase()
    const isImage = attachment.mimeType?.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.svg', '.webp'].some(ext => lower.endsWith(ext))
    if (isImage) {
      attachments.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: buffer.length,
        kind: 'UNSUPPORTED_IMAGE',
        warning: 'Image attachments are ignored in email drafting mode.'
      })
      continue
    }
    const extractedText = await extractTextFromBuffer(attachment.filename, attachment.mimeType, buffer)
    attachments.push({
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: buffer.length,
      kind: extractedText ? 'SUPPLEMENTAL' : 'UNSUPPORTED_OTHER',
      extractedText,
      warning: extractedText ? undefined : 'Unsupported attachment type for email drafting.'
    })
  }

  return {
    senderEmail: normalized.senderEmail,
    senderDisplayName: normalized.senderDisplayName,
    recipientEmail: normalized.recipientEmail,
    subject: normalized.subject || '',
    messageId: normalized.messageId,
    bodyText: normalized.directBodyText || '',
    attachments,
    headers: new Map<string, string>(),
  }
}

export async function buildCanonicalEmailDraftPayload(requestRecord: any): Promise<EmailDraftPayload> {
  const parsedEmail = requestRecord.rawMimeText
    ? await parseRawMimeEmail(requestRecord.rawMimeText)
    : await parseDirectPayloadEmail({
        senderEmail: requestRecord.senderEmail,
        senderDisplayName: requestRecord.senderDisplayName,
        recipientEmail: requestRecord.recipientEmail,
        subject: requestRecord.subject || '',
        messageId: requestRecord.messageId || undefined,
        directBodyText: requestRecord.parsedPayload?.directBodyText || '',
        directAttachments: requestRecord.parsedPayload?.directAttachments || [],
      })

  const autoSubmitted = String(parsedEmail.headers.get('auto-submitted') || '').toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') {
    throw Object.assign(new Error('Automatic responder emails are not accepted.'), { code: 'AUTO_RESPONDER' })
  }

  const sections = extractLabelSections(parsedEmail.bodyText)
  const warnings: string[] = []

  const bodyClaims = sections['Claims']?.trim() || ''
  const bodyPriorArt = sections['Prior Art']?.trim() || ''
  const noveltyText = sections['Novelty']?.trim() || ''
  const literatureReviewInstructions = sections['Literature Review Instructions']?.trim() || ''
  const literatureReviewContent = sections['Literature Review Content']?.trim() || ''
  const figureDirections = (sections['Figure Directions'] || sections['Figure Remarks'] || '').trim()
  const draftingRemarks = (sections['Patent Drafting Remarks'] || sections['Drafting Remarks'] || '').trim()
  const labeledMainBrief = sections['Main Brief']?.trim() || ''
  const unlabeledBody = parsedEmail.bodyText.trim()
  const claimsCandidates: CanonicalAttachment[] = []
  const priorArtCandidates: CanonicalAttachment[] = []
  const generalTextCandidates: CanonicalAttachment[] = []

  for (const attachment of parsedEmail.attachments) {
    if (attachment.kind === 'UNSUPPORTED_IMAGE' || attachment.kind === 'UNSUPPORTED_OTHER') {
      if (attachment.warning) warnings.push(`${attachment.filename}: ${attachment.warning}`)
      continue
    }
    const lower = attachment.filename.toLowerCase()
    if (/\bclaims?\b/.test(lower)) {
      claimsCandidates.push({ ...attachment, kind: 'CLAIMS' })
      continue
    }
    if (/\bprior\b|\bart\b|\breference\b/.test(lower)) {
      priorArtCandidates.push({ ...attachment, kind: 'PRIOR_ART' })
      continue
    }
    generalTextCandidates.push(attachment)
  }

  if (!bodyClaims && claimsCandidates.length > 1) {
    throw Object.assign(new Error('Multiple claims attachments were detected without explicit guidance. Please resend a clearer email.'), {
      code: 'REJECTED_AMBIGUOUS'
    })
  }

  let mainBriefText = labeledMainBrief
  let coverMemo = ''
  let claimsText = bodyClaims
  let priorArtText = [bodyPriorArt, literatureReviewContent].filter(Boolean).join('\n\n')

  if (!sections['Claims'] && claimsCandidates.length === 1) {
    claimsText = claimsCandidates[0].extractedText || ''
  }

  if (!sections['Prior Art'] && priorArtCandidates.length > 0) {
    const attachmentPriorArtText = priorArtCandidates.map(candidate => candidate.extractedText || '').filter(Boolean).join('\n\n')
    priorArtText = [priorArtText, attachmentPriorArtText].filter(Boolean).join('\n\n')
  }

  if (generalTextCandidates.length === 1 && unlabeledBody && Object.keys(sections).length === 0) {
    coverMemo = unlabeledBody
    mainBriefText = generalTextCandidates[0].extractedText || ''
    generalTextCandidates[0].kind = 'MAIN_BRIEF'
  } else if (generalTextCandidates.length > 0) {
    const sorted = [...generalTextCandidates].sort((a, b) => (b.extractedText?.length || 0) - (a.extractedText?.length || 0))
    mainBriefText = sorted[0].extractedText || ''
    sorted[0].kind = 'MAIN_BRIEF'
    if (sorted.length > 1) {
      const supplementalNotes = sorted.slice(1).map(item => item.extractedText || '').filter(Boolean).join('\n\n')
      if (supplementalNotes) {
        coverMemo = [coverMemo, supplementalNotes].filter(Boolean).join('\n\n')
      }
    }
  }

  if (!mainBriefText) {
    const strippedClaims = bodyClaims ? unlabeledBody.replace(bodyClaims, '').trim() : unlabeledBody
    const strippedPriorArt = bodyPriorArt ? strippedClaims.replace(bodyPriorArt, '').trim() : strippedClaims
    mainBriefText = strippedPriorArt
  }

  if (!mainBriefText.trim()) {
    throw Object.assign(new Error('No usable invention brief was found in the email body or attachments.'), {
      code: 'EMPTY_USABLE_CONTENT'
    })
  }

  const title = sections['Title']?.trim() || parsedEmail.subject || requestRecord.subject || 'Email Patent Draft Request'
  const jurisdictions = (sections['Jurisdictions'] || '')
    .split(/[,\s]+/)
    .map(item => item.trim().toUpperCase())
    .filter(Boolean)

  const claimsHandling = sections['Claims Handling']
    ? parseClaimsHandling(sections['Claims Handling'])
    : claimsText
      ? (detectClaimsCompleteness(claimsText) ? 'use as is' : 'improve')
      : 'draft from brief'

  // "Idea Handling: keep as is / preserve / exactly as provided" opts the draft into
  // PRESERVE mode; anything else keeps the historical structure-and-polish default.
  const ideaHandlingRaw = (sections['Idea Handling'] || sections['Idea Treatment'] || '').trim().toLowerCase()
  const allowRefine = !/(keep\s*(it|my\s*idea)?\s*as[\s-]*is|as[\s-]*it[\s-]*is|preserve|exactly\s+as\s+provided|verbatim|do\s+not\s+(refine|change|modify))/i.test(ideaHandlingRaw)

  const priorArtHandling = sections['Prior Art Handling']
    ? parsePriorArtHandling(sections['Prior Art Handling'])
    : priorArtText
      ? (/(search|expand|refine)/i.test(priorArtText) ? 'expand with search' : (detectPriorArtExhaustive(priorArtText) ? 'use only' : 'expand with search'))
      : 'auto'

  if (!claimsText && claimsHandling === 'use as is') {
    warnings.push('Claims handling requested "use as is" but no claims text was supplied. Falling back to drafting claims from the brief.')
  }

  return {
    parserVersion: 1,
    title: title.trim(),
    jurisdictions,
    filingType: parseFilingType(sections['Filing Type'] || ''),
    allowRefine,
    coverMemo: coverMemo.trim(),
    mainBriefText: [mainBriefText.trim(), noveltyText ? `Novelty / inventive distinction:\n${noveltyText}` : ''].filter(Boolean).join('\n\n'),
    normalizationBrief: condenseForNormalization([mainBriefText, noveltyText ? `Novelty / inventive distinction:\n${noveltyText}` : ''].filter(Boolean).join('\n\n')),
    claimsText: claimsText.trim(),
    claimsHandling: (!claimsText && claimsHandling === 'use as is') ? 'draft from brief' : claimsHandling,
    claimsNotes: sections['Claims Notes']?.trim() || '',
    priorArtText: priorArtText.trim(),
    priorArtHandling,
    noveltyText,
    literatureReviewInstructions,
    literatureReviewContent,
    figureDirections,
    draftingRemarks,
    illustrativeData: sections['Illustrative Data']?.trim() || '',
    warnings,
    attachments: [
      ...generalTextCandidates,
      ...claimsCandidates,
      ...priorArtCandidates,
      ...parsedEmail.attachments.filter(item => item.kind === 'UNSUPPORTED_IMAGE' || item.kind === 'UNSUPPORTED_OTHER')
    ]
  }
}

function buildEnabledJurisdictionToggles(jurisdictions: unknown): Record<string, boolean> {
  const source = Array.isArray(jurisdictions) ? jurisdictions : []
  return Object.fromEntries(
    source
      .map(code => String(code || '').trim().toUpperCase())
      .filter(Boolean)
      .map(code => [code, true] as const)
  )
}

async function createEvent(requestId: string, stage: string, state: string, message?: string, meta?: any) {
  await (prisma as any).emailDraftEvent.create({
    data: {
      requestId,
      stage,
      state,
      message,
      meta: meta ? toJsonSafe(meta) : undefined,
    }
  })
}

async function updateRequest(requestId: string, data: Record<string, unknown>) {
  return (prisma as any).emailDraftRequest.update({
    where: { id: requestId },
    data
  })
}

async function transitionRequest(requestId: string, status: string, extra?: Record<string, unknown>) {
  const progressPct = EMAIL_DRAFTING_PROGRESS[status] ?? EMAIL_DRAFTING_PROGRESS.FAILED
  await updateRequest(requestId, {
    status,
    currentStage: status,
    progressPct,
    ...(extra || {})
  })
  await createEvent(requestId, status, 'started')
}

async function failRequest(requestId: string, errorCode: string, errorMessage: string, status: 'FAILED' | 'REJECTED' | 'CANCELED' = 'FAILED') {
  await updateRequest(requestId, {
    status,
    currentStage: status,
    progressPct: EMAIL_DRAFTING_PROGRESS[status],
    errorCode,
    errorMessage,
    completedAt: new Date(),
    lockedBy: null,
    lockedUntil: null,
  })
  await createEvent(requestId, status, 'failed', errorMessage, { errorCode })
}

async function getUserWithTenant(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { tenant: true }
  })
}

function buildInternalUserJwt(user: any) {
  return generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant'
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
      'content-type': 'application/json'
    },
    body: JSON.stringify(params.body)
  })

  const response = await routeModule.POST(request, { params: { patentId: params.patentId } })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok) {
    const errorBody = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : { error: await response.text().catch(() => 'Unknown drafting error') }
    throw Object.assign(new Error(errorBody.error || errorBody.message || 'Drafting action failed'), {
      status: response.status,
      body: errorBody
    })
  }

  if (contentType.includes('application/json')) {
    return {
      response,
      json: await response.json()
    }
  }

  return { response, json: null as any }
}

async function getOrCreateEmailDraftingProject(userId: string) {
  const existing = await prisma.project.findFirst({
    where: { userId, name: EMAIL_DRAFTING_PROJECT_NAME }
  })
  if (existing) return existing
  return prisma.project.create({
    data: {
      userId,
      name: EMAIL_DRAFTING_PROJECT_NAME
    }
  })
}

async function getProjectForDraftRequest(userId: string, requestRecord: any) {
  if (requestRecord.projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: requestRecord.projectId,
        OR: [
          { userId },
          { collaborators: { some: { userId } } }
        ]
      }
    })

    if (!project) {
      throw Object.assign(new Error('Project not found or access denied.'), { code: 'PROJECT_ACCESS_DENIED' })
    }

    return project
  }

  return getOrCreateEmailDraftingProject(userId)
}

async function createPatentForEmailRequest(projectId: string, userId: string, title: string) {
  return prisma.patent.create({
    data: {
      projectId,
      createdBy: userId,
      title
    }
  })
}

async function persistParsedPayload(requestId: string, payload: EmailDraftPayload) {
  await updateRequest(requestId, {
    parsedPayload: toJsonSafe(payload),
    normalizationBrief: payload.normalizationBrief,
    warnings: toJsonSafe(payload.warnings),
  })

  await (prisma as any).emailDraftAttachment.deleteMany({ where: { requestId } })
  for (let index = 0; index < payload.attachments.length; index += 1) {
    const attachment = payload.attachments[index]
    const content = attachment.extractedText || attachment.warning || ''
    await (prisma as any).emailDraftAttachment.create({
      data: {
        requestId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sha256: sha256(content || attachment.filename),
        sizeBytes: attachment.sizeBytes,
        attachmentOrder: index,
        kind: attachment.kind,
        parseStatus: attachment.extractedText ? 'PARSED' : 'IGNORED',
        extractedText: attachment.extractedText,
        warning: attachment.warning
      }
    })
  }
}

async function sendAcknowledgementEmail(user: any, requestRecord: any, payload: EmailDraftPayload) {
  const progressLink = `${SITE_URL}/email-drafting/requests/${requestRecord.id}`
  const warningBlock = payload.warnings.length
    ? `<p><strong>Warnings:</strong> ${payload.warnings.join('; ')}</p>`
    : ''

  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject: `Patent draft request received: ${payload.title}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Patent draft request received</h2>
        <p>Your email request has been accepted and queued.</p>
        <p><strong>Title:</strong> ${payload.title}</p>
        <p><strong>Jurisdictions:</strong> ${(payload.jurisdictions.length ? payload.jurisdictions : ['IN']).join(', ')}</p>
        <p><strong>Claims mode:</strong> ${payload.claimsHandling}</p>
        <p><strong>Prior art mode:</strong> ${payload.priorArtHandling}</p>
        <p><strong>Figure mode:</strong> PlantUML only</p>
        ${warningBlock}
        <p>You can track progress in-app after logging in.</p>
        <p style="font-size:13px;color:#475569">Tracking reference: ${requestRecord.id}</p>
        <p style="font-size:13px;color:#475569">Direct link: <a href="${progressLink}">${progressLink}</a></p>
      </div>
    `,
    text: `Patent draft request received for ${payload.title}. Tracking reference: ${requestRecord.id}.`
  })
}

async function sendFailureEmail(user: any, requestRecord: any) {
  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject: `Patent draft request could not be completed: ${requestRecord.subject || requestRecord.id}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Patent draft request failed</h2>
        <p><strong>Reason:</strong> ${requestRecord.errorMessage || 'Unknown error'}</p>
        <p>Please resend the request with clearer inputs or contact support.</p>
      </div>
    `,
    text: `Patent draft request failed: ${requestRecord.errorMessage || 'Unknown error'}`
  })
}

async function createDocumentAccessLink(documentId: string, userId: string, requestId: string, ttlDays = EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS) {
  const token = generateToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
  await (prisma as any).documentAccessLink.create({
    data: {
      documentId,
      userId,
      requestId,
      tokenHash,
      expiresAt
    }
  })
  return token
}

async function sendCompletionEmail(user: any, requestRecord: any, downloadToken: string, warnings: string[]) {
  const link = `${SITE_URL}/email-drafting/download/${downloadToken}`
  await sendEmail({
    to: user.email,
    toName: user.name || undefined,
    subject: `Patent draft ready: ${requestRecord.subject || requestRecord.id}`,
    html: `
      <div style="font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 12px">Your patent draft is ready</h2>
        <p>Sign in to PatentNest and use the link below to download the exported draft.</p>
        ${warnings.length ? `<p><strong>Warnings:</strong> ${warnings.join('; ')}</p>` : ''}
        <p><a href="${link}">${link}</a></p>
      </div>
    `,
    text: `Your patent draft is ready: ${link}`
  })
}

async function storeExportArtifact(params: {
  requestId: string
  user: any
  tenantId: string
  filename: string
  buffer: Buffer
  mimeType: string
}) {
  const outDir = path.join(process.cwd(), 'uploads', 'email-drafts', params.requestId)
  await fs.mkdir(outDir, { recursive: true })
  const filePath = path.join(outDir, params.filename)
  await fs.writeFile(filePath, params.buffer)

  const document = await prisma.document.create({
    data: {
      tenantId: params.tenantId,
      userId: params.user.id,
      type: 'PATENT_DRAFT_EXPORT',
      filename: params.filename,
      contentPtr: filePath,
      hash: sha256(params.buffer),
      mimeType: params.mimeType,
      sizeBytes: params.buffer.length,
    }
  })

  return document
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
    issue?.fixPrompt
  ].filter(Boolean).join(' ').toLowerCase()
  return /\b(diagram|figure|drawing|sketch|plantuml|briefdescriptionofdrawings|brief description of drawings)\b/.test(text)
}

async function getLatestDraftForJurisdiction(sessionId: string, jurisdiction: string) {
  return prisma.annexureDraft.findFirst({
    where: { sessionId, jurisdiction: jurisdiction.toUpperCase() },
    orderBy: { version: 'desc' }
  })
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
    ...((draft.extraSections as any) || {})
  }
}

async function setActiveDraftingJurisdiction(sessionId: string, jurisdiction: string) {
  await prisma.draftingSession.update({
    where: { id: sessionId },
    data: { activeJurisdiction: jurisdiction.toUpperCase() } as any
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
      jurisdiction: params.jurisdiction
    }
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

    const relatedContent = Object.fromEntries(
      Object.entries(sectionMap).filter(([key]) => key !== sectionKey)
    )

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
        relatedContent
      }
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
        patch: { [sectionKey]: fixedContent }
      }
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
        jurisdiction: params.jurisdiction
      }
    })
  }

  return { issueCount: issues.length, appliedFixes }
}

async function validateInboundSender(alias: any, senderEmail: string) {
  const user = await prisma.user.findFirst({
    where: {
      email: normalizeEmail(senderEmail),
      ...(alias?.tenantId ? { tenantId: alias.tenantId } : {})
    },
    include: { tenant: true }
  })

  if (!user) {
    return { ok: false as const, code: 'UNAUTHORIZED_SENDER', message: 'Sender is not an active tenant user.' }
  }

  if (user.status !== 'ACTIVE') {
    return { ok: false as const, code: 'USER_INACTIVE', message: 'User account is not active.' }
  }

  if (!user.emailVerified) {
    return { ok: false as const, code: 'UNVERIFIED_SENDER', message: 'User email is not verified.' }
  }

  if (!user.emailDraftingEnabled) {
    return { ok: false as const, code: 'USER_NOT_OPTED_IN', message: 'Email drafting is not enabled for this user.' }
  }

  if (!user.tenant || (user.tenant.status !== 'ACTIVE' && user.tenant.status !== 'PENDING_PAYMENT')) {
    return { ok: false as const, code: 'TENANT_INACTIVE', message: 'Tenant is not active.' }
  }

  const serviceAccess = await checkServiceAccess(user.id, user.tenantId!, 'PATENT_DRAFTING')
  if (!serviceAccess.allowed) {
    return { ok: false as const, code: 'SERVICE_ACCESS_DENIED', message: serviceAccess.reason || 'Patent drafting is not available for this user.' }
  }

  return { ok: true as const, user }
}

export function normalizeInboundEmailPayload(input: any): NormalizedInboundEmail {
  const topLevel = input?.Type === 'Notification' && typeof input?.Message === 'string'
    ? JSON.parse(input.Message)
    : input

  const senderEmail = normalizeEmail(
    topLevel?.mail?.source ||
    topLevel?.senderEmail ||
    topLevel?.from ||
    topLevel?.source ||
    ''
  )
  const recipientEmail = normalizeEmail(
    topLevel?.mail?.destination?.[0] ||
    topLevel?.recipientEmail ||
    topLevel?.to ||
    ''
  )

  return {
    senderEmail,
    senderDisplayName: topLevel?.senderDisplayName || topLevel?.parsedEmail?.senderDisplayName,
    recipientEmail,
    subject: topLevel?.mail?.commonHeaders?.subject || topLevel?.subject || '',
    messageId: topLevel?.mail?.messageId || topLevel?.messageId || topLevel?.parsedEmail?.messageId,
    receiptId: topLevel?.receipt?.action?.objectKey || topLevel?.receipt?.processingTimeMillis || topLevel?.receiptId,
    rawMimeText: topLevel?.rawMimeText || topLevel?.rawEmail || topLevel?.content || topLevel?.parsedEmail?.rawMimeText,
    directBodyText: topLevel?.parsedEmail?.bodyText || topLevel?.bodyText,
    directAttachments: topLevel?.parsedEmail?.attachments,
    verdicts: {
      dkim: topLevel?.receipt?.dkimVerdict?.status,
      spf: topLevel?.receipt?.spfVerdict?.status,
      dmarc: topLevel?.receipt?.dmarcVerdict?.status,
      spam: topLevel?.receipt?.spamVerdict?.status,
      virus: topLevel?.receipt?.virusVerdict?.status,
    }
  }
}

export async function receiveInboundEmail(input: any) {
  const normalized = normalizeInboundEmailPayload(input)
  const parsedRecipient = parseAddress(normalized.recipientEmail)
  if (!parsedRecipient) {
    return { accepted: false as const, status: 400, errorCode: 'UNKNOWN_ALIAS', message: 'Recipient alias was not recognized.' }
  }

  if (normalized.verdicts?.virus?.toUpperCase() === 'FAIL') {
    return { accepted: false as const, status: 400, errorCode: 'MALICIOUS_EMAIL', message: 'Email failed virus checks.' }
  }

  if (normalized.verdicts?.spam?.toUpperCase() === 'FAIL') {
    return { accepted: false as const, status: 400, errorCode: 'SPAM_REJECTED', message: 'Email failed spam checks.' }
  }

  const dkimFailed = normalized.verdicts?.dkim?.toUpperCase() === 'FAIL'
  const spfFailed = normalized.verdicts?.spf?.toUpperCase() === 'FAIL'
  if (dkimFailed && spfFailed) {
    return { accepted: false as const, status: 403, errorCode: 'UNVERIFIED_SENDER', message: 'Sender verification failed.' }
  }

  const isSharedInboundAddress = normalizeEmail(normalized.recipientEmail) === normalizeEmail(EMAIL_DRAFTING_INBOUND_ADDRESS)
  const alias = isSharedInboundAddress
    ? null
    : await (prisma as any).tenantInboundAlias.findFirst({
        where: {
          localPart: parsedRecipient.localPart,
          domain: parsedRecipient.domain,
          isActive: true
        }
      })

  let effectiveAlias = alias
  if (!effectiveAlias && !isSharedInboundAddress) {
    const tenantAtiId = parsedRecipient.localPart.replace(/^draft\+/, '').toUpperCase()
    if (tenantAtiId) {
      const fallbackTenant = await prisma.tenant.findUnique({
        where: { atiId: tenantAtiId },
        select: { id: true }
      })
      if (fallbackTenant) {
        effectiveAlias = await (prisma as any).tenantInboundAlias.create({
          data: {
            tenantId: fallbackTenant.id,
            localPart: parsedRecipient.localPart,
            domain: parsedRecipient.domain,
            defaultJurisdictions: ['IN']
          }
        })
      }
    }
  }

  if (!effectiveAlias && !isSharedInboundAddress) {
    return { accepted: false as const, status: 404, errorCode: 'UNKNOWN_ALIAS', message: 'Recipient alias was not recognized.' }
  }

  const senderResult = await validateInboundSender(effectiveAlias, normalized.senderEmail)
  if (!senderResult.ok) {
    return { accepted: false as const, status: 403, errorCode: senderResult.code, message: senderResult.message }
  }

  const acceptedRecently = await (prisma as any).emailDraftRequest.count({
    where: {
      userId: senderResult.user.id,
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      status: { notIn: ['REJECTED', 'FAILED', 'CANCELED'] }
    }
  })
  if (acceptedRecently >= EMAIL_DRAFTING_MAX_REQUESTS_PER_HOUR) {
    return { accepted: false as const, status: 429, errorCode: 'RATE_LIMITED', message: 'Hourly email drafting request limit exceeded.' }
  }

  const hashInput = normalized.rawMimeText || JSON.stringify({
    subject: normalized.subject,
    body: normalized.directBodyText,
    sender: normalized.senderEmail,
    recipient: normalized.recipientEmail
  })
  const requestHash = sha256(hashInput)
  const dedupeKey = normalized.receiptId
    ? String(normalized.receiptId)
    : `${normalized.messageId || 'no-message-id'}:${requestHash}`

  try {
    const requestRecord = await (prisma as any).emailDraftRequest.create({
      data: {
        tenantId: senderResult.user.tenantId,
        aliasId: effectiveAlias?.id ?? null,
        userId: senderResult.user.id,
        subject: normalized.subject,
        senderEmail: normalized.senderEmail,
        senderDisplayName: normalized.senderDisplayName,
        recipientEmail: normalized.recipientEmail,
        messageId: normalized.messageId,
        receiptId: normalized.receiptId ? String(normalized.receiptId) : null,
        requestHash,
        dedupeKey,
        rawMimeText: normalized.rawMimeText,
        parsedPayload: normalized.rawMimeText ? undefined : {
          directBodyText: normalized.directBodyText || '',
          directAttachments: normalized.directAttachments || []
        },
        status: 'RECEIVED',
        currentStage: 'RECEIVED',
        progressPct: EMAIL_DRAFTING_PROGRESS.RECEIVED
      }
    })

    await createEvent(requestRecord.id, 'RECEIVED', 'accepted', 'Inbound email accepted for processing')

    return { accepted: true as const, status: 202, requestId: requestRecord.id, user: senderResult.user, alias: effectiveAlias ?? null }
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const existing = await (prisma as any).emailDraftRequest.findUnique({ where: { dedupeKey } })
      return { accepted: true as const, status: 200, requestId: existing?.id, duplicate: true }
    }
    throw error
  }
}

async function ensureNoActiveSiblingRequest(requestRecord: any) {
  const sibling = await (prisma as any).emailDraftRequest.findFirst({
    where: {
      userId: requestRecord.userId,
      id: { not: requestRecord.id },
      status: {
        in: ['VALIDATING', 'PARSING', 'INITIALIZING', 'NORMALIZING', 'CLAIMS_SETUP', 'PRIOR_ART_CONTEXT', 'COMPONENTS', 'FIGURES', 'DRAFTING', 'REVIEW', 'EXPORT']
      }
    }
  })

  if (sibling) {
    await updateRequest(requestRecord.id, {
      nextAttemptAt: new Date(Date.now() + 60 * 1000),
      lockedBy: null,
      lockedUntil: null
    })
    return false
  }

  return true
}

export async function claimNextEmailDraftRequest(workerId: string) {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - EMAIL_DRAFTING_STALE_LOCK_MINUTES * 60 * 1000)
  const candidates = await (prisma as any).emailDraftRequest.findMany({
    where: {
      status: {
        in: ['RECEIVED', 'VALIDATING', 'PARSING', 'INITIALIZING', 'NORMALIZING', 'CLAIMS_SETUP', 'PRIOR_ART_CONTEXT', 'COMPONENTS', 'FIGURES', 'DRAFTING', 'REVIEW', 'EXPORT']
      },
      nextAttemptAt: { lte: now },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now } },
        { heartbeatAt: { lt: staleBefore } }
      ]
    },
    orderBy: [{ createdAt: 'asc' }],
    take: 10
  })

  for (const candidate of candidates) {
    const updated = await (prisma as any).emailDraftRequest.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { lockedUntil: null },
          { lockedUntil: { lt: now } },
          { heartbeatAt: { lt: staleBefore } }
        ]
      },
      data: {
        lockedBy: workerId,
        lockedUntil: new Date(now.getTime() + EMAIL_DRAFTING_STALE_LOCK_MINUTES * 60 * 1000),
        heartbeatAt: now
      }
    })

    if (updated.count === 1) {
      return (prisma as any).emailDraftRequest.findUnique({ where: { id: candidate.id } })
    }
  }

  return null
}

async function heartbeatRequest(requestId: string, workerId: string) {
  await (prisma as any).emailDraftRequest.updateMany({
    where: { id: requestId, lockedBy: workerId },
    data: {
      heartbeatAt: new Date(),
      lockedUntil: new Date(Date.now() + EMAIL_DRAFTING_STALE_LOCK_MINUTES * 60 * 1000)
    }
  })
}

export async function processEmailDraftRequestById(requestId: string, workerId = `worker-${process.pid}`) {
  const requestRecord = await (prisma as any).emailDraftRequest.findUnique({ where: { id: requestId } })
  if (!requestRecord) return null

  if (!(await ensureNoActiveSiblingRequest(requestRecord))) return requestRecord

  const user = await getUserWithTenant(requestRecord.userId)
  if (!user) {
    await failRequest(requestId, 'USER_NOT_FOUND', 'User not found', 'REJECTED')
    return null
  }

  try {
    await transitionRequest(requestId, 'VALIDATING', { startedAt: requestRecord.startedAt || new Date() })
    const access = await checkServiceAccess(user.id, requestRecord.tenantId, 'PATENT_DRAFTING')
    const requestPayload = requestRecord.parsedPayload as Partial<EmailDraftPayload> | null
    const isBulkUpload = requestPayload?.source === 'bulk_upload' || requestRecord.recipientEmail === AUTO_DRAFTING_BULK_RECIPIENT
    if (!access.allowed || user.status !== 'ACTIVE' || !user.emailVerified || (!isBulkUpload && !user.emailDraftingEnabled)) {
      throw Object.assign(new Error(access.reason || (isBulkUpload ? 'Auto drafting access is no longer valid for this user.' : 'Email drafting access is no longer valid for this user.')), { code: 'ACCESS_REVOKED' })
    }
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'PARSING')
    const payload = requestRecord.parsedPayload?.parserVersion === 1
      ? requestRecord.parsedPayload as EmailDraftPayload
      : await buildCanonicalEmailDraftPayload(requestRecord)
    const suppressNotificationEmails = payload.suppressNotificationEmails === true || payload.source === 'bulk_upload'
    await persistParsedPayload(requestId, payload)
    if (!suppressNotificationEmails) {
      await sendAcknowledgementEmail(user, requestRecord, payload)
    }
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'INITIALIZING')
    const project = await getProjectForDraftRequest(user.id, requestRecord)
    const patent = requestRecord.patentId
      ? await prisma.patent.findUnique({ where: { id: requestRecord.patentId } })
      : await createPatentForEmailRequest(project.id, user.id, payload.title)
    if (!patent) throw new Error('Failed to create patent record')

    const startSessionResult = await invokeDraftingAction({
      user,
      patentId: patent.id,
      body: { action: 'start_session' }
    })
    const sessionId = startSessionResult.json?.session?.id
    if (!sessionId) throw new Error('Failed to create drafting session')

    const jurisdictions = payload.jurisdictions.length ? payload.jurisdictions : ['IN']
    await invokeDraftingAction({
      user,
      patentId: patent.id,
      body: {
        action: 'set_stage',
        sessionId,
        stage: 'IDEA_ENTRY',
        draftingJurisdictions: jurisdictions,
        activeJurisdiction: jurisdictions[0],
        languageMode: 'common',
        languageByJurisdiction: Object.fromEntries(jurisdictions.map(code => [code, 'en'])),
        figuresLanguage: 'en',
        commonLanguage: 'en'
      }
    })

    await updateRequest(requestId, {
      projectId: project.id,
      patentId: patent.id,
      sessionId
    })

    if (payload.claimsNotes) {
      await upsertUserInstruction({
        sessionId,
        userId: user.id,
        jurisdiction: '*',
        sectionKey: 'claims',
        instruction: payload.claimsNotes,
        isPersistent: false
      })
    }

    if (payload.figureDirections) {
      await upsertUserInstruction({
        sessionId,
        userId: user.id,
        jurisdiction: '*',
        sectionKey: 'briefDescriptionOfDrawings',
        instruction: payload.figureDirections,
        isPersistent: false
      })
      await upsertUserInstruction({
        sessionId,
        userId: user.id,
        jurisdiction: '*',
        sectionKey: 'detailedDescription',
        instruction: payload.figureDirections,
        isPersistent: false
      })
    }

    if (payload.literatureReviewInstructions) {
      for (const sectionKey of ['background', 'summary', 'detailedDescription']) {
        await upsertUserInstruction({
          sessionId,
          userId: user.id,
          jurisdiction: '*',
          sectionKey,
          instruction: `Use the supplied literature review and prior-art remarks when drafting this section:\n\n${payload.literatureReviewInstructions}`,
          isPersistent: false
        })
      }
    }

    if (payload.draftingRemarks) {
      for (const sectionKey of [
        'title',
        'fieldOfInvention',
        'background',
        'summary',
        'briefDescriptionOfDrawings',
        'detailedDescription',
        'bestMethod',
        'claims',
        'abstract',
        'industrialApplicability'
      ]) {
        await upsertUserInstruction({
          sessionId,
          userId: user.id,
          jurisdiction: '*',
          sectionKey,
          instruction: sectionKey === 'claims'
            ? [payload.claimsNotes, payload.draftingRemarks].filter(Boolean).join('\n\n')
            : payload.draftingRemarks,
          isPersistent: false
        })
      }
    }

    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'NORMALIZING')
    await invokeDraftingAction({
      user,
      patentId: patent.id,
      body: {
        action: 'normalize_idea',
        sessionId,
        rawIdea: payload.normalizationBrief,
        title: payload.title,
        allowRefine: payload.allowRefine
      }
    })
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'CLAIMS_SETUP')
    const activeJurisdiction = jurisdictions[0]
    if (payload.claimsHandling === 'use as is' && payload.claimsText) {
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'save_claims',
          sessionId,
          claims: payload.claimsText
        }
      })
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'freeze_claims',
          sessionId,
          claims: payload.claimsText,
          jurisdiction: activeJurisdiction,
          skipPriorArt: true,
          useInitialClaimsForDrafting: true
        }
      })
    } else {
      if (payload.claimsText) {
        await invokeDraftingAction({
          user,
          patentId: patent.id,
          body: {
            action: 'save_claims',
            sessionId,
            claims: payload.claimsText
          }
        })
      }
      const generatedClaims = await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'generate_claims',
          sessionId,
          jurisdiction: activeJurisdiction,
          userClaimRemarks: [
            payload.claimsNotes,
            payload.claimsHandling === 'improve' && payload.claimsText
              ? `Improve the following draft claims without entering claim-refinement mode:\n\n${payload.claimsText}`
              : null
          ].filter(Boolean).join('\n\n')
        }
      })
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'freeze_claims',
          sessionId,
          claims: generatedClaims.json?.claimsHtml,
          jurisdiction: activeJurisdiction,
          skipPriorArt: true,
          useInitialClaimsForDrafting: true
        }
      })
    }
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'PRIOR_ART_CONTEXT')
    if (payload.priorArtText) {
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'save_manual_prior_art',
          sessionId,
          manualPriorArt: {
            text: payload.priorArtText,
            manualPriorArtText: payload.priorArtText
          }
        }
      })
    }

    let selectedPatents: any[] = []
    if (payload.priorArtHandling !== 'use only') {
      try {
        const searchResult = await invokeDraftingAction({
          user,
          patentId: patent.id,
          body: {
            action: 'related_art_search',
            sessionId,
            limit: 5
          }
        })
        selectedPatents = Array.isArray(searchResult.json?.results) ? searchResult.json.results.slice(0, 5) : []
        if (selectedPatents.length) {
          await invokeDraftingAction({
            user,
            patentId: patent.id,
            body: {
              action: 'related_art_select',
              sessionId,
              runId: searchResult.json?.runId,
              selections: selectedPatents
            }
          })
        }
      } catch (error: any) {
        const message = error?.message || 'Prior art search failed'
        await createEvent(requestId, 'PRIOR_ART_CONTEXT', 'warning', message)
      }
    }

    await invokeDraftingAction({
      user,
      patentId: patent.id,
      body: {
        action: 'save_prior_art_config',
        sessionId,
        priorArtConfig: {
          mode: payload.priorArtHandling === 'use only' ? 'manual' : (selectedPatents.length ? 'selected' : 'manual'),
          selectedPatents,
          manualText: payload.priorArtText || '',
          literatureReviewInstructions: payload.literatureReviewInstructions || '',
        },
        skipClaimRefinement: true
      }
    })
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'COMPONENTS')
    await invokeDraftingAction({
      user,
      patentId: patent.id,
      body: { action: 'proceed_to_components', sessionId }
    })
    await heartbeatRequest(requestId, workerId)

    const exportWarnings: string[] = []
    await transitionRequest(requestId, 'FIGURES')
    try {
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'plan_and_generate_diagrams_llm',
          sessionId,
          figureRemarks: payload.figureDirections
        }
      })
    } catch (error: any) {
      exportWarnings.push(error?.message || 'Diagram generation failed')
      await createEvent(requestId, 'FIGURES', 'warning', error?.message || 'Diagram generation failed')
    }
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'DRAFTING')
    if (payload.illustrativeData) {
      const enabledToggles = buildEnabledJurisdictionToggles(jurisdictions)
      const ddData = await prisma.dDUserData.findUnique({ where: { sessionId } })
      if (ddData) {
        const existingToggles = ((ddData as any).jurisdictionToggles || {}) as Record<string, boolean>
        await prisma.dDUserData.update({
          where: { sessionId },
          data: {
            userData: payload.illustrativeData,
            jurisdictionToggles: { ...existingToggles, ...enabledToggles },
            updatedBy: user.id
          }
        })
      } else {
        await prisma.dDUserData.create({
          data: {
            sessionId,
            userData: payload.illustrativeData,
            jurisdictionToggles: enabledToggles,
            createdBy: user.id,
            updatedBy: user.id
          }
        })
      }
    }

    if (jurisdictions.length > 1) {
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'generate_reference_draft',
          sessionId
        }
      })
      for (const jurisdiction of jurisdictions) {
        await invokeDraftingAction({
          user,
          patentId: patent.id,
          body: {
            action: 'translate_to_jurisdiction',
            sessionId,
            targetJurisdiction: jurisdiction,
            targetLanguage: 'en'
          }
        })
      }
    } else {
      await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'generate_draft',
          sessionId,
          jurisdiction: activeJurisdiction,
          filingType: payload.filingType
        }
      })
    }
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'REVIEW')
    const exportJurisdictions = jurisdictions.length ? jurisdictions : [activeJurisdiction]
    for (const jurisdiction of exportJurisdictions) {
      try {
        await setActiveDraftingJurisdiction(sessionId, jurisdiction)
        const reviewResult = await runAIReviewAndApplyTextFixes({
          user,
          patentId: patent.id,
          sessionId,
          jurisdiction
        })
        if (reviewResult.appliedFixes > 0) {
          await createEvent(requestId, 'REVIEW', 'completed', `Applied ${reviewResult.appliedFixes} AI text fix(es) for ${jurisdiction}.`)
        }
      } catch (error: any) {
        await createEvent(requestId, 'REVIEW', 'warning', `${jurisdiction}: ${error?.message || 'AI review failed'}`)
      }
    }
    await heartbeatRequest(requestId, workerId)

    await transitionRequest(requestId, 'EXPORT')
    const artifacts: any[] = []
    for (const jurisdiction of exportJurisdictions) {
      await setActiveDraftingJurisdiction(sessionId, jurisdiction)
      const docxExport = await invokeDraftingAction({
        user,
        patentId: patent.id,
        body: {
          action: 'export_docx',
          sessionId,
          jurisdiction
        }
      })
      const docxBuffer = Buffer.from(await docxExport.response.arrayBuffer())
      const docxDisposition = docxExport.response.headers.get('content-disposition') || ''
      const docxFilename = /filename="?([^"]+)"?/i.exec(docxDisposition)?.[1] || `${payload.title.replace(/[^\w.-]+/g, '_')}_${jurisdiction}.docx`
      artifacts.push(await storeExportArtifact({
        requestId,
        user,
        tenantId: requestRecord.tenantId,
        filename: `${jurisdiction}_${docxFilename}`,
        buffer: docxBuffer,
        mimeType: docxExport.response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }))

      try {
        const pdfExport = await invokeDraftingAction({
          user,
          patentId: patent.id,
          body: {
            action: 'export_pdf',
            sessionId,
            jurisdiction
          }
        })
        const pdfContentType = pdfExport.response.headers.get('content-type') || ''
        if (pdfContentType.includes('pdf') || pdfContentType.includes('octet-stream')) {
          const pdfBuffer = Buffer.from(await pdfExport.response.arrayBuffer())
          const pdfDisposition = pdfExport.response.headers.get('content-disposition') || ''
          const pdfFilename = /filename="?([^"]+)"?/i.exec(pdfDisposition)?.[1] || `${payload.title.replace(/[^\w.-]+/g, '_')}_${jurisdiction}.pdf`
          artifacts.push(
            await storeExportArtifact({
              requestId,
              user,
              tenantId: requestRecord.tenantId,
              filename: `${jurisdiction}_${pdfFilename}`,
              buffer: pdfBuffer,
              mimeType: pdfContentType
            })
          )
        } else {
          exportWarnings.push(`${jurisdiction}: PDF export is not available in the current runtime. DOCX was generated successfully.`)
        }
      } catch (error: any) {
        exportWarnings.push(`${jurisdiction}: ${error?.message || 'PDF export failed'}`)
      }
    }

    const downloadToken = await createDocumentAccessLink(artifacts[0].id, user.id, requestId)
    const completionStatus = exportWarnings.length ? 'DELIVERED_WITH_WARNINGS' : 'DELIVERED'
    await updateRequest(requestId, {
      status: completionStatus,
      currentStage: completionStatus,
      progressPct: EMAIL_DRAFTING_PROGRESS[completionStatus],
      completedAt: new Date(),
      deliveredAt: new Date(),
      warnings: toJsonSafe([...payload.warnings, ...exportWarnings]),
      lockedBy: null,
      lockedUntil: null
    })
    await createEvent(requestId, completionStatus, 'completed', 'Draft exported successfully', { artifacts: artifacts.map(item => item.id) })
    if (!suppressNotificationEmails) {
      await sendCompletionEmail(user, requestRecord, downloadToken, exportWarnings)
    }

    if (requestRecord.autoPatentDraftBatchId) {
      await refreshAutoPatentDraftBatch(requestRecord.autoPatentDraftBatchId)
    }

    return await (prisma as any).emailDraftRequest.findUnique({ where: { id: requestId } })
  } catch (error: any) {
    const code = error?.code || 'PIPELINE_ERROR'
    const message = error?.message || 'Email drafting request failed.'
    await failRequest(requestId, code, message, code === 'REJECTED_AMBIGUOUS' || code === 'EMPTY_USABLE_CONTENT' || code === 'AUTO_RESPONDER' ? 'REJECTED' : 'FAILED')
    const failedRequest = await (prisma as any).emailDraftRequest.findUnique({ where: { id: requestId } })
    const failedPayload = requestRecord.parsedPayload as Partial<EmailDraftPayload> | null
    const suppressFailureEmail = failedPayload?.suppressNotificationEmails === true || failedPayload?.source === 'bulk_upload' || requestRecord.recipientEmail === AUTO_DRAFTING_BULK_RECIPIENT
    if (!suppressFailureEmail) {
      await sendFailureEmail(user, failedRequest)
    }
    if (requestRecord.autoPatentDraftBatchId) {
      await refreshAutoPatentDraftBatch(requestRecord.autoPatentDraftBatchId)
    }
    return failedRequest
  }
}

export async function processPendingEmailDraftRequests(workerId = `worker-${process.pid}`, limit = 1) {
  const processed: any[] = []
  for (let index = 0; index < limit; index += 1) {
    const requestRecord = await claimNextEmailDraftRequest(workerId)
    if (!requestRecord) break
    const result = await processEmailDraftRequestById(requestRecord.id, workerId)
    processed.push(result)
  }
  // Never let a batch-refresh failure (e.g. a missing artifact on disk) escape the
  // poll loop and crash-loop the worker — the per-request work is already committed.
  try {
    await refreshReadyAutoPatentDraftBatches()
  } catch (refreshError) {
    console.error('[EmailDraftingWorker] refreshReadyAutoPatentDraftBatches failed (continuing):', refreshError instanceof Error ? refreshError.message : refreshError)
  }
  return processed
}

export async function getEmailDraftRequestForUser(requestId: string, userId: string) {
  return (prisma as any).emailDraftRequest.findFirst({
    where: { id: requestId, userId },
    include: {
      events: { orderBy: { createdAt: 'asc' } },
      accessLinks: true
    }
  })
}
