import Link from 'next/link'

const searchExample = `curl -X POST "$BASE_URL/api/v1/patents/search" \\
  -H "Authorization: Bearer pn_live_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"battery thermal management for electric vehicles","limit":20}'`

const lookupExample = `curl "$BASE_URL/api/v1/patents/IN20282005A" \\
  -H "Authorization: Bearer pn_live_your_key"`

export default function PatentApiDeveloperPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-14 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-10">
        <header className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-400">PatentNest Developer API</p>
          <h1 className="text-4xl font-semibold tracking-tight">Indian Patent Corpus API v1</h1>
          <p className="max-w-2xl text-lg text-slate-300">Hybrid semantic search and publication-number lookup for server-side applications.</p>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-xl font-semibold">Authentication</h2>
          <p className="mt-2 text-slate-300">Send the API key in the bearer authorization header. Keys must not be embedded in browser or mobile client code.</p>
          <code className="mt-4 block rounded-lg bg-slate-950 p-4 text-sm text-cyan-300">Authorization: Bearer pn_live_your_key</code>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Search</h2>
          <p className="text-slate-300"><code>POST /api/v1/patents/search</code> accepts 2–2,000 characters and returns up to 50 ranked records.</p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{searchExample}</code></pre>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">Publication lookup</h2>
          <p className="text-slate-300"><code>GET /api/v1/patents/{'{publicationNumber}'}</code> normalizes case and separators before lookup.</p>
          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-5 text-sm text-slate-200"><code>{lookupExample}</code></pre>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
          <h2 className="text-xl font-semibold text-slate-100">Limits and errors</h2>
          <p className="mt-2">Responses include minute, daily, and monthly quota headers. HTTP 429 includes <code>Retry-After</code>. Errors use a stable code, message, and request ID.</p>
          <Link href="/api/v1/openapi.json" className="mt-5 inline-flex rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400">OpenAPI 3.1 document</Link>
        </section>
      </div>
    </main>
  )
}

