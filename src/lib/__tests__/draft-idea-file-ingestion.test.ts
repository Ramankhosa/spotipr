import { describe, expect, test, vi } from 'vitest'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import {
  DraftIdeaFileIngestionError,
  extractDraftIdeaTextFromBuffer,
} from '@/lib/draft-idea-file-ingestion'
import { MAX_DRAFTING_INPUT_CHARS } from '@/lib/drafting-constants'

describe('draft idea file ingestion', () => {
  test('extracts and normalizes txt files', async () => {
    const result = await extractDraftIdeaTextFromBuffer({
      fileName: 'idea.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('\uFEFFLine one\r\nLine two\rLine three\n'),
    })

    expect(result).toMatchObject({
      textContent: 'Line one\nLine two\nLine three',
      fileName: 'idea.txt',
      detectedFormat: 'txt',
    })
  })

  test('extracts docx text through the configured converter', async () => {
    const extractDocxText = vi.fn().mockResolvedValue(' Smart controller disclosure ')

    const result = await extractDraftIdeaTextFromBuffer(
      {
        fileName: 'idea.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from('docx'),
      },
      { extractDocxText }
    )

    expect(extractDocxText).toHaveBeenCalled()
    expect(result.detectedFormat).toBe('docx')
    expect(result.textContent).toBe('Smart controller disclosure')
  })

  test('extracts text from a real docx buffer', async () => {
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun('Smart irrigation controller invention description')],
          }),
        ],
      }],
    })
    const buffer = await Packer.toBuffer(doc)

    const result = await extractDraftIdeaTextFromBuffer({
      fileName: 'idea.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer,
    })

    expect(result.detectedFormat).toBe('docx')
    expect(result.textContent).toContain('Smart irrigation controller invention description')
  })

  test('extracts selectable text from pdf files', async () => {
    const extractPdfText = vi.fn().mockResolvedValue('Selectable PDF text')

    const result = await extractDraftIdeaTextFromBuffer(
      {
        fileName: 'idea.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF'),
      },
      { extractPdfText }
    )

    expect(extractPdfText).toHaveBeenCalled()
    expect(result.detectedFormat).toBe('pdf')
    expect(result.textContent).toBe('Selectable PDF text')
  })

  test('rejects scanned or empty pdf files', async () => {
    await expect(
      extractDraftIdeaTextFromBuffer(
        {
          fileName: 'scan.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF'),
        },
        { extractPdfText: vi.fn().mockResolvedValue('   ') }
      )
    ).rejects.toThrow('No readable text was found. Scanned PDFs are not supported yet.')
  })

  test('rejects empty files', async () => {
    await expect(
      extractDraftIdeaTextFromBuffer({
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('  \n'),
      })
    ).rejects.toThrow('File appears to be empty or contains no readable text.')
  })

  test('rejects oversized extracted text', async () => {
    await expect(
      extractDraftIdeaTextFromBuffer({
        fileName: 'large.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('A'.repeat(MAX_DRAFTING_INPUT_CHARS + 1)),
      })
    ).rejects.toThrow(`File content exceeds ${MAX_DRAFTING_INPUT_CHARS.toLocaleString()} characters`)
  })

  test('rejects unsupported extensions', async () => {
    await expect(
      extractDraftIdeaTextFromBuffer({
        fileName: 'idea.rtf',
        mimeType: 'application/rtf',
        buffer: Buffer.from('idea'),
      })
    ).rejects.toThrow('Unsupported file type. Please upload .txt, .doc, .docx, or .pdf files.')
  })

  test('uses a clear best-effort failure message for doc parser errors', async () => {
    await expect(
      extractDraftIdeaTextFromBuffer(
        {
          fileName: 'legacy.doc',
          mimeType: 'application/msword',
          buffer: Buffer.from('not-doc'),
        },
        { extractDocText: vi.fn().mockRejectedValue(new Error('parse failed')) }
      )
    ).rejects.toThrow('Could not extract text from this .doc file. Please save it as .docx or .txt and upload again.')
  })

  test('throws typed ingestion errors', async () => {
    await expect(
      extractDraftIdeaTextFromBuffer({
        fileName: 'empty.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(''),
      })
    ).rejects.toBeInstanceOf(DraftIdeaFileIngestionError)
  })
})
