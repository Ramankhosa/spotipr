import Link from 'next/link'

const searchExample = `curl -X POST "$BASE_URL/api/v1/patents/search" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"battery thermal management for electric vehicles","limit":20}'`

const lookupExample = `curl "$BASE_URL/api/v1/patents/IN20282005A" \\
  -H "Authorization: Bearer pn_live_your_key"`

const featuresExample = `curl -X POST "$BASE_URL/api/v1/analysis/features" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Solar-powered cold-chain container","description":"A shipping container with phase-change thermal storage panels charged by roof-mounted photovoltaic cells. A controller predicts door-opening events from a delivery schedule and pre-cools the buffer zone before each stop."}'`

const mappingExample = `curl -X POST "$BASE_URL/api/v1/analysis/feature-mapping" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"features":["phase-change thermal storage panel charged by photovoltaic cells","controller pre-cools a buffer zone based on predicted door-opening events"],"publicationNumber":"IN20282005A"}'`

const mcpConfigExample = `{
  "mcpServers": {
    "patentnest": {
      "type": "http",
      "url": "$BASE_URL/api/v1/mcp",
      "headers": { "Authorization": "Bearer pn_live_your_key" }
    }
  }
}`

export default function PatentApiDeveloperPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-14 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">PatentNest Developer API</p>
          <h1 className="text-4xl font-semibold tracking-tight">Patent Intelligence API v1.1</h1>
          <p className="max-w-2xl text-lg text-slate-300">
            Hybrid semantic search, publication lookup, and AI novelty analysis over the Indian patent corpus — as REST
            endpoints and as MCP tools for AI agents.
          </p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">Authentication</h2>
          <p className="mt-2 text-slate-300">Send the API key in the bearer authorization header. Keys must not be embedded in browser or mobile client code.</p>
          <code className="mt-4 block rounded-lg bg-slate-950 p-4 text-sm text-cyan-300">Authorization: Bearer pn_live_your_key</code>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Search</h2>
          <p className="text-slate-300"><code>POST /api/v1/patents/search</code> accepts 2–2,000 characters and returns up to 50 ranked records.</p>
          <p className="text-slate-300">
            Every search response includes a <code>coverage</code> manifest stating exactly what was searched — corpus,
            jurisdiction, document count, and the share of the corpus with semantic embeddings — so a negative result is
            a measurable signal, not a guess.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{searchExample}</code></pre>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Publication lookup</h2>
          <p className="text-slate-300"><code>GET /api/v1/patents/{'{publicationNumber}'}</code> normalizes case and separators before lookup.</p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{lookupExample}</code></pre>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">AI analysis: extract invention features</h2>
          <p className="text-slate-300">
            <code>POST /api/v1/analysis/features</code> runs the same normalization stage as the PatentNest novelty
            pipeline on a plain-English disclosure (40–20,000 characters): atomic technical features with per-feature
            detail and confidence, novelty-focus candidates, a suggested prior-art search query, and CPC/IPC hints.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{featuresExample}</code></pre>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">AI analysis: feature-to-patent evidence mapping</h2>
          <p className="text-slate-300">
            <code>POST /api/v1/analysis/feature-mapping</code> classifies each submitted feature (1–12) as{' '}
            <code>present</code>, <code>partial</code>, <code>absent</code>, or <code>unknown</code> in one corpus
            patent — with a verbatim quote and the field it came from (title, abstract, or claims). The response also
            reports which fields were available as evidence, so you always know the basis of the verdict.
          </p>
          <p className="text-slate-300">
            Typical flow: extract features → search with the suggested query → map features against shortlisted results.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{mappingExample}</code></pre>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">MCP server for AI agents</h2>
          <p className="text-slate-300">
            <code>POST /api/v1/mcp</code> is a Model Context Protocol endpoint (streamable HTTP) exposing{' '}
            <code>search_patents</code>, <code>get_patent</code>, <code>extract_invention_features</code>, and{' '}
            <code>map_features_to_patent</code> as tools for Claude, Cursor, and custom agent stacks. Tool calls use the
            same bearer API keys and count against the same quotas as REST requests.
          </p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{mcpConfigExample}</code></pre>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
          <h2 className="text-xl font-semibold text-slate-100">Limits and errors</h2>
          <p className="mt-2">
            Responses include minute, daily, and monthly quota headers. HTTP 429 includes <code>Retry-After</code>.
            Errors use a stable code, message, and request ID. AI analysis endpoints run a full LLM analysis per call
            and typically respond in tens of seconds; plan client timeouts accordingly.
          </p>
          <p className="mt-2">
            The two <code>/api/v1/analysis</code> endpoints draw on a separate daily analysis budget, reported as{' '}
            <code>X-RateLimit-Analysis-Remaining</code> and exhausted with <code>ANALYSIS_QUOTA_EXCEEDED</code>. A credit
            is charged only when a validated request reaches the model, so rejected requests cost nothing. Request
            bodies are capped at 256 KB (<code>PAYLOAD_TOO_LARGE</code>).
          </p>
          <p className="mt-2">
            Confidentiality: submitted disclosures are processed to produce the response and are not used to train
            models. Request logs store hashes and metadata, never disclosure text.
          </p>
          <Link href="/api/v1/openapi.json" className="mt-5 inline-flex rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400">OpenAPI 3.1 document</Link>
        </section>
      </div>
    </main>
  )
}
