'use client'

// Claim challenge panel.
//
// An opt-in adversarial review the attorney asks for. Nothing here is shown
// unless they open the panel: these are examiner-style objections raised on
// request, not the product volunteering doubts about its own output.
//
// Three steps, in one drawer: run the challenge, review the remarks, review the
// resulting amendments as per-claim diffs before applying them.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronLeft,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import { renderDiff } from '@/components/drafting/claim-diff'

type Disposition = 'pending' | 'accepted' | 'dismissed'

type ChallengeRemark = {
  id: string
  source: 'llm' | 'lint' | 'user'
  claims: number[]
  cat: string
  sev: 'H' | 'M' | 'L'
  objection: string
  fix: string
  disposition: Disposition
  editedFix?: string
  refs?: string[]
  verbatimReuse?: Array<{ publicationNumber: string; snippet: string }>
}

type ArtReference = {
  publicationNumber: string
  title?: string | null
  completeness?: 'FULL' | 'FIRST_CLAIM_ONLY' | 'PARTIAL'
}

type RefinedClaim = {
  number: number
  original_text?: string
  refined_text: string | null
  keep_as_is: boolean
  change_reason?: string
  remark_refs?: string[]
}

type AddedClaim = {
  number: number
  text: string
  dependsOn: number
  reason?: string
  remark_refs?: string[]
}

interface ClaimChallengePanelProps {
  session: any
  open: boolean
  onClose: () => void
  claimsStructured: any[]
  claimsFrozen: boolean
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

const CATEGORY_LABELS: Record<string, string> = {
  DEFINITENESS: 'Definiteness',
  PICTURE_CLAIM: 'Picture claiming',
  JARGON: 'Nomenclature',
  CATEGORY_MIX: 'Statutory category',
  SEQUENCE_CONFLATION: 'Sequence discipline',
  ANTECEDENT_BASIS: 'Antecedent basis',
  TERMINOLOGY_DRIFT: 'Terminology drift',
  UNSUPPORTED_MATTER: 'Support',
  CLAIM_FORM: 'Claim form',
  DEPENDENCY: 'Dependency',
  FUNCTIONAL_CLAIMING: 'Functional claiming',
  OPTIONAL_LANGUAGE: 'Optional language',
  RANGES: 'Ranges',
  CLAIM_SET_STRATEGY: 'Claim set strategy',
  REDUNDANCY: 'Redundancy',
  NEGATIVE_LIMITATION: 'Negative limitation',
  PRIOR_ART_SIGNAL: 'Possible prior art',
  USER_FOCUS: 'Your focus',
  OTHER: 'Other',
}

const COMPLETENESS_LABELS: Record<string, string> = {
  FULL: 'full claim set',
  FIRST_CLAIM_ONLY: 'first claim only',
  PARTIAL: 'partial claims',
}

const SEVERITY_STYLES: Record<string, string> = {
  H: 'bg-wax-50 text-wax-700 border-wax-200',
  M: 'bg-amber-50 text-amber-700 border-amber-200',
  L: 'bg-paper-100 text-ai-graphite-600 border-paper-300',
}

const SEVERITY_LABELS: Record<string, string> = { H: 'High', M: 'Medium', L: 'Low' }

export default function ClaimChallengePanel({
  session,
  open,
  onClose,
  claimsStructured,
  claimsFrozen,
  onComplete,
  onRefresh,
}: ClaimChallengePanelProps) {
  const normalized = session?.ideaRecord?.normalizedData || {}

  const [challenge, setChallenge] = useState<any>(null)
  const [preview, setPreview] = useState<any>(null)
  const [focusText, setFocusText] = useState('')
  // Opt-in per run: similar corpus claim sets as a vocabulary reference.
  const [useArtReferences, setUseArtReferences] = useState(false)
  const [dispositions, setDispositions] = useState<Record<string, Disposition>>({})
  const [editedFixes, setEditedFixes] = useState<Record<string, string>>({})
  const [newRemark, setNewRemark] = useState<{ claims: string; objection: string; fix: string } | null>(null)
  const [acceptMap, setAcceptMap] = useState<Record<number, boolean>>({})
  const [addedAcceptMap, setAddedAcceptMap] = useState<Record<number, boolean>>({})
  const [step, setStep] = useState<'remarks' | 'diff'>('remarks')
  const [isRunning, setIsRunning] = useState(false)
  const [isDrafting, setIsDrafting] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)

