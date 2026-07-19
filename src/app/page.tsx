import type { Metadata } from 'next'
import PatentNestNav from '@/components/patentnest/PatentNestNav'
import DocumentHero from '@/components/patentnest/DocumentHero'
import PriorArtSection from '@/components/patentnest/PriorArtSection'
import StudioSection from '@/components/patentnest/StudioSection'
import FiguresSection from '@/components/patentnest/FiguresSection'
import EmbodimentsSection from '@/components/patentnest/EmbodimentsSection'
import ClaimsSection from '@/components/patentnest/ClaimsSection'
import GrantSection from '@/components/patentnest/GrantSection'
import PaperFooter from '@/components/patentnest/PaperFooter'

export const metadata: Metadata = {
  title: 'PatentNest.ai — Where ideas become property',
  description:
    'The patent studio from disclosure to filing: prior-art search across 30M+ patents, AI-drafted specifications and claims, and filing-ready figures — validated before you pay a single fee.',
}

// The PatentNest document-style landing page, now the DEFAULT homepage.
// The same composition remains available at /patentnest; the original dark
// homepage is preserved at /classic-home. The global Header is hidden here
// (see components/ConditionalHeader.tsx) — PatentNestNav is the chrome.
export default function HomePage() {
  return (
    <div className="min-h-screen bg-paper-200 font-sans text-ai-graphite-900 antialiased selection:bg-brass-600/20">
      <PatentNestNav />
      <main>
        <DocumentHero />
        <PriorArtSection />
        <StudioSection />
        <FiguresSection />
        <EmbodimentsSection />
        <ClaimsSection />
        <GrantSection />
      </main>
      <PaperFooter />
    </div>
  )
}
