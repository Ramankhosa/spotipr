import type { Metadata } from 'next'
import WorkspaceNav from '@/components/home-v2/WorkspaceNav'
import WorkspaceHero from '@/components/home-v2/WorkspaceHero'
import SystemFlow from '@/components/home-v2/SystemFlow'
import FeatureGrid from '@/components/home-v2/FeatureGrid'
import DraftingCoverage from '@/components/home-v2/DraftingCoverage'
import AudienceStrip from '@/components/home-v2/AudienceStrip'
import PricingSection from '@/components/home-v2/PricingSection'
import ClosingBand from '@/components/home-v2/ClosingBand'
import WorkspaceFooter from '@/components/home-v2/WorkspaceFooter'

export const metadata: Metadata = {
  title: 'PatentNest.ai — From invention to defensible application',
  description:
    'Search prior art across 55M+ patent documents, engineer claims, draft complete specifications, generate patent drawings, and respond to office actions — all in one connected workspace.',
}

// The "Paper and Ink" homepage: warm vellum ground (vellum-200 #f6f5f2), an
// ~8:1 display-to-body type scale, and hairline tables ON the ground instead of
// white cards floating above it. Capabilities are drawn as patent figures
// rather than shown as shrunken screenshots.
//
// Colour is semantic only: cobalt (lamp-600) is what PatentNest adds, red
// (ink-examiner) is anything adversarial, green (ink-verified) marks a survived
// test, amber (ink-weakening) a fading one. Nothing is coloured for decoration.
//
// This adds the 'vellum' ramp to the token system for marketing surfaces; the
// app itself keeps the cool 'paper' ramp, so the homepage reads as a document
// and the product reads as an instrument.
//
// This REPLACED the document-style landing page as the default homepage; that
// composition is unchanged and still served at /patentnest. /home-v2, where this
// design was developed, now redirects here.
//
// Public entry points: signed-out visitors are sent to /free-trial (access is
// requested and approved by a person, not self-serve) and /contact. Signed-in
// visitors go straight to /patents/draft/new. The global Header is suppressed
// for '/' in components/ConditionalHeader.tsx — WorkspaceNav is the chrome.
//
// PricingSection resolves live prices on the server, which makes this route
// dynamic. It falls back to the plan catalog if the database is unreachable, so
// the homepage still renders when the DB is down.
export default function HomePage() {
  return (
    <div className="min-h-screen bg-vellum-200 font-sans text-vellum-900 antialiased selection:bg-lamp-600 selection:text-white">
      <WorkspaceNav />
      <main>
        <WorkspaceHero />
        <SystemFlow />
        <FeatureGrid />
        <DraftingCoverage />
        <AudienceStrip />
        <PricingSection />
        <ClosingBand />
      </main>
      <WorkspaceFooter />
    </div>
  )
}
