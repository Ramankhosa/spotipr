import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import { spawn } from 'child_process'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  appendStoredPdfsToPatentImportBatch,
  createPatentImportBatchFromStoredPdfs,
  PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE,
  PATENT_CORPUS_MAX_PDFS_PER_BATCH,
  PATENT_CORPUS_UPLOAD_ROOT,
  refreshPatentImportBatchStatus,
  StoredPatentCorpusPdf,
} from '@/lib/patent-corpus-service'

type IpIndiaInventoryRecord = {
  key: string
  status: string
  availability_date?: string
  publication_date?: string
  journal_no?: string
  part?: string
  label?: string
  output_file?: string
  bytes?: string
  sha256?: string
  portal_file_name?: string
  error?: string
  updated_at?: string
}

export type IpIndiaArchiveFilters = {
  since?: string
  until?: string
  status?: string
  part?: number
  portalLimit?: number
  all?: boolean
  take?: number
  skip?: number
}

const SCRIPT_DIR = path.join(process.cwd(), 'scripts', 'ipindia')
const INVENTORY_SCRIPT = path.join(SCRIPT_DIR, 'download_patent_journals.py')
const SINGLE_DOWNLOAD_SCRIPT = path.join(SCRIPT_DIR, 'download_one_patent_journal.py')
const PYTHON_BIN = process.env.IPINDIA_JOURNAL_PYTHON || 'python'
const DOWNLOAD_ROOT = process.env.IPINDIA_JOURNAL_DOWNLOAD_ROOT || path.join(PATENT_CORPUS_UPLOAD_ROOT, 'ipindia-journals')
const MANIFEST_PATH = path.join(DOWNLOAD_ROOT, 'manifest.csv')
const STATUS_PATH = path.join(DOWNLOAD_ROOT, 'download_status.csv')
const STATE_PATH = path.join(DOWNLOAD_ROOT, 'download_state.json')
const NAME_TEMPLATE = process.env.IPINDIA_JOURNAL_NAME_TEMPLATE || '{date_dash}_journal-{journal_issue}-{journal_year}_part-{roman}_{key}.pdf'
const DEFAULT_TIMEOUT_SECONDS = Math.max(30, Number(process.env.IPINDIA_JOURNAL_TIMEOUT_SECONDS || '180') || 180)
const DEFAULT_RETRIES = Math.max(0, Number(process.env.IPINDIA_JOURNAL_RETRIES || '2') || 2)
const LATEST_CHECK_LIMIT = Math.max(1, Number(process.env.IPINDIA_JOURNAL_LATEST_CHECK_LIMIT || '1') || 1)
const DAILY_CHECK_INTERVAL_MS = Math.max(60 * 60 * 1000, Number(process.env.IPINDIA_JOURNAL_DAILY_CHECK_INTERVAL_MS || String(24 * 60 * 60 * 1000)) || 24 * 60 * 60 * 1000)
const MAX_DOWNLOAD_ATTEMPTS = Math.max(1, Number(process.env.IPINDIA_JOURNAL_MAX_ATTEMPTS || '5') || 5)
const STALE_LOCK_MINUTES = Math.max(5, Number(process.env.IPINDIA_JOURNAL_STALE_LOCK_MINUTES || '30') || 30)
const PROGRESS_POLL_MS = Math.max(1000, Number(process.env.IPINDIA_JOURNAL_PROGRESS_POLL_MS || '2000') || 2000)
const JOURNAL_WORKER_DELAY_MS = Math.max(0, Number(process.env.IPINDIA_JOURNAL_WORKER_DELAY_MS || '10000') || 0)
const ARCHIVE_PDFS_PER_BATCH = Math.max(
  1,
  Math.min(
    PATENT_CORPUS_MAX_PDFS_PER_BATCH,
    Number(process.env.IPINDIA_JOURNAL_PDFS_PER_IMPORT_BATCH || PATENT_CORPUS_MAX_PDFS_PER_BATCH) || PATENT_CORPUS_MAX_PDFS_PER_BATCH
  )
)
const EMBEDDING_WORKER_CLAIM_MAX = Math.max(1, Number(process.env.PATENT_CORPUS_EMBEDDING_CLAIM_MAX || '512') || 512)
const EMBEDDING_WORKER_CLAIM = Math.max(0, Math.min(Number(process.env.PATENT_CORPUS_EMBEDDING_BATCH || '32') || 32, EMBEDDING_WORKER_CLAIM_MAX))
const JOB_BACKOFF_BASE_MS = 2 * 60 * 1000
const JOB_BACKOFF_MAX_MS = 60 * 60 * 1000
const ARCHIVE_CONTROL_ID = 'global'

