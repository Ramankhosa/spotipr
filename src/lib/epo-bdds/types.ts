// Shared types for the EPO Bulk Data Download Service (BDDS) ingestion service.
//
// The BDDS domain model is three tiers: Product -> Delivery -> File.
// Field names below mirror the wire format exactly; see catalog.ts for the
// endpoints and the sources those were confirmed from.

/** A BDDS product, e.g. "EP full-text data - back file". */
export interface BddsProduct {
  id: number
  name: string
  description?: string | null
}

/**
 * One file inside a delivery.
 *
 * NOTE `fileSize` is a HUMAN-READABLE STRING on the wire (e.g. "1.5 GB"), not a
 * byte count. Use parseFileSize() for planning estimates only; the authoritative
 * byte count comes from Content-Length at download time.
 *
 * `fileChecksum` algorithm is not stated by the API. detectChecksumAlgorithm()
 * determines it empirically and it is persisted per file in the ledger.
 */
export interface BddsFile {
  fileId: number
  fileName: string
  fileSize: string
  fileChecksum: string
  itemPublicationDatetime?: string
}

/** A delivery: one back-file chunk, or one recurring weekly update. */
export interface BddsDelivery {
  deliveryId: number
  deliveryName: string
  deliveryPublicationDatetime: string
  deliveryExpiryDatetime?: string | null
  files: BddsFile[]
}

export interface BddsProductWithDeliveries extends BddsProduct {
  deliveries: BddsDelivery[]
}

/** OAuth2 password-grant response from the EPO Okta tenant. */
export interface BddsTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  scope?: string
  id_token?: string
}

export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha256'

/** Which dataset a file belongs to. Drives parser selection. */
export type BddsLane = 'ep-fulltext' | 'docdb' | 'inpadoc'

/**
 * Slice coordinates parsed out of a BDDS filename, e.g.
 *   DOCDB-202501-Amend-PubDate20250103AndBefore-AP-0001.zip
 * Used to skip whole files without downloading them.
 */
export interface FileSliceInfo {
  authority: string | null
  /** Publication-coverage bounds. Set ONLY from an explicit PubDate in the
   *  filename; null means coverage is unknown and must be filtered per record. */
  pubYearFrom: number | null
  pubYearTo: number | null
  /** Production/delivery stamp. Informational — NEVER used to skip downloads,
   *  because a back-file archive produced in 2026 spans decades of publications. */
  deliveryYear: number | null
}
