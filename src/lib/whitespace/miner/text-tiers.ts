/**
 * Invention Miner — what text did we actually read?
 *
 * Every claim the miner makes about a publication is only as good as the text it
 * was extracted from, and the corpus does not hold the same depth for every row:
 * a US publication carries its first claim and a 5,000-character description
 * PREFIX, an EP publication carries a full claim set, a manual IPIndia capture
 * carries the whole specification, and tens of millions of rows carry nothing but
 * an abstract. "No prior art admits this problem" means something completely
 * different when it was read from 5,000 characters than when it was read from a
 * full description — so the tier travels with the extraction (it is inside the
 * text hash), with the field row, and onto the coverage strip the attorney reads.
 *
 * This module is the single source of truth for that resolution. Nothing else in
 * the miner may infer a tier from a row: one rule, one place, or the coverage
 * sentence and the cache key drift apart and the cache starts answering questions
 * about a thinner reading than the caller thinks it made.
 */

import { createHash } from 'node:crypto'

/**
 * The tiers, richest first:
 *   description-full — the whole specification body (manual IPIndia captures, and
 *                      EPO rows whose complete description fits under the cap)
 *   description-5k   — the first 5,000 characters of the body, and nothing after
 *   claims           — claims only (a full EP set, or a single US first claim)
 *   abstract         — an abstract, which is a marketing summary of the invention
 */
export type TextTier = 'description-full' | 'description-5k' | 'claims' | 'abstract'

/** Higher is richer. Used for "did this row get better?" comparisons, never displayed. */
export const TIER_RANK: Record<TextTier, number> = {
  'description-full': 4,
  'description-5k': 3,
  claims: 2,
  abstract: 1,
}

/**
 * The subset of a `local_patents` / `patent_text_availability` join this module
 * reads. Deliberately structural rather than a Prisma type: callers select these
 * columns from raw SQL (the availability labels only exist on the view).
 */
export interface PatentTextRow {
  descriptionText?: string | null
  claimsText?: string | null
  abstract?: string | null
  /** patent_text_availability."claimsAvailability": FULL_EPO | FULL | FIRST_CLAIM_ONLY | ON_DEMAND_BIGQUERY | NONE */
  claimsAvailability?: string | null
  /** patent_text_availability."descriptionAvailability": FULL_EPO | FULL | TRUNCATED_5K | NONE */
  descriptionAvailability?: string | null
}

/**
 * The cap every bulk import applies to `descriptionText`
 * (`DESCRIPTION_SNIPPET_CHARS` in src/lib/epo-bdds/loader.ts, and the same 5,000
 * in the Google-US legacy rows). A stored description is therefore a PREFIX
 * unless it is longer than this.
 */
const DESCRIPTION_PREFIX_CHARS = 5000

/** Availability labels that assert a COMPLETE body/claim set was stored. */
const COMPLETE_LABELS = new Set(['FULL', 'FULL_EPO', 'COMPLETE'])

/** Labels that assert the text is NOT in this database, whatever a column holds. */
const ABSENT_LABELS = new Set(['NONE', 'ON_DEMAND_BIGQUERY'])

function present(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value : ''
  return text.trim() ? text : null
}

function label(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase()
}

/**
 * The richest tier this row can actually be read at, or null when nothing is
 * readable (which is a coverage fact to record, never a row to skip silently).
 *
 * Description discrimination, in order:
 *
 *  1. LENGTH WINS over the view's label. `patent_text_availability` resolves an
 *     un-marked row carrying description text to 'TRUNCATED_5K' by rule, which
 *     mislabels exactly the rows that are NOT truncated — the manual IPIndia
 *     captures, the only ones in the corpus that exceed 5,000 characters. A body
 *     longer than the cap cannot be a prefix of the cap, so length settles it.
 *  2. Otherwise an explicit completeness marker (FULL / FULL_EPO) is believed:
 *     the EPO loader writes it when the complete description fitted under the
 *     cap, and calling a genuinely complete 3,000-character body a "5,000-
 *     character prefix" would be dishonest in the other direction.
 *  3. Otherwise it is a prefix. This is the overwhelming majority.
 *
 * Claims are ONE tier, not two. A US row carries only its first claim
 * (`FIRST_CLAIM_ONLY`) while an EP row carries the full set (`FULL_EPO`/`FULL`),
 * and that difference matters enormously — but it is a property of the claim
 * READING, not of the depth of text available, and the miner records it as its
 * own coverage fact rather than by splitting the tier vocabulary that the
 * extraction cache key and the field table are both keyed on.
 */
