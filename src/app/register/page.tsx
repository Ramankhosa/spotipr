'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { motion } from 'framer-motion'
import AnimatedLogo from '@/components/ui/animated-logo'
import { Check, CreditCard, Building2 } from 'lucide-react'

// Appearance-only restyle to the paper/ink/lamp document system — all signup
// logic (invite/trial redirects, paid-signup flow, payment handoff) unchanged.

type PlanCode = 'BASIC' | 'PRO' | 'ENTERPRISE'
type BillingCycle = 'monthly' | 'yearly'

const PLAN_NAMES: Record<PlanCode, string> = {
  BASIC: 'Basic',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
}

const PLAN_FEATURES: Record<PlanCode, string[]> = {
  BASIC: ['1 Patent Draft/month', '3 Novelty Searches', '5 Diagrams'],
  PRO: ['4 Patent Drafts/month', '20 Novelty Searches', '30 Diagrams'],
  ENTERPRISE: ['15 Patent Drafts/month', '100 Novelty Searches', '150 Diagrams'],
}

const inputClass =
  'block w-full appearance-none rounded-lg border border-ai-graphite-900/15 bg-white px-4 py-3 text-sm text-ai-graphite-900 placeholder-ai-graphite-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-lamp-600'

const labelClass =
  'mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-ai-graphite-500'

function TitleBlock() {
  return (
    <div className="mb-8 flex items-center gap-4">
      <span className="h-px flex-1 bg-ai-graphite-900/15" />
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-500">
        PatentNest<span className="text-brass-600">.ai</span>
      </p>
      <span className="h-px flex-1 bg-ai-graphite-900/15" />
    </div>
  )
}

