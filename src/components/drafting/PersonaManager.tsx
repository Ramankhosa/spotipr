'use client'

/**
 * Persona picker for the drafting toolbar.
 *
 * Opened from the "Style" control in Stage 1 (claims) and the annexure stage.
 * Its job is to answer three questions in one screen: which style will be used,
 * whether that style has actually been taught anything yet, and how to fix it if
 * not. The full teaching surface lives at /personas — this links there rather
 * than duplicating it.
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  getPersonaReadiness,
  resolveCoveredSections,
  type PersonaSampleRef
} from '@/lib/persona-guidance'
import {
  X, Plus, Check, Building2, Lock, ExternalLink, AlertTriangle, Layers, Loader2
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
  isOwn: boolean
  createdBy?: { id: string; name: string }
  createdAt: string
}

interface PersonaManagerProps {
  isOpen: boolean
  onClose: () => void
  onSelectPersona?: (selection: PersonaSelection) => void
  currentSelection?: PersonaSelection
  /**
   * The jurisdiction about to be drafted. Readiness is reported against it,
   * because a persona taught only under another country resolves to nothing
   * here. Defaults to the universal set when the caller has no jurisdiction.
   */
  jurisdiction?: string
  /** Kept for call-site compatibility; the picker behaves the same either way. */
  showSelector?: boolean
}

export interface PersonaSelection {
  primaryPersonaId?: string
  primaryPersonaName?: string
  secondaryPersonaIds?: string[]
  secondaryPersonaNames?: string[]
}

