/**
 * Access-request service — the whole lifecycle of an inbound "contact us" or
 * "request a free trial" submission.
 *
 * Public side:   submitContactRequest / submitTrialRequest (spam-guarded)
 * Admin side:    listRequests / getRequest / triageRequest / approveTrial / declineTrial
 *
 * Approving a trial reuses the existing TrialInvite machinery rather than
 * inventing a parallel one: we mint an email-locked invite inside a dedicated
 * "Inbound Trial Requests" campaign, so registration, signup tracking, trial
 * quotas and campaign analytics all work exactly as they do for CSV-imported
 * invites.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/mailer'
import { generateInviteToken } from '@/lib/trial-invite-service'
import {
  adminAlert,
  contactAcknowledgement,
  trialAcknowledgement,
  trialApproved,
  trialDeclined,
} from './emails'
import {
  DEFAULT_TRIAL_DAYS,
  FIELD_LIMITS,
  OPEN_STATUSES,
  STATUSES_BY_KIND,
  TRIAL_JURISDICTION_CODES,
  type AccessRequestKind,
  type AccessRequestStatus,
} from './constants'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Campaign that holds every invite issued from an approved inbound request. */
const INBOUND_CAMPAIGN_NAME = 'Inbound Trial Requests'

export function siteUrl(): string {
  return (
    process.env.SITE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    'http://localhost:3000'
  )
}

/** Where new-request alerts go. Comma-separated list; first address is primary. */
function adminRecipients(): string[] {
  const raw =
    process.env.ACCESS_REQUEST_NOTIFY_EMAILS ||
    process.env.CONTACT_NOTIFY_EMAIL ||
    'ramankhosa@gmail.com'
  return raw
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Input hygiene
// ---------------------------------------------------------------------------

export function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

/** Same as clean() but keeps newlines — for message / use-case bodies. */
export function cleanMultiline(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

/**
 * Salted hash of the client IP. We keep it only to spot repeat abuse — the raw
 * address is never written to the database.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null
  const salt = process.env.ACCESS_REQUEST_IP_SALT || process.env.JWT_SECRET || 'patentnest'
  return crypto.createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}

export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') || headers.get('cf-connecting-ip')
}

// ---------------------------------------------------------------------------
// Spam guards
// ---------------------------------------------------------------------------

/**
 * In-memory sliding window. Good enough for a single-node deployment and it
 * degrades safely: a restart or a second instance just resets the window, and
 * the database duplicate check below is the real backstop.
 */
const rateWindows = new Map<string, number[]>()
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

export function checkRateLimit(key: string | null): { allowed: boolean; retryAfterSec: number } {
  if (!key) return { allowed: true, retryAfterSec: 0 }

  const now = Date.now()
  const hits = (rateWindows.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  if (hits.length >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - hits[0])) / 1000)
    rateWindows.set(key, hits)
    return { allowed: false, retryAfterSec }
  }

  hits.push(now)
  rateWindows.set(key, hits)

  // Opportunistic cleanup so the map cannot grow without bound.
  if (rateWindows.size > 5000) {
    rateWindows.forEach((timestamps: number[], key: string) => {
      if (timestamps.every((t: number) => now - t >= RATE_LIMIT_WINDOW_MS)) rateWindows.delete(key)
    })
  }

  return { allowed: true, retryAfterSec: 0 }
}

/**
 * reCAPTCHA v2 checkbox verification.
 *
 * When RECAPTCHA_SECRET_KEY is unset the check is skipped OUTSIDE production so
 * local development works without Google keys; in production a missing secret is
 * a hard failure rather than a silent bypass.
 */
