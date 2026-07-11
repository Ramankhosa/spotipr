/**
 * Subscription Lifecycle Cron Endpoint
 * POST /api/cron/subscription-lifecycle
 * 
 * This endpoint should be called by a scheduled job (e.g., Vercel Cron, GitHub Actions)
 * to process:
 * 1. Expired subscriptions
 * 2. Expiry warning notifications
 * 3. Abandoned signup cleanup
 * 
 * Secure with CRON_SECRET environment variable
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  processExpiredSubscriptions,
  sendExpiryWarningNotifications,
  cleanupAbandonedSignups,
} from '@/lib/subscription-lifecycle-service'

// Force dynamic rendering
export const dynamic = 'force-dynamic'

// Vercel Cron config (if using Vercel)
export const maxDuration = 60 // 60 seconds max execution time

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET

    // Fail closed: without a configured secret this destructive job (expires
    // subscriptions, deletes abandoned tenants/users/projects) must never run
    // unauthenticated. A missing secret is a misconfiguration, not an open door.
    if (!cronSecret) {
      console.error('[Cron] CRON_SECRET is not set; refusing to run subscription-lifecycle job.')
      return NextResponse.json(
        { error: 'Server misconfiguration: CRON_SECRET is not configured' },
        { status: 503 }
      )
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get optional parameters from request body
    const body = await request.json().catch(() => ({}))
    const {
      processExpiry = true,
      sendWarnings = true,
      cleanupAbandoned = true,
      warningDays = 7,
      abandonedDays = 7,
    } = body

    const results: Record<string, any> = {
      timestamp: new Date().toISOString(),
    }

    // 1. Process expired subscriptions
    if (processExpiry) {
      const expiryResult = await processExpiredSubscriptions()
      results.expiry = expiryResult
    }

    // 2. Send expiry warning notifications
    if (sendWarnings) {
      const warningsSent = await sendExpiryWarningNotifications(warningDays)
      results.warnings = { sent: warningsSent }
    }

    // 3. Clean up abandoned signups
    if (cleanupAbandoned) {
      const cleanedUp = await cleanupAbandonedSignups(abandonedDays)
      results.cleanup = { deleted: cleanedUp }
    }

    console.log('[Cron] Subscription lifecycle job completed:', results)

    return NextResponse.json({
      success: true,
      results,
    })
  } catch (error) {
    console.error('[Cron] Subscription lifecycle job failed:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Job failed' 
      },
      { status: 500 }
    )
  }
}

// Also support GET for simple health checks / manual triggers
export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Fail closed: never process without a configured secret (see POST handler).
  if (!cronSecret) {
    console.error('[Cron] CRON_SECRET is not set; refusing to run subscription-lifecycle job.')
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET is not configured' },
      { status: 503 }
    )
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }

  // Just run expiry processing on GET
  try {
    const result = await processExpiredSubscriptions()
    return NextResponse.json({
      success: true,
      processed: result,
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Processing failed' },
      { status: 500 }
    )
  }
}

