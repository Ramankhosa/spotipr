'use client'

/**
 * Hypotheses (stage 5) and their validation (stage 6), plus promotion to
 * concepts (stage 7).
 *
 * Presentation rules:
 *  - The six scores are always displayed together and never collapsed into one
 *    headline number. Type and status are words, shown separately — they are
 *    categorical facts, not scores.
 *  - The attack log is first-class: a hypothesis that survived four attacks and
 *    one that survived twelve must look like different objects.
 *  - "What this doesn't cover" lists data-coverage facts. They are properties
 *    of the corpus, stated plainly.
 *  - The attorney's review is the last thing on the card, below every machine
 *    caveat, because it is the judgment that outranks them.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ArrowUpRight, FlaskConical, Gavel, Loader2, Sparkles, Swords, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { GATE_LABEL, REVIEW_LABEL, STATUS_LABEL, STRATEGY_LABEL, TYPE_LABEL } from '@/lib/whitespace/labels'
import { HUMAN_REVIEW_VERDICTS, MIN_REVIEW_NOTE, type HumanReviewVerdict } from '@/lib/whitespace/types'
import { conflictRunId, isPollAborted, wsApi } from './api'
import { LiveActivityPanel } from './LiveActivityPanel'
import { DISTANCE_TOOLTIP } from './SemanticSearchPanel'
import { useRunActivity } from './useRunActivity'

interface HypothesisRow {
  id: string
  statement: string
  rationale: string
  type: string
  status: string
  clusterLabel: string | null
  elementCombination: { elements?: string[]; strategy?: string } | null
  scores: {
    density: number | null
    rarity: number | null
    semanticNovelty: number | null
    evidenceQuality: number | null
    confidence: number | null
    crowdedness: number | null
    strength: number | null
  } | null
  validation: {
    attacks: Array<{ strategy: string; query: string; hits: number; outcome: string; reason?: string }>
    gates: Array<{ gate: string; outcome: string; basis: string }>
    attacksRun: number
    attacksPlanned: number
    redTeamNotes: string | null
  } | null
  coverageLimitations: string[] | null
  humanReview: { verdict: HumanReviewVerdict; note: string | null; reviewedAt: string } | null
  evidence: Array<{
    id: string
    kind: string
    stance: string
    refId: string | null
    passage: string | null
    score: number | null
    data?: { role?: string; title?: string | null; rank?: number } | null
  }>
}

interface ConceptRow {
  id: string
  hypothesisId: string | null
  title: string
  summary: string
  status: string
  features: { requiredElements?: string[]; openQuestions?: string[] } | null
}

/** The slice of the study GET's `runs[]` used to re-attach to live validations. */
interface StudyRunRow {
  id: string
  stage: string
  status: string
  params?: Record<string, unknown> | null
}

function paramString(params: StudyRunRow['params'], key: string): string | undefined {
  const value = params?.[key]
  return typeof value === 'string' ? value : undefined
}

/** Verdict chip colours. Endorsement is the only one that earns the accent. */
const REVIEW_TONE: Record<HumanReviewVerdict, string> = {
  ENDORSED: 'bg-primary/10 text-primary',
  REJECTED: 'bg-destructive/10 text-destructive',
  NEEDS_INVESTIGATION: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
}

