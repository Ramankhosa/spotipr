// Load parsed DOCDB records into Postgres.
//
// Two destinations, decided per record:
//
//   already in local_patents  -> INSERT into epo_patent_bib (applicants /
//                                inventors / IPC). local_patents is NOT touched,
//                                so no row is rewritten and no vector is
//                                invalidated.
//   not in local_patents      -> CREATE a local_patents row, but ONLY when DOCDB
//                                supplies a title AND an abstract. A bib-only
//                                row cannot be embedded (the semantic lane runs
//                                on title + abstract) and would never surface in
//                                search, so it would be dead weight on a disk we
//                                are trying not to fill.
//
// Everything is batched and idempotent: re-running the same archive produces no
// duplicates and no second copy of anything.

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { DocdbRecord } from './parsers/docdb'
import type { EpFullTextRecord } from './parsers/epft'

/**
 * The canonical key, byte-identical to the Google loader's
 * (scripts/google-patents-import/04-postgres-load-and-upsert.sql:68):
 *   NULLIF(regexp_replace(upper(publication_number), '[^A-Z0-9]', '', 'g'), '')
 *
 * Uppercase, strip non-alphanumerics, KEEP the kind code. Not to be confused
 * with `pub_canonical`, which strips the kind code and exists only for BigQuery
 * claims lookups. Getting these two mixed up silently mismatches millions of rows.
 */
