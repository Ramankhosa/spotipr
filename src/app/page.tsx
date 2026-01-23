import HeroSection from '@/components/home/HeroSection'
import FeaturesSection from '@/components/home/FeaturesSection'
import HowItWorksSection from '@/components/home/HowItWorksSection'
import PricingSection from '@/components/home/PricingSection'
import TrustSection from '@/components/home/TrustSection'
import CTAFooter from '@/components/home/CTAFooter'
import MinimalFooter from '@/components/home/MinimalFooter'

export default function HomePage() {
  return (
    <div className="min-h-screen bg-ai-graphite-950 selection:bg-ai-blue-500/30">
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <PricingSection />
      <TrustSection />
      <CTAFooter />
      <MinimalFooter />
    </div>
  )
}
