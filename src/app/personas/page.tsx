'use client'

/**
 * Writing Personas — teach the drafter your voice.
 *
 * The screen has one job: get an attorney from "what is a persona?" to a
 * persona that is actually usable in drafting. Everything here serves that —
 * the readiness meter states the goal, the section rows say what to paste, and
 * Universal is presented as the default so nobody has to fill twenty countries.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { SECTION_WORD_LIMITS, DEFAULT_LIMITS } from '@/lib/writing-sample-limits'
import {
  getPersonaReadiness,
  getPersonaCoverage,
  resolveCoveredSections,
  sectionBlurb,
  isHighImpact,
  countWords,
  type PersonaReadiness,
  type PersonaSampleRef
} from '@/lib/persona-guidance'
import { getFlagEmoji } from '@/lib/country-flags'
import {
  Feather, Plus, Check, Copy, Globe, Lock, Building2, Pencil, Trash2, X,
  AlertTriangle, ChevronDown, Sparkles, Loader2, Eye, ArrowRight
} from 'lucide-react'

interface Persona {
  id: string
  name: string
  description: string | null
  visibility: 'PRIVATE' | 'ORGANIZATION'
  isTemplate: boolean
  allowCopy: boolean
  sampleCount: number
  sampleCoverage?: PersonaSampleRef[]
  coveredSections?: string[]
  jurisdictions?: string[]
  isOwn: boolean
  createdBy?: { id: string; name: string }
  createdAt: string
}

interface Sample {
  id: string
  sectionKey: string
  jurisdiction: string
  sampleText: string
  wordCount: number
  isActive: boolean
}

interface SectionInfo {
  key: string
  label: string
  displayOrder?: number
  isRequired?: boolean
  usedBy?: string[]
}

interface Jurisdiction {
  code: string
  label: string
}

// Fallback until the active drafting countries load from the API.
const DEFAULT_COUNTRIES: Jurisdiction[] = [
  { code: 'IN', label: 'India' },
  { code: 'US', label: 'United States' },
  { code: 'EP', label: 'Europe' },
  { code: 'PCT', label: 'PCT' }
]

const UNIVERSAL = '*'

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function ReadinessMeter({ readiness, size = 'sm' }: { readiness: PersonaReadiness; size?: 'sm' | 'lg' }) {
  const tone =
    readiness.level === 'ready'
      ? 'bg-success'
      : readiness.level === 'partial'
        ? 'bg-primary'
        : 'bg-border'

  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-muted ${size === 'lg' ? 'h-1.5' : 'h-1'}`}
      role="progressbar"
      aria-valuenow={readiness.covered}
      aria-valuemin={0}
      aria-valuemax={readiness.total}
      aria-label={`Persona readiness: ${readiness.label}`}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${tone}`}
        style={{ width: `${Math.max(readiness.ratio * 100, readiness.level === 'empty' ? 0 : 8)}%` }}
      />
    </div>
  )
}

function ReadinessLabel({ readiness }: { readiness: PersonaReadiness }) {
  if (readiness.level === 'ready') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
        <Check className="h-3.5 w-3.5" aria-hidden />
        Ready to use
      </span>
    )
  }
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {readiness.label}
    </span>
  )
}

/** Live length feedback while typing a sample. */
function WordMeter({ text, sectionKey }: { text: string; sectionKey: string }) {
  const words = countWords(text)
  const limits = SECTION_WORD_LIMITS[sectionKey] || DEFAULT_LIMITS

  let tone = 'text-muted-foreground'
  let message = `Aim for ${limits.recommended.min}–${limits.recommended.max} words`

  if (words === 0) {
    // Keep the neutral prompt.
  } else if (words < limits.min) {
    tone = 'text-destructive'
    message = `Too short — at least ${limits.min} words`
  } else if (words > limits.max) {
    tone = 'text-destructive'
    message = `Too long — ${limits.max} words maximum`
  } else if (words < limits.recommended.min) {
    tone = 'text-warning'
    message = `A bit short — ${limits.recommended.min}+ words works better`
  } else if (words > limits.recommended.max) {
    tone = 'text-warning'
    message = `Longer than needed — ${limits.recommended.max} words is plenty`
  } else {
    tone = 'text-success'
    message = 'Good length'
  }

  return (
    <p className={`text-xs ${tone}`}>
      <span className="tabular-nums font-medium">{words}</span> word{words === 1 ? '' : 's'} · {message}
    </p>
  )
}