export function publicationNumberKey(publicationNumber: string): string {
  return String(publicationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** "20070202" -> Date, or null. DOCDB also emits partial dates like "200702". */
function parseDocdbDate(value: string | null): Date | null {
  if (!value || !/^\d{8}$/.test(value)) return null
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime()) ? null : date
}

export interface LoadOptions {
  productId: number
  deliveryId: number
  /** Create local_patents rows for publications we do not hold. Default true. */
  createMissingRows?: boolean
  /** Restrict to these publication years; others are dropped at record level. */
  fromYear?: number | null
  toYear?: number | null
  batchSize?: number
}

export interface LoadStats {
  parsed: number
  enriched: number
  created: number
  skippedNoAbstract: number
  skippedOutOfRange: number
}

const emptyStats = (): LoadStats => ({
  parsed: 0, enriched: 0, created: 0, skippedNoAbstract: 0, skippedOutOfRange: 0,
})

function yearOf(record: DocdbRecord): number | null {
  const value = record.publicationDate
  return value && /^\d{4}/.test(value) ? Number(value.slice(0, 4)) : null
}

/**
 * Accumulates records and flushes them in batches. Create one per archive, call
 * add() per parsed record, then flush() at the end.
 */
export class DocdbLoader {
  private buffer: DocdbRecord[] = []
  readonly stats: LoadStats = emptyStats()
  private readonly batchSize: number

  constructor(private readonly options: LoadOptions) {
    this.batchSize = options.batchSize ?? 500
  }

  async add(record: DocdbRecord): Promise<void> {
    this.stats.parsed++

    const year = yearOf(record)
    const { fromYear, toYear } = this.options
    if (year != null && ((fromYear != null && year < fromYear) || (toYear != null && year > toYear))) {
      this.stats.skippedOutOfRange++
      return
    }
    if (!record.publicationNumber || !publicationNumberKey(record.publicationNumber)) return

    this.buffer.push(record)
    if (this.buffer.length >= this.batchSize) await this.flush()
  }

  async flush(): Promise<void> {
    if (!this.buffer.length) return
    const batch = this.buffer
    this.buffer = []

    const keys = batch.map(r => publicationNumberKey(r.publicationNumber))
    const existing = await prisma.$queryRaw<Array<{ publicationNumberKey: string }>>(Prisma.sql`
      SELECT "publicationNumberKey" FROM "local_patents"
      WHERE "publicationNumberKey" = ANY(${keys})
    `)
    const known = new Set(existing.map(row => row.publicationNumberKey))

    const toCreate: DocdbRecord[] = []
    const toEnrich: DocdbRecord[] = []

    for (const record of batch) {
      if (known.has(publicationNumberKey(record.publicationNumber))) {
        toEnrich.push(record)
        continue
      }
      if (this.options.createMissingRows === false) continue
      // Only worth a row if it can actually be searched.
      if (record.title && record.abstract) toCreate.push(record)
      else this.stats.skippedNoAbstract++
    }

    if (toCreate.length) {
      const created = await this.createLocalPatents(toCreate)
      this.stats.created += created
    }
    // New rows are enriched too, so applicants/inventors/IPC land for them as well.
    const enrichable = [...toEnrich, ...toCreate]
    if (enrichable.length) {
      this.stats.enriched += await this.upsertBib(enrichable)
    }
  }

  /** Insert rows for publications we do not hold. Never updates an existing row. */
  private async createLocalPatents(records: DocdbRecord[]): Promise<number> {
    const pubs = records.map(r => r.publicationNumber)
    const keys = records.map(r => publicationNumberKey(r.publicationNumber))
    const titles = records.map(r => (r.title ?? '').slice(0, 1000))
    const abstracts = records.map(r => r.abstract ?? '')
    const countries = records.map(r => r.country || null)
    const kinds = records.map(r => r.kind || null)
    const families = records.map(r => r.familyId)
    const dates = records.map(r => parseDocdbDate(r.publicationDate))
    const ipc = records.map(r => r.ipc)

    const result = await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "local_patents" (
        "publicationNumber", "publicationNumberKey", "title", "abstract",
        "country", "kind", "familyId", "publicationDate",
        "classifications", "corpusSources", "embeddingText", "createdAt", "updatedAt"
      )
      SELECT s.pub, s.key, s.title, s.abstract, s.country, s.kind, s.family, s.pubdate,
             s.ipc, ARRAY['epo-docdb']::TEXT[],
             LEFT(s.title || E'\n' || s.abstract, 20000),
             now(), now()
      FROM (
        SELECT * FROM UNNEST(
          ${pubs}::text[], ${keys}::text[], ${titles}::text[], ${abstracts}::text[],
          ${countries}::text[], ${kinds}::text[], ${families}::text[],
          ${dates}::timestamp[], ${ipc}::text[][]
        ) AS t(pub, key, title, abstract, country, kind, family, pubdate, ipc)
      ) s
      -- Protects the publicationNumberKey unique constraint when a different
      -- publication already owns that key (same guard as the Google loader).
      WHERE NOT EXISTS (
        SELECT 1 FROM "local_patents" lp
        WHERE lp."publicationNumberKey" = s.key AND lp."publicationNumber" <> s.pub
      )
      ON CONFLICT ("publicationNumber") DO NOTHING
    `)
    return Number(result)
  }

  /** Applicants / inventors / IPC into the side table. Insert-only, no FK. */
  private async upsertBib(records: DocdbRecord[]): Promise<number> {
    const keys = records.map(r => publicationNumberKey(r.publicationNumber))
    const pubs = records.map(r => r.publicationNumber)
    const applicants = records.map(r => JSON.stringify(r.applicants))
    const inventors = records.map(r => r.inventors)
    const ipc = records.map(r => r.ipc)
    const families = records.map(r => r.familyId)

    const result = await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "epo_patent_bib" (
        "publicationNumberKey", "publicationNumber", "applicants", "inventors", "ipc",
        "docdbFamilyId", "sourceProductId", "sourceDeliveryId", "ingestedAt", "updatedAt"
      )
      SELECT s.key, s.pub, s.applicants::jsonb, s.inventors, s.ipc, s.family,
             ${this.options.productId}, ${this.options.deliveryId}, now(), now()
      FROM UNNEST(
        ${keys}::text[], ${pubs}::text[], ${applicants}::text[],
        ${inventors}::text[][], ${ipc}::text[][], ${families}::text[]
      ) AS s(key, pub, applicants, inventors, ipc, family)
      ON CONFLICT ("publicationNumberKey") DO UPDATE SET
        "applicants"       = EXCLUDED."applicants",
        "inventors"        = EXCLUDED."inventors",
        "ipc"              = EXCLUDED."ipc",
        "docdbFamilyId"    = COALESCE("epo_patent_bib"."docdbFamilyId", EXCLUDED."docdbFamilyId"),
        "sourceDeliveryId" = EXCLUDED."sourceDeliveryId",
        "updatedAt"        = now()
    `)
    return Number(result)
  }
}

