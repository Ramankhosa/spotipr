import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { imageSize } from 'image-size'
import { prisma } from '@/lib/prisma'
import { generateJWT } from '@/lib/auth'
import { detectExternalImageContent } from '@/lib/sketch-service'
import {
  isPendingImportedImageDescription,
} from '@/lib/diagram-image-analysis'

const LOCK_MINUTES = Math.max(5, Number(process.env.DIAGRAM_IMAGE_ANALYSIS_LOCK_MINUTES || 15))
const MAX_AI_SIDE = 1920
const MAX_AI_PIXELS = 1920 * 1080
const MAX_AI_BYTES = 10 * 1024 * 1024
const RASTER_ALLOWED_MIME_TYPE_VALUES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
const RASTER_ALLOWED_MIME_TYPES = new Set(RASTER_ALLOWED_MIME_TYPE_VALUES)
const UPLOAD_ALLOWED_MIME_TYPES = new Set([...RASTER_ALLOWED_MIME_TYPE_VALUES, 'image/svg+xml'])

type QueueInput = {
  diagramSourceId: string
  patentId: string
  sessionId: string
  userId: string
  tenantId?: string | null
  payload?: Record<string, unknown>
  maxAttempts?: number
}

function lockExpiry() {
  return new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
}

function retryDelay(attempt: number) {
  const delays = [60_000, 5 * 60_000, 15 * 60_000]
  return delays[Math.min(Math.max(0, attempt - 1), delays.length - 1)]
}

// Extend the lock while this worker is actively processing so a long-running
// (but alive) analysis is not reclaimed by another worker as a crash orphan.
async function heartbeat(jobId: string, workerId: string) {
  await (prisma as any).diagramImageAnalysisJob.updateMany({
    where: { id: jobId, status: 'PROCESSING', lockedBy: workerId },
    data: { heartbeatAt: new Date(), lockedUntil: lockExpiry() },
  })
}

async function withHeartbeat<T>(jobId: string, workerId: string, work: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => void heartbeat(jobId, workerId).catch(() => undefined), 60_000)
  try {
    return await work()
  } finally {
    clearInterval(timer)
  }
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null))
}

function mimeTypeForFilename(filename?: string | null) {
  const ext = path.extname(String(filename || '')).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.svg') return 'image/svg+xml'
  return ''
}

function titleCanBeReplaced(currentTitle: unknown, figureNo: number, originalTitle?: unknown) {
  const current = typeof currentTitle === 'string' ? currentTitle.trim() : ''
  const original = typeof originalTitle === 'string' ? originalTitle.trim() : ''
  if (!current) return true
  if (original && current === original) return true
  return [
    /^imported figure\b/i,
    /^embedded document image\b/i,
    /^embedded spreadsheet image\b/i,
    /^pdf page\b/i,
    new RegExp(`^figure\\s*${figureNo}\\b`, 'i'),
  ].some(pattern => pattern.test(current))
}

function localFileCandidates(params: {
  rawPath?: string | null
  filename?: string | null
  patentId?: string | null
  projectId?: string | null
}) {
  const candidates: string[] = []
  const rawPath = String(params.rawPath || '').trim()
  const filename = String(params.filename || '').trim()

  if (rawPath) {
    candidates.push(path.isAbsolute(rawPath) ? rawPath : path.join(process.cwd(), rawPath.replace(/^[/\\]+/, '')))
    if (rawPath.startsWith('/uploads/')) {
      candidates.push(path.join(process.cwd(), 'public', rawPath.replace(/^[/\\]+/, '')))
    }
  }

  if (filename && params.projectId && params.patentId) {
    candidates.push(path.join(process.cwd(), 'uploads', 'projects', params.projectId, 'patents', params.patentId, 'figures', filename))
    candidates.push(path.join(process.cwd(), 'public', 'uploads', 'projects', params.projectId, 'patents', params.patentId, 'figures', filename))
  }

  if (filename && params.patentId) {
    candidates.push(path.join(process.cwd(), 'uploads', 'patents', params.patentId, 'figures', filename))
    candidates.push(path.join(process.cwd(), 'public', 'uploads', 'patents', params.patentId, 'figures', filename))
  }

  return Array.from(new Set(candidates))
}

