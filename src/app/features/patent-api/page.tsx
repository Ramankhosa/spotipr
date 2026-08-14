import type { Metadata } from 'next'
import Link from 'next/link'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'
import Reveal from '@/components/home-v2/Reveal'
import { ClosingAsk, Chip, DefGrid, FeatureHero, Panel, Section, StageRail } from '@/components/features/kit'

export const metadata: Metadata = {
  title: 'Patent Intelligence API — PatentNest',
  description:
    'Programmatic access to patent corpus search, AI feature extraction, and element-wise novelty evidence mapping. REST endpoints and MCP tools for AI agents. Starting with full Indian patent coverage — more jurisdictions ahead.',
}

// Every endpoint, field, error code, and limit on this page is sourced from
// the implementation and the OpenAPI spec, not invented for marketing:
//   public API + search             src/lib/patent-public-api.ts
//   auth, keys, quotas              src/lib/patent-api-auth.ts
//   analysis endpoints              src/lib/patent-api-analysis.ts
//   MCP tool definitions            src/app/api/v1/mcp/route.ts
//   route wiring                    src/lib/patent-api-route.ts
//   OpenAPI spec                    src/app/api/v1/openapi.json/route.ts

const WORKFLOW = [
  {
    code: 'extract',
    label: 'Describe the invention in plain English',
    copy: 'Send a disclosure (40–20,000 characters) to the feature extraction endpoint. It runs the same AI normalization stage as the full PatentNest novelty pipeline — atomic technical features, novelty-focus candidates, a ready-to-use prior-art search query, and CPC/IPC classification hints. No patent vocabulary required from your side.',
  },
  {
    code: 'search',
    label: 'Search the corpus with the suggested query',
    copy: 'Use the AI-suggested query — or write your own — to run hybrid semantic and full-text search across the patent corpus. Results come back ranked with composite, semantic, and text relevance scores. Every response includes a coverage manifest: corpus, jurisdiction, document count, and the share that is semantically indexed. A negative result is a measured signal, not a guess.',
  },
  {
    code: 'map',
    label: 'Map features against shortlisted patents',
    copy: 'For each shortlisted result, submit the features and the publication number. Each feature is classified as present, partial, absent, or unknown — with a verbatim quote from the patent text and the field it was found in (title, abstract, or claims). You get the evidence, not a summary of it.',
  },
]

const ENDPOINTS = [
  {
    term: 'Semantic patent search',
    code: 'POST /api/v1/patents/search',
    copy: 'Hybrid semantic and full-text search across the patent corpus. Send a plain-English technical description (2–2,000 chars), get up to 50 ranked patent records with relevance scoring and a coverage manifest that declares what was searched.',
    tone: 'info',
  },
  {
    term: 'Patent record lookup',
    code: 'GET /api/v1/patents/{publicationNumber}',
    copy: 'Retrieve a single structured patent record by publication number. Case and separators are normalized automatically — any reasonable formatting resolves to the same canonical record.',
    tone: 'info',
  },
  {
    term: 'AI feature extraction',
    code: 'POST /api/v1/analysis/features',
    copy: 'AI analysis of a plain-English invention disclosure. Returns atomic technical features with per-feature confidence and type classification, novelty-focus candidates, a retrieval-optimized search query, and CPC/IPC classification hints.',
    tone: 'info',
  },
  {
    term: 'Element-wise evidence mapping',
    code: 'POST /api/v1/analysis/feature-mapping',
    copy: 'Classifies each submitted feature (1–12) as present, partial, absent, or unknown against one patent record — with a verbatim quote and the field it was sourced from. Returns quality flags for low evidence, ambiguous abstracts, and language mismatch.',
    tone: 'info',
  },
]

