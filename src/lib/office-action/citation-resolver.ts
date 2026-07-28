import { prisma } from '../prisma'

/**
 * Office Action Studio — cited-document resolver
 *
 * For each document the FER cites (D1…Dn), obtains the FULL patent text so the
 * attorney can read the actual specification, claims and description. Resolution
 * cascade, cheapest first:
 *   1. local corpus (if it already holds full claims + description)
 *   2. European publications → the EPO route
 *   3. otherwise → external full-text retrieval
 * Non-patent literature (journal articles) has no publication number and is
 * flagged for the attorney to upload.
 *
 * IMPORTANT — attorney-facing presentation: the resolved document is shown to the
 * attorney AS THE PATENT DOCUMENT. The retrieval mechanism is never surfaced.
 * `resolvedVia` is an internal diagnostics/metering code only; toAttorneyView()
 * whitelists patent fields and attaches a neutral source label — no provider or
 * "fetched"/"API" wording ever reaches the UI.
 */

export type ResolveRoute = 'local' | 'epo' | 'google' | 'external' | 'manual'

export interface ResolvedDocument {
  publicationNumber: string
  title?: string
  abstract?: string
  claims?: string
  description?: string
  resolvedVia: ResolveRoute      // INTERNAL ONLY — never sent to the attorney
  complete: boolean              // has claims AND description
}

/** What the attorney sees — the patent document, with no retrieval detail. */
export interface AttorneyPatentView {
  label: string                  // "D1"
  kind: 'PATENT' | 'NPL'
  publicationNumber?: string
  office?: string                // issuing office from the number (US/EP/…) — the patent's own identity
  title?: string
  abstract?: string
  claims?: string
  description?: string
  examinerRelevance?: string     // the examiner's pinpoint (from the FER table)
  status: 'available' | 'awaiting-upload' | 'pending'
  sourceLabel: string            // neutral, e.g. "Full patent specification" — NEVER a provider name
}

const EP_RE = /^EP\s?\d/i
const WO_RE = /^WO\s?\d/i

function officeOf(pub: string): string | undefined {
  const m = /^([A-Z]{2})/i.exec((pub || '').trim())
  return m ? m[1].toUpperCase() : undefined
}

/** Deterministic route choice from the document number + kind. */
export function selectRoute(docNumber: string | null | undefined, kind: string): ResolveRoute {
  if (kind === 'NPL') return 'manual'
  const n = (docNumber || '').trim()
  if (!n) return 'manual'
  if (EP_RE.test(n) || WO_RE.test(n)) return 'epo'   // EPO route for European / PCT publications
  return 'external'                                   // (checked after local in resolveCitation)
}

// ---- injectable fetchers (real implementations lazy-loaded; stubbed in tests) ----
export interface ResolverDeps {
  lookupLocal(pubNumber: string): Promise<ResolvedDocument | null>
  fetchEpo(pubNumber: string): Promise<ResolvedDocument | null>
  /** Free full-text tier (Google Patents page) — tried before the paid tier. */
  fetchGoogle(pubNumber: string): Promise<ResolvedDocument | null>
  /** Paid last-resort tier — only when every free tier misses. */
  fetchExternal(pubNumber: string): Promise<ResolvedDocument | null>
}

export interface CitationInput {
  label: string
  kind: string
  docNumber?: string | null
  normalizedKey?: string | null
}

/**
 * Resolve a single citation to full text via the cascade. Local first (free),
 * then the routed source; falls back external if the EPO route is incomplete.
 */
