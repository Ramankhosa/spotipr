import { describe, expect, test, vi } from 'vitest'
import { POST } from './route'
import { authenticateUser } from '@/lib/auth-middleware'

vi.mock('@/lib/auth-middleware', () => ({
  authenticateUser: vi.fn(),
}))

const mockedAuthenticateUser = vi.mocked(authenticateUser)

function buildRequest(file?: File) {
  const formData = new FormData()
  if (file) formData.append('file', file)

  return new Request('http://localhost/api/patents/draft/ingest-file', {
    method: 'POST',
    body: formData,
  }) as any
}

describe('POST /api/patents/draft/ingest-file', () => {
  test('rejects unauthorized requests', async () => {
    mockedAuthenticateUser.mockResolvedValueOnce({
      user: null,
      error: { message: 'Unauthorized', status: 401 },
    } as any)

    const response = await POST(buildRequest(new File(['idea'], 'idea.txt', { type: 'text/plain' })))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
  })

  test('returns extracted text for valid txt uploads', async () => {
    mockedAuthenticateUser.mockResolvedValueOnce({
      user: { id: 'user_1' },
      error: null,
    } as any)

    const response = await POST(buildRequest(new File(['Patent idea'], 'idea.txt', { type: 'text/plain' })))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      textContent: 'Patent idea',
      fileName: 'idea.txt',
      detectedFormat: 'txt',
    })
  })

  test('rejects unsupported files', async () => {
    mockedAuthenticateUser.mockResolvedValueOnce({
      user: { id: 'user_1' },
      error: null,
    } as any)

    const response = await POST(buildRequest(new File(['idea'], 'idea.rtf', { type: 'application/rtf' })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Unsupported file type. Please upload .txt, .md, .csv, .tsv, .xlsx, .doc, .docx, or .pdf files.')
  })

  test('rejects unsupported extensions even when browser supplies text/plain', async () => {
    mockedAuthenticateUser.mockResolvedValueOnce({
      user: { id: 'user_1' },
      error: null,
    } as any)

    const response = await POST(buildRequest(new File(['<b>idea</b>'], 'evil.html', { type: 'text/plain' })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Unsupported file type. Please upload .txt, .md, .csv, .tsv, .xlsx, .doc, .docx, or .pdf files.')
  })

  test('rejects empty pdf uploads as non-readable text', async () => {
    mockedAuthenticateUser.mockResolvedValueOnce({
      user: { id: 'user_1' },
      error: null,
    } as any)

    const response = await POST(buildRequest(new File([''], 'scan.pdf', { type: 'application/pdf' })))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('No readable text was found. Scanned PDFs are not supported yet.')
  })
})
