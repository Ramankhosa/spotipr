/**
 * POST /api/contact — public "contact us" submission.
 *
 * Persists the enquiry to the access-request inbox (so a super admin can triage
 * it at /super-admin/requests), acknowledges the sender, and alerts the admin
 * recipients. Guarded by reCAPTCHA, a per-IP rate limit and a honeypot field.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyJWT } from '@/lib/auth'
import {
  checkRateLimit,
  clientIp,
  hashIp,
  submitContactRequest,
  verifyRecaptcha,
} from '@/lib/access-requests/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ContactPayload {
  name?: string
  email?: string
  phone?: string
  organization?: string
  topic?: string
  message?: string
  recaptchaToken?: string
  /** Honeypot — real users never fill this in. */
  website?: string
  sourcePage?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ContactPayload

    // Bots fill every field they find. Answer 200 so they learn nothing.
    if (body.website && body.website.trim()) {
      return NextResponse.json({ success: true })
    }

    const ip = clientIp(request.headers)
    const limit = checkRateLimit(ip ? `contact:${ip}` : null)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many submissions from this connection. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
      )
    }

    const captcha = await verifyRecaptcha(body.recaptchaToken)
    if (!captcha.ok) {
      return NextResponse.json({ error: captcha.error }, { status: captcha.status })
    }

    const result = await submitContactRequest(
      {
        name: body.name || '',
        email: body.email || '',
        phone: body.phone,
        organization: body.organization,
        topic: body.topic,
        message: body.message,
      },
      {
        sourcePage: body.sourcePage || '/contact',
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
    console.error('Contact API error:', error)
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 })
  }
}

/** Best-effort: attribute the submission when the visitor happens to be logged in. */
function signedInUserId(request: NextRequest): string | null {
  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  try {
    return verifyJWT(header.substring(7))?.sub ?? null
  } catch {
    return null
  }
}
