'use client'

/**
 * Public "contact us" form.
 *
 * Submissions land in the same triage inbox as trial requests
 * (/super-admin/requests, kind = CONTACT) and are acknowledged by email.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Script from 'next/script'
import { ArrowRight, CircleCheck, Clock, Loader2, Rocket, ShieldCheck } from 'lucide-react'
import { CONTACT_TOPICS, FIELD_LIMITS } from '@/lib/access-requests/constants'

interface FormState {
  name: string
  email: string
  phone: string
  organization: string
  topic: string
  message: string
  website: string // honeypot
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  phone: '',
  organization: '',
  topic: CONTACT_TOPICS[0],
  message: '',
  website: '',
}

const STEPS = [
  'Tell us what you are working on and how we can help.',
  'Your message reaches our team and is routed to the right person.',
  'You get a reply from a human, with next steps.',
]

export default function ContactPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY

  useEffect(() => {
    ;(window as unknown as Record<string, unknown>).onContactRecaptchaSuccess = (token: string) => {
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

  const messageLeft = useMemo(
    () => FIELD_LIMITS.message - form.message.length,
    [form.message.length]
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
      setError('Please provide at least your name and email.')
      return
    }
    if (siteKey && !captchaToken) {
      setError('Please complete the CAPTCHA below.')
      return
    }

    try {
      setSubmitting(true)
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, recaptchaToken: captchaToken, sourcePage: '/contact' }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setError(data?.error || 'Something went wrong. Please try again in a moment.')
        resetCaptcha()
        return
      }

      setSubmitted(true)
    } catch (err) {
      console.error('Contact form submit error:', err)
      setError('Unable to submit your message. Please check your connection and try again.')
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
          <h1 className="font-serif text-3xl text-foreground">Message sent</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Thanks for getting in touch. We&apos;ve sent a confirmation to{' '}
            <span className="font-medium text-foreground">{form.email}</span> and someone from the
            team will reply there, usually within one business day.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-lamp-700"
            >
              Back to home
            </Link>
            <Link
              href="/free-trial"
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition hover:bg-muted"
            >
              Request a free trial
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
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* Narrative */}
          <div className="lg:pt-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              We usually reply within a day
            </span>

            <h1 className="mt-5 font-serif text-4xl leading-tight text-foreground sm:text-5xl">
              Let&apos;s talk about
              <span className="block text-primary">your next filing.</span>
            </h1>

            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Drafting your first application, validating novelty, or answering an office action —
              tell us where you are and we&apos;ll point you at the right part of the platform.
            </p>

            <ol className="mt-8 space-y-4">
              {STEPS.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm text-foreground/90">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                    {index + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-8 space-y-3 border-t border-border pt-6">
              <div className="flex gap-3 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brass-500" aria-hidden />
                <span>
                  Keep it high-level — please don&apos;t send confidential or privileged disclosure
                  through this form.
                </span>
              </div>
              <div className="flex gap-3 text-sm text-muted-foreground">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brass-500" aria-hidden />
                <span>Replies come from a person, not an autoresponder.</span>
              </div>
            </div>

            <Link
              href="/free-trial"
              className="mt-8 flex items-start gap-3 rounded-xl border border-primary/25 bg-secondary/50 p-4 transition hover:border-primary/50"
            >
              <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  Want to try it instead?
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  Request a free trial and we&apos;ll set your account up by hand.
                </span>
              </span>
            </Link>
          </div>

          {/* Form */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <h2 className="font-serif text-2xl text-foreground">Tell us how we can help</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;ll email you back at the address you provide.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
              {/* Honeypot */}
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
                    placeholder="Your name"
                  />
                </Field>

                <Field label="Email address" htmlFor="email" required>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    maxLength={FIELD_LIMITS.email}
                    value={form.email}
                    onChange={set('email')}
                    className={inputClass}
                    placeholder="you@example.com"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Organisation" htmlFor="organization" hint="Optional">
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

                <Field label="Phone number" htmlFor="phone" hint="Optional">
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

              <Field label="What do you want to talk about?" htmlFor="topic">
                <select id="topic" value={form.topic} onChange={set('topic')} className={selectClass}>
                  {CONTACT_TOPICS.map((topic) => (
                    <option key={topic} value={topic}>
                      {topic}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="How can we help?"
                htmlFor="message"
                hint={`${messageLeft} characters left`}
              >
                <textarea
                  id="message"
                  rows={5}
                  maxLength={FIELD_LIMITS.message}
                  value={form.message}
                  onChange={set('message')}
                  className={`${inputClass} resize-y`}
                  placeholder="Share a bit about your invention, your current workflow, or the problem you're trying to solve."
                />
              </Field>

              {siteKey && (
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <div
                    className="g-recaptcha"
                    data-sitekey={siteKey}
                    data-callback="onContactRecaptchaSuccess"
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
                  By submitting this form you consent to being contacted about PatentNest.ai.
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
                      Send message
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
