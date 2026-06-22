import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    $queryRaw: vi.fn(),
    ipIndiaJournalArchiveControl: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    ipIndiaJournalFile: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
      update: vi.fn(),
    },
    localPatent: {
      groupBy: vi.fn(),
    },
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/patent-corpus-service', () => ({
  appendStoredPdfsToPatentImportBatch: vi.fn(),
  createPatentImportBatchFromStoredPdfs: vi.fn(),
  PATENT_CORPUS_EMBEDDING_API_BATCH_SIZE: 128,
  PATENT_CORPUS_MAX_PDFS_PER_BATCH: 25,
  PATENT_CORPUS_UPLOAD_ROOT: 'uploads/patent-corpus',
  refreshPatentImportBatchStatus: vi.fn(),
}))

import { listIpIndiaJournalArchive } from '@/lib/ipindia-journal-archive-service'

describe('IP India journal archive service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prisma.$queryRaw.mockResolvedValue([])
    mocks.prisma.ipIndiaJournalArchiveControl.findUnique.mockResolvedValue({
      id: 'global',
      downloadsPaused: false,
      pausedAt: null,
      pausedBy: null,
      resumedAt: null,
      resumedBy: null,
    })
    mocks.prisma.ipIndiaJournalFile.count.mockResolvedValue(2)
    mocks.prisma.ipIndiaJournalFile.groupBy.mockResolvedValue([])
    mocks.prisma.localPatent.groupBy.mockResolvedValue([])
  })

  it('lists journal PDFs newest-first for the admin archive display', async () => {
    const files = [
      {
        id: 'new-file',
        journalKey: '20260619_25-2026_3_hash',
        availabilityDate: new Date('2026-06-19T00:00:00.000Z'),
        part: 3,
        patentImportFileId: null,
      },
      {
        id: 'old-file',
        journalKey: '20260612_24-2026_1_hash',
        availabilityDate: new Date('2026-06-12T00:00:00.000Z'),
        part: 1,
        patentImportFileId: null,
      },
    ]
    mocks.prisma.ipIndiaJournalFile.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(files)

    const archive = await listIpIndiaJournalArchive({ take: 50, skip: 0 })

    expect(mocks.prisma.ipIndiaJournalFile.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      orderBy: [
        { availabilityDate: { sort: 'desc', nulls: 'last' } },
        { part: 'desc' },
        { createdAt: 'desc' },
      ],
    }))
    expect(archive.files.map((file: any) => file.id)).toEqual(['new-file', 'old-file'])
  })
})
