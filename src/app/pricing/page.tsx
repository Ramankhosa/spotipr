'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { Check, Star, ArrowRight, Globe, X, Loader2 } from 'lucide-react'
import { useRazorpay } from '@/hooks/useRazorpay'

type BillingCycle = 'monthly' | 'yearly'
type PlanCode = 'BASIC' | 'PRO' | 'ENTERPRISE'
type Currency = 'USD' | 'INR'

interface PlanPricing {
  amount: number
  formatted: string
  perMonth: string
  savings?: string
  savingsMonths?: number
}

interface Plan {
  code: PlanCode
  name: string
  currency: Currency
  currencySymbol: string
  pricing: {
    monthly: PlanPricing
    yearly: PlanPricing
  }
  features: { value?: string; label: string }[]
}

export default function PricingPage() {
  const router = useRouter()
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')
  const [plans, setPlans] = useState<Plan[]>([])
  const [currency, setCurrency] = useState<Currency>('USD')
  const [countryCode, setCountryCode] = useState<string>('US')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState<PlanCode | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [successPlan, setSuccessPlan] = useState<string>('')

  const { 
    isLoading: isCheckoutLoading, 
    error: checkoutError, 
    initiateCheckout,
    clearError 
  } = useRazorpay(
    // On success
    (data) => {
      setSuccessPlan(data.planCode)
      setShowSuccessModal(true)
      setSelectedPlan(null)
    },
    // On failure
    (error) => {
      console.error('Payment failed:', error)
      setSelectedPlan(null)
    }
  )

  // Get search params for checkout redirect
  const searchParams = typeof window !== 'undefined' 
    ? new URLSearchParams(window.location.search) 
    : null
  const isCheckoutRedirect = searchParams?.get('checkout') === 'true'
  const redirectPlan = searchParams?.get('plan')?.toUpperCase() as PlanCode | undefined
  const redirectCycle = searchParams?.get('cycle') as BillingCycle | undefined

  // Detect user's country and fetch pricing
  useEffect(() => {
    async function fetchPricing() {
      try {
        // Try to detect country from IP
        let detectedCountry = 'US'
        try {
          const geoResponse = await fetch('https://ipapi.co/json/', { 
            signal: AbortSignal.timeout(3000) 
          })
          if (geoResponse.ok) {
            const geoData = await geoResponse.json()
            detectedCountry = geoData.country_code || 'US'
          }
        } catch {
          // Fallback to US if geo detection fails
        }

        setCountryCode(detectedCountry)

        // Fetch pricing for detected country
        const pricingResponse = await fetch(`/api/pricing?country=${detectedCountry}`)
        if (pricingResponse.ok) {
          const data = await pricingResponse.json()
          setPlans(data.plans)
          setCurrency(data.currency)
        }
      } catch (error) {
        console.error('Failed to fetch pricing:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchPricing()
  }, [])

  // Auto-initiate checkout if redirected from registration
  useEffect(() => {
    if (isCheckoutRedirect && redirectPlan && !isLoading && plans.length > 0) {
      // Set billing cycle from URL if provided
      if (redirectCycle && ['monthly', 'yearly'].includes(redirectCycle)) {
        setBillingCycle(redirectCycle)
      }
      
      // Check if user is logged in
      const token = localStorage.getItem('auth_token') || 
                    localStorage.getItem('token') || 
                    localStorage.getItem('jwt')
      
      if (token && ['BASIC', 'PRO', 'ENTERPRISE'].includes(redirectPlan)) {
        // Small delay to ensure everything is loaded
        const timer = setTimeout(() => {
          setSelectedPlan(redirectPlan)
          initiateCheckout({
            planCode: redirectPlan,
            billingCycle: redirectCycle || billingCycle,
            countryCode,
          })
          
          // Clear the URL params after initiating checkout
          window.history.replaceState({}, '', '/pricing')
          
          // Clear pending payment from localStorage
          localStorage.removeItem('pending_payment')
        }, 500)
        
        return () => clearTimeout(timer)
      }
    }
  }, [isCheckoutRedirect, redirectPlan, redirectCycle, isLoading, plans, countryCode, billingCycle, initiateCheckout])

  const handleSubscribe = async (planCode: PlanCode) => {
    // Check if user is logged in - check all possible token keys
    const token = localStorage.getItem('auth_token') || 
                  localStorage.getItem('token') || 
                  localStorage.getItem('jwt')
    if (!token) {
      // Redirect to register with plan selection
      router.push(`/register?plan=${planCode}&cycle=${billingCycle}`)
      return
    }

    setSelectedPlan(planCode)
    await initiateCheckout({
      planCode,
      billingCycle,
      countryCode,
    })
  }

  const toggleCurrency = () => {
    const newCountry = countryCode === 'IN' ? 'US' : 'IN'
    setCountryCode(newCountry)
    setCurrency(newCountry === 'IN' ? 'INR' : 'USD')
    
    // Refetch pricing
    fetch(`/api/pricing?country=${newCountry}`)
      .then(res => res.json())
      .then(data => {
        setPlans(data.plans)
        setCurrency(data.currency)
      })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ai-graphite-950 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-ai-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ai-graphite-950 selection:bg-ai-blue-500/30">
      {/* Header */}
      <header className="border-b border-ai-graphite-900/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-white">
            PatentNest
          </Link>
          <Link 
            href="/login" 
            className="text-ai-graphite-400 hover:text-white transition-colors"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="relative py-20 overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-[0.03]" />
        <div className="absolute -top-40 right-0 w-[420px] h-[420px] bg-ai-blue-900/20 blur-[140px]" />
        <div className="absolute bottom-0 left-0 w-[380px] h-[380px] bg-cyan-900/20 blur-[140px]" />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-5xl font-bold text-white mb-6 tracking-tight">
              Pricing that scales with your invention speed
            </h1>
            <p className="text-lg md:text-xl text-ai-graphite-400 max-w-3xl mx-auto">
              Choose the plan that matches your roadmap. Every tier delivers high-volume drafting, 
              searches, and visuals so you feel the value from day one.
            </p>
          </motion.div>

          {/* Billing Toggle & Currency */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12">
            {/* Billing Cycle Toggle */}
            <div className="flex items-center gap-3 bg-ai-graphite-900/50 rounded-full p-1">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-all ${
                  billingCycle === 'monthly'
                    ? 'bg-ai-blue-500/20 text-white'
                    : 'text-ai-graphite-400 hover:text-white'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-6 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                  billingCycle === 'yearly'
                    ? 'bg-ai-blue-500/20 text-white'
                    : 'text-ai-graphite-400 hover:text-white'
                }`}
              >
                Yearly
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">
                  Save 1 month
                </span>
              </button>
            </div>

            {/* Currency Toggle */}
            <button
              onClick={toggleCurrency}
              className="flex items-center gap-2 text-sm text-ai-graphite-400 hover:text-white transition-colors"
            >
              <Globe className="w-4 h-4" />
              {currency === 'INR' ? '🇮🇳 INR' : '🇺🇸 USD'}
            </button>
          </div>

          {/* Error Message */}
          {checkoutError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md mx-auto mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-3"
            >
              <span className="text-red-400 text-sm flex-1">{checkoutError}</span>
              <button onClick={clearError} className="text-red-400 hover:text-red-300">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Pricing Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {plans.map((plan, index) => {
              const isPopular = plan.code === 'PRO'
              const pricing = plan.pricing[billingCycle]
              const isSelected = selectedPlan === plan.code

              return (
                <motion.div
                  key={plan.code}
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: index * 0.15 }}
                  className="h-full"
                >
                  <div
                    className={`relative h-full rounded-2xl border p-8 backdrop-blur-sm ${
                      isPopular
                        ? 'bg-ai-graphite-900/70 border-ai-blue-500/50 shadow-[0_0_50px_rgba(14,165,233,0.2)]'
                        : 'bg-ai-graphite-900/40 border-ai-graphite-800/60'
                    }`}
                  >
                    {/* Popular Badge */}
                    {isPopular && (
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full bg-ai-blue-500/20 border border-ai-blue-500/50 text-xs uppercase tracking-[0.2em] text-ai-blue-200 flex items-center gap-2">
                        <Star className="w-3.5 h-3.5 text-ai-blue-300" />
                        Most Popular
                      </div>
                    )}

                    {/* Plan Header */}
                    <div className="flex items-start justify-between gap-6 mb-6">
                      <div>
                        <h3 className="text-2xl font-semibold text-white mb-2">{plan.name}</h3>
                        <p className="text-sm text-ai-graphite-400">
                          {plan.code === 'BASIC' && 'For inventors filing a single patent'}
                          {plan.code === 'PRO' && 'For startups and frequent patent drafting'}
                          {plan.code === 'ENTERPRISE' && 'For teams, law firms & university IP cells'}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-4xl font-bold text-white">{pricing.perMonth}</div>
                        <div className="text-xs tracking-widest text-ai-graphite-500">/ month</div>
                        {billingCycle === 'yearly' && pricing.savings && (
                          <div className="text-xs text-green-400 mt-1">
                            Save {pricing.savings}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Features */}
                    <div className="space-y-3 mb-8">
                      {plan.features.map((feature, featureIndex) => (
                        <div key={featureIndex} className="flex items-start gap-3 text-ai-graphite-300">
                          <span className="mt-0.5 text-ai-blue-400">
                            <Check className="w-4 h-4" />
                          </span>
                          <div className="text-sm leading-relaxed">
                            {feature.value && (
                              <span className="font-semibold text-white">{feature.value} </span>
                            )}
                            {feature.label}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* CTA Button */}
                    <button
                      onClick={() => handleSubscribe(plan.code)}
                      disabled={isCheckoutLoading && isSelected}
                      className={`w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg border text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
                        isPopular
                          ? 'bg-ai-blue-500/20 border-ai-blue-400/60 text-white hover:bg-ai-blue-500/30'
                          : 'bg-ai-graphite-900/60 border-ai-graphite-800 text-ai-graphite-200 hover:text-white hover:border-ai-blue-500/40'
                      }`}
                    >
                      {isCheckoutLoading && isSelected ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          Start {plan.name}
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>

                    {/* Enterprise Note */}
                    {plan.code === 'ENTERPRISE' && (
                      <div className="mt-4 text-center">
                        <Link
                          href="/contact"
                          className="text-xs text-ai-graphite-500 hover:text-ai-blue-300 transition-colors"
                        >
                          Need a tailored rollout or extra seats? Talk to sales
                        </Link>
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>

          {/* Contact Sales */}
          <div className="mt-12 text-center">
            <p className="text-sm text-ai-graphite-400">
              Have something else in mind or need a customized plan?{' '}
              <Link href="/contact" className="text-ai-blue-300 hover:text-ai-blue-200 transition-colors">
                Talk to sales
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-ai-graphite-900 border border-ai-graphite-800 rounded-2xl p-8 max-w-md mx-4 text-center"
          >
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-3">
              Welcome to {successPlan}!
            </h2>
            <p className="text-ai-graphite-400 mb-6">
              Your subscription has been activated. You now have access to all {successPlan} features.
            </p>
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full px-6 py-3 bg-ai-blue-500/20 border border-ai-blue-500/50 text-white rounded-lg font-medium hover:bg-ai-blue-500/30 transition-colors"
            >
              Go to Dashboard
            </button>
          </motion.div>
        </div>
      )}
    </div>
  )
}

