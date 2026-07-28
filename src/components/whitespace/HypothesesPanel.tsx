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
 */

import { useCallback, useEffect, useState } from 'react'
import { ArrowUpRight, FlaskConical, Loader2, Sparkles, Swords } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { pollRun, wsApi } from './api'

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
  evidence: Array<{ id: string; kind: string; stance: string; refId: string | null; passage: string | null }>
}

interface ConceptRow {
  id: string
  hypothesisId: string | null
  title: string
  summary: string
  status: string
  features: { requiredElements?: string[]; openQuestions?: string[] } | null
}

const TYPE_LABEL: Record<string, string> = {
  UNDETERMINED: 'Not yet tested',
  DATA_WHITESPACE: 'Data gap — corpus cannot see this area',
  TERMINOLOGY_WHITESPACE: 'Vocabulary gap — patented under other words',
  PATENT_WHITESPACE: 'Sparse area',
  CLAIM_WHITESPACE: 'Claim gap — patents exist, claims do not recite this',
  SCIENTIFIC_WHITESPACE: 'Untouched by patents and literature',
  PRODUCT_WHITESPACE: 'Patented but not productised',
  TECHNICAL_FEASIBILITY_WHITESPACE: 'Tried and abandoned',
  COMMERCIAL_WHITESPACE: 'Feasible but uneconomic',
  REGULATORY_WHITESPACE: 'Blocked by regulation',
  GENUINE: 'Genuine opening — survived all tests',
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Proposed',
  VALIDATING: 'Being tested',
  VALIDATED: 'Survived testing',
  REFUTED: 'Refuted',
  INCONCLUSIVE: 'Inconclusive',
}

const GATE_LABEL: Record<string, string> = {
  G1_DATA: 'Data coverage',
  G2_TERMINOLOGY: 'Vocabulary',
  G3_ADJACENT_CLAIMS: 'Adjacent claims',
  G4_FEASIBILITY: 'Feasibility',
  G5_COMMERCIAL: 'Commercial',
  G6_REGULATORY: 'Regulatory',
}

const STRATEGY_LABEL: Record<string, string> = {
  SYNONYM_SHIFTED: 'Other vocabulary',
  SEMANTIC_PARAPHRASE: 'Meaning search',
  CPC_ADJACENT: 'Adjacent classes',
  ASSIGNEE_PIVOT: 'Competitor portfolios',
  RED_TEAM: 'Red team',
  LITERATURE: 'Literature',
}

export function HypothesesPanel({
  studyId,
  areasReady,
  onChanged,
}: {
  studyId: string
  areasReady: boolean
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const [hypotheses, setHypotheses] = useState<HypothesisRow[]>([])
  const [concepts, setConcepts] = useState<ConceptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [validatingId, setValidatingId] = useState<string | null>(null)
  const [convertingId, setConvertingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await wsApi<{ hypotheses: HypothesisRow[]; concepts: ConceptRow[] }>(
        `/api/whitespace/studies/${studyId}/hypotheses`
      )
      setHypotheses(data.hypotheses)
      setConcepts(data.concepts)
    } catch {
      // Auth errors surface on the study page; this panel keeps its empty state.
    } finally {
      setLoading(false)
    }
  }, [studyId])

  useEffect(() => {
    void load()
  }, [load])

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

  const validate = useCallback(
    async (hypothesisId: string) => {
      setValidatingId(hypothesisId)
      try {
        const started = await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, {
          method: 'POST',
          body: JSON.stringify({ stage: 'VALIDATE', params: { hypothesisId } }),
        })
        const final = await pollRun(studyId, started.runId)
        if (final.status === 'FAILED') {
          toast({ variant: 'error', title: 'Validation did not finish', description: final.error || 'Run it again.' })
        }
        await load()
        onChanged?.()
      } catch (error) {
        toast({
          variant: 'error',
          title: 'Could not start validation',
          description: error instanceof Error ? error.message : 'Try again.',
        })
      } finally {
        setValidatingId(null)
      }
    },
    [studyId, toast, load, onChanged]
  )

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
        <Button size="sm" onClick={() => void generate()} disabled={generating || !areasReady}>
          {generating ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-2 h-3.5 w-3.5" />}
          {hypotheses.length ? 'Propose more' : 'Propose hypotheses'}
        </Button>
      </div>

      <div className="px-5 py-5">
        {!areasReady && (
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

        {areasReady && !loading && !hypotheses.length && !generating && (
          <p className="text-sm text-muted-foreground">
            None yet. Reading claims in a few areas first (above) gives the generator its strongest signal — element
            combinations the field measurably avoids.
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
                  {promoted && <span className="text-xs text-muted-foreground">Promoted to a concept below.</span>}
                </div>
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