export async function verifyRecaptcha(
  token: string | undefined
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secret = process.env.RECAPTCHA_SECRET_KEY

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[AccessRequest] RECAPTCHA_SECRET_KEY is not configured')
      return { ok: false, status: 500, error: 'CAPTCHA is not configured on the server.' }
    }
    console.warn('[AccessRequest] No RECAPTCHA_SECRET_KEY — skipping CAPTCHA outside production')
    return { ok: true }
  }

  if (!token) {
    return { ok: false, status: 400, error: 'Please complete the CAPTCHA.' }
  }

  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    })

    if (!res.ok) {
      console.error('[AccessRequest] reCAPTCHA HTTP error', res.status)
      return { ok: false, status: 502, error: 'Failed to verify CAPTCHA. Please try again.' }
    }

    const json = (await res.json()) as { success: boolean; 'error-codes'?: string[] }
    if (!json.success) {
      console.warn('[AccessRequest] reCAPTCHA rejected:', json['error-codes'])
      return { ok: false, status: 400, error: 'CAPTCHA verification failed. Please try again.' }
    }

    return { ok: true }
  } catch (error) {
    console.error('[AccessRequest] reCAPTCHA verification threw:', error)
    return { ok: false, status: 502, error: 'Failed to verify CAPTCHA. Please try again.' }
  }
}

