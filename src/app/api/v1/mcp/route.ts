import { NextRequest, NextResponse } from 'next/server'
import {
  authenticatePatentApiRequest,
  PatentApiAuthContext,
  PatentApiError,
  patentApiQueryHash,
  patentApiRateHeaders,
  patentApiRequestId,
  recordPatentApiRequest,
} from '@/lib/patent-api-auth'
import { readPatentApiJsonBody } from '@/lib/patent-api-route'
import {
  assertPatentPublicApiEnabled,
  getPublicIndianPatent,
  getPublicSearchCoverage,
  searchPublicIndianPatents,
} from '@/lib/patent-public-api'
import {
  extractPublicInventionFeatures,
  mapFeaturesToPublicPatent,
  PATENT_API_ANALYSIS_LIMITS,
} from '@/lib/patent-api-analysis'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Model Context Protocol server (streamable HTTP transport, JSON responses).
 * Lets AI agents (Claude, Cursor, custom stacks) call PatentNest search and
 * novelty-analysis tools directly. Tool calls authenticate with the same
 * pn_live_ bearer keys and consume the same per-client quotas as the REST API.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = {
  name: 'patentnest-patent-api',
  title: 'PatentNest Patent Intelligence API',
  version: '1.1.0',
}
const SERVER_INSTRUCTIONS =
  'Search the Indian patent corpus and run novelty analysis. Typical flow: ' +
  'extract_invention_features on a disclosure, search_patents with the suggested query, ' +
  'then map_features_to_patent against shortlisted publication numbers to get quoted, ' +
  'element-wise evidence. All quotes are verbatim from the patent record; treat "unknown" ' +
  'statuses as insufficient evidence, not as proof of novelty.'

const TOOLS = [
  {
    name: 'search_patents',
    title: 'Search Indian patents',
    description:
      'Hybrid semantic + text search over the Indian patent corpus. Returns ranked patent records with relevance scores and a coverage manifest describing exactly what was searched.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 2000, description: 'Plain-English technical description of what to find.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
    },
  },
  {
    name: 'get_patent',
    title: 'Get a patent record',
    description: 'Fetch one Indian patent record by publication number (case and separators are normalized).',
    inputSchema: {
      type: 'object',
      required: ['publicationNumber'],
      additionalProperties: false,
      properties: {
        publicationNumber: { type: 'string', minLength: 2, maxLength: 40 },
      },
    },
  },
  {
    name: 'extract_invention_features',
    title: 'Extract invention features',
    description:
      'Analyze an invention disclosure and return atomic technical features, novelty-focus candidates, a suggested prior-art search query, and classification hints. Use before searching.',
    inputSchema: {
      type: 'object',
      required: ['description'],
      additionalProperties: false,
      properties: {
        title: { type: 'string', maxLength: PATENT_API_ANALYSIS_LIMITS.titleMaxChars },
        description: {
          type: 'string',
          minLength: PATENT_API_ANALYSIS_LIMITS.descriptionMinChars,
          maxLength: PATENT_API_ANALYSIS_LIMITS.descriptionMaxChars,
          description: 'Plain-English invention disclosure.',
        },
      },
    },
  },
  {
    name: 'map_features_to_patent',
    title: 'Map features to a patent',
    description:
      'Element-wise novelty evidence: classifies every feature as present, partial, absent, or unknown in one patent, with verbatim quotes and the field they came from. Use on shortlisted search results.',
    inputSchema: {
      type: 'object',
      required: ['features', 'publicationNumber'],
      additionalProperties: false,
      properties: {
        features: {
          type: 'array',
          minItems: PATENT_API_ANALYSIS_LIMITS.featuresMin,
          maxItems: PATENT_API_ANALYSIS_LIMITS.featuresMax,
          items: {
            type: 'string',
            minLength: PATENT_API_ANALYSIS_LIMITS.featureMinChars,
            maxLength: PATENT_API_ANALYSIS_LIMITS.featureMaxChars,
          },
          description: 'Atomic technical features, e.g. from extract_invention_features.',
        },
        publicationNumber: { type: 'string', minLength: 2, maxLength: 40 },
      },
    },
  },
]

type JsonRpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: any }

function rpcResult(id: unknown, result: unknown, headers?: Headers) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result }, { status: 200, headers })
}

function rpcError(id: unknown, code: number, message: string, status = 200, headers?: Headers, data?: unknown) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } },
    { status, headers }
  )
}

function negotiateProtocolVersion(requested: unknown) {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : SUPPORTED_PROTOCOL_VERSIONS[0]
}

async function executeTool(name: string, args: any, auth: PatentApiAuthContext) {
  switch (name) {
    case 'search_patents': {
      const query = typeof args?.query === 'string' ? args.query.trim() : ''
      if (query.length < 2 || query.length > 2000) {
        throw new PatentApiError('INVALID_REQUEST', 'query must contain between 2 and 2,000 characters.', 400)
      }
      const rawLimit = args?.limit === undefined ? 20 : args.limit
      if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
        throw new PatentApiError('INVALID_REQUEST', 'limit must be an integer between 1 and 50.', 400)
      }
      const results = await searchPublicIndianPatents(query, rawLimit)
      const coverage = await getPublicSearchCoverage()
      return {
        data: { query, count: results.length, results, coverage },
        resultCount: results.length,
        queryHash: patentApiQueryHash(query),
      }
    }
    case 'get_patent': {
      if (typeof args?.publicationNumber !== 'string' || !args.publicationNumber.trim()) {
        throw new PatentApiError('INVALID_REQUEST', 'publicationNumber must be a non-empty string.', 400)
      }
      const patent = await getPublicIndianPatent(args.publicationNumber)
      return { data: patent, resultCount: 1 }
    }
    case 'extract_invention_features': {
      if (args?.title !== undefined && typeof args.title !== 'string') {
        throw new PatentApiError('INVALID_REQUEST', 'title must be a string.', 400)
      }
      if (typeof args?.description !== 'string') {
        throw new PatentApiError('INVALID_REQUEST', 'description must be a string.', 400)
      }
      const analysis = await extractPublicInventionFeatures({ title: args.title, description: args.description, auth })
      return {
        data: analysis,
        resultCount: analysis.features.length,
        queryHash: patentApiQueryHash(args.description),
      }
    }
    case 'map_features_to_patent': {
      if (!Array.isArray(args?.features)) {
        throw new PatentApiError('INVALID_REQUEST', 'features must be an array of strings.', 400)
      }
      if (typeof args?.publicationNumber !== 'string' || !args.publicationNumber.trim()) {
        throw new PatentApiError('INVALID_REQUEST', 'publicationNumber must be a non-empty string.', 400)
      }
      const mapping = await mapFeaturesToPublicPatent({ features: args.features, publicationNumber: args.publicationNumber, auth })
      return {
        data: mapping,
        resultCount: mapping.featureFindings.length,
        queryHash: patentApiQueryHash(mapping.publicationNumber),
      }
    }
    default:
      throw new PatentApiError('UNKNOWN_TOOL', `Unknown tool: ${name}.`, 404)
  }
}