type IpIndiaArchiveControlState = {
  downloadsPaused: boolean
  pausedAt: Date | null
  pausedBy: string | null
  resumedAt: Date | null
  resumedBy: string | null
}

function envDate(value?: string) {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const [, year, month, day] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
}

function parsePortalDate(value?: string) {
  if (!value) return null
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim())
  if (!match) return null
  const [, day, month, year] = match
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
}

function dateLteEndOfDay(value?: string) {
  const date = envDate(value)
  if (!date) return undefined
  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1)
}

function safeBasename(value?: string) {
  const base = path.basename(String(value || '').trim())
  return base || 'ipindia-journal.pdf'
}

function now() {
  return new Date()
}

function jitter(ms: number) {
  return Math.round(ms * (0.75 + Math.random() * 0.5))
}

function nextAttemptAt(attemptCount: number) {
  const exponent = Math.max(0, attemptCount - 1)
  return new Date(Date.now() + jitter(Math.min(JOB_BACKOFF_MAX_MS, JOB_BACKOFF_BASE_MS * 2 ** exponent)))
}

function conciseErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown error')
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  const meaningful = [...lines]
    .reverse()
    .find(line => !line.startsWith('File "') && !line.startsWith('Traceback'))
  const message = meaningful || raw.trim() || 'Unknown error'
  return message.length > 1200 ? `${message.slice(0, 1200)}...` : message
}

function terminalImportStatuses() {
  return ['IMPORTED', 'EXTRACTED', 'EMBEDDED', 'SKIPPED'] as const
}

function normalizeArchiveControl(control: any): IpIndiaArchiveControlState {
  return {
    downloadsPaused: Boolean(control?.downloadsPaused),
    pausedAt: control?.pausedAt || null,
    pausedBy: control?.pausedBy || null,
    resumedAt: control?.resumedAt || null,
    resumedBy: control?.resumedBy || null,
  }
}

export async function getIpIndiaJournalArchiveControl(): Promise<IpIndiaArchiveControlState> {
  const existing = await (prisma as any).ipIndiaJournalArchiveControl.findUnique({
    where: { id: ARCHIVE_CONTROL_ID },
  }).catch(() => null)
  if (existing) return normalizeArchiveControl(existing)

  const created = await (prisma as any).ipIndiaJournalArchiveControl.create({
    data: { id: ARCHIVE_CONTROL_ID },
  }).catch(() => null)
  if (created) return normalizeArchiveControl(created)

  const reread = await (prisma as any).ipIndiaJournalArchiveControl.findUnique({
    where: { id: ARCHIVE_CONTROL_ID },
  })
  return normalizeArchiveControl(reread)
}

export async function setIpIndiaJournalArchiveDownloadsPaused(paused: boolean, userId?: string) {
  const timestamp = now()
  const user = userId || null
  const data = paused
    ? {
        downloadsPaused: true,
        pausedAt: timestamp,
        pausedBy: user,
      }
    : {
        downloadsPaused: false,
        resumedAt: timestamp,
        resumedBy: user,
      }

  const control = await (prisma as any).ipIndiaJournalArchiveControl.upsert({
    where: { id: ARCHIVE_CONTROL_ID },
    create: {
      id: ARCHIVE_CONTROL_ID,
      downloadsPaused: paused,
      pausedAt: paused ? timestamp : null,
      pausedBy: paused ? user : null,
      resumedAt: paused ? null : timestamp,
      resumedBy: paused ? null : user,
    },
    update: data,
  })
  return normalizeArchiveControl(control)
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function sha256File(filePath: string) {
  const digest = crypto.createHash('sha256')
  const handle = await fs.open(filePath, 'r')
  try {
    for await (const chunk of handle.createReadStream()) {
      digest.update(chunk)
    }
  } finally {
    await handle.close()
  }
  return digest.digest('hex')
}

async function pdfStats(filePath: string) {
  const handle = await fs.open(filePath, 'r')
  try {
    const header = Buffer.alloc(5)
    await handle.read(header, 0, 5, 0)
    if (header.toString('utf8') !== '%PDF-') {
      throw new Error('Downloaded file does not start with %PDF-.')
    }
  } finally {
    await handle.close()
  }
  const stat = await fs.stat(filePath)
  return {
    size: stat.size,
    sha256: await sha256File(filePath),
  }
}

function runPython(args: string[], options?: { cwd?: string }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(PYTHON_BIN, args, {
      cwd: options?.cwd || process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error((stderr || stdout || `Python exited with code ${code}`).trim()))
      }
    })
  })
}

