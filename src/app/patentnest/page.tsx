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
    'The patent studio from disclosure to filing: prior-art search across millions of patents, AI-drafted specifications and claims, and filing-ready figures — validated before you pay a single fee.',
}

// Parallel landing page ("The Application, Elevated" direction), served at
// /patentnest alongside the current homepage at / for side-by-side comparison.
// The page is typeset like a patent application for PatentNest itself:
// Abstract (hero) -> Background (problem) -> Summary of the Invention (studio,
// with product frames) -> Drawings (real figure outputs) -> Claims (value props
// as numbered claims) -> Granted (seal + CTA). The global Header is hidden for
// this route (see components/ConditionalHeader.tsx).
export default function PatentNestLandingPage() {
  return (
    <div className="min-h-screen bg-[#faf9f7] font-sans text-ai-graphite-900 antialiased selection:bg-[#8a6a1f]/20">
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
