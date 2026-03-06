import HeroSection from '@/components/home/HeroSection'
import OutputsSection from '@/components/home/OutputsSection'
import DiagramsSection from '@/components/home/DiagramsSection'
import FeaturesSection from '@/components/home/FeaturesSection'
import ComparisonSection from '@/components/home/ComparisonSection'
import HowItWorksSection from '@/components/home/HowItWorksSection'
import PricingSection from '@/components/home/PricingSection'
import TrustSection from '@/components/home/TrustSection'
import CTAFooter from '@/components/home/CTAFooter'
import MinimalFooter from '@/components/home/MinimalFooter'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-ai-graphite-950 selection:bg-ai-blue-500/30">
      <HeroSection />
      <OutputsSection />
      <DiagramsSection />
      <FeaturesSection />
      <ComparisonSection />
      <HowItWorksSection />
      <div className="hidden">
        <PricingSection />
      </div>
      <TrustSection />
      <CTAFooter />
      <MinimalFooter />
    </div>
  )
}
