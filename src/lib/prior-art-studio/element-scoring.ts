// Per-element evidence: for each claim element × each candidate document, how
// well does that document teach that element? Two independent signals —
// semantic similarity (element text vs the document's stored embedding) and
// literal term coverage — blended into a CATEGORICAL verdict.
//
// Deliberate design constraints, carried from the Prior-Art Studio spec:
//   • Cells are categorical (STRONG / PART / WEAK / NONE), never a bare decimal
//     presented as precision we don't have.
//   • Every cell carries its evidence (matched terms + which text tier was read)
//     so nothing is asserted without something the attorney can check.
//   • Evidence tier is labelled honestly: abstract-tier similarity is NOT a
//     claim mapping, and the UI must say so.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  PATENT_CORPUS_EMBEDDING_COLUMN,
  PATENT_CORPUS_EMBEDDING_DIMENSIONS,
  PATENT_CORPUS_EMBEDDING_DISTANCE_OP,
  PATENT_CORPUS_EMBEDDING_DTYPE,
  PATENT_CORPUS_EMBEDDING_MODEL,
  PATENT_CORPUS_EMBEDDING_SQL_TYPE,
  corpusEmbeddingToLiteral,
  hasSearchEmbeddingApiKey,
  requestSearchQueryEmbeddings,
} from '@/lib/patent-corpus-service'
import type { StudioElement, StudioElementCell, StudioElementVerdict } from './types'

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'upon', 'said', 'which', 'wherein',
  'having', 'have', 'has', 'are', 'was', 'were', 'being', 'been', 'configured', 'adapted', 'least', 'one',
  'comprising', 'including', 'includes', 'include', 'plurality', 'first', 'second', 'third', 'each', 'such',
  'when', 'while', 'thereof', 'therein', 'whereby', 'about', 'between', 'within', 'through', 'other',
])

/** Significant words of an element — what "literal coverage" is measured over. */
export function elementTerms(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    )
  ).slice(0, 12)
}

interface DocText {
  publicationNumber: string
  title: string
  abstract: string
  claims: string
  hasClaims: boolean
}

/**
 * Absolute similarity floors, applied ALONGSIDE the within-run relative score.
 *
 * The relative score alone manufactures verdicts: min-max normalising over the
 * graded set guarantees the best document scores 1.0 and the worst 0.0 whatever
 * the absolute similarities are, so 40 wholly irrelevant documents still yield a
 * full STRONG..NONE spread — and the grid would then nominate §102 anticipation
 * candidates from noise. A document must clear a real similarity bar too.
 *
 * Binary Hamming similarity over 512 bits centres near 0.5 for unrelated text,
 * so these are calibrated well above that floor. Tunable via env after eval.
 */
const ABS_SIM_STRONG = Number(process.env.PAS_ELEMENT_ABS_STRONG || '0.62') || 0.62
const ABS_SIM_PART = Number(process.env.PAS_ELEMENT_ABS_PART || '0.56') || 0.56

function verdictFor(
  combined: number,
  termCoverage: number,
  absoluteSimilarity: number | undefined,
  semanticAvailable: boolean
): StudioElementVerdict {
  // Literal-only mode: without embeddings the combined score is capped at 0.4,
  // so a document containing every element term verbatim could never exceed
  // WEAK. Judge on term coverage alone and let the caller flag the degradation.
  if (!semanticAvailable) {
    if (termCoverage >= 0.6) return 'STRONG'
    if (termCoverage >= 0.3) return 'PART'
    if (termCoverage > 0) return 'WEAK'
    return 'NONE'
  }

  const clearsStrong = absoluteSimilarity === undefined || absoluteSimilarity >= ABS_SIM_STRONG
  const clearsPart = absoluteSimilarity === undefined || absoluteSimilarity >= ABS_SIM_PART

  // Strong literal coverage stands on its own even if the abstract embedding is
  // a poor match — the words are right there and the attorney can check them.
  if (termCoverage >= 0.6) return 'STRONG'
  if (combined >= 0.66 && termCoverage > 0 && clearsStrong) return 'STRONG'
  if (combined >= 0.66 && clearsPart) return 'PART' // strong semantic, no literal support
  if (combined >= 0.42 && clearsPart) return 'PART'
  if (combined >= 0.2 || termCoverage > 0) return 'WEAK'
  return 'NONE'
}

/**
 * Score every element against every candidate document.
 * Returns a map: publicationNumber -> elementId -> cell.
 */