/** True when the same email filed the same kind of request in the last 10 minutes. */
async function isDuplicateSubmission(kind: AccessRequestKind, email: string): Promise<boolean> {
  const since = new Date(Date.now() - 10 * 60 * 1000)
  const existing = await prisma.accessRequest.findFirst({
    where: { kind, email: email.toLowerCase(), createdAt: { gte: since } },
    select: { id: true },
  })
  return Boolean(existing)
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmissionContext {
  sourcePage?: string | null
  referrer?: string | null
  userAgent?: string | null
  ipHash?: string | null
  existingUserId?: string | null
}

export interface ContactInput {
  name: string
  email: string
  phone?: string | null
  organization?: string | null
  topic?: string | null
  message?: string | null
}

export interface TrialInput {
  name: string
  email: string
  phone?: string | null
  organization?: string | null
  jobTitle?: string | null
  country?: string | null
  useCase?: string | null
  teamSize?: string | null
  expectedVolume?: string | null
  jurisdictions?: string[]
}

export type SubmitResult =
  | { ok: true; id: string; duplicate: boolean }
  | { ok: false; status: number; error: string }

export async function submitContactRequest(
  input: ContactInput,
  context: SubmissionContext
): Promise<SubmitResult> {
  const name = clean(input.name, FIELD_LIMITS.name)
  const email = clean(input.email, FIELD_LIMITS.email)?.toLowerCase() ?? null

  if (!name || !email) {
    return { ok: false, status: 400, error: 'Name and email are required.' }
  }
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: 'Please enter a valid email address.' }
  }

  // A repeat inside the dedupe window is answered with success: the person sees
  // the same confirmation, the inbox does not fill with copies.
  if (await isDuplicateSubmission('CONTACT', email)) {
    const recent = await prisma.accessRequest.findFirst({
      where: { kind: 'CONTACT', email },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    return { ok: true, id: recent?.id ?? '', duplicate: true }
  }

  const request = await prisma.accessRequest.create({
    data: {
      kind: 'CONTACT',
      name,
      email,
      phone: clean(input.phone, FIELD_LIMITS.phone),
      organization: clean(input.organization, FIELD_LIMITS.organization),
      topic: clean(input.topic, FIELD_LIMITS.topic) || 'Other',
      message: cleanMultiline(input.message, FIELD_LIMITS.message),
      sourcePage: clean(context.sourcePage, 300),
      referrer: clean(context.referrer, 300),
      userAgent: clean(context.userAgent, 300),
      ipHash: context.ipHash ?? null,
      existingUserId: context.existingUserId ?? null,
      events: {
        create: { type: 'SUBMITTED', note: 'Submitted from the contact form' },
      },
    },
  })

  await notifyNewRequest(request.id)
  return { ok: true, id: request.id, duplicate: false }
}

export async function submitTrialRequest(
  input: TrialInput,
  context: SubmissionContext
): Promise<SubmitResult> {
  const name = clean(input.name, FIELD_LIMITS.name)
  const email = clean(input.email, FIELD_LIMITS.email)?.toLowerCase() ?? null

  if (!name || !email) {
    return { ok: false, status: 400, error: 'Name and email are required.' }
  }
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: 'Please enter a valid email address.' }
  }

  if (await isDuplicateSubmission('TRIAL', email)) {
    const recent = await prisma.accessRequest.findFirst({
      where: { kind: 'TRIAL', email },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    return { ok: true, id: recent?.id ?? '', duplicate: true }
  }

  const jurisdictions = Array.isArray(input.jurisdictions)
    ? Array.from(
        new Set(
          input.jurisdictions
            .map((j) => String(j).trim().toUpperCase())
            .filter((j) => TRIAL_JURISDICTION_CODES.includes(j))
        )
      ).slice(0, TRIAL_JURISDICTION_CODES.length)
    : []

  // An open request from the same address means we already owe them an answer.
  const openExisting = await prisma.accessRequest.findFirst({
    where: { kind: 'TRIAL', email, status: { in: OPEN_STATUSES as AccessRequestStatus[] } },
    select: { id: true },
  })

  const request = await prisma.accessRequest.create({
    data: {
      kind: 'TRIAL',
      name,
      email,
      phone: clean(input.phone, FIELD_LIMITS.phone),
      organization: clean(input.organization, FIELD_LIMITS.organization),
      jobTitle: clean(input.jobTitle, FIELD_LIMITS.jobTitle),
      country: clean(input.country, FIELD_LIMITS.country),
      useCase: cleanMultiline(input.useCase, FIELD_LIMITS.useCase),
      teamSize: clean(input.teamSize, 60),
      expectedVolume: clean(input.expectedVolume, 60),
      jurisdictions,
      requestedDays: DEFAULT_TRIAL_DAYS,
      sourcePage: clean(context.sourcePage, 300),
      referrer: clean(context.referrer, 300),
      userAgent: clean(context.userAgent, 300),
      ipHash: context.ipHash ?? null,
      existingUserId: context.existingUserId ?? null,
      events: {
        create: {
          type: 'SUBMITTED',
          note: openExisting
            ? 'Submitted from the trial form — this address already has an open request'
            : 'Submitted from the trial form',
        },
      },
    },
  })

  await notifyNewRequest(request.id)
  return { ok: true, id: request.id, duplicate: false }
}

/**
 * Acknowledge the requester and alert the admin inbox.
 *
 * Mail is best-effort: a delivery failure is logged as an event but never fails
 * the submission, because the row is already safely in the inbox.
 */
async function notifyNewRequest(requestId: string): Promise<void> {
  const request = await prisma.accessRequest.findUnique({ where: { id: requestId } })
  if (!request) return

  const isTrial = request.kind === 'TRIAL'

  const ack = isTrial
    ? trialAcknowledgement({ name: request.name })
    : contactAcknowledgement({ name: request.name, topic: request.topic })

  const alert = adminAlert({
    kind: request.kind,
    requestId: request.id,
    siteUrl: siteUrl(),
    name: request.name,
    email: request.email,
    phone: request.phone,
    organization: request.organization,
    jobTitle: request.jobTitle,
    country: request.country,
    topic: request.topic,
    message: request.message,
    useCase: request.useCase,
    teamSize: request.teamSize,
    expectedVolume: request.expectedVolume,
    jurisdictions: request.jurisdictions,
    sourcePage: request.sourcePage,
  })

  // sendEmail resolves with { sent: false } when Mailjet is unconfigured, so a
  // silent no-op is counted as a failure rather than passing as delivered.
  const deliver = async (message: Parameters<typeof sendEmail>[0]) => {
    const result = await sendEmail(message)
    if (!result?.sent) throw new Error('Mailjet is not configured')
  }

  const jobs: Array<Promise<unknown>> = [
    deliver({ to: request.email, toName: request.name, ...ack }),
    ...adminRecipients().map((to) => deliver({ to, ...alert })),
  ]

  const results = await Promise.allSettled(jobs)
  const failed = results.filter((r) => r.status === 'rejected')

  if (failed.length > 0) {
    console.error(
      `[AccessRequest] ${failed.length}/${jobs.length} notification emails failed for ${request.id}`,
      failed.map((f) => (f as PromiseRejectedResult).reason)
    )
    await prisma.accessRequestEvent.create({
      data: {
        requestId: request.id,
        type: 'EMAIL_FAILED',
        note: `${failed.length} of ${jobs.length} notification emails failed to send`,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Admin: read
// ---------------------------------------------------------------------------

export interface ListFilters {
  kind?: AccessRequestKind
  status?: AccessRequestStatus[]
  search?: string
  page?: number
  pageSize?: number
}

export async function listRequests(filters: ListFilters) {
  const page = Math.max(1, filters.page || 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 25))

  const where: Record<string, unknown> = {}
  if (filters.kind) where.kind = filters.kind
  if (filters.status?.length) where.status = { in: filters.status }
  if (filters.search) {
    const q = filters.search.trim()
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { organization: { contains: q, mode: 'insensitive' } },
      { message: { contains: q, mode: 'insensitive' } },
      { useCase: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [rows, total, statusCounts] = await Promise.all([
    prisma.accessRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.accessRequest.count({ where }),
    prisma.accessRequest.groupBy({ by: ['kind', 'status'], _count: { _all: true } }),
  ])

  const counts = {
    trialOpen: 0,
    contactOpen: 0,
    totalOpen: 0,
    byStatus: {} as Record<string, number>,
  }
  for (const row of statusCounts) {
    const n = row._count._all
    counts.byStatus[`${row.kind}:${row.status}`] = n
    if ((OPEN_STATUSES as string[]).includes(row.status)) {
      counts.totalOpen += n
      if (row.kind === 'TRIAL') counts.trialOpen += n
      else counts.contactOpen += n
    }
  }

  return {
    requests: rows,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 },
    counts,
  }
}

/**
 * Full detail for the drawer: the request, its event trail, the live status of
 * any invite issued from it, and whether the email already has an account.
 */
export async function getRequestDetail(id: string) {
  const request = await prisma.accessRequest.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: 'desc' } } },
  })
  if (!request) return null

  const [invite, existingUser, relatedCount] = await Promise.all([
    request.grantedInviteId
      ? prisma.trialInvite.findUnique({
          where: { id: request.grantedInviteId },
          select: {
            id: true,
            status: true,
            sentAt: true,
            tokenExpiresAt: true,
            signedUpAt: true,
            openCount: true,
            clickCount: true,
            campaign: { select: { id: true, name: true, trialDurationDays: true } },
          },
        })
      : null,
    prisma.user.findUnique({
      where: { email: request.email },
      select: { id: true, email: true, name: true, createdAt: true, roles: true },
    }),
    prisma.accessRequest.count({ where: { email: request.email, id: { not: request.id } } }),
  ])

  return { request, invite, existingUser, relatedCount }
}

// ---------------------------------------------------------------------------
// Admin: triage
// ---------------------------------------------------------------------------

export interface TriageInput {
  status?: AccessRequestStatus
  internalNotes?: string
  assignToSelf?: boolean
  unassign?: boolean
  note?: string
}

export async function triageRequest(
  id: string,
  input: TriageInput,
  actor: { userId: string; email: string }
) {
  const existing = await prisma.accessRequest.findUnique({ where: { id } })
  if (!existing) return { ok: false as const, status: 404, error: 'Request not found' }

  const data: Record<string, unknown> = {}
  const events: Array<{ type: string; note: string }> = []

  if (input.status && input.status !== existing.status) {
    const allowed = STATUSES_BY_KIND[existing.kind as AccessRequestKind]
    if (!allowed.includes(input.status)) {
      return {
        ok: false as const,
        status: 400,
        error: `A ${existing.kind.toLowerCase()} request cannot be set to ${input.status}.`,
      }
    }
    // APPROVED / REJECTED are decisions — they must go through the decision
    // endpoint so the invite and the applicant email are handled too.
    if (input.status === 'APPROVED' || input.status === 'REJECTED') {
      return {
        ok: false as const,
        status: 400,
        error: 'Use the approve or decline action to record a trial decision.',
      }
    }
    data.status = input.status
    events.push({ type: 'STATUS_CHANGED', note: `${existing.status} → ${input.status}` })
  }

  if (typeof input.internalNotes === 'string') {
    const notes = cleanMultiline(input.internalNotes, FIELD_LIMITS.internalNotes)
    if (notes !== existing.internalNotes) {
      data.internalNotes = notes
      events.push({ type: 'NOTE_ADDED', note: 'Internal notes updated' })
    }
  }

  if (input.assignToSelf) {
    data.assignedTo = actor.userId
    events.push({ type: 'ASSIGNED', note: `Assigned to ${actor.email}` })
  } else if (input.unassign) {
    data.assignedTo = null
    events.push({ type: 'ASSIGNED', note: 'Unassigned' })
  }

  if (input.note?.trim()) {
    events.push({ type: 'NOTE_ADDED', note: cleanMultiline(input.note, 2000) || '' })
  }

  if (Object.keys(data).length === 0 && events.length === 0) {
    return { ok: true as const, request: existing }
  }

  const request = await prisma.accessRequest.update({
    where: { id },
    data: {
      ...data,
      events: { create: events.map((e) => ({ ...e, actorEmail: actor.email })) },
    },
  })

  return { ok: true as const, request }
}

// ---------------------------------------------------------------------------
// Admin: trial decision
// ---------------------------------------------------------------------------

/**
 * The campaign an inbound-request invite is filed under; created on demand.
 *
 * There is one campaign PER TRIAL LENGTH, and that is load-bearing rather than
 * cosmetic: `getTrialQuotaStatus` computes a trial's expiry from
 * `campaign.trialDurationDays` (trial-plan-service.ts), not from anything stored
 * on the invite. Filing a 21-day grant into a 14-day campaign would expire the
 * user early and make the approval email a lie, so the length picked at approval
 * time has to select the campaign.
 */
async function ensureInboundCampaign(createdBy: string, trialDays: number) {
  const name = `${INBOUND_CAMPAIGN_NAME} (${trialDays}d)`

  const existing = await prisma.trialCampaign.findFirst({
    where: { name },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing

  const tenant =
    (await prisma.tenant.findFirst({ where: { atiId: 'PLATFORM' } })) ??
    (await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } }))

  if (!tenant) throw new Error('No tenant available to own the inbound trial campaign')

  return prisma.trialCampaign.create({
    data: {
      tenantId: tenant.id,
      name,
      description: `Auto-created. Holds ${trialDays}-day trial invites issued by approving a request from the public trial form.`,
      status: 'ACTIVE',
      trialDurationDays: trialDays,
      emailSubject: 'Your PatentNest.ai trial is ready',
      senderName: 'PatentNest',
      createdBy,
    },
  })
}

