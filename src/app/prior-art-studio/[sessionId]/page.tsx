import type { Metadata } from 'next'
import { StudioApp } from '@/components/prior-art-studio/StudioApp'

export const metadata: Metadata = {
  title: 'Advanced Search Studio · PatentNest',
  description:
    'Manual patent searching with the boring parts automated: AI-drafted queries you approve term by term, a counted retrieval funnel, inbox-style triage, and a compiled search report.',
}

/**
 * Deep link to one search.
 *
 * The Studio was a single route with all of its state in React, so a search
 * could not be linked to a colleague, bookmarked, or recovered after a refresh —
 * and the browser Back button left the module entirely instead of returning to
 * the session list. This route makes a session addressable; the app keeps the
 * URL in step as the attorney moves around.
 *
 * Ownership is enforced server-side on every API call (getOwnedSession), so an
 * unknown or foreign id simply lands on the session list.
 */
export default function PriorArtStudioSessionPage({ params }: { params: { sessionId: string } }) {
  return <StudioApp initialSessionId={params.sessionId} />
}
