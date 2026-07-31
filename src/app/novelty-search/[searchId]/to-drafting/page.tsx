'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, Loader2, RefreshCw } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { defaultLanguageForJurisdiction } from '@/lib/jurisdiction-language'

type Project = { id: string; name: string }

type CountryOption = {
  code: string
  label: string
  office: string
  continent: string
  languages: string[]
}

type RefinedIdea = {
  refinedTitle: string
  refinedDescription: string
  abstract: string
  keyFeatures: string[]
  potentialApplications: string[]
  domainTags: string[]
  technicalField: string
  changeLog: string[]
  openQuestions: string[]
}

type HandoffPayload = {
  searchId: string
  jurisdiction: string
  citationCount: number
  shortlistedCount: number
  citations: Array<{ patentNumber: string; title: string; noveltyThreat: string; overlapRiskLevel: string }>
  claimGuidance: {
    primaryClaimFocus: string
    secondaryClaimFocus: string
    remainingInventiveCore: string
    weakClaimAreas: string[]
    avoidRelyingSolelyOn: string[]
    independentClaimFocus: string
    dependentClaimIdeas: string[]
    fallbackClaimIdeas: string[]
  }
  findingsDigest: string
  risk: { noveltyRisk: string; headline: string; assessmentConfidence: string; decision: string; confidence: string }
}

const THREAT_STYLES: Record<string, string> = {
  anticipates: 'bg-red-50 text-red-700 border-red-200',
  obvious: 'bg-amber-50 text-amber-700 border-amber-200',
  adjacent: 'bg-lamp-50 text-lamp-700 border-lamp-200',
  remote: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  unknown: 'bg-slate-50 text-slate-600 border-slate-200',
}

