'use client'

/**
 * Public "request a free trial" form.
 *
 * Deliberately a request, not a signup: submitting files an AccessRequest that a
 * super admin approves at /super-admin/requests. Approval is what mints the
 * email-locked invite and unlocks the account, so nothing here grants access.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import {
  ArrowRight,
  Check,
  CircleCheck,
  Clock,
  Loader2,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import {
  EXPECTED_VOLUMES,
  FIELD_LIMITS,
  TEAM_SIZES,
  TRIAL_JURISDICTIONS,
} from '@/lib/access-requests/constants'

interface FormState {
  name: string
  email: string
  phone: string
  organization: string
  jobTitle: string
  country: string
  teamSize: string
  expectedVolume: string
  jurisdictions: string[]
  useCase: string
  website: string // honeypot
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  phone: '',
  organization: '',
  jobTitle: '',
  country: '',
  teamSize: '',
  expectedVolume: '',
  jurisdictions: [],
  useCase: '',
  website: '',
}

const WHAT_YOU_GET = [
  'Full drafting workspace — specification, claims, abstract and figures',
  'Novelty and prior-art search with an attorney-style report',
  'Office action analysis and response drafting',
  'Your jurisdictions configured before you log in',
]

export default function FreeTrialPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).onTrialRecaptchaSuccess = (token: string) => {
      setCaptchaToken(token)
      setError(null)
    }
  }, [])

  const set = useCallback(
    <K extends keyof FormState>(field: K) =>
      (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
      ) => {
        setForm((prev) => ({ ...prev, [field]: event.target.value as FormState[K] }))
      },
    []
  )

  const toggleJurisdiction = (code: string) => {
    setForm((prev) => ({
      ...prev,
      jurisdictions: prev.jurisdictions.includes(code)
        ? prev.jurisdictions.filter((c) => c !== code)
        : [...prev.jurisdictions, code],
    }))
  }

  const useCaseLeft = useMemo(
    () => FIELD_LIMITS.useCase - form.useCase.length,
    [form.useCase.length]
  )

  const resetCaptcha = () => {
    setCaptchaToken(null)
    const grecaptcha = (window as unknown as { grecaptcha?: { reset?: () => void } }).grecaptcha
    try {
      grecaptcha?.reset?.()
    } catch {
      // A stale widget just means the next submit asks again.
    }
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!form.name.trim() || !form.email.trim()) {
      setError('Please tell us your name and email so we can reply.')
      return
    }
    if (siteKey && !captchaToken) {
      setError('Please complete the CAPTCHA below.')
      return
    }

    try {
      setSubmitting(true)
      const response = await fetch('/api/trial-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, recaptchaToken: captchaToken, sourcePage: '/free-trial' }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error || 'Something went wrong. Please try again in a moment.')
        resetCaptcha()
        return
      }

      setSubmitted(true)
    } catch (err) {
      console.error('Trial request submit failed:', err)
      setError('Unable to send your request. Please check your connection and try again.')
      resetCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------

  if (submitted) {
    return (
      <main className="min-h-[calc(100vh-4rem)] bg-paper-200 px-4 py-16">
        <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-secondary">
            <CircleCheck className="h-7 w-7 text-primary" aria-hidden />
          </div>
          <h1 className="font-serif text-3xl text-foreground">Request received</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            We review every trial request by hand so your jurisdictions and limits are set up
            before you log in. You&apos;ll hear from us at{' '}
            <span className="font-medium text-foreground">{form.email}</span>, normally within one
            business day.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-lamp-700"
            >
              Back to home
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              See plans and pricing
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <>
      {siteKey && <Script src="https://www.google.com/recaptcha/api.js" strategy="afterInteractive" />}

      <main className="min-h-[calc(100vh-4rem)] bg-paper-200 px-4 py-10 sm:py-14">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          {/* ---------------------------------------------------------------- */}
          {/* Narrative                                                         */}
          {/* ---------------------------------------------------------------- */}
          <div className="lg:pt-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              Free trial
            </span>

            <h1 className="mt-5 font-serif text-4xl leading-tight text-foreground sm:text-5xl">
              Try PatentNest on
              <span className="block text-primary">your own matter.</span>
            </h1>

            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Tell us what you work on and we&apos;ll open a trial configured for it — the right
              jurisdictions, sensible limits, nothing to uninstall afterwards.
            </p>

            <ul className="mt-8 space-y-3">
              {WHAT_YOU_GET.map((item) => (
                <li key={item} className="flex gap-3 text-sm text-foreground/90">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 space-y-3 border-t border-border pt-6">
              <div className="flex gap-3 text-sm text-muted-foreground">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brass-500" aria-hidden />
                <span>
                  Reviewed by a person, usually within one business day. No card, no auto-renewal.
                </span>
              </div>
              <div className="flex gap-3 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brass-500" aria-hidden />
                <span>
                  Please keep this form high-level — don&apos;t send confidential disclosure here.
                </span>
              </div>
              <div className="flex gap-3 text-sm text-muted-foreground">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brass-500" aria-hidden />
                <span>
                  Just have a question?{' '}
                  <Link href="/contact" className="font-medium text-primary underline-offset-2 hover:underline">
                    Contact us instead
                  </Link>
                  .
                </span>
              </div>
            </div>
          </div>

          {/* ---------------------------------------------------------------- */}
          {/* Form                                                              */}
          {/* ---------------------------------------------------------------- */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <h2 className="font-serif text-2xl text-foreground">Request your trial</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fields marked <span className="text-destructive">*</span> are required. Everything
              else helps us set the account up properly.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
              {/* Honeypot — visually hidden, never focusable */}
              <div className="absolute h-0 w-0 overflow-hidden" aria-hidden>
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={set('website')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" htmlFor="name" required>
                  <input
                    id="name"
                    type="text"
                    required
                    autoComplete="name"
                    maxLength={FIELD_LIMITS.name}
                    value={form.name}
                    onChange={set('name')}
                    className={inputClass}
                    placeholder="Ananya Rao"
                  />
                </Field>

                <Field label="Work email" htmlFor="email" required>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={FIELD_LIMITS.email}
                    value={form.email}
                    onChange={set('email')}
                    className={inputClass}
                    placeholder="you@firm.com"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Organisation" htmlFor="organization">
                  <input
                    id="organization"
                    type="text"
                    autoComplete="organization"
                    maxLength={FIELD_LIMITS.organization}
                    value={form.organization}
                    onChange={set('organization')}
                    className={inputClass}
                    placeholder="Firm, company or university"
                  />
                </Field>

                <Field label="Your role" htmlFor="jobTitle">
                  <input
                    id="jobTitle"
                    type="text"
                    maxLength={FIELD_LIMITS.jobTitle}
                    value={form.jobTitle}
                    onChange={set('jobTitle')}
                    className={inputClass}
                    placeholder="Patent agent, IP counsel, founder…"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country" htmlFor="country">
                  <input
                    id="country"
                    type="text"
                    autoComplete="country-name"
                    maxLength={FIELD_LIMITS.country}
                    value={form.country}
                    onChange={set('country')}
                    className={inputClass}
                    placeholder="India"
                  />
                </Field>

                <Field label="Phone" htmlFor="phone" hint="Optional">
                  <input
                    id="phone"
                    type="tel"
                    autoComplete="tel"
                    maxLength={FIELD_LIMITS.phone}
                    value={form.phone}
                    onChange={set('phone')}
                    className={inputClass}
                    placeholder="+91 98765 43210"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Team size" htmlFor="teamSize">
                  <select
                    id="teamSize"
                    value={form.teamSize}
                    onChange={set('teamSize')}
                    className={selectClass}
                  >
                    <option value="">Select…</option>
                    {TEAM_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Expected filings" htmlFor="expectedVolume">
                  <select
                    id="expectedVolume"
                    value={form.expectedVolume}
                    onChange={set('expectedVolume')}
                    className={selectClass}
                  >
                    <option value="">Select…</option>
                    {EXPECTED_VOLUMES.map((volume) => (
                      <option key={volume} value={volume}>
                        {volume}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-foreground">
                  Jurisdictions you file in
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Pick any that apply
                  </span>
                </legend>
                <div className="flex flex-wrap gap-2">
                  {TRIAL_JURISDICTIONS.map((jurisdiction) => {
                    const active = form.jurisdictions.includes(jurisdiction.code)
                    return (
                      <button
                        key={jurisdiction.code}
                        type="button"
                        onClick={() => toggleJurisdiction(jurisdiction.code)}
                        aria-pressed={active}
                        className={`rounded-full border px-3.5 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
                          active
                            ? 'border-primary bg-secondary font-medium text-secondary-foreground'
                            : 'border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        }`}
                      >
                        {jurisdiction.label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>

              <Field
                label="What would you like to try first?"
                htmlFor="useCase"
                hint={`${useCaseLeft} characters left`}
              >
                <textarea
                  id="useCase"
                  rows={4}
                  maxLength={FIELD_LIMITS.useCase}
                  value={form.useCase}
                  onChange={set('useCase')}
                  className={`${inputClass} resize-y`}
                  placeholder="For example: drafting a provisional for a battery-management invention, and checking novelty before we file in IN and US."
                />
              </Field>

              {siteKey && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div
                    className="g-recaptcha"
                    data-sitekey={siteKey}
                    data-callback="onTrialRecaptchaSuccess"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Protected by reCAPTCHA; Google&apos;s Privacy Policy and Terms apply.
                  </p>
                </div>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] leading-relaxed text-muted-foreground sm:max-w-[58%]">
                  By submitting you agree to be contacted about your trial. See our{' '}
                  <Link href="/privacy" className="underline underline-offset-2">
                    privacy policy
                  </Link>
                  .
                </p>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-lamp-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Sending…
                    </>
                  ) : (
                    <>
                      Request trial access
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </>
  )
}

// ---------------------------------------------------------------------------
// Local primitives
// ---------------------------------------------------------------------------

const inputClass =
  'block w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-ring/30'

const selectClass = `${inputClass} appearance-none bg-card`

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-destructive">*</span>}
        </label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}