// ---------------------------------------------------------------------------
// EP full-text
// ---------------------------------------------------------------------------

/**
 * How much EP text to keep. Measured on the real feed: the description averages
 * 112,883 chars per publication against 7,630 for all claims, so it is ~94% of
 * the storage. Dropping it takes a year of EP coverage from ~11 GB to ~0.8 GB —
 * cheap enough to hold the entire 1978-2026 back catalogue in ~15 GB.
 *
 * TRANSFER IS UNCHANGED by this choice: the claims live inside the same
 * archives as the page images, so the download is the same either way. This
 * buys storage, not bandwidth.
 */
export type EpTextPolicy =
  /** Everything. ~9.2 GB per year of coverage; ~180 GB for all of EP. */
  | 'claims-full+description-full'
  /**
   * DEFAULT. Full claims plus the first 5,000 characters of the description —
   * enough to carry the field, background and summary, which is where a
   * description's disclosure value is concentrated. ~1.8 GB per year, ~35 GB for
   * the entire 1978-2026 catalogue. Matches the 5,000-char convention the Google
   * loader already uses (scripts/google-patents-import/staging-select.sql).
   */
  | 'claims-full+description-5k'
  /** All claims, no description at all. ~1.3 GB per year. */
  | 'claims-full'
  /** Claim 1 only. Cheapest, but loses the dependent claims where novelty
   *  usually turns, and repeats the known weakness of the US corpus. */
  | 'first-claim-only'

/** Characters of description retained under the …description-5k policy. */
export const DESCRIPTION_SNIPPET_CHARS = 5000

export interface EpLoadOptions {
  productId: number
  deliveryId: number
  /** Recorded per row so a later policy change knows what to re-import. */
  textPolicy?: EpTextPolicy
  /**
   * Fill claimsText / descriptionText on EXISTING local_patents rows that have
   * none. Default TRUE. Strictly NULL-fill: a row already carrying text (Indian
   * OCR, or a US first-claim) is never overwritten, and never even rewritten.
   *
   * SAFE FOR EMBEDDINGS: embeddingText is `title + '\n' + abstract`, and neither
   * is touched here, so no textHash changes and no vector is invalidated.
   */
  fillLocalPatents?: boolean
  /**
   * Create local_patents rows for EP publications not in the corpus. Default TRUE.
   *
   * Verified against the real feed: A-publications (A1/A2/A3) carry
   * `<abstract id="abst">`, granted specifications (B1/B2) do not. Rather than
   * drop granted specs — which are the most valuable documents in the set, being
   * the enforceable ones — claim 1 stands in as the embedding basis. Measured at
   * ~1,034 chars against a typical abstract's ~800-1,200, it is comparable in
   * length and states what the invention is.
   *
   * The `abstract` COLUMN stays NULL for those rows: claim 1 is used for
   * embedding, not passed off as an abstract. `embeddingTextSource` records
   * which basis was used.
   *
   * A publication with neither an abstract nor any claim has nothing to embed
   * and is skipped; its text still lives in epo_ep_fulltext.
   */
  createMissingRows?: boolean
  fromYear?: number | null
  toYear?: number | null
  batchSize?: number
}

