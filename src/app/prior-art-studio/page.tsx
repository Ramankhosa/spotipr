import type { Metadata } from 'next'
import { StudioApp } from '@/components/prior-art-studio/StudioApp'

export const metadata: Metadata = {
  title: 'Advanced Search Studio · PatentNest',
  description:
    'Manual patent searching with the boring parts automated: AI-drafted queries you approve term by term, a counted retrieval funnel, inbox-style triage, and a compiled search report.',
}

export default function PriorArtStudioPage() {
  // The Studio manages its own full-height layout (sticky command bar and
  // funnel, independently scrolling panes), so this wrapper must not add a
  // min-height or vertical padding that would fight it.
  return <StudioApp />
}