export default function NoveltyToDraftingPage() {
  const params = useParams()
  const router = useRouter()
  const { user, isLoading: authLoading, authFetch } = useAuth()
  const { toast } = useToast()
  const searchId = params?.searchId as string

  const [search, setSearch] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const [isRefining, setIsRefining] = useState(false)
  const [refined, setRefined] = useState<RefinedIdea | null>(null)
  const [payload, setPayload] = useState<HandoffPayload | null>(null)
  const [ideaId, setIdeaId] = useState('')
  const [editedTitle, setEditedTitle] = useState('')
  const [editedDescription, setEditedDescription] = useState('')

  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [countries, setCountries] = useState<CountryOption[]>([])
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [commonLanguage, setCommonLanguage] = useState('en')
  const [isCreating, setIsCreating] = useState(false)

  const existingHandoff = search?.draftingHandoff || null
  const alreadyDrafted = Boolean(existingHandoff?.patentId && existingHandoff?.sessionId)

  // ── Load the search, projects and country profiles ───────────────────────────────────────
  useEffect(() => {
    if (!searchId || authLoading || !user) return
    let cancelled = false

    const load = async () => {
      try {
        setIsLoading(true)
        setError('')
        const [searchResponse, projectResponse, countryResponse] = await Promise.all([
          authFetch(`/api/novelty-search/${searchId}`, { cache: 'no-store' }),
          authFetch('/api/projects'),
          authFetch('/api/country-profiles'),
        ])

        const searchBody = await searchResponse.json().catch(() => null)
        if (!searchResponse.ok || !searchBody?.search) {
          throw new Error(searchBody?.error || 'Failed to load the novelty assessment')
        }
        if (cancelled) return

        const searchData = searchBody.search
        setSearch(searchData)
        setEditedTitle(searchData.title || '')

        const projectBody = projectResponse.ok ? await projectResponse.json() : { projects: [] }
        const nextProjects: Project[] = projectBody.projects || []
        setProjects(nextProjects)
        setProjectId(
          searchData.projectId ||
          nextProjects.find(project => project.name === 'Default Project')?.id ||
          nextProjects[0]?.id ||
          ''
        )

        const countryBody = countryResponse.ok ? await countryResponse.json() : { countries: [] }
        const nextCountries: CountryOption[] = (countryBody.countries || []).map((meta: any) => ({
          code: String(meta.code || '').toUpperCase(),
          label: `${meta.name || meta.code} (${String(meta.code || '').toUpperCase()})`,
          office: meta.office || 'Patent Office',
          continent: meta.continent || 'Unknown',
          languages: meta.languages || [],
        }))
        nextCountries.sort((a, b) => a.label.localeCompare(b.label))
        setCountries(nextCountries)

        // Default to the jurisdiction the assessment was actually run for.
        const runJurisdiction = String(searchData.jurisdiction || 'IN').toUpperCase()
        if (nextCountries.some(country => country.code === runJurisdiction)) {
          setSelectedCodes([runJurisdiction])
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load the novelty assessment')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [authFetch, authLoading, searchId, user])

  const runRefinement = useCallback(async () => {
    setIsRefining(true)
    setError('')
    try {
      const response = await authFetch(`/api/novelty-search/${searchId}/refine-idea`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Idea refinement failed')

      setRefined(body.refined)
      setPayload(body.payload)
      setIdeaId(body.ideaId)
      setEditedTitle(body.refined.refinedTitle)
      setEditedDescription(body.refined.refinedDescription)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Idea refinement failed'
      setError(message)
      toast({ title: message, variant: 'error' })
    } finally {
      setIsRefining(false)
    }
  }, [authFetch, searchId, toast])

  // Refine once the search is loaded; the user can regenerate from the UI.
  useEffect(() => {
    if (!search || refined || isRefining || error) return
    if (search.status !== 'COMPLETED') return
    void runRefinement()
  }, [error, isRefining, refined, runRefinement, search])

  const titleWordCount = useMemo(
    () => editedTitle.trim().split(/\s+/).filter(Boolean).length,
    [editedTitle]
  )

  const languageOptions = useMemo(() => {
    const selected = selectedCodes
      .map(code => countries.find(country => country.code === code))
      .filter(Boolean) as CountryOption[]
    if (!selected.length) return ['en']
    const shared = selected[0].languages.filter(lang => selected.every(country => country.languages.includes(lang)))
    return shared.length ? shared : ['en']
  }, [countries, selectedCodes])

  useEffect(() => {
    if (!languageOptions.includes(commonLanguage)) {
      // Not languageOptions[0]: the shared list inherits the profile catalogue's
      // arbitrary order, which for PCT begins with Arabic.
      setCommonLanguage(defaultLanguageForJurisdiction(selectedCodes[0] || '', languageOptions))
    }
  }, [commonLanguage, languageOptions, selectedCodes])

  const toggleCountry = (code: string) => {
    setSelectedCodes(prev => prev.includes(code) ? prev.filter(item => item !== code) : [...prev, code])
  }

  const canCreate = Boolean(
    projectId &&
    editedTitle.trim() &&
    titleWordCount <= 15 &&
    editedDescription.trim() &&
    selectedCodes.length > 0 &&
    !isCreating &&
    !isRefining
  )

  const handleCreateDraft = async () => {
    if (!canCreate) return
    setIsCreating(true)
    setError('')

    try {
      // 1. Create the patent + drafting session, and seed the analysed prior art + claim guidance.
      const handoffResponse = await authFetch(`/api/novelty-search/${searchId}/to-drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The Idea Bank id is not sent: the server reads it from the run's draftingHandoff,
        // which the refine step wrote, so it cannot be pointed at someone else's idea.
        body: JSON.stringify({ projectId, patentTitle: editedTitle.trim() }),
      })
      const handoff = await handoffResponse.json().catch(() => ({}))
      if (!handoffResponse.ok) throw new Error(handoff.error || 'Failed to create the draft')

      const { patentId, sessionId } = handoff

      // 2. Persist jurisdiction + language through the existing drafting handler.
      const stageResponse = await authFetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_stage',
          sessionId,
          stage: 'IDEA_ENTRY',
          draftingJurisdictions: selectedCodes,
          activeJurisdiction: selectedCodes[0],
          languageMode: 'common',
          commonLanguage,
          figuresLanguage: commonLanguage,
          languageByJurisdiction: Object.fromEntries(selectedCodes.map(code => [code, commonLanguage])),
        }),
      })
      if (!stageResponse.ok) {
        const stageBody = await stageResponse.json().catch(() => ({}))
        throw new Error(stageBody.error || 'Failed to persist jurisdiction selection')
      }

      // 3. Normalize the refined idea through Stage 0.
      const normalizeResponse = await authFetch(`/api/patents/${patentId}/drafting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'normalize_idea',
          sessionId,
          rawIdea: editedDescription.trim(),
          title: editedTitle.trim(),
        }),
      })
      if (!normalizeResponse.ok) {
        const normalizeBody = await normalizeResponse.json().catch(() => ({}))
        throw new Error(normalizeBody.error || 'Failed to normalize the refined idea')
      }

      router.push(`/patents/${patentId}/draft`)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to create the draft'
      setError(message)
      toast({ title: message, variant: 'error' })
      setIsCreating(false)
    }
  }

  if (authLoading || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ai-graphite-400" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <a href={`/login?redirect=${encodeURIComponent(`/novelty-search/${searchId}/to-drafting`)}`} className="text-ai-blue-600 hover:underline">
          Sign in to continue
        </a>
      </div>
    )
  }

  if (search && search.status !== 'COMPLETED') {
    return (
      <div className="min-h-screen bg-paper-100 px-4 py-16">
        <div className="mx-auto max-w-2xl rounded-xl border border-paper-300 bg-white p-8 text-center">
          <h1 className="text-xl font-bold text-ai-graphite-900">Assessment still running</h1>
          <p className="mt-2 text-ai-graphite-600">
            This novelty assessment has not finished yet. Once it completes you can push the refined idea into drafting.
          </p>
          <Link href="/novelty-search" className="mt-6 inline-block text-ai-blue-600 hover:underline">Back to novelty search</Link>
        </div>
      </div>
    )
  }

  const highRisk = payload?.risk?.noveltyRisk === 'High' || /not novel|high mapped-overlap/i.test(payload?.risk?.headline || '')

  return (
    <div className="min-h-screen bg-paper-100 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <Link href={`/novelty-search/${searchId}/consolidated`} className="mb-4 inline-flex items-center text-ai-graphite-600 hover:text-ai-graphite-900">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to report
        </Link>

        <h1 className="text-2xl font-bold text-ai-graphite-900">Push to drafting</h1>
        <p className="mt-1 text-ai-graphite-600">
          Your invention is rewritten against what the assessment found, then carried into a new draft together with the
          prior art it already analysed.
        </p>

        {alreadyDrafted && (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-amber-900">
                A draft was already created from this assessment.
              </p>
              <div className="flex gap-2">
                <Link
                  href={`/patents/${existingHandoff.patentId}/draft`}
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                >
                  Open existing draft
                </Link>
              </div>
            </div>
            <p className="mt-2 text-xs text-amber-800">You can still create another draft below if you want a separate filing.</p>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
        )}

        {highRisk && (
          <div className="mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="text-sm text-red-900">
              <p className="font-semibold">{payload?.risk?.headline}</p>
              <p className="mt-1">
                The assessment found substantial overlap with the cited art. Drafting remains available, but review the
                claim guidance below and the closest references before you invest in a full specification.
              </p>
            </div>
          </div>
        )}

        {/* ── 1. Refined idea ────────────────────────────────────────────────────────────── */}
        <section className="mt-8 rounded-xl border border-paper-300 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-ai-graphite-900">1. Refined idea</h2>
            <button
              type="button"
              onClick={() => void runRefinement()}
              disabled={isRefining}
              className="inline-flex items-center gap-2 rounded-lg border border-paper-300 px-3 py-1.5 text-sm font-medium text-ai-graphite-700 hover:bg-paper-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isRefining ? 'animate-spin' : ''}`} />
              {isRefining ? 'Refining…' : 'Regenerate'}
            </button>
          </div>

          {isRefining && !refined ? (
            <div className="mt-6 flex items-center gap-3 text-ai-graphite-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Rewriting the disclosure against the assessment findings…
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ai-graphite-500">Original</div>
                  <div className="rounded-lg border border-paper-300 bg-paper-50 p-3">
                    <p className="text-sm font-medium text-ai-graphite-900">{search?.title}</p>
                    <p className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap text-sm leading-6 text-ai-graphite-700">
                      {search?.inventionDescription}
                    </p>
                  </div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-lamp-700">Refined — editable</div>
                  <input
                    value={editedTitle}
                    onChange={event => setEditedTitle(event.target.value)}
                    placeholder="Patent title"
                    className="w-full rounded-lg border border-lamp-200 px-3 py-2 text-sm font-medium text-ai-graphite-900 focus:border-lamp-400 focus:outline-none"
                  />
                  <div className={`mt-1 text-xs ${titleWordCount > 15 ? 'text-red-600' : 'text-ai-graphite-500'}`}>
                    {titleWordCount}/15 words
                  </div>
                  <textarea
                    value={editedDescription}
                    onChange={event => setEditedDescription(event.target.value)}
                    rows={12}
                    placeholder="Refined invention description"
                    className="mt-2 w-full rounded-lg border border-lamp-200 px-3 py-2 text-sm leading-6 text-ai-graphite-800 focus:border-lamp-400 focus:outline-none"
                  />
                </div>
              </div>

              {refined?.changeLog?.length ? (
                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-ai-graphite-500">What changed and why</div>
                  <ul className="mt-2 space-y-1">
                    {refined.changeLog.map((item, index) => (
                      <li key={index} className="flex gap-2 text-sm text-ai-graphite-700">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {refined?.openQuestions?.length ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">Support gaps to fill before drafting</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                    {refined.openQuestions.map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                </div>
              ) : null}

              {ideaId && (
                <p className="mt-4 text-xs text-ai-graphite-500">
                  Saved privately to your Idea Bank — visible only to you, and never listed for other users.
                </p>
              )}
            </>
          )}
        </section>

        {/* ── 2. Destination ─────────────────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-xl border border-paper-300 bg-white p-6">
          <h2 className="text-lg font-semibold text-ai-graphite-900">2. Destination</h2>

          <label className="mt-4 block text-sm font-medium text-ai-graphite-700">Project</label>
          <select
            value={projectId}
            onChange={event => setProjectId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-ai-graphite-900 focus:border-ai-blue-400 focus:outline-none"
          >
            <option value="">Select a project…</option>
            {projects.map(project => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>

          <div className="mt-5 text-sm font-medium text-ai-graphite-700">Jurisdictions</div>
          <p className="text-xs text-ai-graphite-500">
            Defaulted to the jurisdiction this assessment was run for. You can change languages per jurisdiction later in the workspace.
          </p>
          <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-auto rounded-lg border border-paper-300 p-2 sm:grid-cols-2">
            {countries.map(country => (
              <label key={country.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-paper-100">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedCodes.includes(country.code)}
                  onChange={() => toggleCountry(country.code)}
                />
                <span className="text-ai-graphite-800">{country.label}</span>
              </label>
            ))}
          </div>

          <label className="mt-4 block text-sm font-medium text-ai-graphite-700">Drafting language</label>
          <select
            value={commonLanguage}
            onChange={event => setCommonLanguage(event.target.value)}
            className="mt-1 w-full rounded-lg border border-paper-300 px-3 py-2 text-sm text-ai-graphite-900 focus:border-ai-blue-400 focus:outline-none sm:w-64"
          >
            {languageOptions.map(language => (
              <option key={language} value={language}>{language}</option>
            ))}
          </select>
        </section>

        {/* ── 3. What carries over ───────────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-xl border border-paper-300 bg-white p-6">
          <h2 className="text-lg font-semibold text-ai-graphite-900">3. What carries over</h2>

          {payload ? (
            <>
              <div className="mt-4 flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-lamp-50 px-3 py-1 text-lamp-800">
                  {payload.citationCount} analysed reference{payload.citationCount === 1 ? '' : 's'} → Prior Art stage
                </span>
                {payload.shortlistedCount > 0 && (
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                    {payload.shortlistedCount} shortlisted, listed for reference
                  </span>
                )}
                <span className="rounded-full bg-lamp-50 px-3 py-1 text-lamp-800">Claim guidance → claim generation</span>
              </div>

              {payload.citations.length > 0 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-paper-300 text-xs uppercase tracking-wide text-ai-graphite-500">
                        <th className="py-2 pr-3">Reference</th>
                        <th className="py-2 pr-3">Title</th>
                        <th className="py-2">Overlap</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.citations.slice(0, 12).map(citation => (
                        <tr key={citation.patentNumber} className="border-b border-paper-200 last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs text-ai-graphite-800">{citation.patentNumber}</td>
                          <td className="py-2 pr-3 text-ai-graphite-700">{citation.title}</td>
                          <td className="py-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${THREAT_STYLES[citation.noveltyThreat] || THREAT_STYLES.unknown}`}>
                              {citation.noveltyThreat}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {payload.citations.length > 12 && (
                    <p className="mt-2 text-xs text-ai-graphite-500">
                      +{payload.citations.length - 12} more carried over.
                    </p>
                  )}
                </div>
              )}

              {payload.claimGuidance?.primaryClaimFocus && (
                <div className="mt-5 rounded-lg border border-lamp-200 bg-lamp-50 p-4 text-sm">
                  <div className="font-semibold text-lamp-900">Primary claim focus</div>
                  <p className="mt-1 text-lamp-900">{payload.claimGuidance.primaryClaimFocus}</p>
                  {payload.claimGuidance.avoidRelyingSolelyOn?.length > 0 && (
                    <>
                      <div className="mt-3 font-semibold text-lamp-900">Do not rely on alone</div>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-lamp-900">
                        {payload.claimGuidance.avoidRelyingSolelyOn.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="mt-3 text-sm text-ai-graphite-500">Waiting for the refinement to complete…</p>
          )}
        </section>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 pb-12">
          <Link href={`/novelty-search/${searchId}/consolidated`} className="text-sm text-ai-graphite-600 hover:underline">
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleCreateDraft}
            disabled={!canCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-ai-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {isCreating ? 'Creating draft…' : 'Create draft'}
            {!isCreating && <ArrowRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