export function resolveTextTier(row: PatentTextRow): TextTier | null {
  const descriptionLabel = label(row.descriptionAvailability)
  const description = ABSENT_LABELS.has(descriptionLabel) ? null : present(row.descriptionText)
  if (description) {
    if (description.length > DESCRIPTION_PREFIX_CHARS) return 'description-full'
    if (COMPLETE_LABELS.has(descriptionLabel)) return 'description-full'
    return 'description-5k'
  }

  const claimsLabel = label(row.claimsAvailability)
  // ON_DEMAND_BIGQUERY means "fetchable, not stored": a stub in claimsText is not
  // a reading. The view cannot currently produce that pairing, so this is a guard
  // against a future writer, not a live case.
  if (!ABSENT_LABELS.has(claimsLabel) && present(row.claimsText)) return 'claims'

  if (present(row.abstract)) return 'abstract'
  return null
}

/**
 * The identity of one reading: sha256(tier || NUL || text), hex.
 *
 * The tier is INSIDE the hash on purpose. `patent_text_extractions` is unique on
 * (publicationNumber, textHash), so hashing the text alone would let a later,
 * richer reading of the same publication collide with a thinner one — an EPO
 * claims fill arriving after an abstract-only pass would look like the same row
 * and quietly leave the thin extraction in place. With the tier in the hash the
 * richer reading writes a NEW row and the thin one can be superseded.
 *
 * The NUL separator makes the encoding injective: without it, tier+text pairs
 * could concatenate to the same string.
 */
export function textHashFor(tier: TextTier, text: string): string {
  return createHash('sha256').update(`${tier}\u0000${text}`, 'utf8').digest('hex')
}

/** Is `a` a strictly richer reading than `b`? (Upgrade test for the extraction cache.) */
export function tierIsRicher(a: TextTier, b: TextTier): boolean {
  return TIER_RANK[a] > TIER_RANK[b]
}

/**
 * Plural-aware phrase for one tier's share of the reading.
 *
 * NEVER says "the description". A 5,000-character prefix is roughly the field of
 * the invention plus the background section — it typically stops before the
 * embodiments, i.e. before the part that would disclose the mechanism. Calling
 * that "the description" on a coverage strip tells an attorney the miner read
 * something it did not, and every conclusion drawn from it inherits that lie.
 */
function tierPhrase(tier: TextTier, count: number): string {
  switch (tier) {
    case 'description-full':
      return `${count} from a full description`
    case 'description-5k':
      return `${count} from a 5,000-character description prefix`
    case 'claims':
      return `${count} from claims only`
    case 'abstract':
      return `${count} from ${count === 1 ? 'an abstract' : 'abstracts'} only`
  }
}

/**
 * One honest sentence for the coverage strip: how many publications were read,
 * and at what depth. Ordered richest-first so the reader sees the best available
 * evidence and the worst in the same glance.
 */
export function describeTierMix(counts: Record<TextTier, number>): string {
  const ordered = (Object.keys(TIER_RANK) as TextTier[]).sort((a, b) => TIER_RANK[b] - TIER_RANK[a])
  const safe = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0)

  const parts: string[] = []
  let total = 0
  for (const tier of ordered) {
    const count = safe(counts?.[tier] as number)
    if (!count) continue
    total += count
    parts.push(tierPhrase(tier, count))
  }

  if (!total) return 'No publication in this set had any readable text.'
  const subject = total === 1 ? '1 publication' : `${total} publications`
  return `Read ${subject}: ${parts.join(', ')}.`
}
