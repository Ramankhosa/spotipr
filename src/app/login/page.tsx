'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import AuthLoader from '@/components/ui/AuthLoader'
import { motion } from 'framer-motion'
import AnimatedLogo from '@/components/ui/animated-logo'

// Appearance-only restyle to the paper/ink/lamp document system — all auth
// logic (login flow, social redirect detection, payment redirect) unchanged.

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [socialProvider, setSocialProvider] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuth()
  const router = useRouter()
  const redirectParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('redirect')
    : null
  const redirectAfterLogin = redirectParam?.startsWith('/') && !redirectParam.startsWith('//')
    ? redirectParam
    : '/dashboard'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setSocialProvider(null)

    const result = await login(email, password)

    if (result.success && result.requiresPayment) {
      // Login succeeded but payment is required - redirect to payment page
      router.push(result.redirectUrl || '/pricing?checkout=true')
    } else if (result.success) {
      // Full login success - redirect to requested local page or dashboard
      router.push(redirectAfterLogin)
    } else {
      // Check if this is a social login account
      if (result.error?.includes('uses') && result.error?.includes('login')) {
        // Extract provider from error message
        const match = result.error.match(/uses (\w+) login/)
        if (match) {
          setSocialProvider(match[1].toLowerCase())
        }
      }
      setError(result.error || 'Login failed')
      setIsLoading(false)
    }
  }

  const handleSocialRedirect = () => {
    if (socialProvider) {
      window.location.href = `/api/auth/social/${socialProvider}`
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-paper-200 px-4 py-12">
      {isLoading && <AuthLoader />}

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        {/* document title block */}
        <div className="mb-8 flex items-center gap-4">
          <span className="h-px flex-1 bg-ai-graphite-900/15" />
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-ai-graphite-500">
            PatentNest<span className="text-brass-600">.ai</span>
          </p>
          <span className="h-px flex-1 bg-ai-graphite-900/15" />
        </div>

        <div className="rounded-xl border border-ai-graphite-900/10 bg-paper-50 p-8 shadow-[0_24px_60px_-40px_rgba(15,23,42,0.35)] sm:p-10">
          <div className="flex flex-col items-center">
            <AnimatedLogo size="lg" />
            <h1 className="mt-5 text-center font-serif text-3xl font-medium tracking-tight text-ai-graphite-900">
              Welcome back.
            </h1>
            <p className="mt-2 text-center text-sm text-ai-graphite-500">
              Sign in to continue your applications.
            </p>
          </div>

          {/* Social Login Buttons */}
          <div className="mt-8 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => window.location.href = '/api/auth/social/google'}
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
              onClick={() => window.location.href = '/api/auth/social/linkedin'}
              className="inline-flex w-full items-center justify-center rounded-lg border border-ai-graphite-900/15 bg-white px-4 py-2.5 text-sm font-medium text-ai-graphite-800 transition-colors hover:border-ai-graphite-900/30 hover:bg-paper-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-600"
            >
              <svg className="mr-2 h-5 w-5" fill="#0077B5" viewBox="0 0 24 24" aria-hidden>
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
              </svg>
              LinkedIn
            </button>
          </div>

          <div className="relative mt-7">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ai-graphite-900/10" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-paper-50 px-3 font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
                or with email
              </span>
            </div>
          </div>

          <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-ai-graphite-500"
                >
                  Email address
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="block w-full appearance-none rounded-lg border border-ai-graphite-900/15 bg-white px-4 py-3 text-sm text-ai-graphite-900 placeholder-ai-graphite-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-lamp-600"
                  placeholder="counsel@firm.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-ai-graphite-500"
                >
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="block w-full appearance-none rounded-lg border border-ai-graphite-900/15 bg-white px-4 py-3 text-sm text-ai-graphite-900 placeholder-ai-graphite-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-lamp-600"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-sm">
              <Link
                href="/register"
                className="font-medium text-lamp-700 underline-offset-4 transition-colors hover:text-lamp-600 hover:underline"
              >
                Create account
              </Link>
              <Link
                href="/forgot-password"
                className="text-ai-graphite-500 underline-offset-4 transition-colors hover:text-ai-graphite-900 hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="rounded-lg border border-wax-200 bg-wax-50 p-4"
              >
                <div className="text-center text-sm text-wax-700">{error}</div>
                {socialProvider && (
                  <button
                    type="button"
                    onClick={handleSocialRedirect}
                    className="mt-3 w-full rounded-lg border border-lamp-600/40 px-4 py-2 text-sm font-medium text-lamp-700 transition-colors hover:bg-lamp-100"
                  >
                    Sign in with {socialProvider.charAt(0).toUpperCase() + socialProvider.slice(1)}
                  </button>
                )}
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full justify-center rounded-lg bg-ai-graphite-900 px-4 py-3 text-sm font-medium text-white transition-all duration-150 hover:bg-ai-graphite-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-600 focus-visible:ring-offset-2 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sign in
            </button>

            <p className="mt-4 text-center text-xs leading-relaxed text-ai-graphite-500">
              By signing in, you agree to our{' '}
              <Link href="/terms" className="text-lamp-700 underline-offset-2 hover:underline">
                Terms of Service
              </Link>{' '}
              and{' '}
              <Link href="/privacy" className="text-lamp-700 underline-offset-2 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          </form>
        </div>

        <p className="mt-6 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-ai-graphite-400">
          Where ideas become property
        </p>
      </motion.div>
    </div>
  )
}
