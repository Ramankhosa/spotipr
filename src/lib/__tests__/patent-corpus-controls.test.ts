import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import {
  cancelPatentImportBatch,
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
})
