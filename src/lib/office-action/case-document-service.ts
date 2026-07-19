import { prisma } from '../prisma'
import { normalizeInvention, estimateTokens } from './document-intake'

/**
 * Office Action Studio — case document intake
 *
 * Stores the attorney's invention context (as-filed specification / claims) and
 * supplementary material, normalizes it into paragraphs + chunks, and indexes it
 * ONCE so every later stage retrieves small slices instead of the whole document.
 *
 * newMatterSafe is the legal guard: only as-filed specification/claims may serve
 * as amendment basis (Section 59). Supplementary material is argument/affidavit
 * evidence and is stored with newMatterSafe = false.
 */

export type CaseDocumentKind = 'SPECIFICATION' | 'CLAIMS' | 'DRAWINGS' | 'SUPPLEMENTARY'
export type CaseDocumentSource = 'UPLOAD' | 'SPOTIPR_PROJECT' | 'PASTE'

export interface AddDocumentInput {
  caseId: string
  kind: CaseDocumentKind
  source: CaseDocumentSource
  title?: string
  text: string
  fileKey?: string
  /** Supplementary only: how the attorney wants it used. */
  intentNote?: string
  /** Supplementary only: canonical objection codes it serves. */
  targetCodes?: string[]
}

export interface AddDocumentResult {
  documentId: string
  paragraphs: number
  chunks: number
  tokens: number
  newMatterSafe: boolean
}

/**
 * Add a document to a case, chunk it, and queue/complete indexing.
 * Embedding is attempted once here; failure leaves indexStatus PENDING so a
 * retry can embed later — retrieval degrades to digest-only, never full-spec.
 */
export async function addCaseDocument(input: AddDocumentInput): Promise<AddDocumentResult> {
  const isAsFiled = input.kind === 'SPECIFICATION' || input.kind === 'CLAIMS'
  const normalized = normalizeInvention(input.text)

  const doc = await prisma.oaCaseDocument.create({
    data: {
      caseId: input.caseId,
      kind: input.kind,
      source: input.source,
      title: input.title || null,
      fileKey: input.fileKey || null,
      text: input.text,
      sectionsJson: { sections: normalized.sections, paragraphCount: normalized.paragraphs.length } as any,
      intentNote: input.intentNote || null,
      targetCodes: (input.targetCodes || []) as any,
      newMatterSafe: isAsFiled,     // ONLY as-filed material can support amendments
      indexStatus: 'PENDING'
    }
  })

  // Persist chunks (retrieval units, each labelled with its ¶ range).
  if (normalized.chunks.length) {
    await prisma.oaDocumentChunk.createMany({
      data: normalized.chunks.map(c => ({
        caseId: input.caseId, documentId: doc.id, kind: input.kind,
        sectionRef: c.sectionRef, text: c.text, tokenCount: c.tokenCount
      }))
    })
  }

  // Keep the case's canonical spec/claims text in sync for the pipeline.
  if (input.kind === 'SPECIFICATION') {
    await prisma.officeActionCase.update({ where: { id: input.caseId }, data: { specificationText: input.text } })
  } else if (input.kind === 'CLAIMS') {
    await prisma.officeActionCase.update({ where: { id: input.caseId }, data: { claimsText: input.text } })
  }

  const embedded = await embedChunks(doc.id).catch(() => false)
  await prisma.oaCaseDocument.update({
    where: { id: doc.id }, data: { indexStatus: embedded ? 'INDEXED' : 'PENDING' }
  })

  return {
    documentId: doc.id,
    paragraphs: normalized.paragraphs.length,
    chunks: normalized.chunks.length,
    tokens: normalized.totalTokens,
    newMatterSafe: isAsFiled
  }
}

/**
 * Embed a document's chunks once (the only paid step for the invention context).
 * Uses the existing corpus embedding service; returns false if unavailable so the
 * document stays PENDING rather than failing the upload.
 */
