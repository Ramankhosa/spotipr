import { BigQuery } from '@google-cloud/bigquery'

// On-demand claims retrieval for shortlisted prior-art candidates.
//
// Full claims text is deliberately NOT imported into Postgres (it is ~10x the size of
// abstracts and only a few dozen references per novelty run ever need it). Instead the
// BigQuery staging step keeps a claims table clustered by publication number (see
// scripts/google-patents-import/02-claims-staging.sql), so per-publication lookups
// scan only the clustered blocks and cost fractions of a cent.

const BIGQUERY_LOCATION = process.env.GOOGLE_PATENTS_BQ_LOCATION || process.env.BIGQUERY_LOCATION || 'US'

function googleCloudProjectId() {
  return String(
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.BIGQUERY_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.BIGQUERY_BILLING_PROJECT ||
    ''
  ).trim()
}

function claimsTableId() {
  // Fully qualified `project.dataset.table`, e.g. my-project.spotipr_patents.patent_claims
  return String(process.env.GOOGLE_PATENTS_CLAIMS_TABLE || '').trim()
}

export function googlePatentsClaimsEnabled() {
  return Boolean(claimsTableId() && googleCloudProjectId())
}

export function canonicalClaimsKey(publicationNumber: unknown): string {
  const compact = String(publicationNumber || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!compact || compact.startsWith('PAPER')) return ''
  const kindSuffixMatch = compact.match(/^(.+\d)[A-Z]\d?$/)
  return kindSuffixMatch?.[1] || compact
}

let cachedClient: BigQuery | null = null
function bigQueryClient() {
  if (!cachedClient) {
    cachedClient = new BigQuery({ projectId: googleCloudProjectId(), location: BIGQUERY_LOCATION })
  }
  return cachedClient
}

/**
 * Fetch English claims text for the given publication numbers from the BigQuery
 * claims staging table. Returns a map keyed by canonical publication number
 * (uppercase, alphanumeric, kind code stripped — same normalization the novelty
 * pipeline uses). Failures are non-fatal: an empty map is returned so the novelty
 * pipeline continues on title/abstract evidence alone.
 */
export async function fetchGooglePatentsClaims(publicationNumbers: string[]): Promise<Map<string, string>> {
  const claims = new Map<string, string>()
  if (!googlePatentsClaimsEnabled()) return claims
  const keys = Array.from(new Set(publicationNumbers.map(canonicalClaimsKey).filter(Boolean)))
  if (!keys.length) return claims

  try {
    const [rows] = await bigQueryClient().query({
      query: `
        SELECT pub_canonical, claims_text
        FROM \`${claimsTableId()}\`
        WHERE pub_canonical IN UNNEST(@keys)
        ORDER BY pub_canonical, kind_preference ASC
      `,
      params: { keys },
      location: BIGQUERY_LOCATION,
    })
    for (const row of rows as Array<{ pub_canonical?: string; claims_text?: string }>) {
      const key = String(row?.pub_canonical || '').trim()
      const text = String(row?.claims_text || '').trim()
      if (key && text && !claims.has(key)) claims.set(key, text)
    }
  } catch (error) {
    console.warn('[GooglePatentsClaims] Claims lookup failed; continuing without claims text.',
      error instanceof Error ? error.message : error)
  }

  // No Postgres write-back: per-run lookups against the clustered BigQuery table cost
  // fractions of a cent, and an UPDATE matched on a computed expression would sequential-
  // scan the 30M-row corpus on the small database server.
  return claims
}
