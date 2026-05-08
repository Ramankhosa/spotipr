import { beforeEach, describe, expect, test, vi } from 'vitest'

const prisma = vi.hoisted(() => ({
  draftingSession: {
    findUnique: vi.fn(),
  },
}))

const executeLLMOperation = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma }))
vi.mock('@/lib/metering/gateway', () => ({
  llmGateway: {
    executeLLMOperation,
  },
}))

import {
  detectExternalImageContent,
  EXTERNAL_IMAGE_AI_MAX_PIXELS,
} from '@/lib/sketch-service'

const oneByOnePng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lJX6LwAAAABJRU5ErkJggg=='

function pngHeaderWithDimensions(width: number, height: number): string {
  const buffer = Buffer.alloc(33)
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0)
  buffer.writeUInt32BE(13, 8)
  buffer.write('IHDR', 12, 'ascii')
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  buffer[24] = 8
  buffer[25] = 2
  buffer[26] = 0
  buffer[27] = 0
  buffer[28] = 0
  return buffer.toString('base64')
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.draftingSession.findUnique.mockResolvedValue({
    ideaRecord: {
      normalizedData: {
        title: 'Mosquito repellent device',
        problem: 'Mosquito activity varies over time',
      },
    },
    referenceMap: {
      components: {
        components: [
          { name: 'Mosquito detection module', referenceLabel: '100' },
          { name: 'Repellent controller', referenceLabel: '200' },
        ],
      },
    },
    figurePlans: [
      { figureNo: 1, title: 'System architecture', description: 'Main device architecture' },
    ],
    diagramSources: [],
    annexureDrafts: [],
  })
})

describe('detectExternalImageContent', () => {
  test('uses sketch generation quota with a hardcoded Gemini 2.5 Pro vision model', async () => {
    executeLLMOperation.mockResolvedValue({
      success: true,
      response: {
        output: JSON.stringify({
          titleSuggestion: 'Sensor Controller Diagram',
          description:
            'The image shows a mosquito detection module labeled 100 connected to a repellent controller labeled 200, with visible arrows indicating signal transfer and controller output toward a repellent emission section.',
          warnings: [],
        }),
        outputTokens: 100,
        modelClass: 'gemini-2.5-pro',
      },
    })

    const result = await detectExternalImageContent({
      patentId: 'patent_1',
      sessionId: 'session_1',
      uploadedImageBase64: oneByOnePng,
      uploadedImageMimeType: 'image/png',
      requestHeaders: { authorization: 'Bearer token' },
    })

    expect(result.success).toBe(true)
    expect(result.description).toContain('mosquito detection module')
    expect(result.titleSuggestion).toBe('Sensor Controller Diagram')
    expect(executeLLMOperation).toHaveBeenCalledTimes(1)
    const [, request] = executeLLMOperation.mock.calls[0]
    expect(request.taskCode).toBe('LLM3_DIAGRAM')
    expect(request.stageCode).toBe('DRAFT_SKETCH_GENERATION')
    expect(request.modelClass).toBe('gemini-2.5-pro')
    expect(request.parameters.maxOutputTokens).toBe(8192)
    expect(request.content.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image' }),
        expect.objectContaining({ type: 'text' }),
      ])
    )
  })

  test('rejects unsupported image mime types before calling the LLM', async () => {
    const result = await detectExternalImageContent({
      patentId: 'patent_1',
      sessionId: 'session_1',
      uploadedImageBase64: oneByOnePng,
      uploadedImageMimeType: 'image/svg+xml',
      requestHeaders: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/PNG, JPEG, and WebP/)
    expect(executeLLMOperation).not.toHaveBeenCalled()
  })

  test('rejects outputs shorter than the required description', async () => {
    executeLLMOperation.mockResolvedValue({
      success: true,
      response: {
        output: JSON.stringify({ description: 'A short controller diagram.' }),
        outputTokens: 10,
        modelClass: 'gemini-2.5-pro',
      },
    })

    const result = await detectExternalImageContent({
      patentId: 'patent_1',
      sessionId: 'session_1',
      uploadedImageBase64: oneByOnePng,
      uploadedImageMimeType: 'image/png',
      requestHeaders: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/sufficiently detailed/)
  })

  test('rejects images above Full HD pixel budget', async () => {
    const result = await detectExternalImageContent({
      patentId: 'patent_1',
      sessionId: 'session_1',
      uploadedImageBase64: pngHeaderWithDimensions(1920, 1081),
      uploadedImageMimeType: 'image/png',
      requestHeaders: {},
    })

    expect(1920 * 1081).toBeGreaterThan(EXTERNAL_IMAGE_AI_MAX_PIXELS)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/Full HD/)
    expect(executeLLMOperation).not.toHaveBeenCalled()
  })
})