export function HypothesesPanel({
  studyId,
  areasReady,
  onChanged,
  proposeEnabled = true,
  emptyHint,
  refreshToken,
}: {
  studyId: string
  areasReady: boolean
  onChanged?: () => void
  /**
   * Invention studies reach hypotheses by promoting a measured gap, never by
   * asking a model for them — the generator reads landscape clusters, which an
   * invention study does not have. False hides the proposal affordance rather
   * than offering a button that can only fail.
   */
  proposeEnabled?: boolean
  /** Replaces the landscape-specific empty state when the route differs. */
  emptyHint?: string
  /**
   * Bump to refetch data in place. Deliberately a prop rather than a `key`:
   * remounting on every upstream stage completion destroyed an in-progress
   * review draft, the open verdict chips and the scroll position.
   */
  refreshToken?: number
}) {
  const { toast } = useToast()
  const [hypotheses, setHypotheses] = useState<HypothesisRow[]>([])
  const [concepts, setConcepts] = useState<ConceptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [savingReview, setSavingReview] = useState(false)
  const [draftVerdict, setDraftVerdict] = useState<HumanReviewVerdict | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [hasValidating, setHasValidating] = useState(false)

  // Live narration for validations in flight, keyed by the card they belong to.
  const activity = useRunActivity(studyId)
  const { watch: watchRun, dismiss: dismissRun } = activity
  const [liveByHypothesis, setLiveByHypothesis] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const data = await wsApi<{ hypotheses: HypothesisRow[]; concepts: ConceptRow[] }>(
        `/api/whitespace/studies/${studyId}/hypotheses`
      )
      setHypotheses(data.hypotheses)
      setConcepts(data.concepts)
      setLoadFailed(null)
      setHasValidating(data.hypotheses.some(hypothesis => hypothesis.status === 'VALIDATING'))
    } catch (error) {
      // Auth errors surface on the study page; anything else must not pass
      // itself off as a genuinely empty hypothesis list.
      if ((error as { status?: number })?.status !== 401) {
        setLoadFailed(error instanceof Error ? error.message : 'Could not load the hypotheses.')
      }
    } finally {
      setLoading(false)
    }
  }, [studyId])

  // `refreshToken` refetches in place — same data path, no state reset.
  useEffect(() => {
    void load()
  }, [load, refreshToken])

  const generate = useCallback(async () => {
    setGenerating(true)
    try {
      await wsApi(`/api/whitespace/studies/${studyId}/hypotheses/generate`, { method: 'POST' })
      await load()
      onChanged?.()
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not propose hypotheses',
        description: error instanceof Error ? error.message : 'Try again.',
      })
    } finally {
      setGenerating(false)
    }
  }, [studyId, toast, load, onChanged])

  // Validation is the longest stage in the studio; without an abort tied to
  // unmount its poll outlived the panel by up to twenty minutes.
  const pollAbort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      pollAbort.current?.abort()
    },
    []
  )

  const validate = useCallback(
    async (hypothesisId: string) => {
      setValidatingId(hypothesisId)
      pollAbort.current?.abort()
      const controller = new AbortController()
      pollAbort.current = controller
      try {
        let runId: string
        try {
          const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
            method: 'POST',
            body: JSON.stringify({ stage: 'VALIDATE', params: { hypothesisId } }),
          })
          runId = started.runId
        } catch (error) {
          // 409 means this hypothesis is already being validated — attach to
          // that run rather than reporting a failure for work under way.
          const liveRunId = conflictRunId(error)
          if (!liveRunId) throw error
          runId = liveRunId
        }
        setLiveByHypothesis(current => ({ ...current, [hypothesisId]: runId }))
        const final = await watchRun(runId, controller.signal)
        if (final.status === 'FAILED') {
          toast({ variant: 'error', title: 'Validation did not finish', description: final.error || 'Run it again.' })
        }
        await load()
        onChanged?.()
      } catch (error) {
        if (isPollAborted(error)) return
        toast({
          variant: 'error',
          title: 'Could not start validation',
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        if (pollAbort.current === controller) pollAbort.current = null
        // Clear only if still the owner — validating B aborts A, whose finally
        // must not wipe B's spinner and re-enable its button mid-run.
        setValidatingId(current => (current === hypothesisId ? null : current))
      }
    },
    [studyId, toast, load, onChanged, watchRun]
  )

  /**
   * Re-attaches after a reload: a hypothesis left VALIDATING has a QUEUED or
   * PROCESSING VALIDATE run behind it, and without a poll it read "Validating"
   * forever. Watches every live VALIDATE run — each mapped to its card by
   * params.hypothesisId, when the payload carries it — and refreshes when they
   * settle; a failure is not toasted because the user did not just start this
   * work. The card's panel shows it.
   */
  const reattachValidation = useCallback(async () => {
    if (pollAbort.current) return
    const controller = new AbortController()
    pollAbort.current = controller
    try {
      const data = await wsApi<{ runs: StudyRunRow[] }>(`/api/whitespace/studies/${studyId}`, {
        signal: controller.signal,
      })
      const live = data.runs.filter(
        run => run.stage === 'VALIDATE' && (run.status === 'QUEUED' || run.status === 'PROCESSING')
      )
      if (!live.length) {
        // No run to wait on (orphaned status) — stop re-attempting.
        setHasValidating(false)
        return
      }
      const byHypothesis: Record<string, string> = {}
      for (const run of live) {
        const hypothesisId = paramString(run.params, 'hypothesisId')
        // Newest first: the first run seen for a hypothesis is the one to show.
        if (hypothesisId && !byHypothesis[hypothesisId]) byHypothesis[hypothesisId] = run.id
      }
      if (Object.keys(byHypothesis).length) setLiveByHypothesis(current => ({ ...current, ...byHypothesis }))
      await Promise.all(live.map(run => watchRun(run.id, controller.signal)))
      await load()
      onChanged?.()
    } catch (error) {
      if (isPollAborted(error)) return
      // Background re-attach; the cards keep their status until the next load.
    } finally {
      if (pollAbort.current === controller) pollAbort.current = null
    }
  }, [studyId, load, onChanged, watchRun])

  useEffect(() => {
    if (hasValidating) void reattachValidation()
  }, [hasValidating, reattachValidation])

  const convert = useCallback(
    async (hypothesisId: string) => {
      setConvertingId(hypothesisId)
      try {
        const result = await wsApi<{ concept: { title: string } }>(
          `/api/whitespace/studies/${studyId}/hypotheses/${hypothesisId}/convert`,
          { method: 'POST' }
        )
        toast({ variant: 'success', title: 'Promoted to concept', description: result.concept.title })
        await load()
        onChanged?.()
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not promote it',
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        setConvertingId(null)
      }
    },
    [studyId, toast, load, onChanged]
  )

  const openReview = useCallback((hypothesis: HypothesisRow) => {
    setReviewingId(hypothesis.id)
    setDraftVerdict(hypothesis.humanReview?.verdict ?? null)
    setDraftNote(hypothesis.humanReview?.note ?? '')
  }, [])

  const saveReview = useCallback(
    async (hypothesisId: string, verdict: HumanReviewVerdict | null, note: string) => {
      setSavingReview(true)
      try {
        await wsApi(`/api/whitespace/studies/${studyId}/hypotheses/${hypothesisId}`, {
          method: 'PATCH',
          body: JSON.stringify({ verdict, note }),
        })
        // Only a successful save may discard what the attorney typed.
        setReviewingId(null)
        setDraftVerdict(null)
        setDraftNote('')
        await load()
        onChanged?.()
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not save the review',
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        setSavingReview(false)
      }
    },
    [studyId, toast, load, onChanged]
  )

  return (
    <section className="mt-10 rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Hypotheses</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Candidate gaps, proposed from measured signals — then attacked. An empty area is a question; only a
            hypothesis that survives its attacks becomes an answer.
          </p>
        </div>
        {proposeEnabled && (
          <Button size="sm" onClick={() => void generate()} disabled={generating || !areasReady}>
            {generating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
            {hypotheses.length ? 'Propose more' : 'Propose hypotheses'}
          </Button>
        )}
      </div>

      <div className="px-5 py-5">
        {proposeEnabled && !areasReady && (
          <p className="text-sm text-muted-foreground">
            Map and measure the areas first — hypotheses are proposed from those numbers, not from a blank page.
          </p>
        )}

        {areasReady && loading && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading hypotheses…</span>
          </div>
        )}

        {areasReady && !loading && loadFailed && !hypotheses.length && !generating && (
          <p className="text-sm text-muted-foreground">
            The hypotheses could not be loaded — {loadFailed}{' '}
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={() => {
                setLoading(true)
                void load()
              }}
            >
              Retry
            </Button>
          </p>
        )}

        {areasReady && !loading && !loadFailed && !hypotheses.length && !generating && (
          <p className="text-sm text-muted-foreground">
            {emptyHint ??
              'None yet. Reading claims in a few areas first (above) gives the generator its strongest signal — element combinations the field measurably avoids.'}
          </p>
        )}

        {generating && !hypotheses.length && (
          <div className="flex items-center gap-2 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Reading the signals and drafting testable statements…</span>
          </div>
        )}

        <ul className="space-y-5">
          {hypotheses.map(hypothesis => {
            const validating = validatingId === hypothesis.id
            const scores = hypothesis.scores
            const validation = hypothesis.validation
            const refuted = hypothesis.status === 'REFUTED'
            const promoted = concepts.some(concept => concept.hypothesisId === hypothesis.id)
            const liveState = activity.get(liveByHypothesis[hypothesis.id])
            return (
              <li key={hypothesis.id} className={`rounded-md border p-4 ${refuted ? 'border-border bg-muted/30' : 'border-border'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      hypothesis.status === 'VALIDATED'
                        ? 'bg-primary/10 text-primary'
                        : refuted
                          ? 'bg-muted text-muted-foreground line-through'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {STATUS_LABEL[hypothesis.status] ?? hypothesis.status}
                  </span>
                  <span className="text-xs text-muted-foreground">{TYPE_LABEL[hypothesis.type] ?? hypothesis.type}</span>
                  {hypothesis.clusterLabel && (
                    <span className="text-xs text-muted-foreground">· in “{hypothesis.clusterLabel}”</span>
                  )}
                </div>

                <p className={`mt-2 font-medium ${refuted ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {hypothesis.statement}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{hypothesis.rationale}</p>

                {(hypothesis.elementCombination?.elements?.length ?? 0) > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Elements: {hypothesis.elementCombination!.elements!.join(' · ')}
                  </p>
                )}

                {scores && (
                  <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 sm:grid-cols-6">
                    <Score label="Density" value={scores.density} />
                    <Score label="Rarity" value={scores.rarity} />
                    <Score label="Novelty" value={scores.semanticNovelty} />
                    <Score label="Evidence" value={scores.evidenceQuality} />
                    <Score label="Confidence" value={scores.confidence} />
                    <Score label="Crowding" value={scores.crowdedness} />
                  </div>
                )}

                <NearestArt evidence={hypothesis.evidence} />

                {validation && (
                  <details className="mt-3 rounded-md bg-muted/40 px-3 py-2" open={refuted}>
                    <summary className="cursor-pointer text-sm font-medium text-foreground">
                      <Swords className="mr-1.5 inline h-3.5 w-3.5" />
                      How it was tested — {validation.attacksRun} of {validation.attacksPlanned} attacks ran
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                      {validation.attacks.map((attack, index) => (
                        <li key={index} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{STRATEGY_LABEL[attack.strategy] ?? attack.strategy}:</span>{' '}
                          “{attack.query.slice(0, 120)}” — {attack.hits} hits,{' '}
                          {attack.outcome === 'CLEAN'
                            ? 'nothing close'
                            : attack.outcome === 'WEAKENING'
                              ? 'close-but-partial art found'
                              : attack.outcome === 'REFUTING'
                                ? 'refuting art found'
                                : `not run — ${attack.reason ?? 'unavailable'}`}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                      {validation.gates.map(gate => (
                        <p key={gate.gate} className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{GATE_LABEL[gate.gate] ?? gate.gate}:</span>{' '}
                          {gate.basis}
                        </p>
                      ))}
                    </div>
                    {validation.redTeamNotes && (
                      <p className="mt-2 text-xs text-muted-foreground">Red team: {validation.redTeamNotes}</p>
                    )}
                  </details>
                )}

                {(hypothesis.coverageLimitations?.length ?? 0) > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">What this doesn&apos;t cover</summary>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {hypothesis.coverageLimitations!.map((limitation, index) => (
                        <li key={index}>{limitation}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {/* The attorney's word, placed after every machine caveat. */}
                {hypothesis.humanReview && reviewingId !== hypothesis.id && (
                  <div className="mt-3 rounded-md border border-primary/30 bg-primary/[0.04] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${REVIEW_TONE[hypothesis.humanReview.verdict]}`}
                      >
                        {REVIEW_LABEL[hypothesis.humanReview.verdict]}
                      </span>
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Your review — the operative judgment
                      </span>
                      <span className="text-xs text-muted-foreground">
                        · {hypothesis.humanReview.reviewedAt.slice(0, 10)}
                      </span>
                    </div>
                    {hypothesis.humanReview.note && (
                      <p className="mt-2 whitespace-pre-line text-sm text-foreground">{hypothesis.humanReview.note}</p>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => openReview(hypothesis)}
                      >
                        Revise
                      </button>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        onClick={() => void saveReview(hypothesis.id, null, '')}
                        disabled={savingReview}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                {reviewingId === hypothesis.id && (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Your verdict
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {HUMAN_REVIEW_VERDICTS.map(verdict => (
                        <button
                          key={verdict}
                          type="button"
                          onClick={() => setDraftVerdict(verdict)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                            draftVerdict === verdict
                              ? `border-transparent ${REVIEW_TONE[verdict]}`
                              : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                          }`}
                        >
                          {REVIEW_LABEL[verdict]}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      className="mt-3 text-sm"
                      rows={3}
                      value={draftNote}
                      onChange={event => setDraftNote(event.target.value)}
                      placeholder={
                        draftVerdict === 'REJECTED'
                          ? `Why are you setting this aside? (at least ${MIN_REVIEW_NOTE} characters — it goes in the report as your reasoning)`
                          : 'Your reasoning, in your words. It appears in the exported report.'
                      }
                    />
                    {/* The server enforces this floor; saying so before Save
                        beats an error toast after it. Trimmed, as the server trims. */}
                    {draftVerdict === 'REJECTED' && draftNote.trim().length < MIN_REVIEW_NOTE && (
                      <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                        {draftNote.trim().length} / {MIN_REVIEW_NOTE} characters — a rejection needs your reasoning.
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        disabled={
                          !draftVerdict ||
                          savingReview ||
                          (draftVerdict === 'REJECTED' && draftNote.trim().length < MIN_REVIEW_NOTE)
                        }
                        onClick={() => draftVerdict && void saveReview(hypothesis.id, draftVerdict, draftNote)}
                      >
                        {savingReview ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        Save review
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={savingReview}
                        onClick={() => {
                          setReviewingId(null)
                          setDraftNote('')
                          setDraftVerdict(null)
                        }}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {!refuted && hypothesis.status !== 'VALIDATING' && (
                    <Button variant={hypothesis.status === 'DRAFT' ? 'default' : 'outline'} size="sm" onClick={() => void validate(hypothesis.id)} disabled={validating}>
                      {validating ? (
                        <>
                          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Attacking it…
                        </>
                      ) : (
                        <>
                          <FlaskConical className="mr-2 h-3.5 w-3.5" />
                          {validation ? 'Test again' : 'Try to refute it'}
                        </>
                      )}
                    </Button>
                  )}
                  {hypothesis.status === 'VALIDATED' && !promoted && (
                    <Button variant="outline" size="sm" onClick={() => void convert(hypothesis.id)} disabled={convertingId === hypothesis.id}>
                      {convertingId === hypothesis.id ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ArrowUpRight className="mr-2 h-3.5 w-3.5" />
                      )}
                      Promote to concept
                    </Button>
                  )}
                  {!hypothesis.humanReview && reviewingId !== hypothesis.id && (
                    <Button variant="outline" size="sm" onClick={() => openReview(hypothesis)}>
                      <Gavel className="mr-2 h-3.5 w-3.5" />
                      Record your verdict
                    </Button>
                  )}
                  {promoted && <span className="text-xs text-muted-foreground">Promoted to a concept below.</span>}
                </div>

                {/* The attack's own narration — what has been run, never a verdict. */}
                <AnimatePresence>
                  {liveState && (
                    <LiveActivityPanel
                      key={liveState.runId}
                      variant="compact"
                      state={liveState}
                      className="mt-3"
                      onDismiss={() => dismissRun(liveState.runId)}
                    />
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>

        {concepts.length > 0 && (
          <div className="mt-8">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Invention directions
            </h3>
            <ul className="space-y-3">
              {concepts.map(concept => (
                <li key={concept.id} className="rounded-md border border-primary/25 bg-primary/[0.03] p-4">
                  <p className="font-medium text-foreground">{concept.title}</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{concept.summary.slice(0, 400)}</p>
                  {(concept.features?.requiredElements?.length ?? 0) > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Required elements: {concept.features!.requiredElements!.join(' · ')}
                    </p>
                  )}
                  {(concept.features?.openQuestions?.length ?? 0) > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Open questions for human judgment
                      </summary>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {concept.features!.openQuestions!.map((question, index) => (
                          <li key={index}>{question}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * The nearest documents to the hypothesis statement, captured at generation
 * time (data.role NEAREST_ART discriminates them from validation's own
 * PATENT_PASSAGE rows). Hypotheses generated before the capture existed have
 * no such rows, and the section simply doesn't render — an honest omission,
 * not a warning.
 */
function NearestArt({ evidence }: { evidence: HypothesisRow['evidence'] }) {
  const rows = evidence
    .filter(item => item.kind === 'PATENT_PASSAGE' && item.data?.role === 'NEAREST_ART')
    .sort((a, b) => (a.data?.rank ?? a.score ?? 0) - (b.data?.rank ?? b.score ?? 0))
  if (!rows.length) return null
  return (
    <details className="mt-3 rounded-md bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Closest existing art — {rows.length} famil{rows.length === 1 ? 'y' : 'ies'}
      </summary>
      <p className="mt-1.5 text-xs text-muted-foreground">
        The nearest documents in this field to the statement above, by meaning. Read them before
        trusting the gap — the closest art is the art most likely to anticipate it.
      </p>
      <ol className="mt-2 space-y-2">
        {rows.map(item => (
          <li key={item.id} className="text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-[11px] text-muted-foreground">{item.refId}</span>
              <span className="min-w-0 flex-1 font-medium text-foreground">
                {item.data?.title ?? 'Untitled'}
              </span>
              {typeof item.score === 'number' && (
                <span className="font-mono text-[11px] text-muted-foreground" title={DISTANCE_TOOLTIP}>
                  dist {item.score.toFixed(2)}
                </span>
              )}
            </div>
            {item.passage && (
              <p className="mt-0.5 line-clamp-2 text-muted-foreground">{item.passage}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}

/** One of six — always shown together, never averaged into a headline. */
function Score({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      {value === null ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-full max-w-[64px] rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
        </div>
      )}
    </div>
  )
}
