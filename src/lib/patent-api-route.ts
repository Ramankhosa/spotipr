import { NextRequest, NextResponse } from 'next/server'
import {
  authenticatePatentApiRequest,
  PatentApiAuthContext,
  PatentApiError,
  patentApiRateHeaders,
  patentApiRequestId,
  recordPatentApiRequest,
} from '@/lib/patent-api-auth'

type RouteResult = {
  data: unknown
  resultCount?: number
  queryHash?: string
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