export async function resolveCitation(cite: CitationInput, deps: ResolverDeps): Promise<{
  route: ResolveRoute
  status: 'RESOLVED' | 'NOT_FOUND' | 'MANUAL_REQUIRED'
  document?: ResolvedDocument
}> {
  if (cite.kind === 'NPL' || !(cite.docNumber || '').trim()) {
    return { route: 'manual', status: 'MANUAL_REQUIRED' }
  }
  const num = (cite.docNumber || '').trim()
  const done = (route: ResolveRoute, doc: ResolvedDocument) =>
    ({ route, status: 'RESOLVED' as const, document: { ...doc, resolvedVia: route } })

  // Tier 1 — local corpus (free, instant): use only if it holds full claims + description.
  const local = await safe(() => deps.lookupLocal(num))
  if (local?.complete) return done('local', local)

  // Tier 2 — for European/PCT publications, the EPO route (free, authoritative).
  const route = selectRoute(num, cite.kind)
  if (route === 'epo') {
    const epo = await safe(() => deps.fetchEpo(num))
    if (epo?.complete) return done('epo', epo)
    // biblio-only → try the free Google tier next, keep epo biblio as a floor.
    const g = await safe(() => deps.fetchGoogle(num))
    if (g?.complete) return done('google', g)
    if (epo) return done('epo', epo)
    if (g) return done('google', g)
  } else {
    // Tier 3 — Google Patents page (FREE) before any paid call.
    const g = await safe(() => deps.fetchGoogle(num))
    if (g?.complete) return done('google', g)

    // Tier 4 — paid external retrieval, LAST RESORT only when the free tiers miss.
    const ext = await safe(() => deps.fetchExternal(num))
    if (ext) return done('external', ext)
    if (g) return done('google', g)  // incomplete Google text beats nothing
  }

  // Nothing complete — keep any partial local biblio if present.
  if (local) return done('local', local)
  return { route, status: 'NOT_FOUND' }
}

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn() } catch (e) { console.warn('[OA citation] resolve step failed:', e instanceof Error ? e.message : e); return null }
}

/**
 * Resolve every pending citation for a case and persist the full text onto the
 * OaCitation rows. Called eagerly at intake (see kickCitationResolution) so the
 * documents are ready before the attorney opens the citation workbench.
 */
export async function resolveCaseCitations(caseId: string, deps?: ResolverDeps): Promise<{ resolved: number; manual: number; notFound: number }> {
  const d = deps || defaultDeps()
  const citations = await prisma.oaCitation.findMany({
    where: { document: { caseId }, fetchStatus: 'PENDING' }
  })
  let resolved = 0, manual = 0, notFound = 0
  for (const c of citations) {
    const r = await resolveCitation({ label: c.label, kind: c.kind, docNumber: c.docNumber, normalizedKey: c.normalizedKey }, d)
    if (r.status === 'RESOLVED' && r.document) {
      resolved++
      await prisma.oaCitation.update({
        where: { id: c.id },
        data: {
          fetchStatus: 'RESOLVED',
          resolvedVia: r.document.resolvedVia,   // internal only
          normalizedKey: c.normalizedKey || r.document.publicationNumber,
          // Store the full document; keep any examiner-seed already in passagesJson.
          passagesJson: mergePassages(c.passagesJson, r.document)
        }
      })
    } else if (r.status === 'MANUAL_REQUIRED') {
      manual++
      await prisma.oaCitation.update({ where: { id: c.id }, data: { fetchStatus: 'MANUAL_REQUIRED' } })
    } else {
      notFound++
      await prisma.oaCitation.update({ where: { id: c.id }, data: { fetchStatus: 'NOT_FOUND' } })
    }
  }
  return { resolved, manual, notFound }
}

function mergePassages(existing: any, doc: ResolvedDocument): any {
  const prev = (existing && typeof existing === 'object') ? existing : {}
  return {
    ...prev,
    fullDocument: {
      title: doc.title, abstract: doc.abstract, claims: doc.claims, description: doc.description,
      publicationNumber: doc.publicationNumber
      // NOTE: resolvedVia is deliberately NOT stored in passagesJson (which can reach the client);
      // it lives only in OaCitation.resolvedVia for internal diagnostics.
    }
  }
}

/**
 * Build the attorney-facing view of a citation — the patent document, with a
 * neutral source label and NO retrieval detail. This is the ONLY shape sent to
 * the UI. `resolvedVia` is never included.
 */
export function toAttorneyView(citation: {
  label: string; kind: string; docNumber?: string | null; fetchStatus: string; passagesJson?: any
}): AttorneyPatentView {
  const full = citation.passagesJson?.fullDocument
  const seed = citation.passagesJson?.examinerSeed
  const status: AttorneyPatentView['status'] =
    citation.fetchStatus === 'RESOLVED' ? 'available'
    : citation.fetchStatus === 'MANUAL_REQUIRED' || citation.fetchStatus === 'NOT_FOUND' ? 'awaiting-upload'
    : 'pending'
  return {
    label: citation.label,
    kind: (citation.kind === 'NPL' ? 'NPL' : 'PATENT'),
    publicationNumber: citation.docNumber || full?.publicationNumber || undefined,
    office: officeOf(citation.docNumber || full?.publicationNumber || ''),
    title: full?.title,
    abstract: full?.abstract,
    claims: full?.claims,
    description: full?.description,
    examinerRelevance: seed?.relevantDescription,
    status,
    sourceLabel: status === 'available'
      ? (full?.providedByAttorney ? 'Provided by you'
        : full?.claims && full?.description ? 'Full patent specification' : 'Patent record')
      : status === 'awaiting-upload' ? 'Document to be provided' : 'Retrieving…'
  }
}

