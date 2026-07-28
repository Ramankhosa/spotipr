import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceHero from '@/components/home-v2/WorkspaceHero'
import JourneySection from '@/components/home-v2/JourneySection'
import FeatureGrid from '@/components/home-v2/FeatureGrid'
import AudienceStrip from '@/components/home-v2/AudienceStrip'
import ClosingBand from '@/components/home-v2/ClosingBand'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'

export const metadata: Metadata = {
  title: 'PatentNest.ai — From invention to defensible application',
  description:
    'Search prior art across 30M+ patent documents, engineer claims, draft complete specifications, generate patent drawings, and respond to office actions — all in one connected workspace.',
}

// The "patent intelligence workspace" homepage: blue-tinted white ground
// (#f6f8fd), white cards on paper-300 hairlines, cobalt (lamp-600) as the only
// saturated colour, product-first hero. Built on the existing Cobalt & Oxford
// ramps — it does not fork the token system.
//
// This REPLACED the document-style landing page as the default homepage; that
// composition is unchanged and still served at /patentnest. /home-v2, where this
// design was developed, now redirects here.
//
// Public entry points: signed-out visitors are sent to /free-trial (access is
// requested and approved by a person, not self-serve) and /contact. Signed-in
// visitors go straight to /patents/draft/new. The global Header is suppressed
// for '/' in components/ConditionalHeader.tsx — WorkspaceNav is the chrome.
export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#f6f8fd] font-sans text-ai-graphite-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <WorkspaceHero />
        <JourneySection />
        <FeatureGrid />
        <AudienceStrip />
        <ClosingBand />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