async function readFirstExistingFile(candidates: string[]) {
  for (const candidate of candidates) {
    try {
      const buffer = await fs.readFile(candidate)
      return { buffer, path: candidate }
    } catch {
      // Try the next likely storage path.
    }
  }
  return null
}

function readDimensions(buffer: Buffer) {
  const dimensions = imageSize(buffer)
  return {
    width: Number(dimensions.width || 0),
    height: Number(dimensions.height || 0),
  }
}

async function rasterizeForDetection(buffer: Buffer, width: number, height: number) {
  const sideScale = Math.min(MAX_AI_SIDE / width, MAX_AI_SIDE / height, 1)
  const pixelScale = Math.min(Math.sqrt(MAX_AI_PIXELS / (width * height)), 1)
  const scale = Math.min(sideScale, pixelScale)
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const nodeRequire = (0, eval)('require') as (moduleName: string) => unknown
  const { createCanvas, loadImage } = nodeRequire('@napi-rs/canvas') as {
    createCanvas: (width: number, height: number) => {
      getContext: (contextType: '2d') => {
        fillStyle: string
        fillRect: (x: number, y: number, width: number, height: number) => void
        drawImage: (image: unknown, x: number, y: number, width: number, height: number) => void
      }
      toBuffer: (mimeType: 'image/png' | 'image/jpeg', quality?: number) => Buffer
    }
    loadImage: (input: Buffer) => Promise<unknown>
  }
  const image = await loadImage(buffer)
  const canvas = createCanvas(targetWidth, targetHeight)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(image, 0, 0, targetWidth, targetHeight)

  let output = canvas.toBuffer('image/png')
  let mimeType = 'image/png'
  if (output.length > MAX_AI_BYTES) {
    try {
      output = canvas.toBuffer('image/jpeg', 82)
      mimeType = 'image/jpeg'
    } catch {
      // Keep the PNG failure path below.
    }
  }
  if (output.length > MAX_AI_BYTES) {
    throw new Error('Prepared image is still too large for AI diagram reading')
  }

  return {
    base64: output.toString('base64'),
    mimeType,
    width: targetWidth,
    height: targetHeight,
  }
}

async function prepareImageForDetection(buffer: Buffer, mimeType: string) {
  const normalizedMimeType = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType
  if (!UPLOAD_ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
    throw new Error('AI diagram reading supports PNG, JPEG, WebP, and SVG images')
  }

  const { width, height } = readDimensions(buffer)
  if (!width || !height) {
    throw new Error('Could not read imported image dimensions')
  }

  const mustRasterize =
    normalizedMimeType === 'image/svg+xml' ||
    buffer.length > MAX_AI_BYTES ||
    width > MAX_AI_SIDE ||
    height > MAX_AI_SIDE ||
    width * height > MAX_AI_PIXELS

  if (!mustRasterize && RASTER_ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
    return {
      base64: buffer.toString('base64'),
      mimeType: normalizedMimeType,
      width,
      height,
    }
  }

  return rasterizeForDetection(buffer, width, height)
}

function buildInternalUserJwt(user: any) {
  return generateJWT({
    sub: user.id,
    email: user.email,
    tenant_id: user.tenantId,
    roles: user.roles,
    ati_id: user.tenant?.atiId || null,
    tenant_ati_id: user.tenant?.atiId || null,
    scope: user.tenant?.atiId === 'PLATFORM' ? 'platform' : 'tenant',
  })
}

async function setDiagramSourceStatus(diagramSourceId: string, data: Record<string, unknown>) {
  await (prisma as any).diagramSource.update({
    where: { id: diagramSourceId },
    data,
  })
}

export async function enqueueDiagramImageAnalysisJob(input: QueueInput) {
  const existing = await (prisma as any).diagramImageAnalysisJob.findFirst({
    where: {
      diagramSourceId: input.diagramSourceId,
      status: { in: ['QUEUED', 'PROCESSING'] },
    },
    orderBy: { createdAt: 'desc' },
  })

  const now = new Date()
  await setDiagramSourceStatus(input.diagramSourceId, {
    imageAnalysisStatus: 'QUEUED',
    imageAnalysisError: null,
    imageAnalysisQueuedAt: now,
    imageAnalysisStartedAt: null,
    imageAnalysisCompletedAt: null,
  })

  if (existing) return existing

  return (prisma as any).diagramImageAnalysisJob.create({
    data: {
      diagramSourceId: input.diagramSourceId,
      patentId: input.patentId,
      sessionId: input.sessionId,
      userId: input.userId,
      tenantId: input.tenantId || null,
      payload: jsonSafe(input.payload || {}),
      maxAttempts: Number.isInteger(input.maxAttempts) ? input.maxAttempts : 3,
      nextAttemptAt: now,
    },
  })
}

