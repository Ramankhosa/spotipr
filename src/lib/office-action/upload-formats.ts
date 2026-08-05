/**
 * Office Action Studio — accepted upload formats.
 *
 * Kept in its own dependency-free module so the client file pickers and the
 * server extractor advertise exactly the same thing without pulling pdfjs /
 * mammoth into the browser bundle.
 */

export const ACCEPTED_UPLOAD_EXTENSIONS = '.pdf,.docx,.txt,.md'
export const ACCEPTED_UPLOAD_LABEL = 'PDF, Word (.docx) or plain text'
export const MAX_OA_UPLOAD_BYTES = 25 * 1024 * 1024
export const MAX_OA_UPLOAD_LABEL = '25 MB'

/**
 * Cap on pasted / JSON-supplied text.
 *
 * The 25 MB file cap was enforced only on the multipart branch; the JSON paste
 * path took an unbounded string straight into LLM parsing, per-chunk paid
 * embeddings and a JSONB column. A very long specification runs well under a
 * million characters, so this is generous for real documents and still bounds
 * the work a single request can buy.
 */
export const MAX_OA_TEXT_CHARS = 2_000_000
export const MAX_OA_TEXT_LABEL = '2 million characters'