export interface EpLoadStats {
  parsed: number
  /** Rows written to epo_ep_fulltext — the authoritative store. */
  loaded: number
  /** Existing local_patents rows whose NULL claims/description we filled. */
  filledExisting: number
  /** Existing rows left untouched because they already carried text. */
  skippedHasText: number
  /** EP publications not in local_patents (no row created unless opted in). */
  notInCorpus: number
  /** New local_patents rows created — only when createMissingRows is on. */
  createdNew: number
  /** EP publications skipped for row creation because they carry no abstract
   *  (granted B1/B2 specs). Their text is still stored in epo_ep_fulltext. */
  skippedNoAbstract: number
  skippedNoText: number
  skippedOutOfRange: number
}

/** What the text policy decided to store for one record. */
export interface StoredText {
  claimsText: string | null
  claimsCount: number
  claimsComplete: boolean
  descriptionText: string | null
  descriptionCharCount: number
  descriptionComplete: boolean
}

/**
 * Decide what to store for one record under a policy. Pure — no I/O — so the
 * truncation and completeness rules can be tested directly.
 *
 * The completeness flags describe what was actually STORED, never what the
 * document contained. A 5k snippet must not report itself complete, or
 * `coverage` overstates what we hold and a later full-description pass cannot
 * find the rows that need upgrading.
 */
export function applyTextPolicy(record: EpFullTextRecord, policy: EpTextPolicy): StoredText {
  const firstOnly = policy === 'first-claim-only'
  const claimsText = firstOnly ? (record.claims[0] ?? null) : record.claimsText
  const claimsCount = firstOnly ? (record.claims.length ? 1 : 0) : record.claimsCount

  let descriptionText: string | null = null
  let descriptionComplete = false
  if (policy === 'claims-full+description-full') {
    descriptionText = record.descriptionText
    descriptionComplete = Boolean(descriptionText)
  } else if (policy === 'claims-full+description-5k') {
    const full = record.descriptionText
    descriptionText = full ? full.slice(0, DESCRIPTION_SNIPPET_CHARS) : null
    descriptionComplete = Boolean(full) && full!.length <= DESCRIPTION_SNIPPET_CHARS
  }

  return {
    claimsText,
    claimsCount,
    claimsComplete: Boolean(claimsText) && !firstOnly,
    descriptionText,
    descriptionCharCount: descriptionText?.length ?? 0,
    descriptionComplete,
  }
}

/**
 * Loads EP claims + descriptions.
 *
 * Two destinations:
 *   epo_ep_fulltext — always. The authoritative store, with the completeness
 *                     metadata that lets `coverage` report honestly.
 *   local_patents   — NULL-fill only. An existing row that has no claims (every
 *                     non-US Google row, and every Indian row) gains them; a row
 *                     that already has text is never touched.
 *
 * `title`, `abstract` and `embeddingText` are NEVER written, so every one of the
 * 29.8M COMPLETED voyage vectors stays byte-identical and valid.
 */
export class EpFullTextLoader {
  private buffer: EpFullTextRecord[] = []
  readonly stats: EpLoadStats = {
    parsed: 0, loaded: 0, filledExisting: 0, skippedHasText: 0,
    notInCorpus: 0, createdNew: 0, skippedNoAbstract: 0, skippedNoText: 0, skippedOutOfRange: 0,
  }
  private readonly batchSize: number
  private readonly textPolicy: EpTextPolicy

  constructor(private readonly options: EpLoadOptions) {
    this.batchSize = options.batchSize ?? 200
    this.textPolicy = options.textPolicy ?? 'claims-full+description-5k'
  }

  /**
   * Apply the policy. `claimsComplete` reflects what was actually STORED, not
   * what the document contained — so a first-claim-only row never reports
   * itself as holding complete claims, and `coverage` cannot overstate what we
   * have.
   */
  private applyPolicy(record: EpFullTextRecord): StoredText {
    return applyTextPolicy(record, this.textPolicy)
  }


