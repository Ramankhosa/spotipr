'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth-context'
import { wsApi } from './api'
import { WhitespaceStudyApp } from './WhitespaceStudyApp'
import { InventionStudyApp } from './invention/InventionStudyApp'

/**
 * Picks the layout for a study by its kind.
 *
 * The kind is only knowable after a fetch — whitespace auth is a localStorage
 * JWT, so the page cannot resolve it server-side. This reads the one field it
 * needs and hands off; each app then loads its own state as before.
 *
 * The fetch waits for the session to hydrate (firing early sends no
 * Authorization header and answers 401), and a failure asks the user to retry
 * rather than guessing FIELD — loading an invention study into the landscape
 * layout after a transient blip is worse than a visible error.
 */
export function WhitespaceStudyRouter({ studyId }: { studyId: string }) {
  const { user, isLoading: authLoading } = useAuth()
  const [kind, setKind] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    setFailed(null)
    void wsApi<{ study: { kind?: string } }>(`/api/whitespace/studies/${studyId}`)
      .then(data => {
        if (!cancelled) setKind(data.study?.kind === 'INVENTION' ? 'INVENTION' : 'FIELD')
      })
      .catch(error => {
        if (!cancelled) setFailed(error instanceof Error ? error.message : 'Could not load the study.')
      })
    return () => {
      cancelled = true
    }
  }, [studyId, authLoading, user, attempt])

  // Signed out: the landscape app renders the shared sign-in prompt.
  if (!authLoading && !user) return <WhitespaceStudyApp studyId={studyId} />

  if (failed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="text-sm text-foreground">{failed}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAttempt(current => current + 1)}>
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!kind) {
    return (
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-16 text-muted-foreground sm:px-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading the study…</span>
      </div>
    )
  }

  return kind === 'INVENTION' ? <InventionStudyApp studyId={studyId} /> : <WhitespaceStudyApp studyId={studyId} />
}