const USE_CASES = [
  {
    term: 'Patent landscape analytics',
    copy: 'Build technology maps, monitor competitive filings, and track assignee activity across the Indian patent jurisdiction — programmatically, on your own schedule.',
  },
  {
    term: 'Prior art screening',
    copy: 'Integrate prior-art screening into your invention intake workflow. Submit disclosures, get structured features and ranked prior art — before a human analyst touches the case.',
  },
  {
    term: 'IP due diligence',
    copy: 'Feed feature-level evidence into M&A, licensing, and freedom-to-operate workflows. Every verdict carries a verbatim quote and source field — ready for citation.',
  },
  {
    term: 'Novelty assessment automation',
    copy: 'Run the full extract → search → map pipeline from code. Build element-wise novelty matrices that compare each invention feature against multiple prior-art references.',
  },
  {
    term: 'AI agent workflows',
    copy: 'Connect Claude, Cursor, or your own agent stack via MCP. Agents autonomously research prior art, evaluate patentability, or generate structured reports — with the same data and quotas as REST.',
  },
  {
    term: 'Legal tech platforms',
    copy: 'Embed patent intelligence into case management, prosecution tracking, or filing systems. Structured JSON responses with stable schemas, versioned endpoints, and predictable rate-limit headers.',
  },
]

const RECORD_FIELDS = [
  {
    term: 'Publication & application numbers',
    copy: 'Canonical publication number, raw application number, country code, and kind code. Normalized and deduplicated across journal issues.',
  },
  {
    term: 'Title, abstract, and full text',
    copy: 'Complete title and abstract as published. Full claims text available for AI analysis endpoints (feature mapping evidence is quoted verbatim from it).',
  },
  {
    term: 'Structured applicants',
    copy: 'Array of applicant objects — name, address, and sequence number. Not a concatenated string. Ready for assignee landscape analysis.',
  },
  {
    term: 'Inventors and classifications',
    copy: 'Inventor list as published. IPC and CPC classification codes for technology landscape mapping, trend analysis, and cross-jurisdiction comparison.',
  },
  {
    term: 'Filing and publication dates',
    copy: 'ISO 8601 dates. Build prosecution timelines, calculate pendency, filter by filing window, or track publication velocity.',
  },
  {
    term: 'Extraction confidence and source provenance',
    copy: 'Machine-readable confidence score on data extraction quality. Every record carries the original source document name and page number — full audit trail to the government publication.',
  },
  {
    term: 'Relevance scoring (search)',
    copy: 'Composite score, separate semantic and text-match scores, and the list of fields that contributed to the match. The ranking is transparent about why each result placed where it did.',
  },
  {
    term: 'Coverage manifest (search)',
    copy: 'Corpus name, jurisdiction, total document count, semantic coverage percentage, search mode, and embedding model. Returned with every search so your integration always knows what was searched.',
  },
]

