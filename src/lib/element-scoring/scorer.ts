// Per-element evidence: for each claim element × each candidate document, how
// well does that document teach that element? Two independent signals —
// semantic similarity (element text vs the document's stored embedding) and
// literal term coverage — blended into a CATEGORICAL verdict.
//
// Promoted from prior-art-studio/element-scoring.ts so the novelty pipeline's
// Stage 1.7 feature prescreen and the Prior-Art Studio grade with ONE scorer —
// the dtype-dependent absolute floors below mean the same thing everywhere or
// they mean nothing. The old path re-exports from here; both callers see
// identical behavior.
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
// Stemming lives in its own import-free module so the reader (a client
// component) can highlight the same way this scores. Do NOT move it back here.
import { elementTerms, stemSet, stemTerm } from './stemming'
// The element/cell types remain the Prior-Art Studio contract on purpose — the
// studio owns the vocabulary; this module just applies it to more callers.
import type { StudioElement, StudioElementCell, StudioElementVerdict } from '@/lib/prior-art-studio/types'
import type { ExternalAiUsageContext } from '@/lib/external-ai-usage'

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
 * The bar depends on the metric, and there is no single pair of numbers that is
 * right for both. Binary Hamming similarity over 512 bits centres near 0.5 for
 * unrelated text, so 0.62/0.56 sit meaningfully above the noise floor there. On
 * float/cosine the noise floor is much lower and unrelated technical text
 * routinely scores above 0.62 — the same constants are permanently satisfied,
 * which silently disables the only guard against the normalisation artifact
 * described above. Switching on the configured dtype is what makes the guard
 * mean the same thing on both deployments. Tunable via env after eval.
 */
const DTYPE_IS_BINARY = PATENT_CORPUS_EMBEDDING_DTYPE === 'binary'
function envFloor(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}
const ABS_SIM_STRONG = DTYPE_IS_BINARY
  ? envFloor('PAS_ELEMENT_ABS_STRONG', 0.62)
  : envFloor('PAS_ELEMENT_ABS_STRONG_COSINE', 0.42)
