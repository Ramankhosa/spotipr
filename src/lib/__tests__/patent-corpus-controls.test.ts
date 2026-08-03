import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import {
  cancelPatentImportBatch,
  cleanupOldStoredPdfs,
  deletePatentImportFileExtractions,
  deletePatentImportFileStoredPdf,
  patentWhereForImportFile,
  requeuePatentImportFileEmbeddings,
  retryPatentImportFileExtraction,
} from '@/lib/patent-corpus-service'
import { GET as exportGET } from '@/app/api/super-admin/patent-corpus/export/route'
import { POST as cancelBatchPOST } from '@/app/api/super-admin/patent-corpus/imports/[id]/cancel/route'
import { POST as retryExtractionPOST } from '@/app/api/super-admin/patent-corpus/imports/[id]/files/[fileId]/retry-extraction/route'

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    patentImportFile: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    patentImportBatch: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    localPatent: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    localPatentEmbedding: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
    ipIndiaJournalFile: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}))

vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
  },
}))

vi.mock('@/lib/patent-corpus-runner', () => ({
  kickPatentCorpusRunner: vi.fn(() => ({ active: true })),
}))

const mockedAuthenticateUser = vi.mocked(authenticateUser)
const mockPrisma = vi.mocked(prisma as any)
const mockFs = vi.mocked(fs as any)

function resetPrismaMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === 'function' && 'mockReset' in model) {
      ;(model as { mockReset: () => void }).mockReset()
      continue
    }
    if (!model || typeof model !== 'object') continue
    for (const value of Object.values(model as Record<string, unknown>)) {
      if (typeof value === 'function' && 'mockReset' in value) {
        ;(value as { mockReset: () => void }).mockReset()
      }
    }
  }
}