async function handleToolsCall(request: NextRequest, requestId: string, message: JsonRpcMessage) {
  const toolName = typeof message.params?.name === 'string' ? message.params.name : ''
  const toolArgs = message.params?.arguments ?? {}
  const endpoint = `/api/v1/mcp#${toolName || 'unknown'}`
  const startedAt = Date.now()
  let auth: PatentApiAuthContext
  try {
    // Checked before authentication so a disabled platform never spends a
    // client's quota on a request it was always going to refuse.
    assertPatentPublicApiEnabled()
    auth = await authenticatePatentApiRequest(request)
  } catch (error) {
    // Authentication and quota failures are HTTP-level concerns in the
    // streamable HTTP transport, so they surface as HTTP status codes.
    const known = error instanceof PatentApiError
      ? error
      : new PatentApiError('INTERNAL_ERROR', 'The request could not be completed.', 500)
    if (known.auth) {
      await recordPatentApiRequest({
        auth: known.auth,
        request,
        requestId,
        endpoint,
        statusCode: known.status,
        durationMs: Date.now() - startedAt,
        errorCode: known.code,
      }).catch(logError => console.error('[PatentPublicAPI] Failed to write MCP error request log:', logError))
    }
    const headers = new Headers({ 'X-Request-ID': requestId })
    if (known.retryAfter) headers.set('Retry-After', String(known.retryAfter))
    return rpcError(message.id, -32001, known.message, known.status, headers, { code: known.code })
  }

  // Built after the tool runs so analysis-quota counters reserved during
  // execution are reflected in the response headers.
  const responseHeaders = () => {
    const headers = new Headers({ 'X-Request-ID': requestId })
    patentApiRateHeaders(auth).forEach((value, key) => headers.set(key, value))
    return headers
  }
  try {
    if (!TOOLS.some(tool => tool.name === toolName)) {
      throw new PatentApiError('UNKNOWN_TOOL', `Unknown tool: ${toolName || '(missing name)'}.`, 404)
    }
    const result = await executeTool(toolName, toolArgs, auth)
    await recordPatentApiRequest({
      auth,
      request,
      requestId,
      endpoint,
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      resultCount: result.resultCount,
      queryHash: result.queryHash,
    }).catch(logError => console.error('[PatentPublicAPI] Failed to write MCP request log:', logError))
    return rpcResult(message.id, {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      structuredContent: result.data,
      isError: false,
    }, responseHeaders())
  } catch (error) {
    const isKnownError = error instanceof PatentApiError
    const known = isKnownError
      ? (error as PatentApiError)
      : new PatentApiError('INTERNAL_ERROR', 'The request could not be completed.', 500)
    if (!isKnownError || known.status >= 500) console.error('[PatentPublicAPI] MCP tool call failed:', error)
    await recordPatentApiRequest({
      auth,
      request,
      requestId,
      endpoint,
      statusCode: known.status,
      durationMs: Date.now() - startedAt,
      errorCode: known.code,
    }).catch(logError => console.error('[PatentPublicAPI] Failed to write MCP error request log:', logError))
    // Tool execution failures are returned as MCP tool errors so the calling
    // model can see what went wrong and adjust its next call. Retry-After still
    // rides along on the HTTP response so transports can back off.
    const headers = responseHeaders()
    if (known.retryAfter) headers.set('Retry-After', String(known.retryAfter))
    return rpcResult(message.id, {
      content: [{ type: 'text', text: JSON.stringify({ error: { code: known.code, message: known.message } }) }],
      isError: true,
    }, headers)
  }
}

export async function POST(request: NextRequest) {
  const requestId = patentApiRequestId(request)
  let message: JsonRpcMessage
  try {
    message = await readPatentApiJsonBody(request, { allowArray: true })
  } catch (error) {
    if (error instanceof PatentApiError && error.code === 'PAYLOAD_TOO_LARGE') {
      return rpcError(null, -32600, error.message, error.status)
    }
    return rpcError(null, -32700, 'Parse error: the request body must be valid JSON.', 400)
  }
  if (Array.isArray(message)) {
    return rpcError(null, -32600, 'JSON-RPC batching is not supported.', 400)
  }
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') {
    return rpcError(null, -32600, 'Invalid request: a JSON-RPC method is required.', 400)
  }

  if (message.method.startsWith('notifications/')) {
    return new NextResponse(null, { status: 202, headers: { 'X-Request-ID': requestId } })
  }

  switch (message.method) {
    case 'initialize':
      return rpcResult(message.id, {
        protocolVersion: negotiateProtocolVersion(message.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      })
    case 'ping':
      return rpcResult(message.id, {})
    case 'tools/list':
      return rpcResult(message.id, { tools: TOOLS })
    case 'tools/call':
      return handleToolsCall(request, requestId, message)
    default:
      return rpcError(message.id, -32601, `Method not found: ${message.method}.`)
  }
}

export async function GET() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'This MCP endpoint uses JSON responses only. Send JSON-RPC messages via POST.' } },
    { status: 405, headers: { Allow: 'POST' } }
  )
}

export async function DELETE() {
  return NextResponse.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Sessions are stateless; there is nothing to delete.' } },
    { status: 405, headers: { Allow: 'POST' } }
  )
}