  async add(record: EpFullTextRecord): Promise<void> {
    this.stats.parsed++

    const year = record.publicationDate && /^\d{4}/.test(record.publicationDate)
      ? Number(record.publicationDate.slice(0, 4))
      : null
    const { fromYear, toYear } = this.options
    if (year != null && ((fromYear != null && year < fromYear) || (toYear != null && year > toYear))) {
      this.stats.skippedOutOfRange++
      return
    }

    // A3 documents are search-report publications with no text body; storing an
    // empty row would misreport coverage as complete.
    if (!record.claimsText && !record.descriptionText) {
      this.stats.skippedNoText++
      return
    }

    this.buffer.push(record)
    if (this.buffer.length >= this.batchSize) await this.flush()
  }

  /**
   * Write one batch ATOMICALLY.
   *
   * The three statements below used to run as independent autocommits, so a
   * failure in the third left the first two committed — an archive could report
   * FAILED while having written thousands of rows. Wrapping the batch in one
   * transaction makes it all-or-nothing, so ledger status and stored data always
   * agree. Earlier batches of the same archive still commit, which is fine: the
   * loader is idempotent, so re-running the archive completes it.
   */
  async flush(): Promise<void> {
    if (!this.buffer.length) return
    const batch = this.buffer
    this.buffer = []

    await prisma.$transaction(async tx => { await this.writeBatch(tx as typeof prisma, batch) })
  }