  // Identity of the review the local state was last seeded from. Dispositions
  // and edited instructions live only in this panel until "Draft amendments"
  // sends them, so a session refetch triggered by some other stage action must
  // not wipe them; only a review that actually changed on the server may.
  const seededKeyRef = useRef<string | null>(null)
  const seedKeyFor = (stored: any, storedPreview: any) =>
    JSON.stringify([
      stored?.generatedAt || null,
      stored?.dispositionsSavedAt || null,
      stored?.status || null,
      storedPreview?.generatedAt || null,
    ])

  const seedReview = (stored: any, storedPreview: any) => {
    seededKeyRef.current = seedKeyFor(stored, storedPreview)
    setChallenge(stored)
    setPreview(storedPreview)
    setStep(storedPreview ? 'diff' : 'remarks')
    const next: Record<string, Disposition> = {}
    const fixes: Record<string, string> = {}
    ;(stored?.remarks || []).forEach((remark: ChallengeRemark) => {
      next[remark.id] = remark.disposition || 'pending'
      if (remark.editedFix) fixes[remark.id] = remark.editedFix
    })
    setDispositions(next)
    setEditedFixes(fixes)
    const accept: Record<number, boolean> = {}
    ;(storedPreview?.refinedClaims || []).forEach((claim: RefinedClaim) => {
      if (claim.refined_text) accept[Number(claim.number)] = true
    })
    setAcceptMap(accept)
    const added: Record<number, boolean> = {}
    ;(storedPreview?.addedClaims || []).forEach((claim: AddedClaim) => {
      added[Number(claim.number)] = true
    })
    setAddedAcceptMap(added)
  }