export async function claimNextDiagramImageAnalysisJob(workerId: string) {
  const now = new Date()
  // Include PROCESSING rows whose lock has expired so a job orphaned by a worker
  // crash/redeploy (heartbeat stopped, lockedUntil elapsed) is self-healed instead
  // of staying PROCESSING forever. Alive jobs keep their lock via the heartbeat.
  const candidate = await (prisma as any).diagramImageAnalysisJob.findFirst({
    where: {
      status: { in: ['QUEUED', 'PROCESSING'] },
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
  })

  if (!candidate) return null

  const updated = await (prisma as any).diagramImageAnalysisJob.updateMany({
    where: {
      id: candidate.id,
      status: { in: ['QUEUED', 'PROCESSING'] },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: {
      status: 'PROCESSING',
      lockedBy: workerId,
      lockedUntil: lockExpiry(),
      heartbeatAt: now,
      startedAt: candidate.startedAt || now,
    },
  })

  if (updated.count !== 1) return null

  return (prisma as any).diagramImageAnalysisJob.findUnique({ where: { id: candidate.id } })
}

export async function getNextDiagramImageAnalysisAttemptAt() {
  const next = await (prisma as any).diagramImageAnalysisJob.findFirst({
    where: { status: 'QUEUED' },
    orderBy: { nextAttemptAt: 'asc' },
    select: { nextAttemptAt: true },
  })
  return next?.nextAttemptAt instanceof Date ? next.nextAttemptAt : null
}

async function markJobFailedOrRequeue(job: any, workerId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Diagram image analysis failed')
  const attemptCount = Number(job.attemptCount || 0) + 1
  const maxAttempts = Math.max(1, Number(job.maxAttempts || 3))
  const exhausted = attemptCount >= maxAttempts

  await setDiagramSourceStatus(job.diagramSourceId, {
    imageAnalysisStatus: exhausted ? 'FAILED' : 'QUEUED',
    imageAnalysisError: message,
    imageAnalysisStartedAt: exhausted ? job.startedAt || null : null,
    imageAnalysisCompletedAt: exhausted ? new Date() : null,
  })

  await (prisma as any).diagramImageAnalysisJob.updateMany({
    where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
    data: exhausted
      ? {
          status: 'FAILED',
          attemptCount,
          lastError: message,
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: new Date(),
          completedAt: new Date(),
        }
      : {
          status: 'QUEUED',
          attemptCount,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + retryDelay(attemptCount)),
          lockedBy: null,
          lockedUntil: null,
          heartbeatAt: null,
        },
  })

  return exhausted ? 'FAILED' : 'QUEUED'
}

export async function processDiagramImageAnalysisJob(job: any, workerId: string) {
  const currentJob = await (prisma as any).diagramImageAnalysisJob.findFirst({
    where: { id: job.id, status: 'PROCESSING', lockedBy: workerId },
    include: {
      diagramSource: {
        include: {
          session: {
            include: {
              patent: { select: { id: true, projectId: true } },
            },
          },
        },
      },
    },
  })
  if (!currentJob) return null

  try {
    const source = currentJob.diagramSource
    if (!source?.imageFilename && !source?.imagePath) {
      throw new Error('Imported diagram image file is missing')
    }

    const startedAt = new Date()
    await setDiagramSourceStatus(source.id, {
      imageAnalysisStatus: 'PROCESSING',
      imageAnalysisError: null,
      imageAnalysisStartedAt: startedAt,
      imageAnalysisCompletedAt: null,
    })

    const file = await readFirstExistingFile(localFileCandidates({
      rawPath: source.imagePath,
      filename: source.imageFilename,
      patentId: currentJob.patentId,
      projectId: source.session?.patent?.projectId,
    }))
    if (!file) {
      throw new Error('Imported diagram image file could not be found on disk')
    }

    const mimeType = mimeTypeForFilename(source.imageFilename || file.path)
    const prepared = await prepareImageForDetection(file.buffer, mimeType)
    const user = await (prisma as any).user.findUnique({
      where: { id: currentJob.userId },
      include: { tenant: true },
    })
    if (!user) throw new Error('Image analysis job user no longer exists')

    const token = buildInternalUserJwt(user)
    const figurePlan = await (prisma as any).figurePlan.findUnique({
      where: {
        sessionId_figureNo: {
          sessionId: currentJob.sessionId,
          figureNo: source.figureNo,
        },
      },
    })

    const result = await withHeartbeat(currentJob.id, workerId, () => detectExternalImageContent({
      patentId: currentJob.patentId,
      sessionId: currentJob.sessionId,
      uploadedImageBase64: prepared.base64,
      uploadedImageMimeType: prepared.mimeType,
      title: figurePlan?.title || (currentJob.payload as any)?.initialTitle || source.imageFilename || undefined,
      requestHeaders: { authorization: `Bearer ${token}` },
    }))

    if (!result.success || !result.description) {
      throw new Error(result.error || 'AI diagram image analysis failed')
    }

    const figureUpdate: Record<string, unknown> = {}
    const currentDescription = figurePlan?.description || ''
    if (!currentDescription.trim() || isPendingImportedImageDescription(currentDescription)) {
      figureUpdate.description = result.description
    }
    if (
      result.titleSuggestion &&
      titleCanBeReplaced(figurePlan?.title, source.figureNo, (currentJob.payload as any)?.initialTitle)
    ) {
      figureUpdate.title = result.titleSuggestion
    }
    if (Object.keys(figureUpdate).length > 0 && figurePlan) {
      await (prisma as any).figurePlan.update({
        where: { id: figurePlan.id },
        data: figureUpdate,
      })
    }

    await setDiagramSourceStatus(source.id, {
      imageAnalysisStatus: 'COMPLETED',
      imageAnalysisError: null,
      imageAnalysisWarnings: jsonSafe(Array.isArray(result.warnings) ? result.warnings : []),
      imageAnalysisModel: result.modelUsed || null,
      imageAnalysisStartedAt: startedAt,
      imageAnalysisCompletedAt: new Date(),
    })

    await (prisma as any).diagramImageAnalysisJob.updateMany({
      where: { id: currentJob.id, status: 'PROCESSING', lockedBy: workerId },
      data: {
        status: 'COMPLETED',
        lockedBy: null,
        lockedUntil: null,
        heartbeatAt: new Date(),
        lastError: null,
        completedAt: new Date(),
      },
    })

    return { id: currentJob.id, status: 'COMPLETED' }
  } catch (error) {
    console.error('[DiagramImageAnalysisJob] Failed:', {
      jobId: currentJob.id,
      diagramSourceId: currentJob.diagramSourceId,
      error: error instanceof Error ? error.message : String(error),
    })
    const status = await markJobFailedOrRequeue(currentJob, workerId, error)
    return { id: currentJob.id, status }
  }
}

export async function processPendingDiagramImageAnalysisJobs(workerId = `diagram-image-analysis-worker-${process.pid}`, limit = 1) {
  const processed: any[] = []
  for (let i = 0; i < limit; i++) {
    const job = await claimNextDiagramImageAnalysisJob(workerId)
    if (!job) break
    processed.push(await processDiagramImageAnalysisJob(job, workerId))
  }
  return processed
}

export async function retryDiagramImageAnalysis(params: {
  diagramSourceId: string
  patentId: string
  sessionId: string
  userId: string
  tenantId?: string | null
  payload?: Record<string, unknown>
}) {
  await (prisma as any).diagramImageAnalysisJob.updateMany({
    where: {
      diagramSourceId: params.diagramSourceId,
      status: { in: ['QUEUED', 'PROCESSING'] },
    },
    data: {
      status: 'FAILED',
      lockedBy: null,
      lockedUntil: null,
      completedAt: new Date(),
      lastError: 'Superseded by manual retry',
    },
  })

  return enqueueDiagramImageAnalysisJob({
    diagramSourceId: params.diagramSourceId,
    patentId: params.patentId,
    sessionId: params.sessionId,
    userId: params.userId,
    tenantId: params.tenantId,
    payload: params.payload || {},
  })
}

export function hashImageBuffer(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