export interface ApproveInput {
  trialDays?: number
  inviteExpiryDays?: number
  campaignId?: string
  note?: string
  sendEmail?: boolean
}

export async function approveTrial(
  id: string,
  input: ApproveInput,
  actor: { userId: string; email: string }
) {
  const request = await prisma.accessRequest.findUnique({ where: { id } })
  if (!request) return { ok: false as const, status: 404, error: 'Request not found' }
  if (request.kind !== 'TRIAL') {
    return { ok: false as const, status: 400, error: 'Only trial requests can be approved.' }
  }
  if (request.grantedInviteId) {
    return {
      ok: false as const,
      status: 409,
      error: 'This request already has a trial invite. Use resend from the campaign if needed.',
    }
  }

  const requestedDays = clampDays(input.trialDays, DEFAULT_TRIAL_DAYS)
  const expiryDays = clampDays(input.inviteExpiryDays, 30)
  const note = cleanMultiline(input.note, FIELD_LIMITS.decisionReason)
  const shouldEmail = input.sendEmail !== false

  const campaign = input.campaignId
    ? await prisma.trialCampaign.findUnique({ where: { id: input.campaignId } })
    : await ensureInboundCampaign(actor.userId, requestedDays)

  if (!campaign) return { ok: false as const, status: 400, error: 'Campaign not found' }

  // The campaign is the single source of truth for how long the trial actually
  // runs, so the recorded and emailed figure is read back from it. When an admin
  // targets an existing campaign by id, its length wins over the picker.
  const trialDays = campaign.trialDurationDays ?? requestedDays

  // Converting once is enough — never re-invite an address that already signed up
  // through any campaign, not just this one.
  const converted = await prisma.trialInvite.findFirst({
    where: { email: request.email, status: 'SIGNED_UP' },
    select: { id: true },
  })
  if (converted) {
    return {
      ok: false as const,
      status: 409,
      error: 'This address has already signed up through a trial invite.',
    }
  }

  // An invite for this email may already exist in the campaign (repeat requester,
  // or a CSV import). Reuse it rather than tripping the @@unique constraint.
  const existingInvite = await prisma.trialInvite.findFirst({
    where: { campaignId: campaign.id, email: request.email },
  })

  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
  const [firstName, ...restName] = request.name.split(' ')

  let invite = existingInvite
  if (invite) {
    // Re-arm the existing invite with a fresh token and expiry.
    const { token, hash } = generateInviteToken()
    invite = await prisma.trialInvite.update({
      where: { id: invite.id },
      data: {
        inviteToken: token,
        inviteTokenHash: hash,
        tokenExpiresAt: expiresAt,
        status: 'PENDING',
        resendCount: { increment: 1 },
        lastResendAt: new Date(),
        resendReason: `Re-issued by ${actor.email} from access request ${request.id}`,
      },
    })
  } else {
    const { token, hash } = generateInviteToken()
    invite = await prisma.trialInvite.create({
      data: {
        campaignId: campaign.id,
        email: request.email,
        firstName: firstName || null,
        lastName: restName.join(' ') || null,
        country: request.country,
        company: request.organization,
        jobTitle: request.jobTitle,
        customData: { accessRequestId: request.id, approvedBy: actor.email },
        inviteToken: token,
        inviteTokenHash: hash,
        allowedEmail: request.email,
        tokenExpiresAt: expiresAt,
        status: 'PENDING',
      },
    })
    await prisma.trialCampaign.update({
      where: { id: campaign.id },
      data: { totalInvites: { increment: 1 } },
    })
  }

  // --- Send the invite ------------------------------------------------------
  const inviteUrl = `${siteUrl()}/institutional-access?invite=${invite.inviteToken}&trial=true&email=${encodeURIComponent(
    request.email
  )}`

  let emailSent = false
  let emailError: string | null = null

  if (shouldEmail) {
    try {
      const mail = trialApproved({
        name: request.name,
        inviteUrl,
        trialDays,
        expiresAt,
        note,
      })
      // sendEmail resolves with { sent: false } when Mailjet is not configured
      // rather than throwing, so an unsent invite must not be recorded as SENT.
      const delivery = await sendEmail({ to: request.email, toName: request.name, ...mail })
      if (!delivery?.sent) {
        throw new Error('Mailjet is not configured on this environment')
      }
      emailSent = true

      await prisma.trialInvite.update({
        where: { id: invite.id },
        data: { status: 'SENT', sentAt: new Date() },
      })
      await prisma.trialCampaign.update({
        where: { id: campaign.id },
        data: { sentCount: { increment: 1 } },
      })
      await prisma.trialInviteEvent.create({
        data: {
          inviteId: invite.id,
          eventType: 'SENT',
          source: 'access_request_approval',
          eventData: { accessRequestId: request.id, approvedBy: actor.email },
        },
      })
    } catch (error) {
      // The invite is valid regardless; the admin can copy the link by hand.
      emailError = error instanceof Error ? error.message : 'Unknown error'
      console.error('[AccessRequest] Trial approval email failed:', error)
    }
  }

  const updated = await prisma.accessRequest.update({
    where: { id },
    data: {
      status: 'APPROVED',
      reviewedBy: actor.email,
      reviewedAt: new Date(),
      decisionReason: note,
      grantedCampaignId: campaign.id,
      grantedInviteId: invite.id,
      grantedTrialDays: trialDays,
      inviteSentAt: emailSent ? new Date() : null,
      assignedTo: request.assignedTo ?? actor.userId,
      events: {
        create: [
          {
            type: 'APPROVED',
            actorEmail: actor.email,
            note: `Granted a ${trialDays}-day trial (invite valid ${expiryDays} days)`,
            metadata: { campaignId: campaign.id, inviteId: invite.id, trialDays, expiryDays },
          },
          ...(shouldEmail
            ? [
                emailSent
                  ? { type: 'INVITE_SENT', actorEmail: actor.email, note: `Invite emailed to ${request.email}` }
                  : {
                      type: 'EMAIL_FAILED',
                      actorEmail: actor.email,
                      note: `Invite email failed: ${emailError}. The link is still valid — send it manually.`,
                    },
              ]
            : [
                {
                  type: 'INVITE_SENT',
                  actorEmail: actor.email,
                  note: 'Invite created without email — link copied by the admin',
                },
              ]),
        ],
      },
    },
  })

  return { ok: true as const, request: updated, inviteUrl, emailSent, emailError }
}