export async function embedChunks(documentId: string): Promise<boolean> {
  const chunks = await prisma.oaDocumentChunk.findMany({ where: { documentId }, select: { id: true, text: true } })
  if (!chunks.length) return true

  // Destructured dynamic import so TypeScript type-checks these names — an
  // untyped `as any` handle would let a rename compile fine and silently turn
  // OA retrieval into a permanent no-op.
  let corpus: {
    requestCorpusEmbedding: typeof import('../patent-corpus-service').requestCorpusEmbedding
    corpusEmbeddingToLiteral: typeof import('../patent-corpus-service').corpusEmbeddingToLiteral
    sqlType: string
    dimensions: number
  } | null = null
  try {
    const {
      requestCorpusEmbedding, corpusEmbeddingToLiteral,
      PATENT_CORPUS_EMBEDDING_SQL_TYPE, PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    } = await import('../patent-corpus-service')
    corpus = {
      requestCorpusEmbedding, corpusEmbeddingToLiteral,
      sqlType: PATENT_CORPUS_EMBEDDING_SQL_TYPE,
      dimensions: PATENT_CORPUS_EMBEDDING_DIMENSIONS,
    }
  } catch { /* embedding stack unavailable */ }
  if (!corpus) return false

  // Derived, not hardcoded: if the corpus dtype ever flips to float,
  // corpusEmbeddingToLiteral returns a bracketed list and this cast follows it.
  const cast = `${corpus.sqlType}(${corpus.dimensions})`

  let embedded = 0
  for (const c of chunks) {
    try {
      // Chunks are corpus content — 'corpus-indexing' (input_type: document) is
      // the correct side of the Voyage asymmetry here. Queries use
      // requestSearchQueryEmbedding (see office-action/context-budget.ts).
      const vec = await corpus.requestCorpusEmbedding(c.text, { purpose: 'corpus-indexing' })
      if (!Array.isArray(vec) || !vec.length) continue
      await prisma.$executeRawUnsafe(
        `UPDATE "oa_document_chunks" SET "embedding" = $1::${cast} WHERE "id" = $2`,
        corpus.corpusEmbeddingToLiteral(vec), c.id
      )
      embedded += 1
    } catch (e) {
      console.warn('[OA embed] chunk embedding failed:', e instanceof Error ? e.message : e)
    }
  }
  // Zero successes must leave the document PENDING — returning true here used to
  // mark documents INDEXED with no vectors behind them (silent retrieval outage).
  return embedded > 0
}

/** Attach an uploaded document to a citation the system could not fetch (NPL). */
export async function attachDocumentToCitation(citationId: string, text: string, title?: string): Promise<void> {
  const citation = await prisma.oaCitation.findUnique({ where: { id: citationId }, select: { passagesJson: true } })
  const prev = (citation?.passagesJson as any) || {}
  await prisma.oaCitation.update({
    where: { id: citationId },
    data: {
      fetchStatus: 'RESOLVED',
      resolvedVia: 'manual',
      passagesJson: { ...prev, fullDocument: { title: title || prev?.fullDocument?.title, description: text } } as any
    }
  })
}

export interface CaseDocumentSummary {
  id: string
  kind: string
  title: string | null
  intentNote: string | null
  targetCodes: string[]
  newMatterSafe: boolean
  indexStatus: string
  tokens: number
}

export async function listCaseDocuments(caseId: string): Promise<CaseDocumentSummary[]> {
  const docs = await prisma.oaCaseDocument.findMany({
    where: { caseId }, orderBy: { createdAt: 'asc' },
    include: { chunks: { select: { tokenCount: true } } }
  })
  return docs.map(d => ({
    id: d.id, kind: d.kind, title: d.title, intentNote: d.intentNote,
    targetCodes: (d.targetCodes as any) || [], newMatterSafe: d.newMatterSafe,
    indexStatus: d.indexStatus,
    tokens: d.chunks.reduce((s, c) => s + (c.tokenCount || 0), 0)
  }))
}
