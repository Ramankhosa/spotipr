/**
 * Super Admin Retrieval Tuning API
 *
 * Runtime control over the novelty search funnel: candidate caps, rerank cutoff,
 * deep-analysis ceiling, claims depth, and which patent providers may be dispatched.
 * Plus a calibration harness for choosing those values from evidence rather than feel.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { SETTING_CATEGORIES } from '@/lib/settings/registry'
import {
  getSettingsForAdmin,
  resetSettings,
  updateSettings,
} from '@/lib/settings/settings-service'
import {
  getProviderAccessForAdmin,
  updateProviderAccess,
} from '@/lib/settings/provider-access-service'
import {
  getCalibrationRun,
  listBenchmarkCandidates,
  listCalibrationRuns,
  runCalibration,
} from '@/lib/settings/calibration-service'

export const runtime = 'nodejs'
// Calibration replays several searches sequentially; the default serverless budget
// is not enough for a benchmark set of any size.
export const maxDuration = 300

type Access = 'full' | 'read-only'

async function verifySuperAdmin(request: NextRequest): Promise<
  { error: string; status: number } | { userId: string; access: Access }
> {
  const authResult = await authenticateUser(request)
  if (!authResult.user) return { error: 'Unauthorized', status: 401 }

  const roles = authResult.user.roles || []
  const isFull = roles.some((role: string) => role === 'SUPER_ADMIN')
  const isViewer = roles.some((role: string) => role === 'SUPER_ADMIN_VIEWER')
  if (!isFull && !isViewer) return { error: 'Super admin access required', status: 403 }

  return { userId: String(authResult.user.id), access: isFull ? 'full' : 'read-only' }
}

/**
 * GET — current configuration.
 * ?action=config      (default) settings registry + values, provider access
 * ?action=benchmarks  novelty searches available as a calibration benchmark set
 * ?action=runs        recent calibration runs
 * ?action=run&id=...  one calibration run with full results
 */
export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') || 'config'

  try {
    if (action === 'benchmarks') {
      return NextResponse.json({ benchmarks: await listBenchmarkCandidates() })
    }
    if (action === 'runs') {
      return NextResponse.json({ runs: await listCalibrationRuns() })
    }
    if (action === 'run') {
      const id = searchParams.get('id')
      if (!id) return NextResponse.json({ error: 'Run id is required.' }, { status: 400 })
      const run = await getCalibrationRun(id)
      if (!run) return NextResponse.json({ error: 'Calibration run not found.' }, { status: 404 })
      return NextResponse.json({ run })
    }

    const [settings, providers] = await Promise.all([
      getSettingsForAdmin(),
      getProviderAccessForAdmin(),
    ])
    return NextResponse.json({
      categories: SETTING_CATEGORIES,
      settings,
      providers,
      access: auth.access,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[RetrievalTuning] GET failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PATCH — update settings and/or provider access.
 * Body: { settings?: Record<key, value>, providers?: Array<{providerId, enabled?, allowAsFallback?, notes?}> }
 */
export async function PATCH(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.access !== 'full') {
    return NextResponse.json({ error: 'Read-only super admin cannot change settings.' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const errors: string[] = []

    if (body?.settings && typeof body.settings === 'object') {
      const result = await updateSettings(body.settings, auth.userId)
      if (!result.ok) errors.push(...result.errors)
    }

    if (Array.isArray(body?.providers) && body.providers.length) {
      const result = await updateProviderAccess(body.providers, auth.userId)
      if (!result.ok) errors.push(...(result.errors || []))
    }

    if (errors.length) return NextResponse.json({ error: errors.join(' '), errors }, { status: 400 })

    const [settings, providers] = await Promise.all([
      getSettingsForAdmin(),
      getProviderAccessForAdmin(),
    ])
    return NextResponse.json({ ok: true, settings, providers })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[RetrievalTuning] PATCH failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST — run a calibration sweep.
 * Body: { label, searchIds: string[], configOverride?: Record<key, value>, baselineRunId?: string }
 */
export async function POST(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.access !== 'full') {
    return NextResponse.json({ error: 'Read-only super admin cannot run calibration.' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const searchIds = Array.isArray(body?.searchIds) ? body.searchIds.map(String) : []
    if (!searchIds.length) {
      return NextResponse.json({ error: 'Select at least one benchmark search.' }, { status: 400 })
    }

    const result = await runCalibration({
      label: String(body?.label || 'Untitled calibration').slice(0, 200),
      searchIds,
      configOverride: body?.configOverride && typeof body.configOverride === 'object' ? body.configOverride : {},
      baselineRunId: body?.baselineRunId ? String(body.baselineRunId) : undefined,
      createdBy: auth.userId,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[RetrievalTuning] Calibration failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/** DELETE — reset settings to registry defaults. Body: { keys?: string[] } */
export async function DELETE(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  if (auth.access !== 'full') {
    return NextResponse.json({ error: 'Read-only super admin cannot reset settings.' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const keys = Array.isArray(body?.keys) ? body.keys.map(String) : undefined
    await resetSettings(keys)
    return NextResponse.json({ ok: true, settings: await getSettingsForAdmin() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
