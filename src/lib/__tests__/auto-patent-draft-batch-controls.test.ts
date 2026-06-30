import { beforeEach, describe, expect, test, vi } from 'vitest'

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    autoPatentDraftBatch: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    autoPatentDraftBatchItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    patentDraftingJob: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    emailDraftRequest: {
      findMany: vi.fn(),
    },
    document: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    documentAccessLink: {
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/mailer', () => ({ sendEmail: vi.fn(), SITE_URL: 'http://localhost:3000' }))

import {
  cancelAutoPatentDraftBatch,
  getAutoPatentDraftBatchArtifactForUser,
  getAutoPatentDraftBatchArtifactsForUser,
  pauseAutoPatentDraftBatch,
  retryAutoPatentDraftBatchItem,
  resumeAutoPatentDraftBatch,
  updateAutoPatentDraftBatchItemReview,
} from '@/lib/auto-patent-draft-batch-service'
import { claimNextPatentDraftingJob } from '@/lib/patent-drafting-job-service'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('auto patent draft batch controls', () => {
  test('pauses a queued or processing batch without cancelling child jobs', async () => {
    prismaMock.autoPatentDraftBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'PROCESSING' })
    prismaMock.autoPatentDraftBatch.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'PAUSED' })
    prismaMock.autoPatentDraftBatchItem.findMany.mockResolvedValueOnce([])
    prismaMock.emailDraftRequest.findMany.mockResolvedValueOnce([])
    prismaMock.autoPatentDraftBatch.update.mockResolvedValueOnce({ id: 'batch-1', status: 'PAUSED' })

    const result = await pauseAutoPatentDraftBatch('batch-1', 'user-1')

    expect(result).toMatchObject({ outcome: 'paused', status: 'PAUSED' })
    expect(prismaMock.autoPatentDraftBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAUSED', pausedById: 'user-1' }),
    }))
    expect(prismaMock.patentDraftingJob.updateMany).not.toHaveBeenCalled()
  })

  test('resumes a paused batch to processing when unfinished items already started', async () => {
    const items = [
      { id: 'item-1', status: 'COMPLETED', currentStep: 'COMPLETED', artifactIds: [] },
      { id: 'item-2', status: 'PROCESSING', currentStep: 'DRAFTING', artifactIds: [] },
    ]
    prismaMock.autoPatentDraftBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'PAUSED' })
    prismaMock.autoPatentDraftBatchItem.findMany
      .mockResolvedValueOnce(items)
      .mockResolvedValueOnce(items)
    prismaMock.autoPatentDraftBatch.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'PROCESSING' })
    prismaMock.patentDraftingJob.findMany.mockResolvedValueOnce([])
    prismaMock.autoPatentDraftBatch.update.mockResolvedValueOnce({ id: 'batch-1', status: 'PROCESSING' })

    const result = await resumeAutoPatentDraftBatch('batch-1', 'user-1')

    expect(result).toMatchObject({ outcome: 'resumed', status: 'PROCESSING' })
    expect(prismaMock.autoPatentDraftBatch.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSING', resumedById: 'user-1', pausedAt: null }),
    }))
  })

  test('cancels active child jobs and batch items', async () => {
    const cancelledItems = [
      { id: 'item-1', status: 'CANCELLED', currentStep: 'CANCELLED', artifactIds: [], warnings: [] },
      { id: 'item-2', status: 'CANCELLED', currentStep: 'CANCELLED', artifactIds: [], warnings: [] },
    ]
    prismaMock.autoPatentDraftBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'PROCESSING' })
    prismaMock.autoPatentDraftBatch.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.patentDraftingJob.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.autoPatentDraftBatchItem.updateMany.mockResolvedValueOnce({ count: 2 })
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'CANCELLED' })
    prismaMock.autoPatentDraftBatchItem.findMany.mockResolvedValueOnce(cancelledItems)
    prismaMock.patentDraftingJob.findMany.mockResolvedValueOnce([])
    prismaMock.autoPatentDraftBatch.update.mockResolvedValueOnce({ id: 'batch-1', status: 'CANCELLED' })

    const result = await cancelAutoPatentDraftBatch('batch-1', 'user-1', 'No longer needed')

    expect(result).toMatchObject({ outcome: 'cancelled', status: 'CANCELLED' })
    expect(prismaMock.patentDraftingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ autoPatentDraftBatchId: 'batch-1', status: { in: ['QUEUED', 'PROCESSING'] } }),
      data: expect.objectContaining({ status: 'CANCELLED', currentStep: 'CANCELLED', lockedBy: null, lockedUntil: null }),
    }))
    expect(prismaMock.autoPatentDraftBatchItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', currentStep: 'CANCELLED', progressPct: 100 }),
    }))
  })

  test('does not claim queued jobs from paused batches', async () => {
    prismaMock.patentDraftingJob.findMany.mockResolvedValueOnce([
      { id: 'job-paused', status: 'QUEUED', userId: 'user-1', autoPatentDraftBatchId: 'batch-paused' },
      { id: 'job-open', status: 'QUEUED', userId: 'user-1', autoPatentDraftBatchId: null, startedAt: null },
    ])
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({ status: 'PAUSED' })
    prismaMock.patentDraftingJob.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.patentDraftingJob.findUnique.mockResolvedValueOnce({ id: 'job-open', status: 'PROCESSING' })

    const job = await claimNextPatentDraftingJob('worker-1')

    expect(job).toMatchObject({ id: 'job-open', status: 'PROCESSING' })
    expect(prismaMock.patentDraftingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-open' }),
      data: expect.objectContaining({ status: 'PROCESSING', lockedBy: 'worker-1' }),
    }))
  })

  test('marks queued jobs from cancelled batches as cancelled during claim scan', async () => {
    prismaMock.patentDraftingJob.findMany.mockResolvedValueOnce([
      { id: 'job-cancelled', status: 'QUEUED', userId: 'user-1', autoPatentDraftBatchId: 'batch-cancelled' },
    ])
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({
      status: 'CANCELLED',
      cancelledAt: new Date('2026-06-30T00:00:00.000Z'),
      cancelledById: 'user-1',
      cancelReason: 'Cancelled',
    })
    prismaMock.patentDraftingJob.updateMany.mockResolvedValueOnce({ count: 1 })

    const job = await claimNextPatentDraftingJob('worker-1')

    expect(job).toBeNull()
    expect(prismaMock.patentDraftingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-cancelled' }),
      data: expect.objectContaining({ status: 'CANCELLED', currentStep: 'CANCELLED', lockedBy: null }),
    }))
  })

  test('updates attorney review metadata without changing draft artifacts', async () => {
    prismaMock.autoPatentDraftBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'COMPLETED' })
    prismaMock.autoPatentDraftBatchItem.findFirst.mockResolvedValueOnce({
      id: 'item-1',
      batchId: 'batch-1',
      userId: 'user-1',
      reviewStatus: 'NEEDS_REVIEW',
      attorneyNotes: null,
    })
    prismaMock.autoPatentDraftBatchItem.update.mockResolvedValueOnce({
      id: 'item-1',
      reviewStatus: 'ACCEPTED',
      attorneyNotes: 'Ready for filing review.',
    })
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'COMPLETED' })
    prismaMock.autoPatentDraftBatchItem.findMany.mockResolvedValueOnce([])
    prismaMock.emailDraftRequest.findMany.mockResolvedValueOnce([])
    prismaMock.autoPatentDraftBatch.update.mockResolvedValueOnce({ id: 'batch-1', status: 'QUEUED' })

    const result = await updateAutoPatentDraftBatchItemReview('batch-1', 'item-1', 'user-1', {
      reviewStatus: 'ACCEPTED',
      attorneyNotes: 'Ready for filing review.',
    })

    expect(result).toMatchObject({ outcome: 'updated', item: { reviewStatus: 'ACCEPTED' } })
    expect(prismaMock.autoPatentDraftBatchItem.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        reviewStatus: 'ACCEPTED',
        attorneyNotes: 'Ready for filing review.',
        reviewedById: 'user-1',
      }),
    }))
  })

  test('requeues a failed batch item and clears stale batch ZIP state', async () => {
    prismaMock.autoPatentDraftBatch.findFirst.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'COMPLETED_WITH_ERRORS' })
    prismaMock.autoPatentDraftBatchItem.findFirst.mockResolvedValueOnce({
      id: 'item-1',
      batchId: 'batch-1',
      userId: 'user-1',
      jobId: 'job-1',
      status: 'FAILED',
    })
    prismaMock.patentDraftingJob.updateMany.mockResolvedValueOnce({ count: 1 })
    prismaMock.autoPatentDraftBatchItem.update.mockResolvedValueOnce({ id: 'item-1', status: 'QUEUED' })
    prismaMock.autoPatentDraftBatch.update.mockResolvedValueOnce({ id: 'batch-1', status: 'QUEUED' })
    prismaMock.autoPatentDraftBatch.findUnique.mockResolvedValueOnce({ id: 'batch-1', userId: 'user-1', status: 'QUEUED' })
    prismaMock.autoPatentDraftBatchItem.findMany.mockResolvedValueOnce([{ id: 'item-1', status: 'QUEUED', currentStep: 'QUEUED', artifactIds: [] }])
    prismaMock.patentDraftingJob.findMany.mockResolvedValueOnce([])
    prismaMock.autoPatentDraftBatch.update.mockResolvedValueOnce({ id: 'batch-1', status: 'QUEUED' })

    const result = await retryAutoPatentDraftBatchItem('batch-1', 'item-1', 'user-1')

    expect(result).toMatchObject({ outcome: 'retried', status: 'QUEUED' })
    expect(prismaMock.patentDraftingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-1', status: { in: ['FAILED', 'CANCELLED'] } }),
      data: expect.objectContaining({ status: 'QUEUED', currentStep: 'QUEUED', attemptCount: 0 }),
    }))
    expect(prismaMock.autoPatentDraftBatch.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ zipDocumentId: null, completionEmailSentAt: null }),
    }))
  })

  test('groups artifacts and only streams documents belonging to the batch item', async () => {
    const batch = { id: 'batch-1', userId: 'user-1', status: 'COMPLETED' }
    const item = {
      id: 'item-1',
      batchId: 'batch-1',
      userId: 'user-1',
      itemNo: 1,
      title: 'Input title',
      generatedTitle: 'Generated title',
      status: 'COMPLETED',
      reviewStatus: 'NEEDS_REVIEW',
      artifactIds: ['doc-1', 'doc-2'],
      warnings: [],
    }
    prismaMock.autoPatentDraftBatch.findFirst
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce(batch)
    prismaMock.autoPatentDraftBatchItem.findMany
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([item])
      .mockResolvedValueOnce([item])
    prismaMock.document.findMany.mockResolvedValueOnce([
      { id: 'doc-1', filename: 'IN_generated.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 10, createdAt: new Date() },
      { id: 'doc-2', filename: 'FIG-01_diagram.png', mimeType: 'image/png', sizeBytes: 20, createdAt: new Date() },
    ])
    prismaMock.document.findFirst.mockResolvedValueOnce({ id: 'doc-1', contentPtr: 'path/to/doc' })

    const listing = await getAutoPatentDraftBatchArtifactsForUser('batch-1', 'user-1')
    const allowed = await getAutoPatentDraftBatchArtifactForUser('batch-1', 'doc-1', 'user-1')
    const blocked = await getAutoPatentDraftBatchArtifactForUser('batch-1', 'doc-outside', 'user-1')

    expect(listing?.items[0].artifactGroups.drafts).toHaveLength(1)
    expect(listing?.items[0].artifactGroups.png).toHaveLength(1)
    expect(allowed).toMatchObject({ id: 'doc-1' })
    expect(blocked).toBeNull()
  })
})