async function runPythonWithRetries(args: string[], options?: { cwd?: string; retries?: number }) {
  const retries = Math.max(0, Number(options?.retries ?? DEFAULT_RETRIES) || 0)
  let lastError: unknown = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await runPython(args, { cwd: options?.cwd })
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, Math.min(10_000, 1500 * (attempt + 1))))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Python command failed.'))
}

async function runInventorySyncPython(options: Pick<IpIndiaArchiveFilters, 'since' | 'portalLimit' | 'all'> = {}) {
  await ensureDir(DOWNLOAD_ROOT)
  const args = [
    INVENTORY_SCRIPT,
    '--status-only',
    '--output-dir',
    DOWNLOAD_ROOT,
    '--manifest',
    MANIFEST_PATH,
    '--status',
    STATUS_PATH,
    '--state',
    STATE_PATH,
    '--name-template',
    NAME_TEMPLATE,
    '--timeout',
    String(DEFAULT_TIMEOUT_SECONDS),
  ]
  if (options.all !== false && !options.portalLimit) {
    args.push('--all')
  } else {
    args.push('--limit', String(Math.max(1, Number(options.portalLimit || LATEST_CHECK_LIMIT) || LATEST_CHECK_LIMIT)))
  }
  if (options.since) {
    args.push('--since', options.since)
  }
  await runPythonWithRetries(args, { cwd: SCRIPT_DIR, retries: DEFAULT_RETRIES })
  const raw = await fs.readFile(STATE_PATH, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, IpIndiaInventoryRecord>
  return Object.values(parsed)
}

function recordStatus(record: IpIndiaInventoryRecord) {
  const status = String(record.status || '').toLowerCase()
  if (status === 'downloaded') return 'DOWNLOADED'
  if (status === 'failed' || status === 'invalid') return 'FAILED'
  return 'DISCOVERED'
}

function recordFileName(record: IpIndiaInventoryRecord) {
  return safeBasename(record.output_file || `${record.key || crypto.randomUUID()}.pdf`)
}

function recordOutputFile(record: IpIndiaInventoryRecord) {
  return record.output_file || path.join(DOWNLOAD_ROOT, recordFileName(record))
}

function metadataFromRecord(record: IpIndiaInventoryRecord) {
  const fileSizeBytes = Number(record.bytes || 0) || null
  const outputFile = recordOutputFile(record)
  return {
    journalKey: record.key,
    portalFileName: record.portal_file_name || '',
    journalNo: record.journal_no || '',
    publicationDateRaw: record.publication_date || null,
    availabilityDateRaw: record.availability_date || null,
    publicationDate: parsePortalDate(record.publication_date),
    availabilityDate: parsePortalDate(record.availability_date),
    part: Math.max(1, Number(record.part || 1) || 1),
    label: record.label || null,
    fileName: recordFileName(record),
    outputFile,
    storedPath: record.status === 'downloaded' ? outputFile : null,
    fileHash: record.sha256 || null,
    fileSizeBytes,
    downloadedBytes: fileSizeBytes,
    expectedBytes: fileSizeBytes,
    errorMessage: record.error || null,
    lastDiscoveredAt: now(),
  }
}

function whereFromFilters(filters: IpIndiaArchiveFilters) {
  const where: any = {}
  const since = envDate(filters.since)
  const until = dateLteEndOfDay(filters.until)
  if (since || until) {
    where.availabilityDate = {}
    if (since) where.availabilityDate.gte = since
    if (until) where.availabilityDate.lte = until
  }
  if (filters.status && filters.status !== 'ALL') where.status = filters.status
  if (filters.part && [1, 2, 3].includes(filters.part)) where.part = filters.part
  return where
}

async function syncOneInventoryRecord(record: IpIndiaInventoryRecord) {
  if (!record.key || !record.portal_file_name) return null
  const metadata = metadataFromRecord(record)
  const incomingStatus = recordStatus(record)
  const existing = await (prisma as any).ipIndiaJournalFile.findUnique({
    where: { journalKey: record.key },
  })

  if (!existing) {
    return (prisma as any).ipIndiaJournalFile.create({
      data: {
        ...metadata,
        status: incomingStatus,
        downloadedAt: incomingStatus === 'DOWNLOADED' ? now() : null,
      },
    })
  }

  const shouldPromoteDownloaded =
    incomingStatus === 'DOWNLOADED' &&
    !terminalImportStatuses().includes(existing.status) &&
    existing.status !== 'DOWNLOADING'

  const shouldMarkFailed =
    incomingStatus === 'FAILED' &&
    !terminalImportStatuses().includes(existing.status) &&
    existing.status !== 'DOWNLOADING'

  return (prisma as any).ipIndiaJournalFile.update({
    where: { id: existing.id },
    data: {
      ...metadata,
      status: shouldPromoteDownloaded ? 'DOWNLOADED' : shouldMarkFailed ? 'FAILED' : existing.status,
      downloadedAt: shouldPromoteDownloaded && !existing.downloadedAt ? now() : existing.downloadedAt,
      lockedBy: existing.status === 'DOWNLOADING' ? existing.lockedBy : null,
      lockedUntil: existing.status === 'DOWNLOADING' ? existing.lockedUntil : null,
    },
  })
}

export async function syncIpIndiaJournalInventory(filters: Pick<IpIndiaArchiveFilters, 'since' | 'until' | 'portalLimit' | 'all'> = {}) {
  const records = await runInventorySyncPython({
    since: filters.since,
    portalLimit: filters.portalLimit,
    all: filters.all,
  })
  const until = dateLteEndOfDay(filters.until)
  let synced = 0
  let skippedByDate = 0
  const journalKeys: string[] = []

  for (const record of records) {
    const availabilityDate = parsePortalDate(record.availability_date)
    if (until && availabilityDate && availabilityDate > until) {
      skippedByDate += 1
      continue
    }
    const syncedRecord = await syncOneInventoryRecord(record)
    if (syncedRecord) {
      synced += 1
      if (record.key) journalKeys.push(record.key)
    }
  }

  return {
    parsed: records.length,
    synced,
    skippedByDate,
    journalKeys,
    statePath: STATE_PATH,
    statusPath: STATUS_PATH,
    downloadRoot: DOWNLOAD_ROOT,
  }
}

export async function queueIpIndiaJournalFiles(filters: IpIndiaArchiveFilters & { retryFailed?: boolean } = {}) {
  const sync = await syncIpIndiaJournalInventory({
    since: filters.since,
    until: filters.until,
    portalLimit: filters.portalLimit,
    all: filters.all,
  })
  const where = whereFromFilters(filters)
  const statuses = filters.retryFailed
    ? ['DISCOVERED', 'FAILED']
    : ['DISCOVERED']
  const queued = await (prisma as any).ipIndiaJournalFile.updateMany({
    where: {
      ...where,
      status: { in: statuses },
    },
    data: {
      status: 'QUEUED',
      errorMessage: null,
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      nextAttemptAt: now(),
      attemptCount: filters.retryFailed ? 0 : undefined,
    },
  })
  return {
    sync,
    queued: queued.count || 0,
  }
}

export async function queueLatestIpIndiaJournalFiles(options: { retryFailed?: boolean; limit?: number } = {}) {
  const sync = await syncIpIndiaJournalInventory({
    portalLimit: Math.max(1, Number(options.limit || LATEST_CHECK_LIMIT) || LATEST_CHECK_LIMIT),
    all: false,
  })
  const statuses = options.retryFailed
    ? ['DISCOVERED', 'FAILED']
    : ['DISCOVERED']
  const queued = sync.journalKeys.length
    ? await (prisma as any).ipIndiaJournalFile.updateMany({
        where: {
          journalKey: { in: sync.journalKeys },
          status: { in: statuses },
        },
        data: {
          status: 'QUEUED',
          errorMessage: null,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          nextAttemptAt: now(),
          attemptCount: options.retryFailed ? 0 : undefined,
        },
      })
    : { count: 0 }

  return {
    sync,
    queued: queued.count || 0,
  }
}

export async function queueHistoricalIpIndiaJournalFiles(filters: IpIndiaArchiveFilters & { retryFailed?: boolean } = {}) {
  return queueIpIndiaJournalFiles({
    ...filters,
    all: true,
  })
}

export async function listIpIndiaJournalArchive(filters: IpIndiaArchiveFilters = {}) {
  await refreshIpIndiaJournalPipelineStatuses({ take: 300 }).catch(() => undefined)

  const take = Math.min(Math.max(Number(filters.take || 50), 1), 200)
  const skip = Math.max(Number(filters.skip || 0), 0)
  const where = whereFromFilters(filters)
  const [files, total, grouped, control] = await Promise.all([
    (prisma as any).ipIndiaJournalFile.findMany({
      where,
      orderBy: [
        { availabilityDate: 'asc' },
        { part: 'asc' },
      ],
      take,
      skip,
      include: {
        patentImportBatch: {
          select: {
            id: true,
            status: true,
            totalFiles: true,
            processedFiles: true,
            patentPages: true,
            patentsCreated: true,
            patentsUpdated: true,
          },
        },
        patentImportFile: {
          select: {
            id: true,
            batchId: true,
            status: true,
            totalPages: true,
            patentPages: true,
            patentsCreated: true,
            patentsUpdated: true,
            warningCount: true,
            lowConfidencePages: true,
            errorMessage: true,
            completedAt: true,
          },
        },
      },
    }),
    (prisma as any).ipIndiaJournalFile.count({ where }),
    (prisma as any).ipIndiaJournalFile.groupBy({
      by: ['status'],
      _count: { id: true },
    }).catch(() => []),
    getIpIndiaJournalArchiveControl(),
  ])

  const importFileIds = files
    .map((file: any) => file.patentImportFileId)
    .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
  const embeddingCounts = await embeddingCountsByImportFileIds(importFileIds)
  const patentCounts = await patentCountsByImportFileIds(importFileIds)

  const statusCounts = grouped.reduce((acc: Record<string, number>, row: any) => {
    acc[row.status] = row._count?.id || 0
    return acc
  }, {})

  return {
    files: files.map((file: any) => ({
      ...file,
      extractedPatentCount: patentCounts[file.patentImportFileId] || 0,
      embeddingCounts: embeddingCounts[file.patentImportFileId] || {},
    })),
    pagination: {
      take,
      skip,
      total,
    },
    summary: {
      total,
      statusCounts,
      downloadRoot: DOWNLOAD_ROOT,
      pdfsPerImportBatch: ARCHIVE_PDFS_PER_BATCH,
    },
    control,
  }
}

async function claimNextIpIndiaJournalFile(workerId: string) {
  const control = await getIpIndiaJournalArchiveControl()
  if (control.downloadsPaused) return null

  const lockExpiresBefore = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000)
  const candidates = await (prisma as any).ipIndiaJournalFile.findMany({
    where: {
      status: { in: ['QUEUED', 'FAILED'] },
      nextAttemptAt: { lte: now() },
      attemptCount: { lt: MAX_DOWNLOAD_ATTEMPTS },
      OR: [
        { lockedUntil: null },
        { lockedUntil: { lt: now() } },
        { heartbeatAt: { lt: lockExpiresBefore } },
      ],
    },
    orderBy: [
      { availabilityDate: 'asc' },
      { part: 'asc' },
      { createdAt: 'asc' },
    ],
    take: 10,
  })

  for (const candidate of candidates) {
    const updated = await (prisma as any).ipIndiaJournalFile.updateMany({
      where: {
        id: candidate.id,
        status: { in: ['QUEUED', 'FAILED'] },
        attemptCount: { lt: MAX_DOWNLOAD_ATTEMPTS },
        OR: [
          { lockedUntil: null },
          { lockedUntil: { lt: now() } },
          { heartbeatAt: { lt: lockExpiresBefore } },
        ],
      },
      data: {
        status: 'DOWNLOADING',
        lockedBy: workerId,
        lockedUntil: new Date(Date.now() + STALE_LOCK_MINUTES * 60 * 1000),
        heartbeatAt: now(),
        downloadStartedAt: now(),
        attemptCount: { increment: 1 },
        errorMessage: null,
      },
    })
    if (updated.count === 1) {
      return (prisma as any).ipIndiaJournalFile.findUnique({ where: { id: candidate.id } })
    }
  }

  return null
}

