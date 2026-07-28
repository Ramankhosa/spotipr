import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/auth-middleware'
import { kickPatentCorpusRunner } from '@/lib/patent-corpus-runner'
import { cleanupOldStoredPdfs } from '@/lib/patent-corpus-service'
import {
  getIpIndiaJournalArchiveSettings,
  listIpIndiaJournalArchive,
  processPendingIpIndiaJournalArchive,
  queueHistoricalIpIndiaJournalFiles,
  queueIpIndiaJournalFiles,
  queueLatestIpIndiaJournalFiles,
  refreshIpIndiaJournalPipelineStatuses,
  setIpIndiaJournalArchiveDownloadsPaused,
  syncIpIndiaJournalInventory,
} from '@/lib/ipindia-journal-archive-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function verifySuperAdmin(request: NextRequest, write = false) {
  const auth = await authenticateUser(request)
  if (!auth.user) {
    return { error: NextResponse.json({ error: auth.error?.message || 'Unauthorized' }, { status: auth.error?.status || 401 }) }
  }

  const roles = auth.user.roles || []
  const isSuperAdmin = roles.includes('SUPER_ADMIN')
  const isViewer = roles.includes('SUPER_ADMIN_VIEWER')
  if (!isSuperAdmin && !isViewer) {
    return { error: NextResponse.json({ error: 'Super admin access required' }, { status: 403 }) }
  }
  if (write && !isSuperAdmin) {
    return { error: NextResponse.json({ error: 'Write access required' }, { status: 403 }) }
  }

  return { user: auth.user }
}

function parsePart(value: string | null) {
  const part = Number(value || 0)
  return [1, 2, 3].includes(part) ? part : undefined
}

function parseFilters(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  return {
    since: searchParams.get('since') || undefined,
    until: searchParams.get('until') || undefined,
    status: searchParams.get('status') || undefined,
    part: parsePart(searchParams.get('part')),
    take: Number(searchParams.get('take') || 50),
    skip: Number(searchParams.get('skip') || 0),
  }
}

export async function GET(request: NextRequest) {
  const auth = await verifySuperAdmin(request)
  if ('error' in auth) return auth.error

  const [archive, settings] = await Promise.all([
    listIpIndiaJournalArchive(parseFilters(request)),
    getIpIndiaJournalArchiveSettings(),
  ])

  return NextResponse.json({
    ...archive,
    settings,
  })
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifySuperAdmin(request, true)
    if ('error' in auth) return auth.error

    const body = await request.json().catch(() => ({}))
    const filters = {
      since: typeof body?.since === 'string' && body.since.trim() ? body.since.trim() : undefined,
      until: typeof body?.until === 'string' && body.until.trim() ? body.until.trim() : undefined,
      status: typeof body?.status === 'string' && body.status.trim() ? body.status.trim() : undefined,
      part: [1, 2, 3].includes(Number(body?.part)) ? Number(body.part) : undefined,
      retryFailed: body?.retryFailed === true,
    }
    const action = typeof body?.action === 'string' ? body.action : 'queue'

    if (action === 'pause') {
      await setIpIndiaJournalArchiveDownloadsPaused(true, auth.user.id)
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, ...archive })
    }

    if (action === 'resume') {
      await setIpIndiaJournalArchiveDownloadsPaused(false, auth.user.id)
      const runner = kickPatentCorpusRunner('ipindia-archive-resume')
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, runner, ...archive }, { status: 202 })
    }

    if (action === 'sync') {
      const sync = await syncIpIndiaJournalInventory(filters)
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, sync, ...archive })
    }

    if (action === 'refresh-status') {
      const refresh = await refreshIpIndiaJournalPipelineStatuses()
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, refresh, ...archive })
    }

    if (action === 'cleanup-pdfs') {
      // Runs the retention sweep on demand. The queue runner does this too, but
      // only when it goes idle, so on a quiet system it may never fire.
      const cleanup = await cleanupOldStoredPdfs(Math.max(1, Number(body?.limit || 200) || 200))
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, cleanup, ...archive })
    }

    if (action === 'process-one') {
      const processed = await processPendingIpIndiaJournalArchive(`ipindia-admin-${process.pid}`, 1)
      const runner = kickPatentCorpusRunner('ipindia-archive-process-one')
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, processed, runner, ...archive })
    }

    if (action === 'check-latest') {
      const result = await queueLatestIpIndiaJournalFiles({
        limit: Math.max(1, Number(body?.limit || 1) || 1),
        retryFailed: body?.retryFailed === true,
      })
      const runner = kickPatentCorpusRunner('ipindia-archive-check-latest')
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, result, runner, ...archive }, { status: 202 })
    }

    if (action === 'historical') {
      const result = await queueHistoricalIpIndiaJournalFiles(filters)
      const runner = kickPatentCorpusRunner('ipindia-archive-historical')
      const archive = await listIpIndiaJournalArchive(filters)
      return NextResponse.json({ action, result, runner, ...archive }, { status: 202 })
    }

    if (action !== 'queue') {
      return NextResponse.json({ error: 'Unsupported IP India archive action.' }, { status: 400 })
    }

    const result = await queueIpIndiaJournalFiles(filters)
    const runner = kickPatentCorpusRunner('ipindia-archive-queue')
    const archive = await listIpIndiaJournalArchive(filters)
    return NextResponse.json({ action, result, runner, ...archive }, { status: 202 })
  } catch (error) {
    console.error('[PatentCorpus] IP India archive action failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'IP India archive action failed.' },
      { status: 500 }
    )
  }
}