function RegisterContent() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Paid signup state
  const [isPaidSignup, setIsPaidSignup] = useState(false)
  const [planCode, setPlanCode] = useState<PlanCode | null>(null)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly')

  const { paidSignup } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const inviteToken = searchParams?.get('invite')
    const trialParam = searchParams?.get('trial')
    const emailParam = searchParams?.get('email')
    const planParam = searchParams?.get('plan')?.toUpperCase() as PlanCode | undefined
    const cycleParam = searchParams?.get('cycle') as BillingCycle | undefined

    if (inviteToken || trialParam === 'true') {
      const params = new URLSearchParams()
      if (inviteToken) params.set('invite', inviteToken)
      if (trialParam) params.set('trial', trialParam)
      if (emailParam) params.set('email', emailParam)
      router.replace(`/institutional-access${params.toString() ? `?${params.toString()}` : ''}`)
      return
    }

    if (planParam && ['BASIC', 'PRO', 'ENTERPRISE'].includes(planParam)) {
      setPlanCode(planParam)
      setIsPaidSignup(true)
      if (cycleParam && ['monthly', 'yearly'].includes(cycleParam)) {
        setBillingCycle(cycleParam)
      }
    }

    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setIsLoading(true)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long')
      setIsLoading(false)
      return
    }

    if (isPaidSignup && planCode) {
      const result = await paidSignup({
        email,
        password,
        firstName,
        lastName,
        planCode,
        billingCycle,
        companyName: companyName || undefined,
      })

      if (result.success) {
        setSuccess('Account created! Redirecting to payment...')

        localStorage.setItem('pending_payment', JSON.stringify({
          planCode: result.planCode,
          billingCycle: result.billingCycle,
          userId: result.userId,
          tenantId: result.tenantId,
        }))

        const loginResponse = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })

        if (loginResponse.ok) {
          const loginData = await loginResponse.json()
          localStorage.setItem('auth_token', loginData.token)

          setTimeout(() => {
            router.push(`/pricing?checkout=true&plan=${planCode}&cycle=${billingCycle}`)
          }, 1000)
        } else {
          setTimeout(() => {
            router.push('/login?redirect=/pricing')
          }, 1500)
        }
      } else {
        setError(result.error || 'Signup failed')
      }

      setIsLoading(false)
    }
  }

  if (!isPaidSignup || !planCode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper-200 px-4 py-12 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md"
        >
          <TitleBlock />

          <div className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-8 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)] sm:p-10">
            <div className="flex flex-col items-center">
              <AnimatedLogo size="lg" />
              <h1 className="mt-5 text-center font-serif text-3xl font-medium tracking-tight text-ai-graphite-900">
                Create your account.
              </h1>
              <p className="mt-2 text-center text-sm text-ai-graphite-500">
                Choose how you&rsquo;d like to join PatentNest.
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <Link
                href="/pricing"
                className="block w-full rounded-xl border-2 border-lamp-600/50 bg-white p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-lamp-600 hover:shadow-[0_16px_40px_-28px_rgba(15,23,42,0.4)]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-lamp-100">
                    <CreditCard className="h-4.5 w-4.5 text-lamp-600" style={{ height: 18, width: 18 }} />
                  </span>
                  <span className="font-serif text-lg font-semibold text-ai-graphite-900">
                    Self-serve subscription
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-ai-graphite-600">
                  Pick a plan, create your account, and complete payment to activate access.
                </p>
              </Link>

              <Link
                href="/institutional-access"
                className="block w-full rounded-xl border border-ai-graphite-900/15 bg-white p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-ai-graphite-900/30 hover:shadow-[0_16px_40px_-28px_rgba(15,23,42,0.4)]"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brass-100">
                    <Building2 style={{ height: 18, width: 18 }} className="text-brass-600" />
                  </span>
                  <span className="font-serif text-lg font-semibold text-ai-graphite-900">
                    Institutional access
                  </span>
                </div>
                <p className="mt-2.5 text-sm leading-relaxed text-ai-graphite-600">
                  Use your organization&rsquo;s ATI access code to join an existing tenant.
                </p>
              </Link>
            </div>

            <p className="mt-7 text-center text-sm text-ai-graphite-500">
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-medium text-lamp-700 underline-offset-4 transition-colors hover:text-lamp-600 hover:underline"
              >
                Sign in
              </Link>
            </p>
          </div>

          <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
            Where ideas become property
          </p>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper-200 px-4 py-12 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-lg"
      >
        <TitleBlock />

        <div className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-8 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)] sm:p-10">
          <div className="flex flex-col items-center">
            <AnimatedLogo size="lg" />

            <div className="mt-4 flex items-center gap-2 rounded-full border border-lamp-600/30 bg-lamp-50 px-3 py-1">
              <CreditCard style={{ height: 14, width: 14 }} className="text-lamp-600" />
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-lamp-700">
                {PLAN_NAMES[planCode]} · {billingCycle === 'yearly' ? 'Annual' : 'Monthly'}
              </span>
            </div>

            <h1 className="mt-4 text-center font-serif text-3xl font-medium tracking-tight text-ai-graphite-900">
              Create your account.
            </h1>
            <p className="mt-2 text-center text-sm text-ai-graphite-500">
              Complete signup to start your {PLAN_NAMES[planCode]} subscription.
            </p>
          </div>

          <div className="mt-6 rounded-lg border border-lamp-200 bg-lamp-50 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-lamp-700">
              {PLAN_NAMES[planCode]} includes
            </p>
            <div className="mt-2.5 grid grid-cols-1 gap-1.5">
              {PLAN_FEATURES[planCode].map((feature, idx) => (
                <div key={idx} className="flex items-center gap-2 text-sm text-ai-graphite-700">
                  <Check style={{ height: 15, width: 15 }} className="flex-shrink-0 text-lamp-600" />
                  <span>{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = `/api/auth/social/google?flow=paid&plan=${planCode}&cycle=${billingCycle}`
              }}
              className="inline-flex w-full items-center justify-center rounded-lg border border-ai-graphite-900/15 bg-white px-4 py-2.5 text-sm font-medium text-ai-graphite-800 transition-colors hover:border-ai-graphite-900/30 hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-600"
            >
              <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>

            <button
              type="button"
              onClick={() => {
                window.location.href = `/api/auth/social/linkedin?flow=paid&plan=${planCode}&cycle=${billingCycle}`
              }}
              className="inline-flex w-full items-center justify-center rounded-lg border border-ai-graphite-900/15 bg-white px-4 py-2.5 text-sm font-medium text-ai-graphite-800 transition-colors hover:border-ai-graphite-900/30 hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-600"
            >
              <svg className="mr-2 h-5 w-5" fill="#0077B5" viewBox="0 0 24 24" aria-hidden>
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-ai-graphite-500">
            We will create your account and continue to payment.
          </p>

          <div className="relative mt-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ai-graphite-900/10" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-paper-50 px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                or with email
              </span>
            </div>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="reg-first-name" className={labelClass}>First name</label>
                <input
                  id="reg-first-name"
                  type="text"
                  required
                  className={inputClass}
                  placeholder="Ada"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="reg-last-name" className={labelClass}>Last name</label>
                <input
                  id="reg-last-name"
                  type="text"
                  required
                  className={inputClass}
                  placeholder="Lovelace"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-email" className={labelClass}>Email address</label>
              <input
                id="reg-email"
                type="email"
                required
                className={inputClass}
                placeholder="counsel@firm.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="reg-company" className={labelClass}>
                Company / organization <span className="normal-case text-ai-graphite-400">(optional)</span>
              </label>
              <input
                id="reg-company"
                type="text"
                className={inputClass}
                placeholder="Your company name"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="reg-password" className={labelClass}>Password</label>
              <input
                id="reg-password"
                type="password"
                required
                className={inputClass}
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="reg-confirm" className={labelClass}>Confirm password</label>
              <input
                id="reg-confirm"
                type="password"
                required
                className={inputClass}
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-lg border border-wax-200 bg-wax-50 p-4"
              >
                <div className="text-center text-sm text-wax-700">{error}</div>
              </motion.div>
            )}

            {success && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-lg border border-lamp-200 bg-lamp-50 p-4"
              >
                <div className="text-center text-sm text-lamp-800">{success}</div>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full justify-center rounded-lg bg-ai-graphite-900 px-4 py-3 text-sm font-medium text-white transition-all duration-150 hover:bg-ai-graphite-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-600 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Creating account…' : 'Continue to payment'}
            </button>

            <p className="text-center text-xs leading-relaxed text-ai-graphite-500">
              By creating an account, you agree to our{' '}
              <Link href="/terms" className="text-lamp-700 underline-offset-2 hover:underline">Terms</Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-lamp-700 underline-offset-2 hover:underline">Privacy Policy</Link>.
            </p>

            <div className="flex items-center justify-center gap-4 text-sm">
              <Link href="/login" className="text-ai-graphite-500 transition-colors hover:text-ai-graphite-900">
                Already have an account?
              </Link>
              <span className="text-ai-graphite-300">|</span>
              <Link href="/institutional-access" className="text-ai-graphite-500 transition-colors hover:text-ai-graphite-900">
                Institutional access
              </Link>
            </div>
          </form>
        </div>
      </motion.div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-paper-200">
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-ai-graphite-500">
            Loading…
          </div>
        </div>
      }
    >
      <RegisterContent />
    </Suspense>
  )
}
