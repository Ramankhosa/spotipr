'use client'

// Claim version history.
//
// Every generation, manual save, challenge apply, prior-art refinement apply and
// finalisation records the resulting claim set as a version. This drawer lists
// them, shows what would change on a switch, and switches the working claims
// to any version. History is never rewritten by a switch, so every switch can
// be undone by switching back.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, Check, ChevronDown, ChevronUp, History, Loader2, X } from 'lucide-react'
import { renderDiff } from '@/components/drafting/claim-diff'

type VersionClaim = { number: number; text: string; type?: string; dependsOn?: number }

type ClaimsVersion = {
  id: string
  number: number
  createdAt: string
  source: string
  label: string
  note?: string
  claimCount: number
  claims: string
  claimsStructured: VersionClaim[]
}

interface ClaimVersionsPanelProps {
  session: any
  open: boolean
  onClose: () => void
  /** The claims the stage is showing right now. */
  currentClaims: VersionClaim[]
  claimsFrozen: boolean
  onComplete: (data: any) => Promise<any>
  onRefresh: () => Promise<void>
}

const SOURCE_STYLES: Record<string, string> = {
  generated: 'bg-paper-100 text-ai-graphite-600 border-paper-300',
  manual_edit: 'bg-paper-100 text-ai-graphite-600 border-paper-300',
  challenge_apply: 'bg-ai-blue-50 text-ai-blue-800 border-ai-blue-200',
  refinement_apply: 'bg-ai-blue-50 text-ai-blue-800 border-ai-blue-200',
  finalized: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  baseline: 'bg-paper-100 text-ai-graphite-600 border-paper-300',
}

/** Content identity, so "current" is judged by what the claims say, not by a pointer. */
const contentKey = (claims: VersionClaim[] | null | undefined) =>
  JSON.stringify(
    (Array.isArray(claims) ? claims : [])
      .map(claim => ({ n: Number(claim?.number) || 0, t: String(claim?.text || '').replace(/\s+/g, ' ').trim() }))
      .sort((a, b) => a.n - b.n)
  )

