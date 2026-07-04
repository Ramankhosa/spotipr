import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
}

const metaSchema = {
  type: 'object',
  required: ['requestId', 'durationMs'],
  properties: {
    requestId: { type: 'string' },
    durationMs: { type: 'integer', minimum: 0 },
  },
}

const patentSchema = {
  type: 'object',
  required: ['publicationNumber', 'title', 'applicants', 'inventors', 'classifications', 'source'],
  properties: {
    publicationNumber: { type: 'string', example: 'IN20282005A' },
    applicationNumber: { type: ['string', 'null'] },
    kind: { type: ['string', 'null'] },
    country: { type: 'string', example: 'IN' },
    title: { type: 'string' },
    abstract: { type: ['string', 'null'] },
    applicants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          address: { type: ['string', 'null'] },
          sequence: { type: 'integer' },
        },
      },
    },
    inventors: { type: 'array', items: { type: 'string' } },
    classifications: { type: 'array', items: { type: 'string' } },
    filingDate: { type: ['string', 'null'], format: 'date' },
    publicationDate: { type: ['string', 'null'], format: 'date' },
    numberOfPages: { type: ['integer', 'null'] },
    numberOfClaims: { type: ['integer', 'null'] },
    extractionConfidence: { type: ['number', 'null'] },
    source: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        document: { type: ['string', 'null'] },
        page: { type: ['integer', 'null'] },
      },
    },
    relevance: {
      type: 'object',
      properties: {
        score: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        semanticScore: { type: ['number', 'null'] },
        textScore: { type: ['number', 'null'] },
        matchedFields: { type: 'array', items: { type: 'string' } },
      },
    },
  },
}

function errorResponses() {
  return {
    '400': { description: 'Invalid request', content: { 'application/json': { schema: errorSchema } } },
    '401': { description: 'Missing, invalid, revoked, or expired API key', content: { 'application/json': { schema: errorSchema } } },
    '403': { description: 'API client suspended', content: { 'application/json': { schema: errorSchema } } },
    '429': { description: 'Rate or quota limit exceeded', headers: { 'Retry-After': { schema: { type: 'integer' } } }, content: { 'application/json': { schema: errorSchema } } },
    '503': { description: 'Service or semantic search unavailable', content: { 'application/json': { schema: errorSchema } } },
    '500': { description: 'Unexpected server error', content: { 'application/json': { schema: errorSchema } } },
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    openapi: '3.1.0',
    info: {
      title: 'PatentNest Indian Patent Corpus API',
      version: '1.0.0',
      description: 'Server-to-server hybrid semantic search and publication lookup for the Indian patent corpus.',
    },
    servers: [{ url: request.nextUrl.origin }],
    security: [{ bearerApiKey: [] }],
    paths: {
      '/api/v1/patents/search': {
        post: {
          operationId: 'searchIndianPatents',
          summary: 'Search Indian patents',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['query'],
                  properties: {
                    query: { type: 'string', minLength: 2, maxLength: 2000 },
                    limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
                  },
                },
                example: { query: 'battery thermal management for electric vehicles', limit: 20 },
              },
            },
          },
          responses: {
            '200': {
              description: 'Ranked Indian patents',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: {
                        type: 'object',
                        properties: {
                          query: { type: 'string' },
                          count: { type: 'integer' },
                          results: { type: 'array', items: patentSchema },
                        },
                      },
                      meta: metaSchema,
                    },
                  },
                },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/api/v1/patents/{publicationNumber}': {
        get: {
          operationId: 'getIndianPatent',
          summary: 'Get an Indian patent by publication number',
          parameters: [{ name: 'publicationNumber', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Patent record',
              content: { 'application/json': { schema: { type: 'object', properties: { data: patentSchema, meta: metaSchema } } } },
            },
            '404': { description: 'Patent not found', content: { 'application/json': { schema: errorSchema } } },
            ...errorResponses(),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerApiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'pn_live_ API key' },
      },
      schemas: { Patent: patentSchema, Error: errorSchema },
    },
  }, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