async function heartbeatJournalDownload(fileId: string, workerId: string, data: Record<string, unknown> = {}) {
  await (prisma as any).ipIndiaJournalFile.updateMany({
    where: { id: fileId, lockedBy: workerId },
    data: {
      ...data,
      heartbeatAt: now(),
      lockedUntil: new Date(Date.now() + STALE_LOCK_MINUTES * 60 * 1000),
    },
  })
}

async function runSinglePdfDownload(item: any, targetFile: string, workerId: string) {
  await ensureDir(path.dirname(targetFile))
  const tempFile = `${targetFile}.tmp`
  await fs.rm(tempFile, { force: true }).catch(() => undefined)

  const args = [
    SINGLE_DOWNLOAD_SCRIPT,
    '--portal-file-name',
    item.portalFileName,
    '--part',
    String(item.part),
    '--label',
    item.label || '',
    '--output-file',
    targetFile,
    '--timeout',
    String(DEFAULT_TIMEOUT_SECONDS),
    '--retries',
    String(DEFAULT_RETRIES),
  ]

  const child = spawn(PYTHON_BIN, args, {
    cwd: SCRIPT_DIR,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', chunk => {
    stderr += chunk.toString()
  })

  const progressTimer = setInterval(async () => {
    try {
      const stat = await fs.stat(tempFile)
      await heartbeatJournalDownload(item.id, workerId, {
        downloadedBytes: stat.size,
      })
    } catch {
      await heartbeatJournalDownload(item.id, workerId).catch(() => undefined)
    }
  }, PROGRESS_POLL_MS)
  ;(progressTimer as any)?.unref?.()

  try {
    await new Promise<void>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => {
        if (code === 0) resolve()
        else reject(new Error((stderr || stdout || `Python exited with code ${code}`).trim()))
      })
    })
  } finally {
    clearInterval(progressTimer)
  }
}

