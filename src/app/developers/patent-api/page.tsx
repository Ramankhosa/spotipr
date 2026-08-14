import type { Metadata } from 'next'
import Link from 'next/link'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'

export const metadata: Metadata = {
  title: 'Patent Intelligence API — Developer Documentation — PatentNest',
  description:
    'Complete reference for the PatentNest Patent Intelligence API v1.1: hybrid semantic search, patent lookup, AI feature extraction, element-wise novelty evidence mapping, and MCP tools for AI agents.',
}

const BASE = 'https://patentnest.ai'

function Code({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <code className={`rounded bg-[#f6f8fd] px-1.5 py-0.5 font-mono text-[13px] text-lamp-700 ${className}`}>
      {children}
    </code>
  )
}

function Endpoint({
  method,
  path,
  id,
  children,
}: {
  method: string
  path: string
  id: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="flex items-baseline gap-3">
        <span className="rounded bg-lamp-600 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
          {method}
        </span>
        <h3 className="font-mono text-[15px] font-semibold text-ai-graphite-900">{path}</h3>
      </div>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Pre({ children, label }: { children: string; label?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-paper-300">
      {label && (
        <div className="border-b border-paper-300 bg-[#f6f8fd] px-5 py-2 font-mono text-[10.5px] font-medium uppercase tracking-wider text-paper-500">
          {label}
        </div>
      )}
      <pre className="overflow-x-auto bg-white p-5 font-mono text-[12.5px] leading-[1.7] text-ai-graphite-800">
        <code>{children}</code>
      </pre>
    </div>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[72ch] text-[14.5px] leading-[1.65] text-paper-600">{children}</p>
}

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 pt-16 text-[22px] font-semibold tracking-[-0.018em] text-ai-graphite-900">
      {children}
    </h2>
  )
}

function Divider() {
  return <hr className="border-paper-300" />
}

const NAV = [
  { label: 'Authentication', href: '#authentication' },
  { label: 'Search patents', href: '#search' },
  { label: 'Patent lookup', href: '#lookup' },
  { label: 'Extract features', href: '#features' },
  { label: 'Feature mapping', href: '#mapping' },
  { label: 'MCP server', href: '#mcp' },
  { label: 'Rate limits', href: '#limits' },
  { label: 'Errors', href: '#errors' },
  { label: 'Data fields', href: '#data' },
  { label: 'Confidentiality', href: '#confidentiality' },
]

export default function PatentApiDeveloperPage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-14 sm:px-8 lg:pt-20">
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-12">
          {/* Sidebar nav */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <p className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-paper-500">
                On this page
              </p>
              <nav className="space-y-1.5">
                {NAV.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="block text-[13px] text-paper-600 transition-colors hover:text-lamp-600"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
              <div className="mt-6 border-t border-paper-300 pt-4">
                <Link
                  href="/api/v1/openapi.json"
                  className="text-[13px] font-medium text-lamp-600 hover:text-lamp-700"
                >
                  OpenAPI 3.1 spec &rarr;
                </Link>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <div className="min-w-0 space-y-10">
            {/* Header */}
            <header>
              <p className="mb-3 flex items-center gap-3 text-[11.5px] font-medium uppercase tracking-[0.16em] text-lamp-600">
                <span className="h-px w-7 bg-lamp-600/50" />
                Developer documentation
              </p>
              <h1 className="text-[clamp(28px,3.5vw,40px)] font-semibold leading-[1.1] tracking-[-0.026em]">
                Patent Intelligence API <span className="text-lamp-600">v1.1</span>
              </h1>
              <p className="mt-5 max-w-[62ch] text-[16px] leading-[1.62] text-paper-600">
                Hybrid semantic search, publication lookup, and AI novelty analysis over the
                Indian patent corpus. Four REST endpoints, one MCP server for AI agents, one API
                key format, one set of quotas.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/features/patent-api"
                  className="rounded-lg border border-paper-300 bg-white px-4 py-2 text-[13.5px] font-medium text-ai-graphite-800 transition-colors hover:border-paper-400"
                >
                  Product overview
                </Link>
                <Link
                  href="/api/v1/openapi.json"
                  className="rounded-lg border border-paper-300 bg-white px-4 py-2 text-[13.5px] font-medium text-ai-graphite-800 transition-colors hover:border-paper-400"
                >
                  OpenAPI 3.1 spec
                </Link>
                <Link
                  href="/contact"
                  className="rounded-lg bg-lamp-600 px-4 py-2 text-[13.5px] font-medium text-white transition-colors hover:bg-lamp-700"
                >
                  Request API access
                </Link>
              </div>
            </header>

            <Divider />

            {/* Base URL */}
            <div>
              <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-wider text-paper-500">
                Base URL
              </p>
              <Pre>{BASE}</Pre>
            </div>

            {/* Authentication */}
            <div>
              <H2 id="authentication">Authentication</H2>
              <div className="mt-4 space-y-4">
                <P>
                  All requests authenticate with a bearer token in the <Code>Authorization</Code> header.
                  API keys use the <Code>pn_live_</Code> prefix and are provisioned per client. Do not embed
                  keys in browser or mobile client code — this is a server-to-server API.
                </P>
                <Pre label="Header">{`Authorization: Bearer pn_live_your_key`}</Pre>
                <P>
                  A missing, invalid, revoked, or expired key returns <Code>401</Code> with
                  error code <Code>INVALID_API_KEY</Code> or <Code>API_KEY_REVOKED</Code>.
                  A suspended client returns <Code>403</Code> with <Code>CLIENT_SUSPENDED</Code>.
                </P>
              </div>
            </div>

            <Divider />

            {/* Search */}
            <Endpoint method="POST" path="/api/v1/patents/search" id="search">
              <P>
                Hybrid semantic and text search over the Indian patent corpus. Send a plain-English
                description and get ranked patent records with composite, semantic, and text relevance
                scores, matched fields, and a coverage manifest that declares what was searched.
              </P>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ai-graphite-900">Request body</p>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Field</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Type</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Required</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      <tr className="border-b border-paper-200">
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">query</td>
                        <td className="px-5 py-2.5 font-mono">string</td>
                        <td className="px-5 py-2.5">Yes</td>
                        <td className="px-5 py-2.5">Plain-English search query, 2–2,000 characters.</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">limit</td>
                        <td className="px-5 py-2.5 font-mono">integer</td>
                        <td className="px-5 py-2.5">No</td>
                        <td className="px-5 py-2.5">Maximum results, 1–50. Default: 20.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <Pre label="Example request">{`curl -X POST "${BASE}/api/v1/patents/search" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "battery thermal management for electric vehicles",
    "limit": 10
  }'`}</Pre>
              <Pre label="Example response (abbreviated)">{`{
  "data": {
    "query": "battery thermal management for electric vehicles",
    "count": 10,
    "results": [
      {
        "publicationNumber": "IN202211045678A",
        "applicationNumber": "202211045678",
        "kind": "A",
        "country": "IN",
        "title": "THERMAL MANAGEMENT SYSTEM FOR ELECTRIC VEHICLE BATTERY PACK",
        "abstract": "A battery thermal management system comprising...",
        "applicants": [
          { "name": "XYZ Technologies Pvt Ltd", "address": "Bengaluru, India", "sequence": 1 }
        ],
        "inventors": ["Rajesh Kumar", "Priya Sharma"],
        "classifications": ["H01M10/613", "H01M10/6568"],
        "filingDate": "2022-08-15",
        "publicationDate": "2023-02-17",
        "numberOfPages": 24,
        "numberOfClaims": 12,
        "extractionConfidence": 0.95,
        "source": {
          "name": "IP India Patent Journal",
          "document": "patent_journal_07_2023.pdf",
          "page": 142
        },
        "relevance": {
          "score": 0.87,
          "semanticScore": 0.91,
          "textScore": 0.72,
          "matchedFields": ["title", "abstract"]
        }
      }
    ],
    "coverage": {
      "corpus": "indian-patent-journal",
      "description": "Indian patent corpus sourced from IP India Patent Journal publications.",
      "jurisdiction": "IN",
      "documents": 163420,
      "semanticCoveragePercent": 99.4,
      "searchMode": "hybrid-semantic-text",
      "embeddingModel": "text-embedding-3-small"
    }
  },
  "meta": { "requestId": "a1b2c3d4-e5f6-7890", "durationMs": 1240 }
}`}</Pre>
              <P>
                The <Code>coverage</Code> object appears in every search response. It tells
                you exactly what was searched — corpus, jurisdiction, document count, semantic
                coverage percentage, and the embedding model. When coverage changes, your
                integration sees it without polling.
              </P>
            </Endpoint>

            <Divider />

            {/* Lookup */}
            <Endpoint method="GET" path="/api/v1/patents/{'{publicationNumber}'}" id="lookup">
              <P>
                Fetch a single Indian patent record by publication number. Case and separators
                are normalized automatically — <Code>IN/2028/2005/A</Code>, <Code>in20282005a</Code>,
                and <Code>IN-2028-2005-A</Code> all resolve to the same document.
              </P>
              <Pre label="Example request">{`curl "${BASE}/api/v1/patents/IN202211045678A" \\
  -H "Authorization: Bearer pn_live_your_key"`}</Pre>
              <Pre label="Example response (abbreviated)">{`{
  "data": {
    "publicationNumber": "IN202211045678A",
    "applicationNumber": "202211045678",
    "kind": "A",
    "country": "IN",
    "title": "THERMAL MANAGEMENT SYSTEM FOR ELECTRIC VEHICLE BATTERY PACK",
    "abstract": "A battery thermal management system comprising...",
    "applicants": [
      { "name": "XYZ Technologies Pvt Ltd", "address": "Bengaluru, India", "sequence": 1 }
    ],
    "inventors": ["Rajesh Kumar", "Priya Sharma"],
    "classifications": ["H01M10/613", "H01M10/6568"],
    "filingDate": "2022-08-15",
    "publicationDate": "2023-02-17",
    "numberOfPages": 24,
    "numberOfClaims": 12,
    "extractionConfidence": 0.95,
    "source": {
      "name": "IP India Patent Journal",
      "document": "patent_journal_07_2023.pdf",
      "page": 142
    }
  },
  "meta": { "requestId": "b2c3d4e5-f6a7-8901", "durationMs": 48 }
}`}</Pre>
              <P>
                Returns <Code>404</Code> with error code <Code>PATENT_NOT_FOUND</Code> if the
                number does not match any Indian patent in the corpus.
              </P>
            </Endpoint>

            <Divider />

            {/* Feature extraction */}
            <Endpoint method="POST" path="/api/v1/analysis/features" id="features">
              <P>
                AI analysis of a plain-English invention disclosure. Runs the same normalization
                stage as the PatentNest novelty pipeline and returns atomic technical features
                with per-feature detail, novelty-focus candidates, a search query built for
                patent retrieval, CPC/IPC classification hints, and confidence values.
              </P>
              <P>
                This endpoint performs a full LLM analysis and typically responds in 10–30 seconds.
                Plan client timeouts accordingly. It draws on a separate daily analysis budget
                (see <a href="#limits" className="text-lamp-600 hover:text-lamp-700">Rate limits</a>).
              </P>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ai-graphite-900">Request body</p>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Field</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Type</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Required</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      <tr className="border-b border-paper-200">
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">title</td>
                        <td className="px-5 py-2.5 font-mono">string</td>
                        <td className="px-5 py-2.5">No</td>
                        <td className="px-5 py-2.5">Invention title, up to 300 characters.</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">description</td>
                        <td className="px-5 py-2.5 font-mono">string</td>
                        <td className="px-5 py-2.5">Yes</td>
                        <td className="px-5 py-2.5">Plain-English disclosure, 40–20,000 characters.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <Pre label="Example request">{`curl -X POST "${BASE}/api/v1/analysis/features" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Solar-powered cold-chain container",
    "description": "A shipping container with phase-change thermal storage panels charged by roof-mounted photovoltaic cells. A controller predicts door-opening events from a delivery schedule and pre-cools the buffer zone before each stop to hold the payload temperature within two degrees."
  }'`}</Pre>
              <Pre label="Example response (abbreviated)">{`{
  "data": {
    "features": [
      "phase-change thermal storage panels in a shipping container",
      "roof-mounted photovoltaic cells charging thermal storage",
      "controller that predicts door-opening events from delivery schedule",
      "pre-cooling of a buffer zone before each scheduled stop",
      "maintaining payload temperature within two-degree tolerance"
    ],
    "featureDetails": [
      {
        "feature": "phase-change thermal storage panels in a shipping container",
        "featureType": "core_technical",
        "disclosureSupport": "Directly stated: 'phase-change thermal storage panels'",
        "technicalRole": "Primary energy storage mechanism for cold-chain maintenance",
        "sourceExcerpt": "A shipping container with phase-change thermal storage panels",
        "confidence": 0.95
      }
    ],
    "noveltyFocus": [
      "controller that predicts door-opening events from delivery schedule",
      "pre-cooling of a buffer zone before each scheduled stop"
    ],
    "suggestedSearchQuery": "solar powered cold chain container phase change thermal storage photovoltaic predictive pre-cooling delivery schedule",
    "inventionTypes": ["apparatus", "system"],
    "classificationHints": {
      "cpc": ["F25D11/003", "B65D88/748", "H02S40/44"],
      "ipc": ["F25D11/00", "B65D88/74", "H02S40/44"]
    },
    "confidence": 0.88,
    "warnings": []
  },
  "meta": { "requestId": "c3d4e5f6-a7b8-9012", "durationMs": 14320 }
}`}</Pre>
              <P>
                <strong>Feature types:</strong> <Code>core_technical</Code> (the technical
                mechanism), <Code>novelty_candidate</Code> (most likely to distinguish over
                prior art), <Code>implementation</Code> (how it is built), <Code>generic_weak</Code> (too
                broad to be distinctive). Use feature type and confidence to decide which features
                are worth mapping against prior art.
              </P>
              <P>
                <strong>Suggested search query:</strong> retrieval-optimized phrasing built from
                the disclosure. Use it as the <Code>query</Code> parameter in the search endpoint.
                You can also use your own query — the suggestion is a strong starting point, not
                mandatory.
              </P>
            </Endpoint>

            <Divider />

            {/* Feature mapping */}
            <Endpoint method="POST" path="/api/v1/analysis/feature-mapping" id="mapping">
              <P>
                Element-wise novelty evidence. Each submitted feature is classified
                as <Code>present</Code>, <Code>partial</Code>, <Code>absent</Code>,
                or <Code>unknown</Code> against one patent record, with a verbatim quote and
                the field it came from (title, abstract, or claims).
              </P>
              <P>
                Typical flow: extract features &rarr; search with the suggested query &rarr; map
                features against shortlisted publication numbers. This is the endpoint that
                produces the actual evidence for a novelty assessment.
              </P>
              <div>
                <p className="mb-2 text-[13px] font-medium text-ai-graphite-900">Request body</p>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Field</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Type</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Required</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      <tr className="border-b border-paper-200">
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">features</td>
                        <td className="px-5 py-2.5 font-mono">string[]</td>
                        <td className="px-5 py-2.5">Yes</td>
                        <td className="px-5 py-2.5">1–12 features, each 3–300 characters.</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">publicationNumber</td>
                        <td className="px-5 py-2.5 font-mono">string</td>
                        <td className="px-5 py-2.5">Yes</td>
                        <td className="px-5 py-2.5">Publication number of the patent to map against.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <Pre label="Example request">{`curl -X POST "${BASE}/api/v1/analysis/feature-mapping" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "features": [
      "phase-change thermal storage panels in a shipping container",
      "roof-mounted photovoltaic cells charging thermal storage",
      "controller that predicts door-opening events from delivery schedule"
    ],
    "publicationNumber": "IN202211045678A"
  }'`}</Pre>
              <Pre label="Example response (abbreviated)">{`{
  "data": {
    "publicationNumber": "IN202211045678A",
    "title": "THERMAL MANAGEMENT SYSTEM FOR ELECTRIC VEHICLE BATTERY PACK",
    "coverage": { "present": 1, "partial": 1, "absent": 1, "unknown": 0 },
    "featureFindings": [
      {
        "feature": "phase-change thermal storage panels in a shipping container",
        "status": "present",
        "evidence": {
          "quote": "a phase-change material encapsulated within thermally conductive panels arranged along the interior walls of the container",
          "field": "claims"
        },
        "confidence": 0.92,
        "reason": "Claim 1 describes phase-change thermal storage panels within a container structure."
      },
      {
        "feature": "roof-mounted photovoltaic cells charging thermal storage",
        "status": "partial",
        "evidence": {
          "quote": "an external energy source connected to the thermal regulation circuit",
          "field": "abstract"
        },
        "confidence": 0.65,
        "reason": "The patent mentions an external energy source but does not specify photovoltaic cells or roof mounting."
      },
      {
        "feature": "controller that predicts door-opening events from delivery schedule",
        "status": "absent",
        "evidence": null,
        "confidence": 0.88,
        "reason": "No mention of predictive control, door-opening events, or delivery schedule integration."
      }
    ],
    "evidenceBasis": { "title": true, "abstract": true, "claims": true },
    "qualityFlags": {
      "lowEvidence": false,
      "ambiguousAbstracts": false,
      "languageMismatch": false
    }
  },
  "meta": { "requestId": "d4e5f6a7-b8c9-0123", "durationMs": 18540 }
}`}</Pre>
              <P>
                <strong>Evidence statuses:</strong> <Code>present</Code> means the feature
                is disclosed with a direct, attributable quote. <Code>partial</Code> means
                some elements match but others are missing or differ. <Code>absent</Code> means
                no evidence for the feature was found. <Code>unknown</Code> means the available
                text is insufficient to make a determination — treat it as an absence of evidence,
                not evidence of absence.
              </P>
              <P>
                <strong>Quality flags:</strong> <Code>lowEvidence</Code> fires when fewer than
                two text fields were available. <Code>ambiguousAbstracts</Code> flags when the
                abstract is too vague to support reliable mapping. <Code>languageMismatch</Code> flags
                when the patent text and features appear to be in different languages.
              </P>
            </Endpoint>

            <Divider />

            {/* MCP */}
            <div>
              <H2 id="mcp">MCP server for AI agents</H2>
              <div className="mt-4 space-y-4">
                <P>
                  <Code>POST /api/v1/mcp</Code> is a Model Context Protocol endpoint (streamable
                  HTTP transport, JSON responses) exposing the same four operations as
                  tools: <Code>search_patents</Code>, <Code>get_patent</Code>, <Code>extract_invention_features</Code>,
                  and <Code>map_features_to_patent</Code>. Tool calls use the same bearer API keys
                  and count against the same quotas as REST requests.
                </P>
                <P>
                  Compatible with Claude Desktop, Claude Code, Cursor, Windsurf, and any
                  MCP-compatible client. Add this to your MCP configuration:
                </P>
                <Pre label="MCP configuration (Claude Desktop / Claude Code)">{`{
  "mcpServers": {
    "patentnest": {
      "type": "http",
      "url": "${BASE}/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer pn_live_your_key"
      }
    }
  }
}`}</Pre>
                <P>
                  The server supports protocol versions <Code>2025-06-18</Code>, <Code>2025-03-26</Code>,
                  and <Code>2024-11-05</Code>. Sessions are stateless. <Code>tools/list</Code> returns
                  the tool definitions with full JSON Schema input specifications.
                </P>
                <p className="text-[13px] font-medium text-ai-graphite-900">Available tools</p>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Tool</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      <tr className="border-b border-paper-200">
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">search_patents</td>
                        <td className="px-5 py-2.5">Hybrid semantic + text search. Same as POST /api/v1/patents/search.</td>
                      </tr>
                      <tr className="border-b border-paper-200">
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">get_patent</td>
                        <td className="px-5 py-2.5">Fetch one patent by publication number. Same as GET /api/v1/patents/&#123;publicationNumber&#125;.</td>
                      </tr>
                      <tr className="border-b border-paper-200">
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">extract_invention_features</td>
                        <td className="px-5 py-2.5">AI feature extraction from a disclosure. Same as POST /api/v1/analysis/features.</td>
                      </tr>
                      <tr>
                        <td className="px-5 py-2.5 font-mono text-ai-graphite-800">map_features_to_patent</td>
                        <td className="px-5 py-2.5">Element-wise evidence mapping. Same as POST /api/v1/analysis/feature-mapping.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <P>
                  <strong>Suggested agent workflow:</strong> call <Code>extract_invention_features</Code> on
                  a disclosure, use the <Code>suggestedSearchQuery</Code> with <Code>search_patents</Code>,
                  then call <Code>map_features_to_patent</Code> against shortlisted publication numbers.
                  All quotes are verbatim from the patent record; treat <Code>unknown</Code> statuses as
                  insufficient evidence, not as proof of novelty.
                </P>
              </div>
            </div>

            <Divider />

            {/* Rate limits */}
            <div>
              <H2 id="limits">Rate limits and quotas</H2>
              <div className="mt-4 space-y-4">
                <P>
                  Every response includes rate-limit headers. Exceeding any limit
                  returns <Code>429</Code> with a <Code>Retry-After</Code> header (seconds).
                </P>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Header</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      {([
                        ['RateLimit-Limit', 'Per-minute request limit.'],
                        ['RateLimit-Remaining', 'Requests remaining in the current minute.'],
                        ['RateLimit-Reset', 'Unix timestamp when the minute window resets.'],
                        ['X-RateLimit-Daily-Limit', 'Daily request limit.'],
                        ['X-RateLimit-Daily-Remaining', 'Requests remaining today (UTC).'],
                        ['X-RateLimit-Monthly-Limit', 'Monthly request limit.'],
                        ['X-RateLimit-Monthly-Remaining', 'Requests remaining this month (UTC).'],
                        ['X-RateLimit-Analysis-Limit', 'Daily AI analysis credit limit (analysis endpoints only).'],
                        ['X-RateLimit-Analysis-Remaining', 'Analysis credits remaining today.'],
                        ['X-Request-ID', 'Unique request identifier. Include in support requests.'],
                      ] as const).map(([header, desc], i, arr) => (
                        <tr key={header} className={i < arr.length - 1 ? 'border-b border-paper-200' : ''}>
                          <td className="whitespace-nowrap px-5 py-2.5 font-mono text-ai-graphite-800">{header}</td>
                          <td className="px-5 py-2.5">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <P>
                  The two <Code>/api/v1/analysis</Code> endpoints draw on a <strong>separate</strong> daily
                  analysis budget. An analysis credit is charged only when a validated request reaches the
                  model, so requests rejected with <Code>400</Code> or <Code>404</Code> never cost a credit.
                  When the analysis budget is exhausted, these endpoints return <Code>429</Code> with
                  error code <Code>ANALYSIS_QUOTA_EXCEEDED</Code>; search and lookup remain available.
                </P>
                <P>
                  Default limits are per client. Contact us if you need higher throughput — limits are
                  configurable per client.
                </P>
              </div>
            </div>

            <Divider />

            {/* Errors */}
            <div>
              <H2 id="errors">Error responses</H2>
              <div className="mt-4 space-y-4">
                <P>
                  All errors return a JSON body with a stable <Code>code</Code>, a
                  human-readable <Code>message</Code>, and a <Code>requestId</Code>. Use the
                  code for programmatic handling; the message may change between versions.
                </P>
                <Pre label="Error response format">{`{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "query must contain between 2 and 2,000 characters.",
    "requestId": "a1b2c3d4-e5f6-7890"
  }
}`}</Pre>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">HTTP</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Code</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      {([
                        ['400', 'INVALID_REQUEST', 'Missing or invalid request parameters.'],
                        ['401', 'INVALID_API_KEY', 'Missing, malformed, or unrecognized API key.'],
                        ['401', 'API_KEY_REVOKED', 'The API key has been revoked.'],
                        ['401', 'API_KEY_EXPIRED', 'The API key has expired.'],
                        ['403', 'CLIENT_SUSPENDED', 'The API client account is suspended.'],
                        ['404', 'PATENT_NOT_FOUND', 'No patent matched the publication number.'],
                        ['404', 'UNKNOWN_TOOL', 'MCP tool name not recognized.'],
                        ['413', 'PAYLOAD_TOO_LARGE', 'Request body exceeds 256 KB.'],
                        ['429', 'RATE_LIMIT_EXCEEDED', 'Per-minute request limit exceeded.'],
                        ['429', 'DAILY_LIMIT_EXCEEDED', 'Daily request limit exceeded.'],
                        ['429', 'MONTHLY_LIMIT_EXCEEDED', 'Monthly request limit exceeded.'],
                        ['429', 'ANALYSIS_QUOTA_EXCEEDED', 'Daily AI analysis credit limit exceeded.'],
                        ['503', 'SERVICE_UNAVAILABLE', 'The patent API is not currently enabled.'],
                        ['503', 'SEMANTIC_SEARCH_UNAVAILABLE', 'Vector search or embedding service is down.'],
                        ['503', 'CORPUS_NOT_READY', 'Embedding coverage below minimum threshold.'],
                        ['503', 'ANALYSIS_UNAVAILABLE', 'AI analysis endpoints are not enabled.'],
                        ['500', 'INTERNAL_ERROR', 'Unexpected server error. Include requestId in support requests.'],
                      ] as const).map(([http, code, desc], i, arr) => (
                        <tr key={`${http}-${code}`} className={i < arr.length - 1 ? 'border-b border-paper-200' : ''}>
                          <td className="px-5 py-2.5 font-mono text-ai-graphite-800">{http}</td>
                          <td className="whitespace-nowrap px-5 py-2.5 font-mono text-lamp-700">{code}</td>
                          <td className="px-5 py-2.5">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <Divider />

            {/* Data fields */}
            <div>
              <H2 id="data">Patent record fields</H2>
              <div className="mt-4 space-y-4">
                <P>
                  Every patent record — whether from search results or a direct lookup — contains
                  the following fields. Search results additionally include a <Code>relevance</Code> object.
                </P>
                <div className="overflow-x-auto rounded-xl border border-paper-300 bg-white">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-paper-300 bg-[#f6f8fd]">
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Field</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Type</th>
                        <th className="px-5 py-2.5 text-left font-mono text-[11px] font-medium text-paper-500">Description</th>
                      </tr>
                    </thead>
                    <tbody className="text-paper-600">
                      {([
                        ['publicationNumber', 'string', 'Canonical publication number (e.g. IN202211045678A).'],
                        ['applicationNumber', 'string | null', 'Raw application number as filed.'],
                        ['kind', 'string | null', 'Kind code (A, B, etc.).'],
                        ['country', 'string', 'Two-letter country code (IN for Indian patents).'],
                        ['title', 'string', 'Full patent title.'],
                        ['abstract', 'string | null', 'Patent abstract text.'],
                        ['applicants', 'object[]', 'Array of { name, address, sequence }.'],
                        ['inventors', 'string[]', 'Inventor names as published.'],
                        ['classifications', 'string[]', 'IPC and CPC classification codes.'],
                        ['filingDate', 'string | null', 'ISO 8601 date (YYYY-MM-DD), where available.'],
                        ['publicationDate', 'string | null', 'ISO 8601 publication date.'],
                        ['numberOfPages', 'integer | null', 'Page count of the patent document.'],
                        ['numberOfClaims', 'integer | null', 'Number of claims.'],
                        ['extractionConfidence', 'number | null', 'Machine extraction confidence score (0–1).'],
                        ['source.name', 'string', 'Source corpus name.'],
                        ['source.document', 'string | null', 'Original Journal PDF filename.'],
                        ['source.page', 'integer | null', 'Page number in the source PDF.'],
                        ['relevance.score', 'number | null', 'Composite relevance score (search only).'],
                        ['relevance.semanticScore', 'number | null', 'Semantic similarity score (search only).'],
                        ['relevance.textScore', 'number | null', 'Text match score (search only).'],
                        ['relevance.matchedFields', 'string[]', 'Fields that contributed to the match (search only).'],
                      ] as const).map(([field, type, desc], i, arr) => (
                        <tr key={field} className={i < arr.length - 1 ? 'border-b border-paper-200' : ''}>
                          <td className="whitespace-nowrap px-5 py-2.5 font-mono text-ai-graphite-800">{field}</td>
                          <td className="whitespace-nowrap px-5 py-2.5 font-mono">{type}</td>
                          <td className="px-5 py-2.5">{desc}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <Divider />

            {/* Confidentiality */}
            <div>
              <H2 id="confidentiality">Confidentiality</H2>
              <div className="mt-4 space-y-4">
                <P>
                  Submitted invention disclosures are processed to produce the API response and
                  are not retained or used to train models. Request logs store request metadata
                  (endpoint, status code, duration, query hashes) — never the disclosure text.
                  Request bodies are capped at 256 KB.
                </P>
                <P>
                  API keys should be treated as secrets. Rotate keys if compromised — contact us
                  or use the admin panel to revoke and reissue.
                </P>
              </div>
            </div>

            <Divider />

            {/* Quick start */}
            <div className="rounded-2xl border border-lamp-200 bg-lamp-50 p-6 sm:p-8">
              <h2 className="text-[18px] font-semibold text-lamp-800">Quick start</h2>
              <ol className="mt-4 list-inside list-decimal space-y-2 text-[14px] leading-[1.6] text-lamp-900">
                <li><Link href="/contact" className="font-medium text-lamp-600 hover:text-lamp-700">Request API access</Link> — we&apos;ll provision a client and send your key.</li>
                <li>Call <Code className="bg-lamp-100">POST /api/v1/analysis/features</Code> with your invention disclosure.</li>
                <li>Use the <Code className="bg-lamp-100">suggestedSearchQuery</Code> to call <Code className="bg-lamp-100">POST /api/v1/patents/search</Code>.</li>
                <li>Call <Code className="bg-lamp-100">POST /api/v1/analysis/feature-mapping</Code> for each shortlisted patent.</li>
                <li>Read the evidence: status, verbatim quote, source field, confidence.</li>
              </ol>
              <p className="mt-4 text-[13px] text-lamp-700">
                The <Link href="/api/v1/openapi.json" className="font-medium text-lamp-600 hover:text-lamp-700">OpenAPI 3.1 spec</Link> can
                be imported into Postman, Swagger UI, or any code generator to scaffold client code automatically.
              </p>
            </div>
          </div>
        </div>
      </main>
      <WorkspaceFooter />
    </div>
  )
}