export default function PatentApiFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <FeatureHero
          kicker="Patent Intelligence API"
          title="Patent data infrastructure"
          accent="for builders."
          lede="Programmatic access to the same AI-powered patent intelligence that drives PatentNest — hybrid semantic search, AI feature extraction, and element-wise novelty evidence mapping. REST endpoints and MCP tools, authenticated with one API key, metered with transparent quotas. Starting with comprehensive Indian patent coverage, with additional jurisdictions on the roadmap."
          specs={[
            { label: 'Coverage', value: '160,000+ Indian patents' },
            { label: 'Search', value: 'Hybrid semantic + full-text' },
            { label: 'AI analysis', value: 'Feature extraction & evidence mapping' },
            { label: 'Protocols', value: 'REST + MCP for AI agents' },
          ]}
        >
          <Reveal delay={0.1}>
            <div className="mt-14 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Panel title="Search coverage manifest" meta="returned with every query">
                <div className="space-y-2 text-[11.5px]">
                  {[
                    ['Corpus', 'indian-patent-journal'],
                    ['Jurisdiction', 'IN'],
                    ['Documents indexed', '160,000+'],
                    ['Semantic coverage', '99%+'],
                    ['Search mode', 'hybrid-semantic-text'],
                    ['Embedding model', 'text-embedding-3-small'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="text-ai-graphite-700">{label}</span>
                      <span className="font-mono text-[10px] text-paper-500">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Every search response includes this manifest. When the corpus grows or a new
                  jurisdiction comes online, your integration sees the change in the response —
                  no polling, no changelog to watch.
                </p>
              </Panel>

              <Panel title="Element-wise evidence verdict" meta="per feature × per patent">
                <div className="space-y-2 text-[11.5px]">
                  {([
                    ['Phase-change thermal storage panel', 'present', 'good'],
                    ['Photovoltaic charging of storage', 'partial', 'warn'],
                    ['Predictive pre-cooling controller', 'absent', 'bad'],
                    ['Door-opening schedule integration', 'unknown', 'mute'],
                  ] as const).map(([label, status, tone]) => (
                    <div key={label} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ai-graphite-700">{label}</span>
                      <Chip tone={tone}>{status}</Chip>
                    </div>
                  ))}
                </div>
                <p className="mt-4 border-t border-paper-300 pt-3 text-[12px] leading-[1.6] text-paper-600">
                  Each verdict carries a verbatim quote and the field it was found in.
                  An &ldquo;unknown&rdquo; means insufficient evidence in the available text — not
                  &ldquo;probably novel&rdquo;. Quality flags report when the evidence basis is thin.
                </p>
              </Panel>
            </div>
          </Reveal>
        </FeatureHero>

        <Section
          kicker="Use cases"
          title="What people build on top of it."
          lede="The API is used by legal tech platforms, IP analytics tools, R&D workflow automation, and AI agents that need patent intelligence as a building block — not a destination."
        >
          <Reveal delay={0.08}>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {USE_CASES.map((item) => (
                <Panel key={item.term} title={item.term}>
                  <p className="text-[13.5px] leading-[1.6] text-paper-600">{item.copy}</p>
                </Panel>
              ))}
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Workflow"
          title="Three calls. Disclosure in, evidence matrix out."
          lede="The API is designed around how novelty analysis actually works: decompose the invention, find what exists, then build an element-wise evidence chart. Each call produces structured output that feeds directly into the next — no reformatting, no copy-paste between tools."
        >
          <Reveal delay={0.08}>
            <StageRail stages={WORKFLOW} />
          </Reveal>
        </Section>

        <Section
          kicker="Endpoints"
          title="Four endpoints. No SDK required."
          lede="Standard REST with JSON request/response and bearer auth. Every endpoint returns structured data with a request ID, duration, and rate-limit headers. Errors use stable, machine-readable codes. Import the OpenAPI 3.1 spec into Postman, Swagger UI, or any code generator."
        >
          <DefGrid items={ENDPOINTS} />
        </Section>

        <Section
          kicker="Data"
          title="Structured records, not summaries."
          lede="Every patent record includes applicants as arrays with addresses, dates in ISO 8601, scores decomposed into semantic and text components, classification codes for landscape analysis, and source provenance back to the original government publication."
        >
          <DefGrid items={RECORD_FIELDS} />
        </Section>

        <Section
          kicker="AI agents"
          title="Native MCP support for the agent era."
          lede="POST /api/v1/mcp exposes all four operations as MCP tools over streamable HTTP. Same bearer keys, same quotas, same structured data — but now Claude, Cursor, or your own agent stack calls them directly without glue code. Sessions are stateless. Protocol versions 2025-06-18, 2025-03-26, and 2024-11-05 are supported."
        >
          <Reveal delay={0.08}>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {([
                ['Claude Desktop and Claude Code', 'Add the MCP config to your Claude settings. Four patent tools appear alongside your other tools. Your agent searches prior art, extracts features, and builds evidence charts in a single conversation.'],
                ['Cursor, Windsurf, and AI IDEs', 'Any IDE that speaks MCP can connect. Patent intelligence becomes part of a coding or research workflow without leaving the editor.'],
                ['Custom agent platforms', 'Standard JSON-RPC over streamable HTTP. Build agents that autonomously screen invention disclosures, monitor competitive filings, or generate prior-art reports.'],
                ['REST for everything else', 'No agent framework needed. Standard HTTP in any language. The MCP transport is there for tools that speak it — everyone else uses the four REST endpoints.'],
              ] as const).map(([title, copy]) => (
                <Panel key={title} title={title}>
                  <p className="text-[13.5px] leading-[1.6] text-paper-600">{copy}</p>
                </Panel>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <Panel className="mt-4" title="MCP server configuration">
              <pre className="overflow-x-auto rounded-lg bg-[#f6f8fd] p-4 font-mono text-[12.5px] leading-[1.7] text-ai-graphite-700">
{`{
  "mcpServers": {
    "patentnest": {
      "type": "http",
      "url": "https://patentnest.ai/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer pn_live_your_key"
      }
    }
  }
}`}
              </pre>
            </Panel>
          </Reveal>
        </Section>

        <Section
          kicker="Trust and limits"
          title="Transparent metering. Your disclosures stay yours."
          lede="Rate limits are per-minute, daily, and monthly — all returned in every response header. AI analysis has a separate daily budget. Rejected requests never consume a credit. Submitted invention disclosures are processed and forgotten — never stored as text, never used for training."
        >
          <Reveal delay={0.08}>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <Panel title="Request quotas">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  Per-minute, daily, and monthly budgets per client. Headers on every
                  response: RateLimit-Limit, RateLimit-Remaining, X-RateLimit-Daily-Remaining,
                  X-RateLimit-Monthly-Remaining. HTTP 429 includes Retry-After.
                </p>
              </Panel>
              <Panel title="Analysis budget">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  The two AI analysis endpoints run full LLM inference — they have their own daily
                  credit pool. A credit is charged only after validation passes and the model starts.
                  A 400 or 404 costs nothing.
                </p>
              </Panel>
              <Panel title="Data confidentiality">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  Submitted disclosures produce the response, then are not retained. Request logs
                  store hashes and metadata, never invention text. No model training on your data.
                  Request bodies capped at 256 KB.
                </p>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Coverage"
          title="Starting with India. Built to grow."
          lede="The Indian patent corpus — sourced from IP India Patent Journal publications — is the first jurisdiction on the platform. The same API surface, data schema, and query format will extend to additional patent offices as they come online. Integrations built today won't need to change."
        >
          <Reveal delay={0.08}>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              <Panel title="Indian Patent Journal corpus">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  160,000+ patent records with 99%+ semantic embedding coverage. Full text
                  extraction from published journal PDFs, deduplicated across issues, with
                  source provenance on every record.
                </p>
              </Panel>
              <Panel title="Jurisdiction roadmap">
                <p className="text-[13.5px] leading-[1.6] text-paper-600">
                  Additional jurisdictions — including EPO and USPTO — are in development. The
                  API schema and endpoint structure are jurisdiction-agnostic by design, so new
                  corpora appear as additional search coverage, not new endpoints to integrate.
                </p>
              </Panel>
            </div>
          </Reveal>
        </Section>

        <Section
          kicker="Documentation"
          title="Complete reference, OpenAPI spec, and quick start."
        >
          <Reveal delay={0.08}>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/developers/patent-api"
                className="group inline-flex items-center gap-2 rounded-lg bg-lamp-600 px-6 py-3.5 text-[15px] font-medium text-white transition-all duration-150 hover:bg-lamp-700 hover:shadow-[0_12px_28px_-12px_rgba(29,78,216,0.7)] active:scale-[0.985]"
              >
                API reference documentation
              </Link>
              <Link
                href="/api/v1/openapi.json"
                className="inline-flex items-center gap-2 rounded-lg border border-paper-300 bg-white px-6 py-3.5 text-[15px] font-medium text-ai-graphite-800 transition-all duration-150 hover:border-paper-400 hover:bg-paper-50 active:scale-[0.985]"
              >
                OpenAPI 3.1 specification
              </Link>
            </div>
          </Reveal>
        </Section>

        <ClosingAsk
          title="Get API access for your platform."
          lede="API keys are provisioned per client with configurable rate limits. Tell us what you're building and we'll set up access, walk through the endpoints, or provision a sandbox environment for your integration."
        />

        <div className="h-20" />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