  // Seed from the session so a reopened panel resumes an in-flight review.
  useEffect(() => {
    const stored = normalized.claimsChallenge || null
    const storedPreview = normalized.claimsChallengeRefinePreview || null
    if (seededKeyRef.current === seedKeyFor(stored, storedPreview)) return
    seedReview(stored, storedPreview)
    setFocusText(stored?.focusText || '')
    setUseArtReferences(stored?.useArtReferences === true)
    setNewRemark(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const isApplied = challenge?.status === 'APPLIED'
  const resolution = isApplied ? normalized.claimsChallengeResolution || null : null

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const remarks: ChallengeRemark[] = useMemo(
    () => (Array.isArray(challenge?.remarks) ? challenge.remarks : []),
    [challenge]
  )

  const acceptedCount = useMemo(
    () => remarks.filter(remark => (dispositions[remark.id] || remark.disposition) === 'accepted').length,
    [remarks, dispositions]
  )

  // The remarks cite claim numbers and wording; an edit since then makes them
  // point at text that no longer exists. Applying the amendments is itself such
  // an edit, so a finished review is never reported as stale. The server holds
  // the authoritative fingerprint check; this only decides whether to warn.
  const isStale = useMemo(() => {
    if (!challenge?.generatedAt || challenge.status === 'APPLIED') return false
    const edited = normalized.claimsLastSavedAt || normalized.claimsGeneratedAt
    if (!edited) return false
    return new Date(edited).getTime() > new Date(challenge.generatedAt).getTime()
  }, [challenge, normalized.claimsLastSavedAt, normalized.claimsGeneratedAt])

  const acceptedAmendmentCount = useMemo(
    () =>
      Object.values(acceptMap).filter(Boolean).length +
      Object.values(addedAcceptMap).filter(Boolean).length,
    [acceptMap, addedAcceptMap]
  )

  const claimText = (number: number) => {
    const found = (claimsStructured || []).find((claim: any) => Number(claim?.number) === Number(number))
    return found?.text || ''
  }

  const runChallenge = async () => {
    setIsRunning(true)
    setError(null)
    setApplied(null)
    try {
      const result = await onComplete({
        action: 'challenge_claims',
        sessionId: session.id,
        focusText: focusText.trim() || undefined,
        useArtReferences,
      })
      // The page returns null when it swallowed the failure itself.
      if (!result || result.error) {
        setError(result?.error || 'The challenge could not be completed. Please retry.')
        return
      }
      seedReview(result.challenge, null)
      setNewRemark(null)
    } catch (err: any) {
      setError(err?.message || 'The challenge could not be completed.')
    } finally {
      setIsRunning(false)
    }
  }

  const draftAmendments = async () => {
    setIsDrafting(true)
    setError(null)
    try {
      const userRemarks = newRemark && (newRemark.objection.trim() || newRemark.fix.trim())
        ? [{
            claims: newRemark.claims
              .split(/[,\s]+/)
              .map(value => Number(value))
              .filter(value => Number.isFinite(value) && value > 0),
            objection: newRemark.objection.trim(),
            fix: newRemark.fix.trim(),
          }]
        : []

      const result = await onComplete({
        action: 'challenge_refine_preview',
        sessionId: session.id,
        remarkDispositions: remarks.map(remark => ({
          id: remark.id,
          disposition: dispositions[remark.id] || remark.disposition,
          editedFix: editedFixes[remark.id],
        })),
        userRemarks,
      })
      if (!result || result.error) {
        setError(result?.error || 'The amendments could not be drafted. Please retry.')
        // The server saves the review before it calls the model and returns it
        // on failure. Adopting it here means a retry resends dispositions that
        // already match and does not add the typed remark a second time.
        if (result?.challenge) {
          seedReview(result.challenge, null)
          setNewRemark(null)
        }
        return
      }
      seedReview(result.challenge || challenge, result.preview)
      setNewRemark(null)
    } catch (err: any) {
      setError(err?.message || 'The amendments could not be drafted.')
    } finally {
      setIsDrafting(false)
    }
  }

  const applyAmendments = async () => {
    setIsApplying(true)
    setError(null)
    try {
      const acceptedClaimNumbers = Object.entries(acceptMap)
        .filter(([, accepted]) => accepted)
        .map(([number]) => Number(number))
      const acceptedAddedClaimNumbers = Object.entries(addedAcceptMap)
        .filter(([, accepted]) => accepted)
        .map(([number]) => Number(number))

      const result = await onComplete({
        action: 'challenge_refine_apply',
        sessionId: session.id,
        acceptedClaimNumbers,
        acceptAll: false,
        acceptedAddedClaimNumbers,
      })
      if (!result || result.error) {
        setError(result?.error || 'The amendments could not be applied. Please retry.')
        // A stale set means the claims moved under us; the remarks must be re-raised.
        if (result?.code === 'CHALLENGE_STALE') {
          setPreview(null)
          setStep('remarks')
        }
        return
      }
      setPreview(null)
      // Reflect the finished state at once; the refresh below re-seeds it from
      // the server and the seed key changes with the status, so no toggle is lost.
      setChallenge((prev: any) => (prev ? { ...prev, status: 'APPLIED' } : prev))
      setApplied(
        `Applied ${acceptedClaimNumbers.length} amendment${acceptedClaimNumbers.length === 1 ? '' : 's'}` +
        (acceptedAddedClaimNumbers.length ? ` and added ${acceptedAddedClaimNumbers.length} claim${acceptedAddedClaimNumbers.length === 1 ? '' : 's'}` : '')
      )
      await onRefresh()
    } catch (err: any) {
      setError(err?.message || 'The amendments could not be applied.')
    } finally {
      setIsApplying(false)
    }
  }

  const setDisposition = (id: string, value: Disposition) => {
    setDispositions(prev => ({ ...prev, [id]: prev[id] === value ? 'pending' : value }))
  }

  const acceptAllHigh = () => {
    setDispositions(prev => {
      const next = { ...prev }
      remarks.forEach(remark => {
        if (remark.sev === 'H') next[remark.id] = 'accepted'
      })
      return next
    })
  }

  if (!open) return null

  const changedClaims: RefinedClaim[] = (preview?.refinedClaims || []).filter((claim: RefinedClaim) => claim.refined_text)
  const addedClaims: AddedClaim[] = preview?.addedClaims || []
  const unresolved = preview?.unresolvedRemarks || []

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ai-graphite-900/20" onClick={onClose} aria-hidden="true" />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-paper-200 bg-white shadow-xl sm:w-[560px]"
        role="dialog"
        aria-label="Challenge claims"
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-paper-200 px-4 py-3">
          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-ai-blue-50">
            <ShieldAlert className="h-4 w-4 text-ai-blue-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-ai-graphite-900">Challenge claims</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ai-graphite-500">
              An adversarial review of this claim set against the objections an examiner or petitioner could raise.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-ai-graphite-400 transition-colors hover:bg-paper-100 hover:text-ai-graphite-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {claimsFrozen && (
            <Alert className="mb-3 border-amber-200 bg-amber-50">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-[12px] text-amber-800">
                These claims are locked. Unlock them to run a challenge.
              </AlertDescription>
            </Alert>
          )}

          {isStale && challenge && !isApplied && (
            <Alert className="mb-3 border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-[12px] text-amber-800">
                The claims changed after this review ran, so these remarks may no longer match them.{' '}
                <button onClick={runChallenge} className="font-medium underline underline-offset-2">
                  Run the challenge again
                </button>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="mb-3 border-wax-200 bg-wax-50">
              <AlertCircle className="h-4 w-4 text-wax-600" />
              <AlertDescription className="text-[12px] text-wax-800">{error}</AlertDescription>
            </Alert>
          )}

          {applied && (
            <Alert className="mb-3 border-emerald-200 bg-emerald-50">
              <Check className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-[12px] text-emerald-800">{applied}</AlertDescription>
            </Alert>
          )}

          {/* Finished review: what the last challenge changed */}
          {isApplied && !isRunning && (
            <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2.5">
              <div className="mb-1 text-[11px] font-semibold text-emerald-800">Amendments applied to the claims</div>
              {resolution?.notes ? (
                <div className="space-y-0.5">
                  {String(resolution.notes).split('\n').filter(Boolean).map((line: string, index: number) => (
                    <p key={index} className="text-[11.5px] leading-relaxed text-ai-graphite-700">{line}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11.5px] leading-relaxed text-ai-graphite-700">
                  The accepted amendments are now part of the claim set.
                </p>
              )}
            </div>
          )}

          {/* Entry state: no review yet, or the last one is finished */}
          {(!challenge || isApplied) && !isRunning && (
            <div className="space-y-3">
              <p className="text-[12px] leading-relaxed text-ai-graphite-600">
                {isApplied
                  ? 'Run the review again to challenge the amended claim set.'
                  : 'The review runs a fixed objection checklist covering definiteness, picture claiming, nomenclature, statutory category, sequence discipline, antecedent basis, terminology and support. You can also point it at something specific.'}
              </p>
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
                  Focus (optional)
                </label>
                <textarea
                  value={focusText}
                  onChange={event => setFocusText(event.target.value)}
                  rows={3}
                  placeholder="e.g. attack the breadth of Claim 1, or check whether the dependent ladder is defensible"
                  className="w-full rounded-md border border-paper-300 px-2.5 py-2 text-[12px] text-ai-graphite-800 placeholder:text-ai-graphite-400 focus:border-ai-blue-400 focus:outline-none"
                />
              </div>
              <label className="flex items-start gap-2 text-[12px] text-ai-graphite-700">
                <input
                  type="checkbox"
                  checked={useArtReferences}
                  onChange={event => setUseArtReferences(event.target.checked)}
                  className="mt-0.5 rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
                />
                <span>
                  Use similar corpus claims as a vocabulary reference
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ai-graphite-500">
                    Uses the patents from your prior-art search when you have run one, otherwise searches the corpus.
                    Terminology and claim architecture only: nothing is copied, and the amendment pass never sees them.
                  </span>
                </span>
              </label>
              <Button
                onClick={runChallenge}
                disabled={claimsFrozen || !claimsStructured?.length}
                className="h-8 w-full bg-ai-blue-700 text-[12px] font-medium text-white hover:bg-ai-blue-800"
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                {isApplied ? 'Run a new challenge' : 'Run challenge'}
              </Button>
            </div>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 rounded-md border border-paper-200 bg-paper-50 px-3 py-3 text-[12px] text-ai-graphite-600">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-ai-blue-600" />
              {useArtReferences
                ? 'Finding similar claim sets, then raising objections'
                : 'Screening the claim set, then raising objections'}
            </div>
          )}

          {/* Remarks review */}
          {challenge && !isApplied && step === 'remarks' && !isRunning && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
                  {remarks.length} objection{remarks.length === 1 ? '' : 's'} · {acceptedCount} accepted
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={acceptAllHigh}
                    className="text-[11px] font-medium text-ai-blue-700 hover:underline"
                  >
                    Accept all high
                  </button>
                  <span className="text-paper-300">|</span>
                  <label
                    className="flex items-center gap-1 text-[11px] text-ai-graphite-500"
                    title="On re-run, give the challenger similar corpus claims as a vocabulary reference"
                  >
                    <input
                      type="checkbox"
                      checked={useArtReferences}
                      onChange={event => setUseArtReferences(event.target.checked)}
                      className="h-3 w-3 rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
                    />
                    corpus refs
                  </label>
                  <button onClick={runChallenge} className="text-[11px] font-medium text-ai-graphite-500 hover:underline">
                    Re-run
                  </button>
                </div>
              </div>

              {/* Art vocabulary references: provenance for the run, or why there were none */}
              {challenge?.referencesStatus?.requested && (
                challenge.referencesStatus.used > 0 ? (
                  <details className="rounded-md border border-paper-200 bg-paper-50 px-3 py-2">
                    <summary className="cursor-pointer text-[11px] font-medium text-ai-graphite-700">
                      References used ({challenge.referencesStatus.used})
                      <span className="ml-1 font-normal text-ai-graphite-500">
                        {challenge.referencesStatus.origin === 'related_art_run'
                          ? 'from your prior-art search'
                          : 'from a corpus search'}
                      </span>
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {((challenge.references || []) as ArtReference[]).map(reference => (
                        <li key={reference.publicationNumber} className="text-[11px] leading-relaxed text-ai-graphite-600">
                          <span className="font-medium text-ai-graphite-800">{reference.publicationNumber}</span>
                          {reference.title ? `: ${reference.title}` : ''}
                          <span className="ml-1 text-ai-graphite-400">
                            ({COMPLETENESS_LABELS[reference.completeness || ''] || 'claims'})
                          </span>
                        </li>
                      ))}
                    </ul>
                    {challenge.referencesStatus.reason && (
                      <p className="mt-1 text-[10.5px] text-ai-graphite-500">{challenge.referencesStatus.reason}</p>
                    )}
                    <p className="mt-1 text-[10.5px] text-ai-graphite-500">
                      Used for terminology and claim structure only. Nothing was copied from them, and the amendment pass does not see them.
                    </p>
                  </details>
                ) : (
                  <p className="rounded-md border border-paper-200 bg-paper-50 px-3 py-2 text-[11px] text-ai-graphite-500">
                    Ran without references{challenge.referencesStatus.reason ? `: ${challenge.referencesStatus.reason}` : '.'}
                  </p>
                )
              )}

              {remarks.map(remark => {
                const disposition = dispositions[remark.id] || remark.disposition
                return (
                  <div
                    key={remark.id}
                    className={`rounded-md border px-3 py-2.5 transition-colors ${
                      disposition === 'accepted'
                        ? 'border-ai-blue-200 bg-ai-blue-50/40'
                        : disposition === 'dismissed'
                          ? 'border-paper-200 bg-paper-50 opacity-60'
                          : 'border-paper-200 bg-white'
                    }`}
                  >
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLES[remark.sev]}`}>
                        {SEVERITY_LABELS[remark.sev]}
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-[0.05em] text-ai-graphite-500">
                        {CATEGORY_LABELS[remark.cat] || remark.cat}
                      </span>
                      <span className="text-[10px] text-ai-graphite-400">
                        Claim {remark.claims.join(', ')}
                      </span>
                      {remark.source === 'lint' && (
                        <span className="rounded bg-paper-100 px-1.5 py-0.5 text-[10px] text-ai-graphite-500">
                          automated check
                        </span>
                      )}
                      {remark.source === 'user' && (
                        <span className="rounded bg-paper-100 px-1.5 py-0.5 text-[10px] text-ai-graphite-500">yours</span>
                      )}
                      {remark.refs && remark.refs.length > 0 && (
                        <span
                          className="rounded bg-paper-100 px-1.5 py-0.5 text-[10px] text-ai-graphite-500"
                          title="The art vocabulary references this remark drew its terminology from"
                        >
                          term from {remark.refs.join(', ')}
                        </span>
                      )}
                      {remark.verbatimReuse && remark.verbatimReuse.length > 0 && (
                        <span
                          className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800"
                          title={remark.verbatimReuse.map(reuse => `${reuse.publicationNumber}: "${reuse.snippet}"`).join('\n')}
                        >
                          copies wording from {remark.verbatimReuse.map(reuse => reuse.publicationNumber).join(', ')}
                        </span>
                      )}
                    </div>

                    <p className="text-[12px] leading-relaxed text-ai-graphite-800">{remark.objection}</p>

                    {remark.cat === 'PRIOR_ART_SIGNAL' ? (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
                        Not an amendment. Take this reference to the prior-art claim refinement stage.
                      </p>
                    ) : (
                      <>
                        <label className="mt-2 block text-[10px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
                          Amendment instruction
                        </label>
                        <textarea
                          value={editedFixes[remark.id] ?? remark.fix}
                          onChange={event => setEditedFixes(prev => ({ ...prev, [remark.id]: event.target.value }))}
                          rows={2}
                          className="mt-0.5 w-full rounded border border-paper-300 px-2 py-1.5 text-[11.5px] leading-relaxed text-ai-graphite-700 focus:border-ai-blue-400 focus:outline-none"
                        />
                      </>
                    )}

                    <div className="mt-2 flex items-center gap-1.5">
                      {remark.cat !== 'PRIOR_ART_SIGNAL' && (
                        <button
                          onClick={() => setDisposition(remark.id, 'accepted')}
                          className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                            disposition === 'accepted'
                              ? 'border-ai-blue-300 bg-ai-blue-700 text-white'
                              : 'border-paper-300 text-ai-graphite-600 hover:border-ai-blue-300'
                          }`}
                        >
                          Accept
                        </button>
                      )}
                      <button
                        onClick={() => setDisposition(remark.id, 'dismissed')}
                        className={`rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
                          disposition === 'dismissed'
                            ? 'border-ai-graphite-400 bg-ai-graphite-600 text-white'
                            : 'border-paper-300 text-ai-graphite-600 hover:border-ai-graphite-400'
                        }`}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* User-added remark */}
              {newRemark ? (
                <div className="rounded-md border border-paper-300 bg-white px-3 py-2.5">
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
                    Your remark
                  </div>
                  <input
                    value={newRemark.claims}
                    onChange={event => setNewRemark({ ...newRemark, claims: event.target.value })}
                    placeholder="Claim numbers, e.g. 1, 4"
                    className="mb-1.5 w-full rounded border border-paper-300 px-2 py-1.5 text-[11.5px] focus:border-ai-blue-400 focus:outline-none"
                  />
                  <textarea
                    value={newRemark.objection}
                    onChange={event => setNewRemark({ ...newRemark, objection: event.target.value })}
                    rows={2}
                    placeholder="What is wrong with the claim"
                    className="mb-1.5 w-full rounded border border-paper-300 px-2 py-1.5 text-[11.5px] focus:border-ai-blue-400 focus:outline-none"
                  />
                  <textarea
                    value={newRemark.fix}
                    onChange={event => setNewRemark({ ...newRemark, fix: event.target.value })}
                    rows={2}
                    placeholder="How it should be amended"
                    className="w-full rounded border border-paper-300 px-2 py-1.5 text-[11.5px] focus:border-ai-blue-400 focus:outline-none"
                  />
                  <button
                    onClick={() => setNewRemark(null)}
                    className="mt-1.5 text-[11px] text-ai-graphite-500 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setNewRemark({ claims: '', objection: '', fix: '' })}
                  className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-paper-300 px-3 py-2 text-[11.5px] font-medium text-ai-graphite-500 hover:border-ai-blue-300 hover:text-ai-blue-700"
                >
                  <Plus className="h-3 w-3" />
                  Add your own remark
                </button>
              )}
            </div>
          )}

          {/* Diff review */}
          {challenge && !isApplied && step === 'diff' && preview && (
            <div className="space-y-3">
              <button
                onClick={() => setStep('remarks')}
                className="flex items-center gap-1 text-[11px] font-medium text-ai-graphite-500 hover:underline"
              >
                <ChevronLeft className="h-3 w-3" />
                Back to objections
              </button>

              {changedClaims.length === 0 && addedClaims.length === 0 && (
                <p className="rounded-md border border-paper-200 bg-paper-50 px-3 py-3 text-[12px] text-ai-graphite-600">
                  No claim changes were proposed for the accepted objections.
                </p>
              )}

              {changedClaims.map(claim => (
                <div key={claim.number} className="rounded-md border border-paper-200 bg-white px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-ai-graphite-700">Claim {claim.number}</span>
                    <button
                      onClick={() => setAcceptMap(prev => ({ ...prev, [claim.number]: !prev[claim.number] }))}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        acceptMap[claim.number]
                          ? 'border-ai-blue-300 bg-ai-blue-700 text-white'
                          : 'border-paper-300 text-ai-graphite-600'
                      }`}
                    >
                      {acceptMap[claim.number] ? 'Accepted' : 'Rejected'}
                    </button>
                  </div>
                  <div className="mb-1.5">
                    {renderDiff(claim.original_text || claimText(claim.number), claim.refined_text || '')}
                  </div>
                  {claim.change_reason && (
                    <p className="text-[11px] leading-relaxed text-ai-graphite-500">
                      {claim.change_reason}
                      {claim.remark_refs?.length ? ` [${claim.remark_refs.join(', ')}]` : ''}
                    </p>
                  )}
                </div>
              ))}

              {addedClaims.map(claim => (
                <div key={`added-${claim.number}`} className="rounded-md border border-emerald-200 bg-emerald-50/40 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-emerald-800">
                      New claim {claim.number} (depends on {claim.dependsOn})
                    </span>
                    <button
                      onClick={() => setAddedAcceptMap(prev => ({ ...prev, [claim.number]: !prev[claim.number] }))}
                      className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                        addedAcceptMap[claim.number]
                          ? 'border-emerald-300 bg-emerald-700 text-white'
                          : 'border-paper-300 text-ai-graphite-600'
                      }`}
                    >
                      {addedAcceptMap[claim.number] ? 'Accepted' : 'Rejected'}
                    </button>
                  </div>
                  <p className="text-[12px] leading-relaxed text-ai-graphite-800">{claim.text}</p>
                  {claim.reason && (
                    <p className="mt-1 text-[11px] leading-relaxed text-ai-graphite-500">{claim.reason}</p>
                  )}
                </div>
              ))}

              {unresolved.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <div className="mb-1 text-[11px] font-semibold text-amber-800">Not amended</div>
                  {unresolved.map((entry: any) => (
                    <p key={entry.id} className="text-[11.5px] leading-relaxed text-amber-800">
                      {entry.id}: {entry.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {challenge && !isApplied && !isRunning && (
          <div className="border-t border-paper-200 px-4 py-3">
            {step === 'remarks' ? (
              <Button
                onClick={draftAmendments}
                disabled={isDrafting || claimsFrozen || (acceptedCount === 0 && !newRemark)}
                className="h-8 w-full bg-ai-blue-700 text-[12px] font-medium text-white hover:bg-ai-blue-800"
              >
                {isDrafting
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Drafting amendments</>
                  : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Draft amendments ({acceptedCount})</>}
              </Button>
            ) : (
              <Button
                onClick={applyAmendments}
                disabled={isApplying || claimsFrozen || !preview || acceptedAmendmentCount === 0}
                className="h-8 w-full bg-ai-blue-700 text-[12px] font-medium text-white hover:bg-ai-blue-800"
              >
                {isApplying
                  ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />Applying</>
                  : <><Check className="mr-1.5 h-3.5 w-3.5" />Apply {acceptedAmendmentCount} amendment{acceptedAmendmentCount === 1 ? '' : 's'} to claims</>}
              </Button>
            )}
          </div>
        )}
      </aside>
    </>
  )
}
