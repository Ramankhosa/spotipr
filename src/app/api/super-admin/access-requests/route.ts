/**
 * GET /api/super-admin/access-requests
 *
 * The triage inbox: contact enquiries and trial requests, newest first, with
 * open-count badges. SUPER_ADMIN_VIEWER may read; writes live on the [id] routes
 * and require SUPER_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listRequests } from '@/lib/access-requests/service'
import { requireAdmin } from '@/lib/access-requests/auth'
import { ALL_STATUSES, type AccessRequestStatus } from '@/lib/access-requests/constants'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)

    const kindParam = searchParams.get('kind')
    const kind = kindParam === 'TRIAL' || kindParam === 'CONTACT' ? kindParam : undefined

    const status = (searchParams.get('status') || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is AccessRequestStatus => (ALL_STATUSES as string[]).includes(s))

    const result = await listRequests({
      kind,
      status,
      search: searchParams.get('search') || undefined,
      page: Number(searchParams.get('page')) || 1,
      pageSize: Number(searchParams.get('pageSize')) || 25,
    })

    return NextResponse.json({ ...result, canWrite: admin.canWrite })
  } catch (error) {
    console.error('[AccessRequest] List failed:', error)
    return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 })
  }
}
