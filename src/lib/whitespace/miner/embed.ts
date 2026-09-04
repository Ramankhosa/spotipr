/**
 * Invention Miner — document-side embedding for the statement vector space.
 *
 * Statements (problems, mechanisms, claim cores) are STORED DOCUMENTS, not
 * queries, so they are embedded with `purpose: 'corpus-indexing'`. Voyage — the
 * production provider — is asymmetric: it prepends a different instruction for
 * `input_type: 'document'` than for `'query'`, and the two families sit in
 * slightly different regions of the space. Embed a statement as a query and its
 * distance TO ITSELF is not zero; the duplicate detection that the whole gap
 * analysis rests on then reports two identical sentences as distinct problems.
 *
 * Nothing here throws. A statement that could not be embedded is a hole in the
 * miner's coverage, and coverage holes are recorded and shown, never raised as
 * an exception that aborts a run over one bad row.
 */

import {
  corpusEmbeddingToLiteral,
  hasCorpusEmbeddingApiKey,
  requestCorpusEmbeddings,
} from '@/lib/patent-corpus-service'

/**
 * Texts per provider call. Small enough that one failure costs little and that
 * a batch stays far inside every provider's per-request token ceiling (a
 * statement is a sentence or two), large enough that a 12,000-statement harvest
 * is ~190 calls rather than 12,000.
 */
const BATCH_SIZE = 64

/** Matches ../embedding's query-side cap. A statement longer than this is not a statement. */
const MAX_CHARS = 8000

/**
 * Embed statements into pgvector literals, INDEX-ALIGNED with the input: entry i
 * of the result belongs to text i, and is null where the text was blank or the
 * provider call failed.
 *
 * The alignment is the entire point of this function, exactly as it is for
 * ../embedding's embedQueryTexts. `requestCorpusEmbeddings` — and both provider
 * helpers under it — do `texts.map(...).filter(Boolean)` BEFORE the request, so
 * the response array can be SHORTER than what was passed in. A caller zipping
 * request texts against response vectors by index attaches the wrong vector to
 * every text after the first blank: no error, no warning, just a corpus of
 * statements silently wearing each other's meanings.
 *
 * Blanks are therefore filtered HERE, with their original positions remembered,
 * and the provider's own filter becomes a no-op on what it receives. The length
 * assertion below catches the case where it is not — anything the provider drops
 * for its own reasons invalidates the whole batch's zip, so the batch is nulled
 * rather than misaligned.
 */
export async function embedStatements(texts: string[]): Promise<Array<string | null>> {
  const results: Array<string | null> = texts.map(() => null)
  if (!texts.length) return results
  if (!hasCorpusEmbeddingApiKey()) return results

  const prepared = texts.map(text => String(text ?? '').trim().slice(0, MAX_CHARS))
  const sendIdx: number[] = []
  const send: string[] = []
  prepared.forEach((text, index) => {
    if (text) {
      sendIdx.push(index)
      send.push(text)
    }
  })
  if (!send.length) return results

  for (let start = 0; start < send.length; start += BATCH_SIZE) {
    const batch = send.slice(start, start + BATCH_SIZE)
    const batchIdx = sendIdx.slice(start, start + BATCH_SIZE)
    let vectors: number[][] = []
    try {
      // Document-side. See the module header: mixing the two input types makes a
      // statement's distance to itself non-zero on Voyage.
      vectors = (await requestCorpusEmbeddings(batch, { purpose: 'corpus-indexing' })) as number[][]
    } catch (error) {
      console.error(
        '[Miner] Statement embedding batch failed:',
        error instanceof Error ? error.message : error
      )
      continue // leave this batch's slots null; the caller records the coverage hole
    }

    if (!Array.isArray(vectors) || vectors.length !== batch.length) {
      // Never zip a response of a different length than the request — that is the
      // bug this function exists to prevent, and a wrong vector is worse than a
      // missing one because nothing downstream can detect it.
      console.error(
        `[Miner] Statement embedding batch returned ${Array.isArray(vectors) ? vectors.length : 'a non-array'} `
          + `vectors for ${batch.length} texts; dropping the batch rather than misaligning it.`
      )
      continue
    }

    vectors.forEach((vector, position) => {
      if (Array.isArray(vector) && vector.length) {
        results[batchIdx[position]] = corpusEmbeddingToLiteral(vector)
      }
    })
  }

  return results
}

/**
 * Embed one text as a PROBE against the statement index — also document-side.
 *
 * This looks wrong and is not. The asymmetry that makes query-side embedding
 * better for corpus search is a property of the PAIR: a query vector is placed
 * to sit near documents embedded as documents. Here both sides of the comparison
 * are statements — the thing being asked about is itself a problem statement,
 * and it is being compared against stored problem statements. Embedding the
 * probe as a query would offset it from the entire index by a constant that is
 * larger than the differences the miner is trying to measure, which reads as
 * "this problem is unlike anything in the field" for every probe.
 */
export async function embedStatementProbe(text: string): Promise<string | null> {
  const [literal] = await embedStatements([text])
  return literal ?? null
}