  private async writeBatch(tx: typeof prisma, batch: EpFullTextRecord[]): Promise<void> {
    const pubs = batch.map(r => r.publicationNumber)
    const keys = batch.map(r => publicationNumberKey(r.publicationNumber))
    const kinds = batch.map(r => r.kind || null)
    const langs = batch.map(r => r.claimsLang || r.lang || null)
    const years = batch.map(r => (r.publicationDate ? Number(r.publicationDate.slice(0, 4)) : null))
    const stored = batch.map(r => this.applyPolicy(r))
    const claims = stored.map(s => s.claimsText)
    const claimCounts = stored.map(s => s.claimsCount)
    const claimsComplete = stored.map(s => s.claimsComplete)
    const descriptions = stored.map(s => s.descriptionText)
    const descChars = stored.map(s => s.descriptionCharCount)
    const descComplete = stored.map(s => s.descriptionComplete)

    const result = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "epo_ep_fulltext" (
        "publicationNumber", "publicationNumberKey", "kind", "lang", "publicationYear",
        "claimsText", "claimsCount", "claimsComplete",
        "descriptionText", "descriptionCharCount", "descriptionComplete",
        "textPolicy", "sourceProductId", "sourceDeliveryId", "ingestedAt", "updatedAt"
      )
      SELECT s.pub, s.key, s.kind, s.lang, s.year,
             s.claims, s.claim_count, s.claims_complete,
             s.description, s.desc_chars, s.desc_complete,
             ${this.textPolicy}, ${this.options.productId}, ${this.options.deliveryId}, now(), now()
      FROM UNNEST(
        ${pubs}::text[], ${keys}::text[], ${kinds}::text[], ${langs}::text[], ${years}::int[],
        ${claims}::text[], ${claimCounts}::int[], ${claimsComplete}::boolean[],
        ${descriptions}::text[], ${descChars}::int[], ${descComplete}::boolean[]
      ) AS s(pub, key, kind, lang, year, claims, claim_count, claims_complete,
             description, desc_chars, desc_complete)
      ON CONFLICT ("publicationNumber") DO UPDATE SET
        "claimsText"           = EXCLUDED."claimsText",
        "claimsCount"          = EXCLUDED."claimsCount",
        "claimsComplete"       = EXCLUDED."claimsComplete",
        "descriptionText"      = EXCLUDED."descriptionText",
        "descriptionCharCount" = EXCLUDED."descriptionCharCount",
        "descriptionComplete"  = EXCLUDED."descriptionComplete",
        "textPolicy"           = EXCLUDED."textPolicy",
        "sourceDeliveryId"     = EXCLUDED."sourceDeliveryId",
        "updatedAt"            = now()
    `)
    this.stats.loaded += Number(result)

    if (this.options.fillLocalPatents !== false) await this.fillExisting(tx, batch, stored)
    if (this.options.createMissingRows !== false) await this.createMissing(tx, batch, stored)
  }

  /**
   * Fill claims/description on rows we already hold that have none.
   *
   * The WHERE clause matches ONLY rows that actually gain something, so a row
   * with existing text is not rewritten at all — no dead tuple, no bloat. Every
   * write stamps the provenance markers, so `textUpdatedAt IS NOT NULL`
   * permanently identifies every row this service has modified.
   */
  private async fillExisting(tx: typeof prisma, batch: EpFullTextRecord[], stored: StoredText[]): Promise<void> {
    // Join on publicationNumberKey, NOT publicationNumber.
    //
    // local_patents."publicationNumber" holds Google's RAW value, which is
    // hyphenated ("EP-4497325-A1"); the normalised form lives in
    // publicationNumberKey (04-postgres-load-and-upsert.sql:67-68). Joining on
    // the raw column matched zero rows out of 4,458.
    const keys = batch.map(r => publicationNumberKey(r.publicationNumber))
    const pubs = batch.map(r => r.publicationNumber)
    const claims = stored.map(s => s.claimsText)
    const descriptions = stored.map(s => s.descriptionText)
    const claimsCompleteness = stored.map(s => (s.claimsComplete ? 'FULL' : 'PARTIAL'))
    const descCompleteness = stored.map(s => (s.descriptionComplete ? 'FULL' : 'TRUNCATED_5K'))

    const filled = await tx.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      UPDATE "local_patents" lp
      SET "claimsText"      = COALESCE(lp."claimsText", s.claims),
          "descriptionText" = COALESCE(lp."descriptionText", s.description),
          "claimsSource" = CASE WHEN lp."claimsText" IS NULL AND s.claims IS NOT NULL
                                THEN 'epo-ep-fulltext' ELSE lp."claimsSource" END,
          "claimsCompleteness" = CASE WHEN lp."claimsText" IS NULL AND s.claims IS NOT NULL
                                      THEN s.claims_completeness ELSE lp."claimsCompleteness" END,
          "descriptionSource" = CASE WHEN lp."descriptionText" IS NULL AND s.description IS NOT NULL
                                     THEN 'epo-ep-fulltext' ELSE lp."descriptionSource" END,
          "descriptionCompleteness" = CASE WHEN lp."descriptionText" IS NULL AND s.description IS NOT NULL
                                           THEN s.desc_completeness ELSE lp."descriptionCompleteness" END,
          "textUpdatedAt" = now(),
          "updatedAt"     = now()
      FROM UNNEST(
        ${keys}::text[], ${claims}::text[], ${descriptions}::text[],
        ${claimsCompleteness}::text[], ${descCompleteness}::text[]
      ) AS s(key, claims, description, claims_completeness, desc_completeness)
      WHERE lp."publicationNumberKey" = s.key
        AND ((lp."claimsText" IS NULL AND s.claims IS NOT NULL)
          OR (lp."descriptionText" IS NULL AND s.description IS NOT NULL))
      RETURNING lp."id"
    `)
    this.stats.filledExisting += filled.length

