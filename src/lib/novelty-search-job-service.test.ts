import { afterEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { cancelNoveltySearch, processNoveltySearchJob } from '@/lib/novelty-search-job-service'
import { checkServiceAccess } from '@/lib/org-access-service'

vi.mock('@/lib/novelty-search-service', () => ({
  NoveltySearchService: class NoveltySearchService {},
}))

vi.mock('@/lib/org-access-service', () => ({
  checkServiceAccess: vi.fn().mockResolvedValue({ allowed: true }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('novelty search job cancellation', () => {
  it('lets the search owner cancel queued or processing work', async () => {
    const findFirst = vi.spyOn((prisma as any).noveltySearchJob, 'findFirst').mockResolvedValue({
      id: 'job-1',
      status: 'PROCESSING',
    })
    const updateMany = vi.spyOn((prisma as any).noveltySearchJob, 'updateMany').mockResolvedValue({ count: 1 })

    const result = await cancelNoveltySearch('search-1', 'user-1')

    expect(result).toEqual({ outcome: 'cancelled', searchId: 'search-1', status: 'CANCELLED' })
    expect(findFirst).toHaveBeenCalledWith({
      where: { searchId: 'search-1', search: { userId: 'user-1' } },
      select: { id: true, status: true },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', status: { in: ['QUEUED', 'PROCESSING'] } },
      data: expect.objectContaining({
        status: 'CANCELLED',
        currentStep: 'CANCELLED',
        cancelledById: 'user-1',
        cancelledAt: expect.any(Date),
        lockedBy: null,
        lockedUntil: null,
      }),
    })
  })

  it('does not cancel completed work', async () => {
    vi.spyOn((prisma as any).noveltySearchJob, 'findFirst').mockResolvedValue({
      id: 'job-1',
      status: 'COMPLETED',
    })
    const updateMany = vi.spyOn((prisma as any).noveltySearchJob, 'updateMany')

    const result = await cancelNoveltySearch('search-1', 'user-1')

    expect(result).toEqual({ outcome: 'not_cancellable', status: 'COMPLETED' })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('does not let a worker complete a job after cancellation wins the race', async () => {
    vi.mocked(checkServiceAccess).mockResolvedValue({ allowed: true } as any)
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 'user-1',
      tenantId: 'tenant-1',
      tenant: {},
    } as any)
    vi.spyOn(prisma.noveltySearchRun, 'findUnique').mockResolvedValue({
      id: 'search-1',
      userId: 'user-1',
      status: 'COMPLETED',
    } as any)
    vi.spyOn((prisma as any).noveltySearchJob, 'findUnique').mockResolvedValue({
      id: 'job-1',
      status: 'CANCELLED',
    })
    const updateMany = vi.spyOn((prisma as any).noveltySearchJob, 'updateMany').mockResolvedValue({ count: 0 })

    const result = await processNoveltySearchJob({
      id: 'job-1',
      searchId: 'search-1',
      search: { userId: 'user-1' },
    }, 'worker-1')

    expect(result).toBeNull()
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job-1', status: 'PROCESSING', lockedBy: 'worker-1' },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }))
  })
})
