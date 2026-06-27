import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    draftingSession: {
      findFirst: vi.fn()
    }
  }
}))

vi.mock('@/lib/plantuml-renderer', () => ({
  renderPlantUml: vi.fn()
}))

import { authenticateUser } from '@/lib/auth-middleware'
import { prisma } from '@/lib/prisma'
import { renderPlantUml } from '@/lib/plantuml-renderer'
import { POST } from './route'

const authMock = vi.mocked(authenticateUser)
const findSessionMock = vi.mocked(prisma.draftingSession.findFirst)
const renderMock = vi.mocked(renderPlantUml)

function request(body: unknown, token = 'token') {
  return new NextRequest('http://local/api/patents/p1/drafting/plantuml-render', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

describe('POST plantuml-render', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unauthenticated requests', async () => {
    authMock.mockResolvedValue({ user: null, error: { code: 'NO_TOKEN', message: 'Unauthorized', status: 401 } } as any)

    const response = await POST(request({ sessionId: 's1', code: '@startuml\n@enduml' }), { params: { patentId: 'p1' } })

    expect(response.status).toBe(401)
    expect(findSessionMock).not.toHaveBeenCalled()
  })

  it('rejects wrong-session requests', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' }, error: null } as any)
    findSessionMock.mockResolvedValue(null as any)

    const response = await POST(request({ sessionId: 's-other', code: '@startuml\n@enduml' }), { params: { patentId: 'p1' } })

    expect(response.status).toBe(404)
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('renders for an owned session', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' }, error: null } as any)
    findSessionMock.mockResolvedValue({ id: 's1' } as any)
    renderMock.mockResolvedValue({
      buffer: Buffer.from('<svg/>'),
      checksum: 'abc',
      contentType: 'image/svg+xml',
      cleaned: '@startuml\n@enduml'
    })

    const response = await POST(request({ sessionId: 's1', code: '@startuml\n@enduml', format: 'svg' }), { params: { patentId: 'p1' } })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('image/svg+xml')
    expect(response.headers.get('x-checksum')).toBe('abc')
    expect(renderMock).toHaveBeenCalledWith('@startuml\n@enduml', 'svg')
  })
})