const ABS_SIM_PART = DTYPE_IS_BINARY
  ? envFloor('PAS_ELEMENT_ABS_PART', 0.56)
  : envFloor('PAS_ELEMENT_ABS_PART_COSINE', 0.34)

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

  // Strong literal coverage is powerful evidence — the words are right there and
  // the attorney can check them — but it cannot stand entirely alone. An element
  // reduces to a handful of significant words ("a housing configured to receive
  // a rotating shaft" -> housing / receive / rotating / shaft), and most
  // mechanical patents contain three of those four while teaching something
  // completely different. Unchecked, that produced STRONG, which produced a §102
  // nomination. Require the document to also be about the same thing.
  if (termCoverage >= 0.6 && clearsPart) return 'STRONG'
  if (termCoverage >= 0.6) return 'PART'
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
  externalAiUsage?: ExternalAiUsageContext
}): Promise<{
  cells: Record<string, Record<string, StudioElementCell>>
  semanticAvailable: boolean
  /** Raw publicationNumber -> family id, for callers that dedupe by family. Additive; studio callers ignore it. */
  familyByPn: Map<string, string>
}> {
  const elements = input.elements.filter(e => e.text.trim())
  const pubs = Array.from(new Set(input.publicationNumbers.filter(Boolean)))
  const out: Record<string, Record<string, StudioElementCell>> = {}
  if (!elements.length || !pubs.length) return { cells: out, semanticAvailable: false, familyByPn: new Map() }

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
        { traceId: input.traceId, externalAiUsage: input.externalAiUsage }
      )
      const column = Prisma.raw(`"${PATENT_CORPUS_EMBEDDING_COLUMN}"`)
      const op = Prisma.raw(PATENT_CORPUS_EMBEDDING_DISTANCE_OP)
      const castType = Prisma.raw(
        PATENT_CORPUS_EMBEDDING_SQL_TYPE === 'bit'
          ? `bit(${PATENT_CORPUS_EMBEDDING_DIMENSIONS})`
          : PATENT_CORPUS_EMBEDDING_SQL_TYPE
      )

      // ONE query for every element, not one per element.
      //
      // The WHERE clause is identical across elements — only the probe vector
      // changes — so issuing it per element meant a 15-element claim set ran 15
      // sequential scans over the same rows, on the request path, with no
      // statement timeout. Each element becomes a distance column instead.
      //
      // Vectors are deduplicated to ONE per DOCDB family (29.8M vectors for
      // 45.4M patents), so a specific publication often has no row of its own.
      // Resolve by family as well, then fall back to the family's
      // representative vector.
      const usableElements = elements
        .map((element, index) => ({ element, vector: vectors[index] }))
        .filter((entry): entry is { element: StudioElement; vector: number[] } => Boolean(entry.vector?.length))

      if (usableElements.length) {
        const distanceColumns = usableElements.map((entry, index) => {
          const literal = corpusEmbeddingToLiteral(entry.vector)
          return Prisma.sql`(e.${column} ${op} ${literal}::${castType})::float8 AS ${Prisma.raw(`"d${index}"`)}`
        })

        const scored = await prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT p."publicationNumber" AS "publicationNumber",
                 p."familyId" AS "familyId",
                 ${Prisma.join(distanceColumns, ', ')}
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

        usableElements.forEach((entry, index) => {
          const byPub = new Map<string, number>()
          const byFamily = new Map<string, number>()
          for (const row of scored) {
            const distance = Number(row[`d${index}`])
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
            const publicationNumber = String(row.publicationNumber)
            const familyId = row.familyId == null ? null : String(row.familyId)
            byPub.set(publicationNumber, similarity)
            if (familyId && !byFamily.has(familyId)) byFamily.set(familyId, similarity)
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
          semantic.set(entry.element.id, perElement)
        })
      }
    } catch (error) {
      // The run continues, but callers mark these cells UNAVAILABLE. Literal
      // absence alone must never be converted into a NONE verdict after an
      // embedding failure.
      console.warn('[PriorArtStudio] Element semantic scoring unavailable:', error)
    }
  }

  // If no element got semantic scores, the embedding step failed or was
  // unavailable — verdicts must be judged on literal coverage alone and the
  // caller must be told, not handed scores computed on a silently capped scale.
  const semanticAvailable = Array.from(semantic.values()).some(scores => scores.size > 0)
  const assessablePubs = new Set(
    pubs.filter(pub =>
      docs.has(pub) &&
      elements.every(element => semantic.get(element.id)?.has(pub))
    )
  )

  // Stem each document once, not once per element — the text is title +
  // abstract + claims, so tokenising it per element would be the same work
  // repeated for every column of the grid.
  const stemsByPub = new Map<string, Set<string>>()
  for (const pub of pubs) {
    const doc = docs.get(pub)
    if (!doc) continue
    stemsByPub.set(pub, stemSet(`${doc.title}\n${doc.abstract}\n${doc.hasClaims ? doc.claims : ''}`))
  }

  // ---- 3. blend, normalising semantic signal within this candidate set ------
  for (const element of elements) {
    const terms = elementTerms(element.text)
    const termStems = terms.map(term => ({ term, stem: stemTerm(term) }))
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
      // A missing corpus document or vector is missing evidence, not a NONE
      // finding. Leave this publication out so the caller marks it UNAVAILABLE.
      if (!semanticAvailable || !assessablePubs.has(pub) || !doc) continue
      // Stem-for-stem, on whole tokens. The old test was `text.includes(term)`,
      // which both missed morphological variants ("rotating" vs "rotates") and
      // matched inside unrelated words.
      const docStems = stemsByPub.get(pub) || new Set<string>()
      const matchedTerms = termStems.filter(entry => docStems.has(entry.stem)).map(entry => entry.term)
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

  return { cells: out, semanticAvailable, familyByPn: familyOf }
}

// Coverage arithmetic (coveredElements / findCombinations /
// findAnticipationCandidates) lives in ./element-math — a client-safe module
// with zero server imports. Do NOT move it back here: this file imports prisma
// and the corpus embedding service, and the 'use client' ElementGrid imports
// those functions, so re-merging drags adm-zip/fs into the browser bundle and
// breaks `next build`.

