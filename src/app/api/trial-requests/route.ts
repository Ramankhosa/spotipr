/**
 * POST /api/trial-requests — public "request a free trial" submission.
 *
 * Lands in the same inbox as contact enquiries, but as kind = TRIAL, which is
 * what unlocks the approve / decline actions in /super-admin/requests. Approval
 * mints an email-locked trial invite; nothing here grants access on its own.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import {
  checkRateLimit,
  clientIp,
  hashIp,
  submitTrialRequest,
  verifyRecaptcha,
} from '@/lib/access-requests/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface TrialRequestPayload {
  name?: string
  email?: string
  phone?: string
  organization?: string
  jobTitle?: string
  country?: string
  useCase?: string
  teamSize?: string
  expectedVolume?: string
  jurisdictions?: string[]
  recaptchaToken?: string
  /** Honeypot — real users never fill this in. */
  website?: string
  sourcePage?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TrialRequestPayload

    if (body.website && body.website.trim()) {
      return NextResponse.json({ success: true })
    }

    const ip = clientIp(request.headers)
    const limit = checkRateLimit(ip ? `trial:${ip}` : null)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests from this connection. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
      )
    }

    const captcha = await verifyRecaptcha(body.recaptchaToken)
    if (!captcha.ok) {
      return NextResponse.json({ error: captcha.error }, { status: captcha.status })
    }

    const result = await submitTrialRequest(
      {
        name: body.name || '',
        email: body.email || '',
        phone: body.phone,
        organization: body.organization,
        jobTitle: body.jobTitle,
        country: body.country,
        useCase: body.useCase,
        teamSize: body.teamSize,
        expectedVolume: body.expectedVolume,
        jurisdictions: body.jurisdictions,
      },
      {
        sourcePage: body.sourcePage || '/free-trial',
        referrer: request.headers.get('referer'),
        userAgent: request.headers.get('user-agent'),
        ipHash: hashIp(ip),
        existingUserId: signedInUserId(request),
      }
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    console.error('Trial request API error:', error)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

function signedInUserId(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  try {
    return verifyJWT(header.substring(7))?.sub ?? null
  } catch {
    return null
  }
}