export default function PersonaManager({
  isOpen,
  onClose,
  onSelectPersona,
  currentSelection,
  jurisdiction
}: PersonaManagerProps) {
  const { token } = useAuth()
  const { toast } = useToast()

  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [primaryId, setPrimaryId] = useState<string | undefined>(currentSelection?.primaryPersonaId)
  const [secondaryIds, setSecondaryIds] = useState<string[]>(currentSelection?.secondaryPersonaIds || [])
  const [showBlend, setShowBlend] = useState((currentSelection?.secondaryPersonaIds || []).length > 0)

  const [creatingName, setCreatingName] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchPersonas = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      const res = await fetch('/api/personas', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error('Could not load your personas')
      const data = await res.json()
      setPersonas([...(data.myPersonas || []), ...(data.orgPersonas || [])])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your personas')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (isOpen) void fetchPersonas()
  }, [isOpen, fetchPersonas])

  // Re-sync when the caller reopens with a different saved selection.
  useEffect(() => {
    if (!isOpen) return
    setPrimaryId(currentSelection?.primaryPersonaId)
    setSecondaryIds(currentSelection?.secondaryPersonaIds || [])
    setShowBlend((currentSelection?.secondaryPersonaIds || []).length > 0)
  }, [isOpen, currentSelection])

  const primary = useMemo(() => personas.find(p => p.id === primaryId), [personas, primaryId])
  const primaryReadiness = getPersonaReadiness(
    resolveCoveredSections(primary?.sampleCoverage, jurisdiction)
  )
  const primaryIsUntaught = !!primary && (primary.sampleCount === 0)

  const createPersona = async () => {
    if (!creatingName?.trim() || !token) return
    setSaving(true)
    try {
      const res = await fetch('/api/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: creatingName.trim(), visibility: 'PRIVATE' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create the persona')

      await fetchPersonas()
      if (data.persona?.id) setPrimaryId(data.persona.id)
      setCreatingName(null)
      toast({
        title: `“${data.persona?.name || creatingName.trim()}” created`,
        description: 'It has no writing samples yet — add some on the Writing Personas page.',
        variant: 'success'
      })
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Could not create the persona', variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const apply = () => {
    const secondaries = personas.filter(p => secondaryIds.includes(p.id))
    onSelectPersona?.({
      primaryPersonaId: primaryId,
      primaryPersonaName: primary?.name,
      secondaryPersonaIds: secondaryIds,
      secondaryPersonaNames: secondaries.map(p => p.name)
    })
    onClose()
  }

  if (!isOpen) return null

  const blendCandidates = personas.filter(p => p.id !== primaryId)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a writing style"
        className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">Choose a writing style</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Drafts will follow the samples you saved for this persona.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
            </div>
          ) : error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : personas.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <h3 className="text-sm font-semibold text-foreground">You have no writing personas yet</h3>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
                A persona is a saved writing style, taught with passages from patents you have already drafted.
                Create one here, then add samples on the Writing Personas page.
              </p>
              {creatingName === null ? (
                <Button size="sm" className="mt-4" onClick={() => setCreatingName('')}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Create a persona
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <fieldset>
                <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Main style
                </legend>
                <div className="space-y-2">
                  {personas.map(persona => {
                    const readiness = getPersonaReadiness(
                      resolveCoveredSections(persona.sampleCoverage, jurisdiction)
                    )
                    const selected = primaryId === persona.id
                    return (
                      <label
                        key={persona.id}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                          selected ? 'border-primary bg-accent' : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="primary-persona"
                          checked={selected}
                          onChange={() => {
                            setPrimaryId(persona.id)
                            setSecondaryIds(prev => prev.filter(id => id !== persona.id))
                          }}
                          className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{persona.name}</span>
                            {persona.isOwn ? (
                              <Lock className="h-3 w-3 text-muted-foreground" aria-label="Private to you" />
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                                <Building2 className="h-3 w-3" aria-hidden />
                                {persona.createdBy?.name || 'Organization'}
                              </span>
                            )}
                            {persona.isTemplate && (
                              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Template
                              </span>
                            )}
                          </span>
                          {persona.description && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {persona.description}
                            </span>
                          )}
                          <span className="mt-1 block text-xs">
                            {readiness.level === 'ready' ? (
                              <span className="inline-flex items-center gap-1 font-medium text-success">
                                <Check className="h-3 w-3" aria-hidden /> Ready to use
                              </span>
                            ) : persona.sampleCount === 0 ? (
                              <span className="font-medium text-warning">No samples yet</span>
                            ) : (
                              <span className="text-muted-foreground">
                                {readiness.label} · {persona.sampleCount} sample{persona.sampleCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </fieldset>

              {/* Optional blending — hidden until asked for, so the common case stays a simple list. */}
              {blendCandidates.length > 0 && primaryId && (
                <div className="mt-4 border-t border-border pt-4">
                  {!showBlend ? (
                    <button
                      type="button"
                      onClick={() => setShowBlend(true)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <Layers className="h-3.5 w-3.5" aria-hidden />
                      Blend in another style
                    </button>
                  ) : (
                    <fieldset>
                      <legend className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Blend in (optional)
                      </legend>
                      <p className="mb-2 mt-1 text-xs leading-relaxed text-muted-foreground">
                        The main style sets structure and voice. Blended styles only contribute vocabulary — useful
                        for a case that straddles two fields, such as a medical device with software.
                      </p>
                      <div className="space-y-1.5">
                        {blendCandidates.map(persona => (
                          <label
                            key={persona.id}
                            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              checked={secondaryIds.includes(persona.id)}
                              onChange={() =>
                                setSecondaryIds(prev =>
                                  prev.includes(persona.id)
                                    ? prev.filter(id => id !== persona.id)
                                    : [...prev, persona.id]
                                )
                              }
                              className="h-4 w-4 accent-[hsl(var(--primary))]"
                            />
                            <span className="truncate text-foreground">{persona.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {persona.sampleCount} sample{persona.sampleCount === 1 ? '' : 's'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}

              {/* Honest warning: selecting an empty persona changes nothing. */}
              {primaryIsUntaught && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
                  <span>
                    <strong className="font-medium">“{primary?.name}” has no writing samples.</strong> Drafts will
                    come out in the default voice until you add some.{' '}
                    <Link href="/personas" target="_blank" className="font-medium text-primary hover:underline">
                      Add samples
                    </Link>
                  </span>
                </div>
              )}
              {!primaryIsUntaught && primary && primaryReadiness.level === 'partial' && (
                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  “{primary.name}” covers {primaryReadiness.label.toLowerCase()}. It will work — filling the rest
                  sharpens it.
                </p>
              )}
            </>
          )}

          {/* Inline create */}
          {creatingName !== null && (
            <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
              <Label htmlFor="new-persona-name" className="text-xs">New persona name</Label>
              <div className="mt-1.5 flex gap-2">
                <Input
                  id="new-persona-name"
                  autoFocus
                  value={creatingName}
                  onChange={e => setCreatingName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void createPersona() }}
                  placeholder="e.g. Software — my style"
                  maxLength={100}
                />
                <Button size="sm" onClick={() => void createPersona()} disabled={saving || !creatingName.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : 'Create'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCreatingName(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4">
          <div className="flex items-center gap-3">
            {personas.length > 0 && creatingName === null && (
              <button
                type="button"
                onClick={() => setCreatingName('')}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden /> New persona
              </button>
            )}
            <Link
              href="/personas"
              target="_blank"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary"
            >
              Manage samples <ExternalLink className="h-3 w-3" aria-hidden />
            </Link>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" onClick={apply} disabled={!primaryId}>
              Use this style
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