async function failJournalItem(item: any, error: unknown) {
  const attemptCount = Math.max(1, Number(item.attemptCount || 1))
  const exhausted = attemptCount >= MAX_DOWNLOAD_ATTEMPTS
  return (prisma as any).ipIndiaJournalFile.update({
    where: { id: item.id },
    data: {
      status: 'FAILED',
      errorMessage: conciseErrorMessage(error),
      lockedBy: null,
      lockedUntil: null,
      heartbeatAt: null,
      nextAttemptAt: exhausted ? now() : nextAttemptAt(attemptCount),
    },
  })
}

async function resolveIpIndiaImportUserId() {
  const configured = process.env.IPINDIA_JOURNAL_IMPORT_USER_ID
  if (configured) {
    const user = await (prisma as any).user.findUnique({ where: { id: configured }, select: { id: true } })
    if (user?.id) return user.id
  }

  const superAdmin = await (prisma as any).user.findFirst({
    where: {
      roles: { has: 'SUPER_ADMIN' },
      status: 'ACTIVE',
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (superAdmin?.id) return superAdmin.id
  throw new Error('No active SUPER_ADMIN user found for IP India archive import ownership. Set IPINDIA_JOURNAL_IMPORT_USER_ID.')
}

async function findReusableArchiveBatch(uploadedBy: string) {
  return (prisma as any).patentImportBatch.findFirst({
    where: {
      uploadedBy,
      status: { in: ['QUEUED', 'COMPLETED', 'COMPLETED_WITH_WARNINGS'] },
      totalFiles: { lt: ARCHIVE_PDFS_PER_BATCH },
      ipIndiaJournalFiles: { some: {} },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
}

async function registerDownloadedPdf(item: any, pdf: StoredPatentCorpusPdf) {
  const existingFile = await (prisma as any).patentImportFile.findFirst({
    where: { fileHash: pdf.fileHash },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      batchId: true,
      status: true,
    },
  })

  if (existingFile) {
    if (existingFile.status === 'FAILED') {
      await (prisma as any).patentImportFile.update({
        where: { id: existingFile.id },
        data: {
          status: 'QUEUED',
          attemptCount: 0,
          errorMessage: null,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
          nextAttemptAt: now(),
          startedAt: null,
          completedAt: null,
          warningBreakdown: {},
          ignoredPageBreakdown: {},
        },
      })
      await refreshPatentImportBatchStatus(existingFile.batchId)
    }

    return (prisma as any).ipIndiaJournalFile.update({
      where: { id: item.id },
      data: {
        status: 'IMPORTED',
        patentImportBatchId: existingFile.batchId,
        patentImportFileId: existingFile.id,
        importedAt: now(),
        errorMessage: null,
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: null,
      },
    })
  }

  const uploadedBy = await resolveIpIndiaImportUserId()
  const activeBatch = await findReusableArchiveBatch(uploadedBy)
  let batch: any
  if (activeBatch?.id) {
    await appendStoredPdfsToPatentImportBatch({
      batchId: activeBatch.id,
      pdfs: [pdf],
    })
    batch = await (prisma as any).patentImportBatch.findUnique({
      where: { id: activeBatch.id },
      include: { files: true },
    })
  } else {
    batch = await createPatentImportBatchFromStoredPdfs({
      uploadedBy,
      pdfs: [pdf],
    })
  }

  const importFile = (batch.files || []).find((file: any) => file.fileHash === pdf.fileHash)
    || await (prisma as any).patentImportFile.findFirst({
      where: { batchId: batch.id, fileHash: pdf.fileHash },
    })
  if (!importFile) {
    throw new Error('Downloaded PDF was stored, but no patent import file record was created.')
  }

  return (prisma as any).ipIndiaJournalFile.update({
    where: { id: item.id },
      data: {
        status: 'IMPORTED',
        patentImportBatchId: batch.id,
        patentImportFileId: importFile.id,
        importedAt: now(),
        errorMessage: null,
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: null,
      },
  })
}

export async function processNextIpIndiaJournalArchiveFile(workerId = `ipindia-journal-${process.pid}`) {
  const item = await claimNextIpIndiaJournalFile(workerId)
  if (!item) return null

  try {
    const targetFile = item.outputFile || path.join(DOWNLOAD_ROOT, item.fileName)
    let stats: { size: number; sha256: string } | null = null

    if (await fileExists(targetFile)) {
      stats = await pdfStats(targetFile)
    } else {
      await runSinglePdfDownload(item, targetFile, workerId)
      stats = await pdfStats(targetFile)
    }

    await (prisma as any).ipIndiaJournalFile.update({
      where: { id: item.id },
      data: {
        status: 'DOWNLOADED',
        storedPath: targetFile,
        outputFile: targetFile,
        fileHash: stats.sha256,
        fileSizeBytes: stats.size,
        downloadedBytes: stats.size,
        expectedBytes: stats.size,
        downloadedAt: now(),
      },
    })

    const pdf = {
      originalName: item.fileName || safeBasename(targetFile),
      storedPath: targetFile,
      mimeType: 'application/pdf',
      fileHash: stats.sha256,
      fileSizeBytes: stats.size,
    }
    return registerDownloadedPdf(item, pdf)
  } catch (error) {
    return failJournalItem(item, error)
  }
}

export async function processPendingIpIndiaJournalArchive(workerId = `ipindia-journal-${process.pid}`, limit = 1) {
  await refreshIpIndiaJournalPipelineStatuses({ take: 300 }).catch(() => undefined)
  const processed: any[] = []
  for (let index = 0; index < limit; index += 1) {
    const item = await processNextIpIndiaJournalArchiveFile(workerId)
    if (!item) break
    processed.push(item)
  }
  return processed
}

async function patentCountsByImportFileIds(fileIds: string[]) {
  if (!fileIds.length) return {}
  const rows = await (prisma as any).localPatent.groupBy({
    by: ['sourceImportFileId'],
    where: { sourceImportFileId: { in: fileIds } },
    _count: { id: true },
  }).catch(() => [])
  return rows.reduce((acc: Record<string, number>, row: any) => {
    if (row.sourceImportFileId) acc[row.sourceImportFileId] = row._count?.id || 0
    return acc
  }, {})
}

async function embeddingCountsByImportFileIds(fileIds: string[]) {
  if (!fileIds.length) return {}
  const rows = await prisma.$queryRaw<any[]>(Prisma.sql`
    SELECT
      p."sourceImportFileId" AS "fileId",
      e."status"::text AS "status",
      COUNT(*)::int AS "count"
    FROM "local_patents" p
    JOIN "local_patent_embeddings" e ON e."localPatentId" = p."id"
    WHERE p."sourceImportFileId" IN (${Prisma.join(fileIds)})
    GROUP BY p."sourceImportFileId", e."status"
  `).catch(() => [])

  return rows.reduce((acc: Record<string, Record<string, number>>, row: any) => {
    const fileId = String(row.fileId || '')
    if (!fileId) return acc
    if (!acc[fileId]) acc[fileId] = {}
    acc[fileId][row.status] = Number(row.count || 0)
    return acc
  }, {})
}

function deriveJournalStatusFromPipeline(file: any, patentCount: number, embeddingCounts: Record<string, number>) {
  if (!file) return null
  if (file.status === 'FAILED') return 'FAILED'
  if (!['COMPLETED', 'COMPLETED_WITH_WARNINGS'].includes(file.status)) return 'IMPORTED'

  const queued = Number(embeddingCounts.QUEUED || 0)
  const processing = Number(embeddingCounts.PROCESSING || 0)
  const failed = Number(embeddingCounts.FAILED || 0)
  const completed = Number(embeddingCounts.COMPLETED || 0)
  if (patentCount > 0 && completed >= patentCount && queued === 0 && processing === 0 && failed === 0) {
    return 'EMBEDDED'
  }
  return 'EXTRACTED'
}

export async function refreshIpIndiaJournalPipelineStatuses(options: { take?: number } = {}) {
  const take = Math.min(Math.max(Number(options.take || 500), 1), 2000)
  const rows = await (prisma as any).ipIndiaJournalFile.findMany({
    where: {
      patentImportFileId: { not: null },
      status: { in: ['IMPORTED', 'EXTRACTED', 'FAILED'] },
    },
    orderBy: { updatedAt: 'asc' },
    take,
    include: {
      patentImportFile: {
        select: {
          id: true,
          status: true,
          batchId: true,
          errorMessage: true,
          completedAt: true,
        },
      },
    },
  })
  const fileIds = rows
    .map((row: any) => row.patentImportFileId)
    .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id))
  const [patentCounts, embeddingCounts] = await Promise.all([
    patentCountsByImportFileIds(fileIds),
    embeddingCountsByImportFileIds(fileIds),
  ])

  let updated = 0
  for (const row of rows) {
    const nextStatus = deriveJournalStatusFromPipeline(
      row.patentImportFile,
      patentCounts[row.patentImportFileId] || 0,
      embeddingCounts[row.patentImportFileId] || {}
    )
    if (!nextStatus) continue
    const nextErrorMessage = nextStatus === 'FAILED' ? row.patentImportFile?.errorMessage : null
    const shouldClearError = nextStatus !== 'FAILED' && Boolean(row.errorMessage)
    if (nextStatus === row.status && !shouldClearError) continue
    await (prisma as any).ipIndiaJournalFile.update({
      where: { id: row.id },
      data: {
        status: nextStatus,
        errorMessage: nextErrorMessage,
        extractedAt: nextStatus === 'EXTRACTED' || nextStatus === 'EMBEDDED' ? (row.extractedAt || now()) : row.extractedAt,
        embeddedAt: nextStatus === 'EMBEDDED' ? (row.embeddedAt || now()) : row.embeddedAt,
      },
    })
    updated += 1
  }
  return { checked: rows.length, updated }
}

export async function getNextIpIndiaJournalQueueAttemptAt() {
  const control = await getIpIndiaJournalArchiveControl()
  if (control.downloadsPaused) return null

  const item = await (prisma as any).ipIndiaJournalFile.findFirst({
    where: {
      status: { in: ['QUEUED', 'FAILED'] },
      attemptCount: { lt: MAX_DOWNLOAD_ATTEMPTS },
      nextAttemptAt: { gt: now() },
    },
    orderBy: { nextAttemptAt: 'asc' },
    select: { nextAttemptAt: true },
  }).catch(() => null)
  return item?.nextAttemptAt || null
}

export async function getIpIndiaJournalArchiveSettings() {
  return {
    python: PYTHON_BIN,
    inventoryScript: INVENTORY_SCRIPT,
    singleDownloadScript: SINGLE_DOWNLOAD_SCRIPT,
    downloadRoot: DOWNLOAD_ROOT,
    statusPath: STATUS_PATH,
    statePath: STATE_PATH,
    nameTemplate: NAME_TEMPLATE,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    retries: DEFAULT_RETRIES,
    latestCheckLimit: LATEST_CHECK_LIMIT,
    dailyCheckIntervalMs: DAILY_CHECK_INTERVAL_MS,
    journalWorkerDelayMs: JOURNAL_WORKER_DELAY_MS,
    maxAttempts: MAX_DOWNLOAD_ATTEMPTS,
    pdfsPerImportBatch: ARCHIVE_PDFS_PER_BATCH,
    embeddingApiBatchSize: PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE,
    embeddingWorkerClaim: EMBEDDING_WORKER_CLAIM,
    embeddingWorkerClaimMax: EMBEDDING_WORKER_CLAIM_MAX,
  }
}
