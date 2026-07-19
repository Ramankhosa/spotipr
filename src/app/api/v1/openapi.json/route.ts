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

const coverageSchema = {
  type: 'object',
  description: 'Manifest of exactly what was searched.',
  properties: {
    corpus: { type: 'string', example: 'indian-patent-journal' },
    description: { type: 'string' },
    jurisdiction: { type: 'string', example: 'IN' },
    documents: { type: 'integer', description: 'Total documents in the corpus.' },
    semanticCoveragePercent: { type: 'number', description: 'Share of the corpus with semantic embeddings.' },
    searchMode: { type: 'string', example: 'hybrid-semantic-text' },
    embeddingModel: { type: 'string' },
  },
}

const featureExtractionSchema = {
  type: 'object',
  required: ['features'],
  properties: {
    features: { type: 'array', items: { type: 'string' }, description: 'Atomic technical features extracted from the disclosure.' },
    featureDetails: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          featureType: { type: ['string', 'null'], description: 'core_technical, novelty_candidate, implementation, or generic_weak.' },
          disclosureSupport: { type: ['string', 'null'] },
          technicalRole: { type: ['string', 'null'] },
          sourceExcerpt: { type: ['string', 'null'], description: 'Supporting excerpt from the submitted disclosure, when available.' },
          claimPositioningText: { type: ['string', 'null'] },
          searchText: { type: ['string', 'null'], description: 'Retrieval-optimized phrasing of the feature.' },
          confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        },
      },
    },
    noveltyFocus: { type: 'array', items: { type: 'string' }, description: 'Features most likely to distinguish over prior art.' },
    suggestedSearchQuery: { type: ['string', 'null'], description: 'Recall-oriented prior-art search query built from the disclosure.' },
    inventionTypes: { type: 'array', items: { type: 'string' } },
    classificationHints: {
      type: 'object',
      properties: {
        cpc: { type: 'array', items: { type: 'string' } },
        ipc: { type: 'array', items: { type: 'string' } },
      },
    },
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}

const featureMappingSchema = {
  type: 'object',
  required: ['publicationNumber', 'coverage', 'featureFindings'],
  properties: {
    publicationNumber: { type: 'string' },
    title: { type: 'string' },
    coverage: {
      type: 'object',
      description: 'Count of features per evidence status.',
      properties: {
        present: { type: 'integer' },
        partial: { type: 'integer' },
        absent: { type: 'integer' },
        unknown: { type: 'integer' },
      },
    },
    featureFindings: {
      type: 'array',
      description: 'One finding per submitted feature, in the submitted order.',
      items: {
        type: 'object',
        required: ['feature', 'status'],
        properties: {
          feature: { type: 'string' },
          status: { type: 'string', enum: ['present', 'partial', 'absent', 'unknown'] },
          evidence: {
            type: ['object', 'null'],
            description: 'Verbatim quote from the patent record supporting present/partial statuses.',
            properties: {
              quote: { type: 'string' },
              field: { type: 'string', enum: ['title', 'abstract', 'claims'] },
            },
          },
          confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
          reason: { type: ['string', 'null'] },
        },
      },
    },
    evidenceBasis: {
      type: 'object',
      description: 'Which patent fields were available as evidence.',
      properties: {
        title: { type: 'boolean' },
        abstract: { type: 'boolean' },
        claims: { type: 'boolean' },
      },
    },
    qualityFlags: {
      type: 'object',
      properties: {
        lowEvidence: { type: 'boolean' },
        ambiguousAbstracts: { type: 'boolean' },
        languageMismatch: { type: 'boolean' },
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
      title: 'PatentNest Patent Intelligence API',
      version: '1.1.0',
      description:
        'Server-to-server patent intelligence over the Indian patent corpus: hybrid semantic search with a coverage manifest, publication lookup, AI invention-feature extraction, and element-wise feature-to-patent evidence mapping. AI agents can call the same tools through the MCP endpoint at POST /api/v1/mcp (streamable HTTP, same bearer API keys).',
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
                          coverage: coverageSchema,
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
      '/api/v1/analysis/features': {
        post: {
          operationId: 'extractInventionFeatures',
          summary: 'Extract invention features from a disclosure',
          description:
            'Runs the same AI normalization stage as the PatentNest novelty pipeline: atomic technical features with per-feature detail, novelty-focus candidates, a suggested prior-art search query, and CPC/IPC hints. This endpoint performs an LLM analysis and typically takes longer than search.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['description'],
                  properties: {
                    title: { type: 'string', maxLength: 300 },
                    description: { type: 'string', minLength: 40, maxLength: 20000 },
                  },
                },
                example: {
                  title: 'Solar-powered cold-chain container',
                  description:
                    'A shipping container with phase-change thermal storage panels charged by roof-mounted photovoltaic cells. A controller predicts door-opening events from a delivery schedule and pre-cools the buffer zone before each stop to hold the payload temperature within two degrees.',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Extracted invention features',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: featureExtractionSchema, meta: metaSchema } },
                },
              },
            },
            ...errorResponses(),
          },
        },
      },
      '/api/v1/analysis/feature-mapping': {
        post: {
          operationId: 'mapFeaturesToPatent',
          summary: 'Map invention features against one patent',
          description:
            'Element-wise novelty evidence: every submitted feature is classified as present, partial, absent, or unknown in the target patent, with verbatim quotes and the field they came from (title, abstract, or claims). This endpoint performs an LLM analysis and typically takes longer than search.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['features', 'publicationNumber'],
                  properties: {
                    features: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 12,
                      items: { type: 'string', minLength: 3, maxLength: 300 },
                    },
                    publicationNumber: { type: 'string' },
                  },
                },
                example: {
                  features: [
                    'phase-change thermal storage panel charged by photovoltaic cells',
                    'controller pre-cools a buffer zone based on predicted door-opening events',
                  ],
                  publicationNumber: 'IN20282005A',
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Element-wise evidence chart',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { data: featureMappingSchema, meta: metaSchema } },
                },
              },
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
      schemas: {
        Patent: patentSchema,
        Error: errorSchema,
        SearchCoverage: coverageSchema,
        FeatureExtraction: featureExtractionSchema,
        FeatureMapping: featureMappingSchema,
      },
    },
  }, { headers: { 'Cache-Control': 'public, max-age=300' } })
}