    if (filled.length) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "epo_gapfill_audit" ("id", "localPatentId", "column", "sourceDeliveryId", "filledAt")
        SELECT 'epg_' || s.id::text || '_' || ${this.options.deliveryId}::text,
               s.id, 'claimsText/descriptionText', ${this.options.deliveryId}, now()
        FROM UNNEST(${filled.map(r => r.id)}::int[]) AS s(id)
        ON CONFLICT ("id") DO NOTHING
      `)
    }

    // Distinguish "already had text" from "not in the corpus at all" — the two
    // look identical in a plain not-updated count, and mean very different things.
    const present = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS n FROM "local_patents"
      WHERE "publicationNumberKey" = ANY(${keys})
    `)
    const inCorpus = Number(present[0]?.n ?? 0)
    this.stats.notInCorpus += Math.max(0, batch.length - inCorpus)
    this.stats.skippedHasText += Math.max(0, inCorpus - filled.length)
  }

  /**
   * Create rows for EP publications we do not hold.
   *
   * Needs a title plus SOMETHING to embed: an abstract (A-publications) or, for
   * granted specs that have none, claim 1. Anything with neither is skipped.
   */
  private async createMissing(tx: typeof prisma, batch: EpFullTextRecord[], stored: StoredText[]): Promise<void> {
    const candidates = batch
      .map((record, i) => ({ record, text: stored[i] }))
      .filter(({ record }) => Boolean(record.title && (record.abstract || record.claims[0])))
    this.stats.skippedNoAbstract += batch.length - candidates.length
    if (!candidates.length) return

    // Abstract when the document has one; claim 1 otherwise. Recorded per row so
    // the two bases stay distinguishable forever.
    const embeddingBasis = candidates.map(c =>
      c.record.abstract ? 'title+abstract' : 'title+first-claim')
    const embeddingBody = candidates.map(c => c.record.abstract ?? c.record.claims[0] ?? '')

    const created = await tx.$executeRaw(Prisma.sql`
      INSERT INTO "local_patents" (
        "publicationNumber", "publicationNumberKey", "title", "abstract", "country", "kind",
        "publicationDate", "classifications", "claimsText", "descriptionText",
        "corpusSources", "embeddingText", "embeddingTextSource",
        "claimsSource", "claimsCompleteness", "descriptionSource", "descriptionCompleteness",
        "textUpdatedAt", "createdAt", "updatedAt"
      )
      -- embeddingText matches the corpus convention (title + a short statement
      -- of the invention). The abstract COLUMN stays NULL for granted specs: we
      -- embed claim 1, we do not present it as an abstract.
      SELECT s.pub, s.key, s.title, NULLIF(s.abstract, ''), s.country, s.kind, s.pubdate, s.ipc,
             s.claims, s.description,
             ARRAY['epo-ep-fulltext']::TEXT[],
             LEFT(s.title || E'\n' || s.embed_body, 20000), s.embed_basis,
             'epo-ep-fulltext', 'FULL', 'epo-ep-fulltext',
             ${this.textPolicy === 'claims-full+description-full' ? 'FULL' : 'TRUNCATED_5K'},
             now(), now(), now()
      FROM (
        -- The array order here MUST match the alias list below, one for one.
        -- A mismatch is not caught at compile time; it surfaces at runtime as
        -- "column s.<name> does not exist".
        SELECT * FROM UNNEST(
          ${candidates.map(c => c.record.publicationNumber)}::text[],          -- pub
          ${candidates.map(c => publicationNumberKey(c.record.publicationNumber))}::text[], -- key
          ${candidates.map(c => (c.record.title ?? '').slice(0, 1000))}::text[], -- title
          ${candidates.map(c => c.record.abstract ?? '')}::text[],             -- abstract
          ${candidates.map(c => c.record.country || 'EP')}::text[],            -- country
          ${candidates.map(c => c.record.kind || null)}::text[],               -- kind
          ${candidates.map(c => parseDocdbDate(c.record.publicationDate))}::timestamp[], -- pubdate
          ${candidates.map(c => c.record.ipc)}::text[][],                      -- ipc
          ${candidates.map(c => c.text.claimsText)}::text[],                   -- claims
          ${candidates.map(c => c.text.descriptionText)}::text[],              -- description
          ${embeddingBody}::text[],                                            -- embed_body
          ${embeddingBasis}::text[]                                            -- embed_basis
        ) AS t(pub, key, title, abstract, country, kind, pubdate, ipc,
               claims, description, embed_body, embed_basis)
      ) s
      WHERE NOT EXISTS (
        SELECT 1 FROM "local_patents" lp
        WHERE lp."publicationNumberKey" = s.key AND lp."publicationNumber" <> s.pub
      )
      ON CONFLICT ("publicationNumber") DO NOTHING
    `)
    this.stats.createdNew += Number(created)
  }
}
