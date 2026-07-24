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