const formatWhen = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ClaimVersionsPanel({
  session,
  open,
  onClose,
  currentClaims,
  claimsFrozen,
  onComplete,
  onRefresh,
}: ClaimVersionsPanelProps) {
  const normalized = session?.ideaRecord?.normalizedData || {}

  const versions: ClaimsVersion[] = useMemo(() => {
    const raw = normalized.claimsVersions
    if (!Array.isArray(raw)) return []
    return raw
      .filter((entry: any) => entry && typeof entry.id === 'string' && Array.isArray(entry.claimsStructured))
      .map((entry: any) => ({ ...entry, number: Number(entry.number) || 0 }))
      .sort((a: ClaimsVersion, b: ClaimsVersion) => b.number - a.number)
  }, [normalized.claimsVersions])

  const currentKey = useMemo(() => contentKey(currentClaims), [currentClaims])
  const currentVersionId = useMemo(() => {
    const byContent = versions.find(version => contentKey(version.claimsStructured) === currentKey)
    return byContent?.id || normalized.claimsActiveVersionId || null
  }, [versions, currentKey, normalized.claimsActiveVersionId])

  const [comparing, setComparing] = useState<string | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const switchTo = async (version: ClaimsVersion) => {
    setSwitching(version.id)
    setError(null)
    setNotice(null)
    try {
      const result = await onComplete({
        action: 'restore_claims_version',
        sessionId: session.id,
        versionId: version.id,
      })
      if (!result || result.error) {
        setError(result?.error || 'The version could not be restored. Please retry.')
        return
      }
      setNotice(`Switched to version ${version.number}: ${version.label}.`)
      setComparing(null)
      await onRefresh()
    } catch (err: any) {
      setError(err?.message || 'The version could not be restored. Please retry.')
    } finally {
      setSwitching(null)
    }
  }

  if (!open) return null

  const renderComparison = (version: ClaimsVersion) => {
    const current = new Map<number, string>()
    ;(currentClaims || []).forEach(claim => current.set(Number(claim.number), String(claim.text || '')))
    const target = new Map<number, string>()
    version.claimsStructured.forEach(claim => target.set(Number(claim.number), String(claim.text || '')))
    const numbers = Array.from(new Set(Array.from(current.keys()).concat(Array.from(target.keys())))).sort((a, b) => a - b)
    const changed = numbers.filter(number => (current.get(number) || '') !== (target.get(number) || ''))
    if (changed.length === 0) {
      return <p className="text-[11.5px] text-ai-graphite-500">Identical to the current claims.</p>
    }
    return (
      <div className="space-y-2">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
          Changes if you switch to this version
        </p>
        {changed.map(number => {
          const before = current.get(number) || ''
          const after = target.get(number) || ''
          return (
            <div key={number} className="rounded border border-paper-200 bg-white px-2.5 py-2">
              <div className="mb-1 text-[11px] font-semibold text-ai-graphite-700">
                Claim {number}
                {!before && <span className="ml-1.5 font-normal text-emerald-700">added by this version</span>}
                {!after && <span className="ml-1.5 font-normal text-wax-600">removed by this version</span>}
              </div>
              {before && after ? renderDiff(before, after) : (
                <p className={`text-[12px] leading-relaxed ${after ? 'text-emerald-800' : 'text-wax-600 line-through'}`}>{after || before}</p>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ai-graphite-900/20" onClick={onClose} aria-hidden="true" />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-paper-200 bg-white shadow-xl sm:w-[560px]"
        role="dialog"
        aria-label="Claim versions"
      >
        <div className="flex items-start gap-3 border-b border-paper-200 px-4 py-3">
          <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-paper-100">
            <History className="h-4 w-4 text-ai-graphite-700" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[13px] font-semibold text-ai-graphite-900">Claim versions</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ai-graphite-500">
              Every generation, edit, amendment and refinement is kept. Switch to any version; switching back is always possible.
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
                These claims are locked. Unlock them to switch versions.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="mb-3 border-wax-200 bg-wax-50">
              <AlertCircle className="h-4 w-4 text-wax-600" />
              <AlertDescription className="text-[12px] text-wax-800">{error}</AlertDescription>
            </Alert>
          )}

          {notice && (
            <Alert className="mb-3 border-emerald-200 bg-emerald-50">
              <Check className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-[12px] text-emerald-800">{notice}</AlertDescription>
            </Alert>
          )}

          {versions.length === 0 && (
            <p className="rounded-md border border-paper-200 bg-paper-50 px-3 py-3 text-[12px] text-ai-graphite-600">
              No versions yet. A version is recorded each time the claims are generated, saved, amended or refined.
            </p>
          )}

          <div className="space-y-2">
            {versions.map(version => {
              const isCurrent = version.id === currentVersionId
              const isComparing = comparing === version.id
              return (
                <div
                  key={version.id}
                  className={`rounded-md border px-3 py-2.5 ${isCurrent ? 'border-ai-blue-200 bg-ai-blue-50/40' : 'border-paper-200 bg-white'}`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-ai-graphite-800">Version {version.number}</span>
                    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_STYLES[version.source] || SOURCE_STYLES.manual_edit}`}>
                      {version.label}
                    </span>
                    {isCurrent && (
                      <span className="rounded bg-ai-blue-700 px-1.5 py-0.5 text-[10px] font-semibold text-white">Current</span>
                    )}
                    <span className="ml-auto text-[10px] text-ai-graphite-400">
                      {formatWhen(version.createdAt)} · {version.claimCount} claim{version.claimCount === 1 ? '' : 's'}
                    </span>
                  </div>

                  {version.note && (
                    <div className="mt-1.5 space-y-0.5">
                      {String(version.note).split('\n').filter(Boolean).slice(0, 6).map((line, index) => (
                        <p key={index} className="text-[11px] leading-relaxed text-ai-graphite-600">{line}</p>
                      ))}
                    </div>
                  )}

                  <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-ai-graphite-700">
                    {version.claimsStructured[0]?.text || ''}
                  </p>

                  <div className="mt-2 flex items-center gap-1.5">
                    {!isCurrent && (
                      <Button
                        size="sm"
                        onClick={() => switchTo(version)}
                        disabled={claimsFrozen || switching !== null}
                        className="h-7 bg-ai-blue-700 px-2.5 text-[11px] font-medium text-white hover:bg-ai-blue-800"
                      >
                        {switching === version.id
                          ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Switching</>
                          : 'Switch to this version'}
                      </Button>
                    )}
                    {!isCurrent && (
                      <button
                        onClick={() => setComparing(isComparing ? null : version.id)}
                        className="flex items-center gap-1 rounded border border-paper-300 px-2 py-1 text-[11px] font-medium text-ai-graphite-600 hover:border-ai-blue-300 hover:text-ai-blue-700"
                      >
                        {isComparing ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        {isComparing ? 'Hide changes' : 'Show changes'}
                      </button>
                    )}
                  </div>

                  {isComparing && <div className="mt-2">{renderComparison(version)}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </aside>
    </>
  )
}