export async function declineTrial(
  id: string,
  input: { reason?: string; sendEmail?: boolean },
  actor: { userId: string; email: string }
) {
  const request = await prisma.accessRequest.findUnique({ where: { id } })
  if (!request) return { ok: false as const, status: 404, error: 'Request not found' }
  if (request.kind !== 'TRIAL') {
    return { ok: false as const, status: 400, error: 'Only trial requests can be declined.' }
  }

  const reason = cleanMultiline(input.reason, FIELD_LIMITS.decisionReason)
  const shouldEmail = input.sendEmail === true

  let emailSent = false
  let emailError: string | null = null

  if (shouldEmail) {
    try {
      const mail = trialDeclined({ name: request.name, reason, siteUrl: siteUrl() })
      const delivery = await sendEmail({ to: request.email, toName: request.name, ...mail })
      if (!delivery?.sent) {
        throw new Error('Mailjet is not configured on this environment')
      }
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Unknown error'
      console.error('[AccessRequest] Decline email failed:', error)
    }
  }

  const updated = await prisma.accessRequest.update({
    where: { id },
    data: {
      status: 'REJECTED',
      reviewedBy: actor.email,
      reviewedAt: new Date(),
      decisionReason: reason,
      assignedTo: request.assignedTo ?? actor.userId,
      events: {
        create: [
          {
            type: 'REJECTED',
            actorEmail: actor.email,
            note: reason || 'Declined without a stated reason',
          },
          ...(shouldEmail
            ? [
                emailSent
                  ? { type: 'EMAIL_SENT', actorEmail: actor.email, note: 'Decline notice emailed' }
                  : {
                      type: 'EMAIL_FAILED',
                      actorEmail: actor.email,
                      note: `Decline email failed: ${emailError}`,
                    },
              ]
            : []),
        ],
      },
    },
  })

  return { ok: true as const, request: updated, emailSent, emailError }
}

function clampDays(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(365, Math.max(1, Math.round(n)))
}
