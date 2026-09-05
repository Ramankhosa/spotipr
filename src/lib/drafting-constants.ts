export const MAX_DRAFTING_INPUT_CHARS = 25000

/**
 * Sampling temperature for the stages that produce the filed text.
 *
 * Every provider adapter falls back to 0.7 when a call passes no temperature,
 * and neither the section calls nor the claim calls used to pass one — so the
 * only two stages whose prompts demand "every sentence must be traceable to the
 * source" were the ones running on the creative default. Stage 0 normalization
 * runs at 0.0–0.2 and AI fixes at 0.2; these match that band.
 */
export const DRAFTING_SECTION_TEMPERATURE = 0.2

/** Claims are the legally operative text; keep them at the low end. */
export const DRAFTING_CLAIMS_TEMPERATURE = 0.2

export const MAX_DRAFTING_UPLOAD_MB = 50

export const MAX_DRAFTING_UPLOAD_BYTES = MAX_DRAFTING_UPLOAD_MB * 1024 * 1024

export const EMAIL_DRAFTING_PROJECT_NAME = 'Email Drafting Requests'
export const AUTO_PATENT_DRAFTING_PROJECT_NAME = 'Automated Patent Drafting'

export const EMAIL_DRAFTING_INBOUND_ADDRESS = 'noreply@patentnest.ai'

export const EMAIL_DRAFTING_DOWNLOAD_TTL_DAYS = 7

export const EMAIL_DRAFTING_MAX_REQUESTS_PER_HOUR = 3

export const EMAIL_DRAFTING_MAX_CONCURRENT_WORKERS = 2

export const EMAIL_DRAFTING_STALE_LOCK_MINUTES = 15

export const AUTO_DRAFTING_BULK_RECIPIENT = 'bulk-auto-drafting@patentnest.local'

export const AUTO_DRAFTING_MAX_UPLOAD_ROWS = 25

// Document (one-patent-per-file) batch upload: the extensions accepted for the
// per-file disclosure upload, and a batch-level total-bytes cap so a single
// multipart create request cannot balloon past a sane size even when every file
// is under the per-file MAX_DRAFTING_UPLOAD_MB limit.
export const AUTO_DRAFTING_DOCUMENT_FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.md'] as const

export const AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_MB = 150

export const AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_BYTES = AUTO_DRAFTING_DOCUMENT_MAX_TOTAL_MB * 1024 * 1024

export const EMAIL_DRAFTING_PROGRESS: Record<string, number> = {
  RECEIVED: 5,
  VALIDATING: 10,
  PARSING: 20,
  INITIALIZING: 25,
  NORMALIZING: 35,
  CLAIMS_SETUP: 45,
  PRIOR_ART_CONTEXT: 55,
  COMPONENTS: 65,
  FIGURES: 75,
  DRAFTING: 85,
  REVIEW: 92,
  EXPORT: 97,
  DELIVERED: 100,
  DELIVERED_WITH_WARNINGS: 100,
  REJECTED: 100,
  FAILED: 100,
}

export const EMAIL_DRAFTING_ALLOWED_TEXT_EXTENSIONS = ['.docx', '.txt', '.md'] as const