// ---------- real fetchers (neutrally named; no provider identity leaves here) ----------
function defaultDeps(): ResolverDeps {
  return {
    async lookupLocal(pub) {
      const { normalizePatentNumberKey } = await import('../patent-number')
      const key = normalizePatentNumberKey(pub)
      if (!key) return null
      const row = await prisma.localPatent.findFirst({
        where: { OR: [{ publicationNumberKey: String(key) }, { publicationNumber: pub }] },
        select: { publicationNumber: true, title: true, abstract: true, claimsText: true, descriptionText: true }
      })
      if (!row) return null
      return {
        publicationNumber: row.publicationNumber, title: row.title || undefined,
        abstract: row.abstract || undefined, claims: row.claimsText || undefined,
        description: row.descriptionText || undefined, resolvedVia: 'local',
        complete: Boolean(row.claimsText && row.descriptionText)
      }
    },
    async fetchEpo(pub) {
      const mod = await import('../patent-search/providers/epo-ops-provider')
      const Provider = (mod as any).EpoOpsProvider
      const hasCreds = (mod as any).hasEpoOpsCredentials
      if (!Provider || (typeof hasCreds === 'function' && !hasCreds())) return null
      const results = await new Provider().search({ publicationNumber: pub })
      const r = Array.isArray(results) ? results[0] : null
      if (!r) return null
      return {
        publicationNumber: r.publicationNumber || pub, title: r.title, abstract: r.abstract,
        claims: r.claims, description: r.description, resolvedVia: 'epo',
        complete: Boolean(r.claims && r.description)
      }
    },
    async fetchGoogle(pub) {
      // FREE tier: fetch + parse the Google Patents page directly (no paid API).
      const { fetchGooglePatentsPage } = await import('./google-patents-fulltext')
      const d = await fetchGooglePatentsPage(pub)
      if (!d) return null
      return {
        publicationNumber: d.publicationNumber, title: d.title, abstract: d.abstract,
        claims: d.claims, description: d.description, resolvedVia: 'google', complete: d.complete
      }
    },
    async fetchExternal(pub) {
      // Paid LAST-RESORT retrieval, only reached when every free tier misses.
      const { serpApiProvider } = await import('../serpapi-provider')
      for (const id of [`patent/${pub}/en`, pub]) {
        try {
          const d = await serpApiProvider.getPatentDetails({ patentId: id })
          const claims = Array.isArray(d?.claims) ? d.claims.join('\n') : (typeof d?.claims === 'string' ? d.claims : undefined)
          if (d?.title || d?.description || claims) {
            return {
              publicationNumber: pub, title: d.title, abstract: d.abstract,
              claims, description: d.description, resolvedVia: 'external',
              complete: Boolean(claims && d.description)
            }
          }
        } catch { /* try next id form */ }
      }
      return null
    }
  }
}

/**
 * Fire-and-forget eager resolution, kicked at FER ingest so cited documents are
 * ready by the time the attorney reaches the citation workbench. Enqueues an
 * OfficeActionJob AND kicks the inline drain — so resolution happens even when
 * the standalone worker is not running (the lease claim keeps both safe).
 */
export async function kickCitationResolution(caseId: string, userId: string): Promise<void> {
  try {
    await prisma.officeActionJob.create({
      data: { caseId, userId, jobType: 'RESOLVE_CITATIONS', status: 'QUEUED', payload: { caseId } }
    })
    const { kickOfficeActionJobsInline } = await import('../office-action-job-service')
    kickOfficeActionJobsInline('citations')
  } catch (e) {
    console.warn('[OA citation] could not enqueue resolution job:', e instanceof Error ? e.message : e)
  }
}
