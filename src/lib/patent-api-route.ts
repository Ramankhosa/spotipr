import { NextRequest, NextResponse } from 'next/server'
import {
  authenticatePatentApiRequest,
  PatentApiAuthContext,
  PatentApiError,
  patentApiRateHeaders,
  patentApiRequestId,
  recordPatentApiRequest,
} from '@/lib/patent-api-auth'
import { assertPatentPublicApiEnabled } from '@/lib/patent-public-api'

type RouteResult = {
  data: unknown
  resultCount?: number
  queryHash?: string
}

/**
 * Hard ceiling on request bodies. Well above the largest documented payload
 * (a 20,000-character disclosure) but small enough that an unbounded upload
 * cannot be buffered into memory before validation runs.
 */
export const PATENT_API_MAX_BODY_BYTES = 256 * 1024

function payloadTooLarge() {
  return new PatentApiError(
    'PAYLOAD_TOO_LARGE',
    `The request body must not exceed ${Math.round(PATENT_API_MAX_BODY_BYTES / 1024)} KB.`,
    413
  )
}

/**
 * Reads and parses a JSON request body with an enforced size cap. The
 * Content-Length header is only a hint, so the decoded body is measured too.
 */
export async function readPatentApiJsonBody(
  request: NextRequest,
  options: { allowArray?: boolean } = {}
): Promise<any> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > PATENT_API_MAX_BODY_BYTES) throw payloadTooLarge()

  let raw: string
  try {
    raw = await request.text()
  } catch {
    throw new PatentApiError('INVALID_REQUEST', 'The request body could not be read.', 400)
  }
  if (Buffer.byteLength(raw, 'utf8') > PATENT_API_MAX_BODY_BYTES) throw payloadTooLarge()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PatentApiError('INVALID_REQUEST', 'The request body must be valid JSON.', 400)
  }
  if (!options.allowArray && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
    throw new PatentApiError('INVALID_REQUEST', 'The request body must be a JSON object.', 400)
  }
  return parsed
}

function copyHeaders(target: Headers, source: Headers) {
  source.forEach((value, key) => target.set(key, value))
}

export async function runPatentApiRoute(
  request: NextRequest,
  endpoint: string,
  handler: (context: { auth: PatentApiAuthContext; requestId: string }) => Promise<RouteResult>
) {
  const startedAt = Date.now()
  const requestId = patentApiRequestId(request)
  let auth: PatentApiAuthContext | undefined
  try {
    // Checked before authentication so a disabled platform never spends a
    // client's quota on a request it was always going to refuse.
    assertPatentPublicApiEnabled()
    auth = await authenticatePatentApiRequest(request)
    const result = await handler({ auth, requestId })
    const durationMs = Date.now() - startedAt
    const headers = new Headers({ 'X-Request-ID': requestId })
    copyHeaders(headers, patentApiRateHeaders(auth))
    await recordPatentApiRequest({
      auth,
      request,
      requestId,
      endpoint,
      statusCode: 200,
      durationMs,
      resultCount: result.resultCount,
      queryHash: result.queryHash,
    }).catch(error => console.error('[PatentPublicAPI] Failed to write request log:', error))
    return NextResponse.json({ data: result.data, meta: { requestId, durationMs } }, { headers })
  } catch (error) {
    const isKnownError = error instanceof PatentApiError
    const known = isKnownError
      ? error
      : new PatentApiError('INTERNAL_ERROR', 'The request could not be completed.', 500)
    auth = auth || known.auth
    const durationMs = Date.now() - startedAt
    if (auth) {
      await recordPatentApiRequest({
        auth,
        request,
        requestId,
        endpoint,
        statusCode: known.status,
        durationMs,
        errorCode: known.code,
      }).catch(logError => console.error('[PatentPublicAPI] Failed to write error request log:', logError))
    }
    if (!isKnownError || known.status >= 500) console.error('[PatentPublicAPI] Request failed:', error)
    const headers = new Headers({ 'X-Request-ID': requestId })
    copyHeaders(headers, patentApiRateHeaders(auth))
    if (known.retryAfter) headers.set('Retry-After', String(known.retryAfter))
    return NextResponse.json(
      { error: { code: known.code, message: known.message, requestId } },
      { status: known.status, headers }
    )
  }
}
