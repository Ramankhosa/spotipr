'use client'

/**
 * Ad-hoc semantic search inside the study's field.
 *
 * A thin client over POST /semantic-search: one request per press, no polling.
 * Lane unavailability arrives as 200 { available: false, reason } and renders
 * inline — it is a property of the installation, not an error the user caused,
 * so it never toasts.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Hint } from '@/components/ui/hint'
import { isPollAborted, wsApi } from './api'

export interface SemanticSearchNeighbor {
  publicationNumber: string
  familyKey: string
  title: string | null
  abstract: string | null
  distance: number
}

type SemanticSearchResponse =
  | { available: true; query: string; effectiveLimit: number; neighbors: SemanticSearchNeighbor[] }
  | { available: false; reason: string }

export const DISTANCE_TOOLTIP =
  'Distance in meaning-space from your text to this document — lower is closer. A ranking aid, not a percentage match.'

export function SemanticSearchPanel({ studyId }: { studyId: string }) {
  const [draft, setDraft] = useState('')
  const [searching, setSearching] = useState(false)
  const [result, setResult] = useState<SemanticSearchResponse | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    []
  )

  const search = async () => {
    const query = draft.trim()
    if (!query || searching) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setSearching(true)
    setFailure(null)
    try {
      const payload = await wsApi<SemanticSearchResponse>(
        `/api/whitespace/studies/${studyId}/semantic-search`,
        { method: 'POST', body: JSON.stringify({ query, limit: 10 }), signal: controller.signal }
      )
      setResult(payload)
    } catch (error) {
      if (isPollAborted(error)) return
      setFailure(error instanceof Error ? error.message : 'Try again.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setSearching(false)
      }
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Search the field by meaning
        <Hint
          title="How this search works"
          text="Your words are converted to the same meaning-vectors as the corpus and compared with every document inside this study's field, so it finds art that says the same thing in different vocabulary. Results are the nearest documents, ranked by distance — nothing is filtered out, so read the top few critically."
        />
      </h3>

      <div className="mt-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void search()
            }}
            placeholder="Describe an approach, mechanism, or use in your own words…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            aria-label="Search the field by meaning"
          />
        </div>
        <Button size="sm" onClick={() => void search()} disabled={searching || !draft.trim()}>
          Search
        </Button>
      </div>

      <div className="mt-3">
        {searching ? (
          <div className="flex items-center gap-2 py-3 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Reading your words and scanning the field…</span>
          </div>
        ) : failure ? (
          <p className="text-sm text-muted-foreground">The search failed — {failure}</p>
        ) : result === null ? (
          <p className="text-xs text-muted-foreground">
            Nothing searched yet. This looks inside the same field the study measured — filing years
            and jurisdictions included.
          </p>
        ) : !result.available ? (
          <p className="text-sm text-muted-foreground">Semantic search is unavailable — {result.reason}</p>
        ) : result.neighbors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing came back. The field scope may be very narrow, or the corpus may hold no vectors
            for it.
          </p>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground">
              The {result.neighbors.length} closest document{result.neighbors.length === 1 ? '' : 's'} in
              this study&apos;s field, nearest first.
            </p>
            <ul className="mt-2 space-y-2.5">
              {result.neighbors.map(neighbor => (
                <li key={neighbor.publicationNumber} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {neighbor.publicationNumber}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
                      {neighbor.title ?? 'Untitled'}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground" title={DISTANCE_TOOLTIP}>
                      dist {neighbor.distance.toFixed(2)}
                    </span>
                  </div>
                  {neighbor.abstract && (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{neighbor.abstract}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
