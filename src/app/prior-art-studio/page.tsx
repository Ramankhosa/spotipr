import type { Metadata } from 'next'
import { StudioApp } from '@/components/prior-art-studio/StudioApp'

export const metadata: Metadata = {
  title: 'Prior-Art Studio · PatentNest',
  description:
    'Manual patent searching with the boring parts automated: AI-drafted queries you approve term by term, a counted retrieval funnel, inbox-style triage, and a compiled search report.',
}

export default function PriorArtStudioPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <StudioApp />
    </div>
  )
}
