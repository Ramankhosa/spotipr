'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { motion } from 'framer-motion'
import AnimatedLogo from '@/components/ui/animated-logo'
import { CreditCard } from 'lucide-react'

function InstitutionalAccessContent() {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [atiToken, setAtiToken] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isInvited, setIsInvited] = useState(false)
  const [isTrial, setIsTrial] = useState(false)

  const { signup } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const inviteToken = searchParams?.get('invite')
    const trialParam = searchParams?.get('trial')
    const emailParam = searchParams?.get('email')

    if (inviteToken) {
      setAtiToken(inviteToken)
      setIsInvited(true)
    }

    if (trialParam === 'true') {
      setIsTrial(true)
    }

    if (emailParam) {
      setEmail(decodeURIComponent(emailParam))
    }
  }, [searchParams])

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

    const result = await signup(email, password, atiToken, firstName, lastName, isTrial)

    if (result.success) {
      if (isTrial) {
        setSuccess('Trial account created! Redirecting to login...')
      } else {
        setSuccess('Account created successfully! You can now log in.')
      }
      setTimeout(() => {
        router.push('/login')
      }, 2000)
    } else {
      setError(result.error || 'Signup failed')
    }

    setIsLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper-200 relative overflow-hidden py-12 px-4 sm:px-6 lg:px-8">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[50%] -left-[20%] w-[100%] h-[100%] rounded-full bg-brass-600/5 blur-[150px]" />
        <div className="absolute -bottom-[20%] -right-[20%] w-[80%] h-[80%] rounded-full bg-lamp-600/5 blur-[150px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full space-y-8 relative z-10"
      >
        <div className="flex flex-col items-center">
          <div className="mb-6 relative">
            <div className="absolute -inset-4 bg-brass-600/10 blur-xl rounded-full" />
            <AnimatedLogo size="lg" />
          </div>

          {isInvited && isTrial ? (
            <>
              <div className="mb-2 px-3 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-full">
                <span className="text-xs font-medium text-emerald-400">Free Trial Access</span>
              </div>
              <h2 className="text-center font-serif text-3xl font-medium text-ai-graphite-900 tracking-tight">
                Welcome to Your Trial
              </h2>
              <p className="mt-2 text-center text-sm text-ai-graphite-500">
                You&apos;ve been invited to try our platform. Create your account to get started.
              </p>
            </>
          ) : isInvited ? (
            <>
              <div className="mb-2 px-3 py-1 bg-ai-blue-500/20 border border-ai-blue-500/30 rounded-full">
                <span className="text-xs font-medium text-lamp-700">Institutional Access</span>
              </div>
              <h2 className="text-center font-serif text-3xl font-medium text-ai-graphite-900 tracking-tight">
                Join Your Organization
              </h2>
              <p className="mt-2 text-center text-sm text-ai-graphite-500">
                Your team invited you to collaborate. Create your account to join.
              </p>
            </>
          ) : (
            <>
              <div className="mb-2 px-3 py-1 bg-ai-blue-500/20 border border-ai-blue-500/30 rounded-full">
                <span className="text-xs font-medium text-lamp-700">Institutional Access</span>
              </div>
              <h2 className="text-center font-serif text-3xl font-medium text-ai-graphite-900 tracking-tight">
                Create your account
              </h2>
              <p className="mt-2 text-center text-sm text-ai-graphite-500">
                Join your organization&apos;s secure workspace with an access code.
              </p>
            </>
          )}
        </div>

        {!isInvited && (
          <div className="bg-gradient-to-r from-ai-blue-900/30 to-lamp-900/30 border border-ai-blue-700/30 rounded-lg p-4">
            <p className="text-sm text-ai-graphite-600 text-center mb-3">
              Don&apos;t have an access code? Start with a paid plan:
            </p>
            <Link
              href="/pricing"
              className="flex items-center justify-center gap-2 w-full py-2.5 px-4 bg-lamp-100 border border-lamp-200 rounded-lg text-sm font-medium text-lamp-700 hover:bg-lamp-200 hover:text-lamp-800 transition-colors"
            >
              <CreditCard className="w-4 h-4" />
              View Plans & Pricing
            </Link>
          </div>
        )}

        <div className="mt-8">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ai-graphite-900/15" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-paper-200 text-ai-graphite-500">Sign up with</span>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/google'}
              className="w-full inline-flex justify-center py-2 px-4 border border-ai-graphite-900/15 bg-white rounded-lg text-sm font-medium text-ai-graphite-800 hover:bg-paper-100 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>

            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/linkedin'}
              className="w-full inline-flex justify-center py-2 px-4 border border-ai-graphite-900/15 bg-white rounded-lg text-sm font-medium text-ai-graphite-800 hover:bg-paper-100 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="#0077B5" viewBox="0 0 24 24">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </button>
          </div>

          <p className="mt-3 text-xs text-center text-ai-graphite-500">
            {isInvited
              ? 'Your access code will be applied automatically'
              : 'You will enter your access code after social verification'}
          </p>
        </div>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-ai-graphite-900/15" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-paper-200 text-ai-graphite-500">Or register with email</span>
          </div>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-ai-graphite-900/15 bg-white placeholder-ai-graphite-400 text-ai-graphite-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="flex-1">
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-ai-graphite-900/15 bg-white placeholder-ai-graphite-400 text-ai-graphite-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-900/15 bg-white placeholder-ai-graphite-400 text-ai-graphite-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <input
                id="atiToken"
                name="atiToken"
                type="text"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-900/15 bg-white placeholder-ai-graphite-400 text-ai-graphite-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Organization access code"
                value={atiToken}
                onChange={(e) => setAtiToken(e.target.value)}
              />
            </div>
            <div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-900/15 bg-white placeholder-ai-graphite-400 text-ai-graphite-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className="appearance-none block w-full px-4 py-3 border border-ai-graphite-900/15 bg-white placeholder-ai-graphite-400 text-ai-graphite-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-ai-blue-500 focus:border-transparent transition-colors sm:text-sm"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg bg-wax-50 border border-wax-200 p-4"
            >
              <div className="text-sm text-wax-700 text-center">{error}</div>
            </motion.div>
          )}

          {success && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="rounded-lg bg-lamp-50 border border-lamp-200 p-4"
            >
              <div className="text-sm text-lamp-800 text-center">{success}</div>
            </motion.div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-lg text-white bg-ai-blue-600 hover:bg-ai-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ai-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-ai-blue-900/30 transition-all duration-200 overflow-hidden"
          >
            <span className="relative z-10">
              {isLoading ? 'Creating account...' : 'Create account'}
            </span>
            <div className="absolute inset-0 -translate-x-full group-hover:translate-x-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500" />
          </button>

          <p className="mt-4 text-xs text-ai-graphite-500 text-center">
            By creating an account, you agree to our{' '}
            <Link href="/terms" className="text-lamp-700 hover:text-lamp-600 underline-offset-2 hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-lamp-700 hover:text-lamp-600 underline-offset-2 hover:underline">
              Privacy Policy
            </Link>
            .
          </p>

          <div className="text-center">
            <span className="text-sm text-ai-graphite-500">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-lamp-700 hover:text-lamp-600 transition-colors">
                Sign in
              </Link>
            </span>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

export default function InstitutionalAccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-paper-200">
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-ai-graphite-500">Loading...</div>
        </div>
      }
    >
      <InstitutionalAccessContent />
    </Suspense>
  )
}