function PersonaListCard({
  persona,
  active,
  onSelect
}: {
  persona: Persona
  active: boolean
  onSelect: () => void
}) {
  // The card has no jurisdiction in hand, so it reports the universal answer
  // and names any country the persona is nonetheless ready for.
  const { readiness, readyJurisdictions } = getPersonaCoverage(persona.sampleCoverage)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className={`w-full rounded-lg border px-4 py-3 text-left transition-colors ${
        active
          ? 'border-primary bg-accent'
          : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {persona.name}
        </span>
        {persona.isTemplate && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Template
          </span>
        )}
        {!persona.isTemplate && persona.visibility === 'ORGANIZATION' && persona.isOwn && (
          <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Shared
          </span>
        )}
      </div>

      {persona.description && (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{persona.description}</p>
      )}

      <div className="mt-2.5">
        <ReadinessMeter readiness={readiness} />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {readyJurisdictions.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Ready for {readyJurisdictions.join(', ')}
            </span>
          ) : (
            <ReadinessLabel readiness={readiness} />
          )}
          {!persona.isOwn && persona.createdBy && (
            <span className="truncate text-[11px] text-muted-foreground">by {persona.createdBy.name}</span>
          )}
        </div>
      </div>
    </button>
  )
}

/** The three-step explainer. Shown as the empty state and behind a disclosure. */
function HowItWorks({ compact = false }: { compact?: boolean }) {
  const steps = [
    {
      title: 'Create a persona',
      body: 'One per style you write in — Software, Life sciences, Mechanical. Most attorneys need two or three.'
    },
    {
      title: 'Paste your own writing',
      body: 'For each section, paste a passage from a patent you actually drafted. Five key sections is enough to start.'
    },
    {
      title: 'Switch it on while drafting',
      body: 'In the drafting toolbar set Style to On and pick the persona. New drafts follow your phrasing and structure.'
    }
  ]

  return (
    <ol className={compact ? 'grid gap-4 sm:grid-cols-3' : 'grid gap-5 sm:grid-cols-3'}>
      {steps.map((step, i) => (
        <li key={step.title}>
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <span className="text-sm font-semibold text-foreground">{step.title}</span>
          </div>
          <p className="mt-1.5 pl-7 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PersonasPage() {
  const { token, user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const { toast } = useToast()

  const [myPersonas, setMyPersonas] = useState<Persona[]>([])
  const [orgPersonas, setOrgPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  // Create / edit persona details
  const [personaForm, setPersonaForm] = useState<{
    mode: 'create' | 'edit'
    id?: string
    name: string
    description: string
    visibility: 'PRIVATE' | 'ORGANIZATION'
  } | null>(null)
  const [saving, setSaving] = useState(false)

  // Selected persona + its samples
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [loadingSamples, setLoadingSamples] = useState(false)
  const [activeJurisdiction, setActiveJurisdiction] = useState(UNIVERSAL)
  const [editingSample, setEditingSample] = useState<{ sectionKey: string; text: string } | null>(null)
  const [addedCountries, setAddedCountries] = useState<string[]>([])

  // Sections for the active jurisdiction
  const [sections, setSections] = useState<SectionInfo[]>([])
  const [sectionsError, setSectionsError] = useState<string | null>(null)
  const [loadingSections, setLoadingSections] = useState(false)

  // Destructive flows
  const [personaToArchive, setPersonaToArchive] = useState<Persona | null>(null)
  const [archiveConfirmText, setArchiveConfirmText] = useState('')
  const [jurisdictionToClear, setJurisdictionToClear] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState<{ source: Persona; name: string } | null>(null)

  // Active drafting countries (any imported country shows up here)
  const [countries, setCountries] = useState<Jurisdiction[]>(DEFAULT_COUNTRIES)

  const isAdmin = user?.roles?.some((r: string) => ['OWNER', 'ADMIN'].includes(r))

  const allPersonas = useMemo(() => [...myPersonas, ...orgPersonas], [myPersonas, orgPersonas])
  const selectedPersona = useMemo(
    () => allPersonas.find(p => p.id === selectedId) || null,
    [allPersonas, selectedId]
  )
  const readOnly = !!selectedPersona && !selectedPersona.isOwn

  const jurisdictionLabel = useCallback(
    (code: string) => {
      if (code === UNIVERSAL) return 'Universal'
      return countries.find(c => c.code === code)?.label || code
    },
    [countries]
  )

  /* ---------------- data ---------------- */

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/country-names', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const data = await res.json()
        const list: Jurisdiction[] = (data.countries || []).map((c: any) => ({ code: c.code, label: c.name }))
        if (!cancelled && list.length > 0) setCountries(list)
      } catch {
        // keep the static fallback
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const fetchPersonas = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch('/api/personas', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('Could not load your personas')
      const data = await res.json()
      setMyPersonas(data.myPersonas || [])
      setOrgPersonas(data.orgPersonas || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your personas')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { void fetchPersonas() }, [fetchPersonas])

  // Without this the page sits on the loading state forever when signed out,
  // because every fetch here short-circuits on a missing token.
  useEffect(() => {
    if (!authLoading && !user) router.push('/login')
  }, [authLoading, user, router])

  const fetchSamples = useCallback(async (personaId: string) => {
    if (!token) return
    setLoadingSamples(true)
    try {
      const res = await fetch(`/api/writing-samples?personaId=${personaId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error('Could not load this persona’s samples')
      const data = await res.json()
      setSamples((data.samples || []).filter((s: Sample) => s.isActive))
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not load samples', variant: 'error' })
      setSamples([])
    } finally {
      setLoadingSamples(false)
    }
  }, [token, toast])

  const fetchSections = useCallback(async (jurisdiction: string) => {
    if (!token) return
    setLoadingSections(true)
    setSectionsError(null)
    try {
      const res = await fetch(`/api/sections/by-jurisdiction?jurisdiction=${jurisdiction}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load sections')
      setSections(data.sections || [])
    } catch (err) {
      setSections([])
      setSectionsError(err instanceof Error ? err.message : 'Could not load sections')
    } finally {
      setLoadingSections(false)
    }
  }, [token])

  useEffect(() => {
    if (selectedId) void fetchSections(activeJurisdiction)
  }, [activeJurisdiction, selectedId, fetchSections])

  /* ---------------- derived ---------------- */

  const sampleCountsByJurisdiction = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const s of samples) counts[s.jurisdiction] = (counts[s.jurisdiction] || 0) + 1
    return counts
  }, [samples])

  // Country tabs: those that already hold samples, plus any the user just added.
  // Codes that are no longer in the active drafting list still appear (labelled
  // by code) so their samples stay visible and removable.
  const visibleCountries = useMemo(() => {
    const codes = Array.from(new Set<string>([
      ...Object.keys(sampleCountsByJurisdiction).filter(c => c !== UNIVERSAL),
      ...addedCountries
    ]))
    return codes.map(code => countries.find(c => c.code === code) || { code, label: code })
  }, [sampleCountsByJurisdiction, addedCountries, countries])

  const availableCountries = useMemo(
    () => countries.filter(c => !visibleCountries.some(v => v.code === c.code)),
    [countries, visibleCountries]
  )

  // Measured against the jurisdiction tab in view, the same way generation
  // resolves it: this country's samples plus the universal ones. Counting every
  // jurisdiction at once would call a US-only persona ready for an Indian draft.
  const selectedReadiness = getPersonaReadiness(
    selectedPersona ? resolveCoveredSections(samples, activeJurisdiction) : []
  )

  /* ---------------- actions ---------------- */

  const selectPersona = (persona: Persona) => {
    setSelectedId(persona.id)
    setEditingSample(null)
    setActiveJurisdiction(UNIVERSAL)
    setAddedCountries([])
    setSamples([])
    void fetchSamples(persona.id)
  }

  const savePersonaDetails = async () => {
    if (!personaForm || !personaForm.name.trim() || !token) return
    setSaving(true)
    try {
      const isEdit = personaForm.mode === 'edit'
      const res = await fetch('/api/personas', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          ...(isEdit ? { id: personaForm.id } : {}),
          name: personaForm.name.trim(),
          description: personaForm.description.trim() || null,
          // Only admins see the control, so only admins may move a persona
          // between private and organization-wide.
          ...(isAdmin ? { visibility: personaForm.visibility } : {})
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save the persona')

      await fetchPersonas()
      if (!isEdit && data.persona?.id) {
        setSelectedId(data.persona.id)
        setActiveJurisdiction(UNIVERSAL)
        setAddedCountries([])
        setSamples([])
        // Re-using an archived name reactivates that persona with its old
        // samples intact, so load them rather than assuming a blank slate.
        void fetchSamples(data.persona.id)
      }
      setPersonaForm(null)
      toast({ title: isEdit ? 'Persona updated' : `“${personaForm.name.trim()}” created`, variant: 'success' })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not save the persona', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const saveSample = async (sectionKey: string, text: string) => {
    if (!selectedPersona || !token) return
    setSaving(true)
    try {
      const res = await fetch('/api/writing-samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          personaId: selectedPersona.id,
          personaName: selectedPersona.name,
          jurisdiction: activeJurisdiction,
          sectionKey,
          sampleText: text
        })
      })
      const data = await res.json()

      if (!res.ok) {
        if (data.code === 'ORG_PERSONA_READONLY') {
          throw new Error('This persona belongs to someone else. Duplicate it to make your own version.')
        }
        if (data.code === 'PERSONA_NOT_FOUND') {
          throw new Error('This persona is no longer available. Refresh the page.')
        }
        if (data.wordCount !== undefined && data.limits) {
          throw new Error(
            `${data.error || 'That sample was rejected'} — yours is ${data.wordCount} words, allowed is ${data.limits.min}–${data.limits.max}.`
          )
        }
        throw new Error(data.error || 'Could not save the sample')
      }

      setEditingSample(null)
      await fetchSamples(selectedPersona.id)
      void fetchPersonas()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not save the sample', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const deleteSample = async (sample: Sample) => {
    if (!token || !selectedPersona) return
    try {
      const res = await fetch(`/api/writing-samples?id=${sample.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not remove the sample')
      await fetchSamples(selectedPersona.id)
      void fetchPersonas()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove the sample', variant: 'error' })
    }
  }

  const archivePersona = async () => {
    if (!personaToArchive || !token) return
    try {
      const res = await fetch(`/api/personas?id=${personaToArchive.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not archive the persona')

      if (selectedId === personaToArchive.id) {
        setSelectedId(null)
        setSamples([])
      }
      toast({ title: `“${personaToArchive.name}” archived`, variant: 'success' })
      setPersonaToArchive(null)
      setArchiveConfirmText('')
      void fetchPersonas()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not archive the persona', variant: 'error' })
    }
  }

  const clearJurisdiction = async () => {
    if (!selectedPersona || !jurisdictionToClear || !token) return
    try {
      const res = await fetch('/api/writing-samples/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ personaId: selectedPersona.id, jurisdiction: jurisdictionToClear })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not remove those samples')

      setAddedCountries(prev => prev.filter(c => c !== jurisdictionToClear))
      if (jurisdictionToClear !== UNIVERSAL) setActiveJurisdiction(UNIVERSAL)
      setJurisdictionToClear(null)
      await fetchSamples(selectedPersona.id)
      void fetchPersonas()
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not remove those samples', variant: 'error' })
    }
  }

  const duplicatePersona = async () => {
    if (!duplicating || !duplicating.name.trim() || !token) return
    setSaving(true)
    try {
      const res = await fetch('/api/personas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'copy', sourceId: duplicating.source.id, newName: duplicating.name.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not duplicate the persona')

      await fetchPersonas()
      if (data.persona?.id) {
        setSelectedId(data.persona.id)
        setActiveJurisdiction(UNIVERSAL)
        setAddedCountries([])
        void fetchSamples(data.persona.id)
      }
      toast({ title: data.message || 'Persona duplicated', variant: 'success' })
      setDuplicating(null)
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not duplicate the persona', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- render ---------------- */

  if (authLoading || (user && loading)) return <PageLoadingBird message="Loading your writing personas..." />
  if (!user) return null

  const hasAnyPersona = allPersonas.length > 0

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Feather className="h-6 w-6 text-primary" aria-hidden />
            Writing Personas
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Teach the drafter to write the way you write. Paste passages from patents you have already
            drafted, then switch the persona on from the drafting toolbar.
          </p>
          {hasAnyPersona && (
            <button
              type="button"
              onClick={() => setShowGuide(v => !v)}
              aria-expanded={showGuide}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showGuide ? 'rotate-180' : ''}`} aria-hidden />
              How writing personas work
            </button>
          )}
        </div>
        <Button onClick={() => setPersonaForm({ mode: 'create', name: '', description: '', visibility: 'PRIVATE' })}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden /> New persona
        </Button>
      </div>

      {hasAnyPersona && showGuide && (
        <div className="mb-6 rounded-lg border border-border bg-muted/40 p-5">
          <HowItWorks compact />
        </div>
      )}

      {error && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {!hasAnyPersona ? (
        /* First run: the page explains itself instead of showing two empty columns. */
        <div className="rounded-lg border border-border bg-card p-8 sm:p-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <Sparkles className="h-6 w-6 text-primary" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold text-foreground">Create your first writing persona</h2>
            <p className="mx-auto mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
              A persona is a saved writing style. You teach it once with passages from your own patents,
              and every draft you generate with it follows your phrasing, structure, and claim habits.
            </p>
          </div>

          <div className="mx-auto mt-8 max-w-3xl border-t border-border pt-8">
            <HowItWorks />
          </div>

          <div className="mt-8 text-center">
            <Button onClick={() => setPersonaForm({ mode: 'create', name: '', description: '', visibility: 'PRIVATE' })}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Create a persona
            </Button>
            <p className="mt-3 text-xs text-muted-foreground">Takes about five minutes to fill in the key sections.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(240px,300px)_1fr]">
          {/* ---------- Left: persona list ---------- */}
          <div className="space-y-6">
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Lock className="h-3 w-3" aria-hidden /> Yours ({myPersonas.length})
              </h2>
              {myPersonas.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                  You have none yet. Duplicate a shared one below, or create your own.
                </p>
              ) : (
                <div className="space-y-2">
                  {myPersonas.map(p => (
                    <PersonaListCard
                      key={p.id}
                      persona={p}
                      active={selectedId === p.id}
                      onSelect={() => selectPersona(p)}
                    />
                  ))}
                </div>
              )}
            </section>

            {orgPersonas.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Building2 className="h-3 w-3" aria-hidden /> Shared by your organization ({orgPersonas.length})
                </h2>
                <div className="space-y-2">
                  {orgPersonas.map(p => (
                    <PersonaListCard
                      key={p.id}
                      persona={p}
                      active={selectedId === p.id}
                      onSelect={() => selectPersona(p)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* ---------- Right: editor ---------- */}
          <div className="min-w-0">
            {!selectedPersona ? (
              <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border p-10 text-center">
                <Feather className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
                <h2 className="font-semibold text-foreground">Pick a persona to teach</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Choose one on the left to add writing samples, or create a new one.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card">
                {/* Editor header */}
                <div className="border-b border-border p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-foreground">{selectedPersona.name}</h2>
                      {selectedPersona.description && (
                        <p className="mt-0.5 text-sm text-muted-foreground">{selectedPersona.description}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {selectedPersona.isOwn ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPersonaForm({
                                mode: 'edit',
                                id: selectedPersona.id,
                                name: selectedPersona.name,
                                description: selectedPersona.description || '',
                                visibility: selectedPersona.visibility
                              })
                            }
                          >
                            <Pencil className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Rename
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setPersonaToArchive(selectedPersona); setArchiveConfirmText('') }}
                            aria-label={`Archive ${selectedPersona.name}`}
                            className="text-destructive hover:bg-destructive/5"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </>
                      ) : selectedPersona.allowCopy ? (
                        <Button
                          size="sm"
                          onClick={() => setDuplicating({ source: selectedPersona, name: `${selectedPersona.name} (my copy)` })}
                        >
                          <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Duplicate to edit
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {/* Readiness */}
                  <div className="mt-4 max-w-md">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <ReadinessLabel readiness={selectedReadiness} />
                      <span className="text-xs text-muted-foreground">
                        {samples.length} sample{samples.length === 1 ? '' : 's'} saved
                      </span>
                    </div>
                    <ReadinessMeter readiness={selectedReadiness} size="lg" />
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {selectedReadiness.level === 'ready' ? (
                        <>
                          Ready for{' '}
                          <strong className="font-medium text-foreground">
                            {activeJurisdiction === UNIVERSAL ? 'every country' : jurisdictionLabel(activeJurisdiction)}
                          </strong>
                          . Switch <strong className="font-medium text-foreground">Style: On</strong> in the drafting
                          toolbar and pick this persona.
                        </>
                      ) : (
                        <>
                          Sections marked <strong className="font-medium text-foreground">Key</strong> carry the most
                          style. {selectedReadiness.nextStep} for{' '}
                          {activeJurisdiction === UNIVERSAL ? 'every country' : jurisdictionLabel(activeJurisdiction)}.
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {/* Read-only banner for shared personas */}
                {readOnly && (
                  <div className="flex items-start gap-2 border-b border-border bg-muted/50 px-5 py-3 text-sm">
                    <Eye className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <p className="text-muted-foreground">
                      {selectedPersona.createdBy?.name
                        ? `Shared by ${selectedPersona.createdBy.name}.`
                        : 'Shared with your organization.'}{' '}
                      You can read it and use it while drafting.{' '}
                      {selectedPersona.allowCopy
                        ? 'To change it, duplicate it into your own personas.'
                        : 'The owner has turned off copying, so it cannot be edited here.'}
                    </p>
                  </div>
                )}

                {/* Coverage / jurisdiction picker */}
                <div className="border-b border-border px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mr-1 text-xs font-medium text-muted-foreground">Applies to</span>

                    <button
                      type="button"
                      onClick={() => { setActiveJurisdiction(UNIVERSAL); setEditingSample(null) }}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                        activeJurisdiction === UNIVERSAL
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-card text-foreground hover:bg-muted'
                      }`}
                    >
                      <Globe className="h-3.5 w-3.5" aria-hidden />
                      Every country
                      {(sampleCountsByJurisdiction[UNIVERSAL] || 0) > 0 && (
                        <span className={activeJurisdiction === UNIVERSAL ? 'opacity-80' : 'text-muted-foreground'}>
                          {sampleCountsByJurisdiction[UNIVERSAL]}
                        </span>
                      )}
                    </button>

                    {visibleCountries.map(c => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => { setActiveJurisdiction(c.code); setEditingSample(null) }}
                        className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          activeJurisdiction === c.code
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-foreground hover:bg-muted'
                        }`}
                      >
                        <span aria-hidden>{getFlagEmoji(c.code)}</span>
                        {c.label}
                        {(sampleCountsByJurisdiction[c.code] || 0) > 0 && (
                          <span className={activeJurisdiction === c.code ? 'opacity-80' : 'text-muted-foreground'}>
                            {sampleCountsByJurisdiction[c.code]}
                          </span>
                        )}
                      </button>
                    ))}

                    {!readOnly && availableCountries.length > 0 && (
                      <label className="inline-flex items-center">
                        <span className="sr-only">Add a country-specific variant</span>
                        <select
                          value=""
                          onChange={e => {
                            const code = e.target.value
                            if (!code) return
                            setAddedCountries(prev => [...prev, code])
                            setActiveJurisdiction(code)
                            setEditingSample(null)
                          }}
                          className="h-[26px] cursor-pointer rounded-md border border-dashed border-border bg-card px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">+ Country variant</option>
                          {availableCountries.map(c => (
                            <option key={c.code} value={c.code}>{c.label}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>

                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {activeJurisdiction === UNIVERSAL ? (
                      <>
                        These samples are used for every country. Start here — you only need a country variant
                        when one patent office expects different phrasing.
                      </>
                    ) : (
                      <>
                        Used only when drafting for {jurisdictionLabel(activeJurisdiction)}. Sections you leave
                        empty here fall back to your <strong className="font-medium text-foreground">Every country</strong> samples.
                      </>
                    )}
                  </p>
                </div>

                {/* Sections */}
                <div className="p-5">
                  {loadingSamples || loadingSections ? (
                    <div className="space-y-3" aria-busy="true" aria-label="Loading sections">
                      {[0, 1, 2, 3].map(i => (
                        <div key={i} className="h-[92px] animate-pulse rounded-lg bg-muted" />
                      ))}
                    </div>
                  ) : sectionsError ? (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center">
                      <p className="text-sm font-medium text-foreground">
                        No sections are configured for {jurisdictionLabel(activeJurisdiction)}
                      </p>
                      <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                        Use <strong className="font-medium text-foreground">Every country</strong> instead — those
                        samples apply here too. If this country needs its own set, ask an administrator to configure it.
                      </p>
                      <Button variant="outline" size="sm" className="mt-4" onClick={() => setActiveJurisdiction(UNIVERSAL)}>
                        <Globe className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Back to every country
                      </Button>
                    </div>
                  ) : sections.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No sections available for {jurisdictionLabel(activeJurisdiction)}.
                    </p>
                  ) : (
                    <>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs text-muted-foreground">
                          {sections.length} section{sections.length === 1 ? '' : 's'} ·{' '}
                          {Object.keys(sampleCountsByJurisdiction).includes(activeJurisdiction)
                            ? `${sampleCountsByJurisdiction[activeJurisdiction]} taught`
                            : 'none taught yet'}
                        </p>
                        {!readOnly && (sampleCountsByJurisdiction[activeJurisdiction] || 0) > 0 && (
                          <button
                            type="button"
                            onClick={() => setJurisdictionToClear(activeJurisdiction)}
                            className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                          >
                            Clear all {jurisdictionLabel(activeJurisdiction)} samples
                          </button>
                        )}
                      </div>

                      <div className="space-y-2.5">
                        {sections.map(section => {
                          const sample = samples.find(
                            s => s.sectionKey === section.key && s.jurisdiction === activeJurisdiction
                          )
                          const universalSample =
                            activeJurisdiction !== UNIVERSAL
                              ? samples.find(s => s.sectionKey === section.key && s.jurisdiction === UNIVERSAL)
                              : undefined
                          const isEditing = editingSample?.sectionKey === section.key
                          const limits = SECTION_WORD_LIMITS[section.key] || DEFAULT_LIMITS
                          const key = isHighImpact(section.key)

                          return (
                            <div
                              key={section.key}
                              className={`rounded-lg border p-4 transition-colors ${
                                sample ? 'border-border bg-card' : 'border-dashed border-border bg-muted/20'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                                    {section.label}
                                    {key && (
                                      <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">
                                        Key
                                      </span>
                                    )}
                                    {section.isRequired === false && (
                                      <span className="text-[11px] font-normal text-muted-foreground">optional</span>
                                    )}
                                  </h3>
                                  {!isEditing && (
                                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                      {sectionBlurb(section.key)}
                                    </p>
                                  )}
                                </div>
                                {sample && !isEditing && (
                                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                                    <Check className="h-3.5 w-3.5" aria-hidden />
                                    {sample.wordCount} words
                                  </span>
                                )}
                              </div>

                              {isEditing ? (
                                <div className="mt-3">
                                  <Textarea
                                    autoFocus
                                    value={editingSample.text}
                                    onChange={e => setEditingSample({ sectionKey: section.key, text: e.target.value })}
                                    rows={8}
                                    aria-label={`Writing sample for ${section.label}`}
                                    className="min-h-[160px] resize-y font-normal leading-relaxed"
                                    placeholder={`Paste the ${section.label.toLowerCase()} from a patent you drafted — ${limits.recommended.min}–${limits.recommended.max} words works best.\n\nUse real text, not a description of your style. The drafter learns from the wording itself.`}
                                  />
                                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                                    <WordMeter text={editingSample.text} sectionKey={section.key} />
                                    <div className="flex items-center gap-2">
                                      {sample && (
                                        <button
                                          type="button"
                                          onClick={() => { void deleteSample(sample); setEditingSample(null) }}
                                          className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                                        >
                                          Remove
                                        </button>
                                      )}
                                      <Button variant="ghost" size="sm" onClick={() => setEditingSample(null)}>
                                        Cancel
                                      </Button>
                                      <Button
                                        size="sm"
                                        onClick={() => void saveSample(section.key, editingSample.text)}
                                        disabled={saving || countWords(editingSample.text) < limits.min}
                                      >
                                        {saving ? (
                                          <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> Saving</>
                                        ) : 'Save sample'}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              ) : sample ? (
                                <div className="mt-3">
                                  <p className="line-clamp-3 whitespace-pre-wrap rounded-md bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                                    {sample.sampleText}
                                  </p>
                                  {!readOnly && (
                                    <button
                                      type="button"
                                      onClick={() => setEditingSample({ sectionKey: section.key, text: sample.sampleText })}
                                      className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                                    >
                                      <Pencil className="h-3 w-3" aria-hidden /> Edit sample
                                    </button>
                                  )}
                                </div>
                              ) : readOnly ? (
                                <p className="mt-3 text-xs italic text-muted-foreground">Not taught in this persona.</p>
                              ) : (
                                <div className="mt-3 flex flex-wrap items-center gap-3">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setEditingSample({ sectionKey: section.key, text: '' })}
                                  >
                                    <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Add sample
                                  </Button>
                                  <span className="text-xs text-muted-foreground">
                                    {limits.recommended.min}–{limits.recommended.max} words
                                  </span>
                                  {universalSample && (
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                      <ArrowRight className="h-3 w-3" aria-hidden />
                                      Falls back to your Every country sample
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- Create / edit persona ---------------- */}
      {personaForm && (
        <Modal
          title={personaForm.mode === 'create' ? 'New writing persona' : 'Persona details'}
          onClose={() => setPersonaForm(null)}
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="persona-name">Name</Label>
              <Input
                id="persona-name"
                autoFocus
                value={personaForm.name}
                onChange={e => setPersonaForm({ ...personaForm, name: e.target.value })}
                className="mt-1.5"
                placeholder="e.g. Software — my style"
                maxLength={100}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Name it after the technology you write in, so you can pick the right one while drafting.
              </p>
            </div>

            <div>
              <Label htmlFor="persona-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea
                id="persona-description"
                value={personaForm.description}
                onChange={e => setPersonaForm({ ...personaForm, description: e.target.value })}
                rows={2}
                className="mt-1.5"
                placeholder="When to reach for this one — e.g. software and data-processing cases"
              />
            </div>

            {isAdmin && (
              <div>
                <Label htmlFor="persona-visibility">Who can use it</Label>
                <select
                  id="persona-visibility"
                  value={personaForm.visibility}
                  onChange={e => setPersonaForm({ ...personaForm, visibility: e.target.value as 'PRIVATE' | 'ORGANIZATION' })}
                  className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="PRIVATE">Only me</option>
                  <option value="ORGANIZATION">Everyone in my organization</option>
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {personaForm.visibility === 'ORGANIZATION'
                    ? 'Colleagues can draft with it and duplicate it, but only you can edit the samples.'
                    : 'Nobody else in your organization will see this persona.'}
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPersonaForm(null)}>Cancel</Button>
            <Button onClick={() => void savePersonaDetails()} disabled={saving || !personaForm.name.trim()}>
              {saving ? 'Saving…' : personaForm.mode === 'create' ? 'Create persona' : 'Save changes'}
            </Button>
          </div>
        </Modal>
      )}

      {/* ---------------- Duplicate ---------------- */}
      {duplicating && (
        <Modal title="Duplicate persona" onClose={() => setDuplicating(null)}>
          <p className="text-sm text-muted-foreground">
            This copies “{duplicating.source.name}” and all its samples into your own personas, where you can
            change them freely. The original stays untouched.
          </p>
          <div className="mt-4">
            <Label htmlFor="duplicate-name">Name your copy</Label>
            <Input
              id="duplicate-name"
              autoFocus
              value={duplicating.name}
              onChange={e => setDuplicating({ ...duplicating, name: e.target.value })}
              className="mt-1.5"
              maxLength={100}
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDuplicating(null)}>Cancel</Button>
            <Button onClick={() => void duplicatePersona()} disabled={saving || !duplicating.name.trim()}>
              {saving ? 'Duplicating…' : 'Duplicate'}
            </Button>
          </div>
        </Modal>
      )}

      {/* ---------------- Archive persona ---------------- */}
      {personaToArchive && (
        <Modal title="Archive this persona?" onClose={() => setPersonaToArchive(null)}>
          <p className="text-sm text-muted-foreground">
            “{personaToArchive.name}” will stop appearing when you draft, for every country. Its samples are kept,
            so recreating the persona with the same name brings them back.
          </p>
          <div className="mt-4">
            <Label htmlFor="archive-confirm">
              Type <span className="font-semibold text-destructive">delete</span> to confirm
            </Label>
            <Input
              id="archive-confirm"
              autoFocus
              autoComplete="off"
              value={archiveConfirmText}
              onChange={e => setArchiveConfirmText(e.target.value)}
              className="mt-1.5"
              placeholder="delete"
            />
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPersonaToArchive(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => void archivePersona()}
              disabled={archiveConfirmText.trim().toLowerCase() !== 'delete'}
            >
              Archive persona
            </Button>
          </div>
        </Modal>
      )}

      {/* ---------------- Clear jurisdiction ---------------- */}
      {jurisdictionToClear && selectedPersona && (
        <Modal title={`Clear ${jurisdictionLabel(jurisdictionToClear)} samples?`} onClose={() => setJurisdictionToClear(null)}>
          <p className="text-sm text-muted-foreground">
            This removes the {sampleCountsByJurisdiction[jurisdictionToClear] || 0} sample
            {(sampleCountsByJurisdiction[jurisdictionToClear] || 0) === 1 ? '' : 's'} you saved for{' '}
            {jurisdictionLabel(jurisdictionToClear)} in “{selectedPersona.name}”. Samples for other countries stay
            as they are, and you can add these again later.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setJurisdictionToClear(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void clearJurisdiction()}>Clear samples</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Modal({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
