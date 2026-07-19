'use client'

// The Reader: open a result and actually read it — full abstract, claims when
// the corpus holds them, bibliographic data, and the family members. Element
// evidence is shown alongside the text, with the text tier stated plainly so
// abstract-level similarity is never mistaken for a claim mapping.

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react'
import { Hint } from '@/components/ui/hint'
import type { StudioElement, StudioResultFamily } from '@/lib/prior-art-studio/types'

interface PatentDetail {
  publicationNumber: string
  applicationNumberRaw?: string | null
  title: string
  abstract?: string | null
  claimsText?: string | null
  claimsTruncated?: boolean
  descriptionText?: string | null
  descriptionTruncated?: boolean
  applicants?: unknown
  inventors?: string[]
  classifications?: string[]
  filingDate?: string | null
  publicationDate?: string | null
  country?: string | null
  kind?: string | null
  familyId?: string | null
  numberOfClaims?: number | null
  numberOfPages?: number | null
  textTier?: 'claims' | 'description-snippet' | 'abstract'
}

interface DocumentReaderProps {
  family: StudioResultFamily
  elements: StudioElement[]
  onClose: () => void
  onSteerFrom: (family: StudioResultFamily) => void
  authHeaders: () => Record<string, string>
}

function googlePatentsUrl(publicationNumber: string): string {
  return `https://patents.google.com/patent/${publicationNumber.replace(/[^A-Za-z0-9]/g, '')}`
}

function applicantText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(v => String(v)).join('; ')
  return ''
}

export function DocumentReader({ family, elements, onClose, onSteerFrom, authHeaders }: DocumentReaderProps) {
  const [detail, setDetail] = useState<PatentDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notInCorpus, setNotInCorpus] = useState(false)
  const [showClaims, setShowClaims] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setNotInCorpus(false)
    setDetail(null)
    fetch(`/api/prior-art-studio/patents/${encodeURIComponent(family.publicationNumber)}`, { headers: authHeaders() })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (!data?.patent) setNotInCorpus(true)
        else setDetail(data.patent)
      })
      .catch(() => !cancelled && setNotInCorpus(true))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [family.publicationNumber, authHeaders])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const abstract = detail?.abstract || family.abstract || family.snippet || ''
  const claims = detail?.claimsText || ''

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">{family.publicationNumber}</span>
        <span className="text-sm font-bold text-foreground">{family.title}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${
            claims
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {claims ? 'claims text available' : 'abstract-tier'}
        </span>
        <Hint
          title="Evidence tier"
          text="The corpus stores title and abstract for every document, and full claims for a subset (mainly US). Anything scored from an abstract is a similarity signal, not a claim mapping — the label tells you which you're looking at."
        />
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSteerFrom(family)}
            className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
            title="Add this document to the steer block on your canvas"
          >
            <Sparkles className="h-3 w-3" /> More like this
          </button>
          <a
            href={family.link || googlePatentsUrl(family.publicationNumber)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Google Patents <ExternalLink className="h-3 w-3" />
          </a>
          <button type="button" onClick={onClose} className="rounded-md border border-border p-1 text-muted-foreground hover:text-foreground" aria-label="Close reader">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.6fr_1fr]">
        <div className="max-h-[520px] overflow-y-auto border-border p-4 lg:border-r">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the document…
            </div>
          ) : (
            <>
              <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Abstract</h4>
              <p className="mb-4 whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                {abstract || <span className="text-muted-foreground">No abstract stored for this document.</span>}
              </p>

              {claims && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowClaims(v => !v)}
                    className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                  >
                    Claims {showClaims ? '▾' : '▸'}
                    {detail?.numberOfClaims ? ` · ${detail.numberOfClaims}` : ''}
                  </button>
                  {showClaims && (
                    <p className="mb-4 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                      {claims}
                      {detail?.claimsTruncated && <span className="italic"> …truncated — open on Google Patents for the full text.</span>}
                    </p>
                  )}
                </>
              )}

              {detail?.descriptionText && (
                <>
                  <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Description (extract)
                  </h4>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {detail.descriptionText}
                    {detail.descriptionTruncated && <span className="italic"> …truncated.</span>}
                  </p>
                </>
              )}

              {notInCorpus && (
                <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
                  This document came from a live provider and isn’t stored in the local corpus, so only the abstract
                  above is available here. Open it on Google Patents for the full text.
                </p>
              )}
            </>
          )}
        </div>

        <div className="max-h-[520px] overflow-y-auto p-4">
          {elements.length > 0 && family.elementCells && (
            <div className="mb-4">
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Element evidence
              </h4>
              <div className="space-y-1.5">
                {elements.map((element, i) => {
                  const cell = family.elementCells?.[element.id]
                  return (
                    <div key={element.id} className="flex items-start gap-2 border-b border-dashed border-border pb-1.5 text-[11px]">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] font-bold text-muted-foreground">
                        E{i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground/90">{element.text}</p>
                        {cell && cell.matchedTerms.length > 0 && (
                          <p className="mt-0.5 text-muted-foreground">
                            found: <b className="text-foreground">{cell.matchedTerms.join(', ')}</b>
                          </p>
                        )}
                      </div>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                          cell?.verdict === 'STRONG'
                            ? 'bg-amber-600 text-white'
                            : cell?.verdict === 'PART'
                              ? 'bg-amber-600/45 text-foreground'
                              : cell?.verdict === 'WEAK'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-muted text-muted-foreground/60'
                        }`}
                      >
                        {cell?.verdict || '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Bibliographic</h4>
          <dl className="space-y-1 text-[11px]">
            {[
              ['Applicants', applicantText(detail?.applicants) || family.applicants],
              ['Inventors', detail?.inventors?.join('; ')],
              ['Country / kind', [detail?.country, detail?.kind].filter(Boolean).join(' · ')],
              ['Published', detail?.publicationDate ? String(detail.publicationDate).slice(0, 10) : family.publicationDate],
              ['Filed', detail?.filingDate ? String(detail.filingDate).slice(0, 10) : null],
              ['Application', detail?.applicationNumberRaw],
              ['Claims', detail?.numberOfClaims ? String(detail.numberOfClaims) : null],
              ['Pages', detail?.numberOfPages ? String(detail.numberOfPages) : null],
              ['Classifications', (detail?.classifications || family.classifications)?.slice(0, 12).join(', ')],
              ['Family', detail?.familyId],
            ]
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={String(label)} className="flex gap-2">
                  <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 flex-1 break-words text-foreground/90">{String(value)}</dd>
                </div>
              ))}
          </dl>

          {family.members.length > 1 && (
            <>
              <h4 className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Family ({family.members.length})
              </h4>
              <ul className="space-y-1 text-[11px]">
                {family.members.map(member => (
                  <li key={member.publicationNumber} className="flex items-baseline gap-2">
                    <a
                      href={googlePatentsUrl(member.publicationNumber)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-blue-700 hover:underline dark:text-blue-400"
                    >
                      {member.publicationNumber}
                    </a>
                    <span className="text-muted-foreground">{member.publicationDate || ''}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