export async function scoreElements(input: {
  elements: StudioElement[]
  publicationNumbers: string[]
  traceId?: string
}): Promise<Record<string, Record<string, StudioElementCell>>> {
  const elements = input.elements.filter(e => e.text.trim())
  const pubs = Array.from(new Set(input.publicationNumbers.filter(Boolean)))
  const out: Record<string, Record<string, StudioElementCell>> = {}
  if (!elements.length || !pubs.length) return out

  // ---- 1. document text (for literal coverage + tier labelling) -------------
  const rows = await prisma.localPatent.findMany({
    where: { publicationNumber: { in: pubs } },
    select: { publicationNumber: true, familyId: true, title: true, abstract: true, claimsText: true },
  })
  const docs = new Map<string, DocText>()
  const familyOf = new Map<string, string>()
  for (const row of rows) {
    const claims = row.claimsText || ''
    docs.set(row.publicationNumber, {
      publicationNumber: row.publicationNumber,
      title: row.title || '',
      abstract: row.abstract || '',
      claims,
      hasClaims: claims.trim().length > 40,
    })
    if (row.familyId) familyOf.set(row.publicationNumber, row.familyId)
  }
  const familyIds = Array.from(new Set(Array.from(familyOf.values())))

  // ---- 2. semantic similarity per element over just these documents ---------
  // A direct scan of ~100 rows — no ANN involved, so no recall loss here.
  const semantic = new Map<string, Map<string, number>>() // elementId -> pub -> similarity
  if (hasSearchEmbeddingApiKey()) {
    try {
      const vectors = await requestSearchQueryEmbeddings(
        elements.map(e => e.text.slice(0, 800)),
        { traceId: input.traceId }
      )
      const column = Prisma.raw(`"${PATENT_CORPUS_EMBEDDING_COLUMN}"`)
      const op = Prisma.raw(PATENT_CORPUS_EMBEDDING_DISTANCE_OP)
      const castType = Prisma.raw(
        PATENT_CORPUS_EMBEDDING_SQL_TYPE === 'bit'
          ? `bit(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`
          : PATENT_CORPUS_EMBEDDING_SQL_TYPE
      )

      for (let i = 0; i < elements.length; i++) {
        const vector = vectors[i]
        if (!vector?.length) continue
        const literal = corpusEmbeddingToLiteral(vector)
        // Vectors are deduplicated to ONE per DOCDB family (29.8M vectors for
        // 45.4M patents), so a specific publication often has no row of its
        // own. Resolve by family as well, then fall back to the family's
        // representative vector.
        const scored = await prisma.$queryRaw<
          Array<{ publicationNumber: string; familyId: string | null; distance: number }>
        >(Prisma.sql`
          SELECT p."publicationNumber" AS "publicationNumber",
                 p."familyId" AS "familyId",
                 (e.${column} ${op} ${literal}::${castType})::float8 AS distance
          FROM local_patent_embeddings e
          JOIN local_patents p ON p.id = e."localPatentId"
          WHERE (
                  p."publicationNumber" IN (${Prisma.join(pubs)})
                  ${familyIds.length ? Prisma.sql`OR p."familyId" IN (${Prisma.join(familyIds)})` : Prisma.empty}
                )
            AND e.status = 'COMPLETED'
            AND e.model = ${PATENT_CORPUS_EMBEDDING_MODEL}
            AND e.${column} IS NOT NULL
        `)

        const byPub = new Map<string, number>()
        const byFamily = new Map<string, number>()
        for (const row of scored) {
          const distance = Number(row.distance)
          if (!Number.isFinite(distance)) continue
          const similarity = Math.max(
            0,
            Math.min(
              1,
              PATENT_CORPUS_EMBEDDING_DTYPE === 'binary'
                ? 1 - distance / PATENT_CORPUS_EMBEDDING_DIMENSIONS
                : 1 - distance
            )
          )
          byPub.set(row.publicationNumber, similarity)
          if (row.familyId && !byFamily.has(row.familyId)) byFamily.set(row.familyId, similarity)
        }

        const perElement = new Map<string, number>()
        for (const pub of pubs) {
          const direct = byPub.get(pub)
          if (direct !== undefined) {
            perElement.set(pub, direct)
            continue
          }
          const family = familyOf.get(pub)
          const viaFamily = family ? byFamily.get(family) : undefined
          if (viaFamily !== undefined) perElement.set(pub, viaFamily)
        }
        semantic.set(elements[i].id, perElement)
      }
    } catch (error) {
      // Element scoring is additive: if embeddings are unavailable the grid
      // degrades to literal-coverage only rather than failing the run.
      console.warn('[PriorArtStudio] Element semantic scoring unavailable:', error)
    }
  }

  // If no element got semantic scores, the embedding step failed or was
  // unavailable — verdicts must be judged on literal coverage alone and the
  // caller must be told, not handed scores computed on a silently capped scale.
  const semanticAvailable = semantic.size > 0

  // ---- 3. blend, normalising semantic signal within this candidate set ------
  for (const element of elements) {
    const terms = elementTerms(element.text)
    const perElement = semantic.get(element.id)
    let min = Infinity
    let max = -Infinity
    if (perElement) {
      perElement.forEach(value => {
        if (value < min) min = value
        if (value > max) max = value
      })
    }
    const spread = max - min

    for (const pub of pubs) {
      const doc = docs.get(pub)
      const searchText = doc
        ? `${doc.title}\n${doc.abstract}\n${doc.hasClaims ? doc.claims : ''}`.toLowerCase()
        : ''
      const matchedTerms = terms.filter(term => searchText.includes(term))
      const termCoverage = terms.length ? matchedTerms.length / terms.length : 0

      const rawSimilarity = perElement?.get(pub)
      // Relative within this run: absolute binary-Hamming similarity sits in a
      // narrow band, so a raw threshold would call noise "strong".
      const semanticRel =
        rawSimilarity === undefined
          ? 0
          : spread > 0.0001
            ? (rawSimilarity - min) / spread
            : 0.5

      const combined = 0.6 * semanticRel + 0.4 * termCoverage
      const tier: StudioElementCell['tier'] = doc?.hasClaims ? 'claims' : 'abstract'

      if (!out[pub]) out[pub] = {}
      out[pub][element.id] = {
        verdict: verdictFor(combined, termCoverage, rawSimilarity, semanticAvailable),
        matchedTerms,
        termCoverage: Number(termCoverage.toFixed(2)),
        similarity: rawSimilarity === undefined ? undefined : Number(rawSimilarity.toFixed(3)),
        tier,
      }
    }
  }

  return out
}

// Coverage arithmetic (coveredElements / findCombinations /
// findAnticipationCandidates) lives in ./element-math — a client-safe module
// with zero server imports. Do NOT move it back here: this file imports prisma
// and the corpus embedding service, and the 'use client' ElementGrid imports
// those functions, so re-merging drags adm-zip/fs into the browser bundle and
// breaks `next build`.