describe('patent corpus PDF-level controls', () => {
  beforeEach(() => {
    resetPrismaMocks()
    mockedAuthenticateUser.mockReset()
    mockFs.access.mockReset()
    mockFs.unlink.mockReset()
    mockFs.access.mockResolvedValue(undefined)
    mockFs.unlink.mockResolvedValue(undefined)
    mockPrisma.patentImportFile.findMany.mockResolvedValue([])
    mockPrisma.patentImportBatch.update.mockResolvedValue({ id: 'batch-1' })
  })

  it('builds precise file-scoped patent filters with legacy fallback', () => {
    expect(patentWhereForImportFile({
      id: 'file-1',
      fileHash: 'hash-1',
      originalName: 'journal.pdf',
    })).toEqual({
      OR: [
        { sourceImportFileId: 'file-1' },
        {
          sourceImportFileId: null,
          sourceFileHash: 'hash-1',
          sourcePdfName: 'journal.pdf',
        },
      ],
    })
  })

  it('queues one PDF for extraction retry and rejects files that are processing', async () => {
    mockPrisma.patentImportFile.findFirst.mockResolvedValueOnce({
      id: 'file-1',
      batchId: 'batch-1',
      status: 'COMPLETED',
      storedPath: 'uploads/patent-corpus/batch-1/file.pdf',
    })
    mockPrisma.patentImportFile.update.mockResolvedValueOnce({ id: 'file-1', status: 'QUEUED' })

    await retryPatentImportFileExtraction('batch-1', 'file-1')

    expect(mockPrisma.patentImportFile.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'file-1' },
      data: expect.objectContaining({
        status: 'QUEUED',
        errorMessage: null,
        lockedBy: null,
        completedAt: null,
      }),
    }))

    mockPrisma.patentImportFile.findFirst.mockResolvedValueOnce({
      id: 'file-1',
      batchId: 'batch-1',
      status: 'PROCESSING',
    })

    await expect(retryPatentImportFileExtraction('batch-1', 'file-1')).rejects.toThrow(/currently processing/)

    mockPrisma.patentImportFile.findFirst.mockResolvedValueOnce({
      id: 'file-1',
      batchId: 'batch-1',
      status: 'COMPLETED',
      storedPath: 'uploads/patent-corpus/batch-1/deleted.pdf',
    })
    mockFs.access.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    await expect(retryPatentImportFileExtraction('batch-1', 'file-1')).rejects.toThrow(/uploaded PDF file has been deleted/i)
  })

  it('deletes one PDF extraction output and relies on cascading embedding deletion', async () => {
    const file = {
      id: 'file-1',
      batchId: 'batch-1',
      status: 'COMPLETED',
      fileHash: 'hash-1',
      originalName: 'journal.pdf',
    }
    mockPrisma.patentImportFile.findFirst.mockResolvedValue(file)
    mockPrisma.localPatent.deleteMany.mockResolvedValue({ count: 2 })
    mockPrisma.patentImportFile.update.mockResolvedValue({ ...file, patentPages: 0 })

    const result = await deletePatentImportFileExtractions('batch-1', 'file-1')

    expect(result.deletedPatents).toBe(2)
    expect(mockPrisma.localPatent.deleteMany).toHaveBeenCalledWith({
      where: patentWhereForImportFile(file),
    })
    expect(mockPrisma.patentImportFile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        patentPages: 0,
        patentsCreated: 0,
        patentsUpdated: 0,
      }),
    }))
  })

  it('deletes only the stored PDF file while keeping extraction metadata', async () => {
    const file = {
      id: 'file-1',
      batchId: 'batch-1',
      status: 'COMPLETED',
      storedPath: 'uploads/patent-corpus/batch-1/file.pdf',
      fileHash: 'hash-1',
      originalName: 'journal.pdf',
    }
    mockPrisma.patentImportFile.findFirst.mockResolvedValue(file)

    const result = await deletePatentImportFileStoredPdf('batch-1', 'file-1')

    expect(result).toMatchObject({ deletedStoredFile: true })
    expect(mockFs.unlink).toHaveBeenCalledWith(file.storedPath)
    expect(mockPrisma.localPatent.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.patentImportFile.update).not.toHaveBeenCalled()
  })

  it('force-requeues embeddings for patents extracted from one PDF', async () => {
    mockPrisma.patentImportFile.findFirst.mockResolvedValue({
      id: 'file-1',
      batchId: 'batch-1',
      status: 'COMPLETED',
      fileHash: 'hash-1',
      originalName: 'journal.pdf',
    })
    mockPrisma.localPatent.findMany.mockResolvedValue([
      { id: 101, embeddingText: 'embedding text 1' },
      { id: 102, title: 'fallback title' },
    ])
    mockPrisma.localPatentEmbedding.findUnique.mockResolvedValue(null)
    mockPrisma.localPatentEmbedding.create.mockResolvedValue({})
    mockPrisma.localPatentEmbedding.deleteMany.mockResolvedValue({ count: 0 })
    mockPrisma.localPatentEmbedding.updateMany.mockResolvedValue({ count: 1 })

    const result = await requeuePatentImportFileEmbeddings('batch-1', 'file-1')

    expect(result).toMatchObject({ patentCount: 2, requeuedEmbeddings: 2 })
    expect(mockPrisma.localPatentEmbedding.create).toHaveBeenCalledTimes(2)
    expect(mockPrisma.localPatentEmbedding.updateMany).toHaveBeenCalledTimes(2)
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled()
  })

  it('cancels queued extraction and embedding jobs for a batch', async () => {
    mockPrisma.patentImportBatch.findUnique.mockResolvedValue({ id: 'batch-1', status: 'PROCESSING' })
    mockPrisma.patentImportFile.findMany
      .mockResolvedValueOnce([
        { id: 'file-1', status: 'QUEUED' },
        { id: 'file-2', status: 'COMPLETED' },
      ])
      .mockResolvedValueOnce([
        {
          id: 'file-1',
          status: 'FAILED',
          totalPages: 0,
          patentPages: 0,
          patentsCreated: 0,
          patentsUpdated: 0,
          lowConfidencePages: 0,
          warningCount: 0,
        },
        {
          id: 'file-2',
          status: 'COMPLETED',
          totalPages: 10,
          patentPages: 8,
          patentsCreated: 8,
          patentsUpdated: 0,
          lowConfidencePages: 0,
          warningCount: 0,
        },
      ])
    mockPrisma.patentImportFile.updateMany.mockResolvedValue({ count: 1 })
    mockPrisma.localPatentEmbedding.updateMany.mockResolvedValue({ count: 2 })
    mockPrisma.patentImportBatch.update.mockResolvedValue({ id: 'batch-1', status: 'COMPLETED_WITH_WARNINGS' })

    const result = await cancelPatentImportBatch('batch-1')

    expect(result).toMatchObject({ cancelledFiles: 1, cancelledEmbeddings: 2 })
    expect(mockPrisma.patentImportFile.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ batchId: 'batch-1', status: { in: ['QUEUED', 'FAILED'] } }),
      data: expect.objectContaining({
        status: 'FAILED',
        attemptCount: expect.any(Number),
        errorMessage: expect.stringMatching(/^Cancelled by user/),
      }),
    }))
    expect(mockPrisma.localPatentEmbedding.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['QUEUED', 'FAILED'] },
        patent: { sourceImportFileId: { in: ['file-1', 'file-2'] } },
      }),
      data: expect.objectContaining({
        status: 'FAILED',
        errorMessage: expect.stringMatching(/^Cancelled by user/),
      }),
    }))
  })

  it('exports only records from a requested PDF file', async () => {
    mockedAuthenticateUser.mockResolvedValue({
      user: { roles: ['SUPER_ADMIN_VIEWER'] },
    } as any)
    const file = {
      id: 'file-1',
      batchId: 'batch-1',
      fileHash: 'hash-1',
      originalName: 'journal.pdf',
    }
    mockPrisma.patentImportFile.findUnique.mockResolvedValue(file)
    mockPrisma.localPatent.findMany.mockResolvedValue([
      { publicationNumber: 'IN1', title: 'One', embeddings: [] },
    ])

    const response = await exportGET!(
      new Request('http://test.local/api/super-admin/patent-corpus/export?fileId=file-1&format=json') as any
    ) as Response

    expect(response.status).toBe(200)
    expect(mockPrisma.localPatent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: patentWhereForImportFile(file),
    }))
    await expect(response.json()).resolves.toMatchObject({ fileId: 'file-1', count: 1 })
  })

  it('blocks viewer users from PDF-level write actions', async () => {
    mockedAuthenticateUser.mockResolvedValue({
      user: { roles: ['SUPER_ADMIN_VIEWER'] },
    } as any)

    const response = await retryExtractionPOST!(
      new Request('http://test.local/api/super-admin/patent-corpus/imports/batch-1/files/file-1/retry-extraction') as any,
      { params: { id: 'batch-1', fileId: 'file-1' } }
    ) as Response

    expect(response.status).toBe(403)
    expect(mockPrisma.patentImportFile.findFirst).not.toHaveBeenCalled()
  })

  it('blocks viewer users from cancelling an import batch', async () => {
    mockedAuthenticateUser.mockResolvedValue({
      user: { roles: ['SUPER_ADMIN_VIEWER'] },
    } as any)

    const response = await cancelBatchPOST!(
      new Request('http://test.local/api/super-admin/patent-corpus/imports/batch-1/cancel') as any,
      { params: { id: 'batch-1' } }
    ) as Response

    expect(response.status).toBe(403)
    expect(mockPrisma.patentImportBatch.findUnique).not.toHaveBeenCalled()
  })

  describe('stored PDF retention cleanup', () => {
    beforeEach(() => {
      mockPrisma.patentImportFile.update.mockResolvedValue({ id: 'file-1' })
      mockPrisma.ipIndiaJournalFile.updateMany.mockResolvedValue({ count: 0 })
      // The orphan-journal pass runs after the import-file pass; default it to no
      // orphans so the existing cases exercise only the import-file path.
      mockPrisma.ipIndiaJournalFile.findMany.mockResolvedValue([])
      mockPrisma.ipIndiaJournalFile.update.mockResolvedValue({ id: 'journal-1' })
    })

    it('only considers finished imports with no embedding work in flight', async () => {
      await cleanupOldStoredPdfs()

      const where = mockPrisma.patentImportFile.findMany.mock.calls[0][0].where
      // Terminal states only -- FAILED is included so its PDF is reclaimed too, but
      // files still QUEUED/PROCESSING for extraction keep their PDF.
      expect(where.status).toEqual({ in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'] })
      expect(where.extractedPatents).toEqual({
        none: { embeddings: { some: { status: { in: ['QUEUED', 'PROCESSING'] } } } },
      })
    })

    it('keeps the last month of downloads and sweeps older ones by ingest date', async () => {
      await cleanupOldStoredPdfs()

      const where = mockPrisma.patentImportFile.findMany.mock.calls[0][0].where

      // Age is measured from createdAt (download/ingest), on a single window --
      // there is no separate empty-file window any more.
      expect(where.OR).toBeUndefined()
      expect(where.createdAt).toEqual({ lt: expect.any(Date) })

      // The cutoff is ~one month in the past.
      const ageMs = Date.now() - where.createdAt.lt.getTime()
      const day = 24 * 60 * 60 * 1000
      expect(ageMs).toBeGreaterThan(29 * day)
      expect(ageMs).toBeLessThan(31 * day)
    })

    it('deletes the PDF and clears both pointers to the shared file on disk', async () => {
      mockPrisma.patentImportFile.findMany.mockResolvedValueOnce([
        { id: 'file-1', storedPath: '/uploads/patent-corpus/old.pdf' },
      ])

      const result = await cleanupOldStoredPdfs()

      expect(mockFs.unlink).toHaveBeenCalledWith('/uploads/patent-corpus/old.pdf')
      expect(mockPrisma.patentImportFile.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { storedPath: '' },
      })
      // The IP India archive row points at the same file, so it must stop
      // advertising a path that no longer exists.
      expect(mockPrisma.ipIndiaJournalFile.updateMany).toHaveBeenCalledWith({
        where: { patentImportFileId: 'file-1' },
        data: { storedPath: null },
      })
      expect(result).toEqual({ checked: 1, deleted: 1 })
    })

    it('never deletes extracted patents or embeddings', async () => {
      mockPrisma.patentImportFile.findMany.mockResolvedValueOnce([
        { id: 'file-1', storedPath: '/uploads/patent-corpus/old.pdf' },
      ])

      await cleanupOldStoredPdfs()

      expect(mockPrisma.localPatent.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.localPatentEmbedding.deleteMany).not.toHaveBeenCalled()
      expect(mockPrisma.localPatentEmbedding.updateMany).not.toHaveBeenCalled()
    })

    it('still clears rows whose file is already gone so the scan keeps moving', async () => {
      mockPrisma.patentImportFile.findMany.mockResolvedValueOnce([
        { id: 'file-1', storedPath: '/uploads/patent-corpus/missing.pdf' },
      ])
      mockFs.unlink.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

      const result = await cleanupOldStoredPdfs()

      expect(mockPrisma.patentImportFile.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { storedPath: '' },
      })
      expect(result).toEqual({ checked: 1, deleted: 0 })
    })

    it('leaves the row untouched when deletion fails for any other reason', async () => {
      mockPrisma.patentImportFile.findMany.mockResolvedValueOnce([
        { id: 'file-1', storedPath: '/uploads/patent-corpus/locked.pdf' },
      ])
      mockFs.unlink.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'EBUSY' }))

      const result = await cleanupOldStoredPdfs()

      expect(mockPrisma.patentImportFile.update).not.toHaveBeenCalled()
      expect(mockPrisma.ipIndiaJournalFile.updateMany).not.toHaveBeenCalled()
      expect(result).toEqual({ checked: 1, deleted: 0 })
    })

    it('also reclaims orphaned journal PDFs that never became an import file', async () => {
      mockPrisma.patentImportFile.findMany.mockResolvedValueOnce([])
      mockPrisma.ipIndiaJournalFile.findMany.mockResolvedValueOnce([
        { id: 'journal-1', storedPath: '/uploads/patent-corpus/ipindia-journals/orphan.pdf' },
      ])

      const result = await cleanupOldStoredPdfs()

      // Only settled downloads with a PDF and no import file, on the same window.
      const where = mockPrisma.ipIndiaJournalFile.findMany.mock.calls[0][0].where
      expect(where.patentImportFileId).toBeNull()
      expect(where.storedPath).toEqual({ not: null })
      expect(where.status).toEqual({
        in: ['DOWNLOADED', 'IMPORTED', 'EXTRACTED', 'EMBEDDED', 'SKIPPED', 'FAILED'],
      })
      expect(where.createdAt).toEqual({ lt: expect.any(Date) })

      expect(mockFs.unlink).toHaveBeenCalledWith('/uploads/patent-corpus/ipindia-journals/orphan.pdf')
      expect(mockPrisma.ipIndiaJournalFile.update).toHaveBeenCalledWith({
        where: { id: 'journal-1' },
        data: { storedPath: null },
      })
      expect(result).toEqual({ checked: 1, deleted: 1 })
    })

    it('spends the batch budget on import files first, leaving none for orphans', async () => {
      mockPrisma.patentImportFile.findMany.mockResolvedValueOnce([
        { id: 'file-1', storedPath: '/uploads/patent-corpus/a.pdf' },
        { id: 'file-2', storedPath: '/uploads/patent-corpus/b.pdf' },
      ])

      const result = await cleanupOldStoredPdfs(2)

      // Budget (2) fully consumed by import files, so the orphan pass is skipped.
      expect(mockPrisma.ipIndiaJournalFile.findMany).not.toHaveBeenCalled()
      expect(result).toEqual({ checked: 2, deleted: 2 })
    })
  })
})
