'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { wsApi } from './api'
import { WhitespaceStudyApp } from './WhitespaceStudyApp'
import { InventionStudyApp } from './invention/InventionStudyApp'

/**
 * Picks the layout for a study by its kind.
 *
 * The kind is only knowable after a fetch — whitespace auth is a localStorage
 * JWT, so the page cannot resolve it server-side. This reads the one field it
 * needs and hands off; each app then loads its own state as before.
 */
export function WhitespaceStudyRouter({ studyId }: { studyId: string }) {
  const [kind, setKind] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void wsApi<{ study: { kind?: string } }>(`/api/whitespace/studies/${studyId}`)
      .then(data => {
        if (!cancelled) setKind(data.study?.kind === 'INVENTION' ? 'INVENTION' : 'FIELD')
      })
      .catch(() => {
        // Fall through to the landscape app, which renders its own error state.
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [studyId])

  if (!kind && !failed) {
    return (
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-16 text-muted-foreground sm:px-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading the study…</span>
      </div>
    )
  }

  return kind === 'INVENTION' ? <InventionStudyApp studyId={studyId} /> : <WhitespaceStudyApp studyId={studyId} />
}
