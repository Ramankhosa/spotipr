'use client'

// The posting UI.
//
// Layout is the argument: the manuscript on the left in reading order (headline
// → the short answer → takeaways → body → follow-ups), the instruments on the
// right (score, preview, publication, metadata). Writers stay in one column and
// never lose their place; the checklist watches from the side and only speaks
// up when something is off.
//
// Everything is one form and one save. Nothing auto-publishes, nothing is saved
// behind the author's back — a half-written article silently going live is the
// failure mode that matters here.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ExternalLink,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import BlogEditor from './BlogEditor'
import SeoPanel from './SeoPanel'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { auditPost } from '@/lib/blog/seo-audit'
import { slugify } from '@/lib/blog/content'
import { JURISDICTION_LABELS, type BlogPostStatusValue, type FaqItem } from '@/lib/blog/types'

interface MetaOption { id: string; name: string; slug: string; title?: string | null }
interface RelatedOption { slug: string; title: string; status: string }

interface FormState {
  title: string
  slug: string
  subtitle: string
  excerpt: string
  content: string
  answerSummary: string
  keyTakeaways: string[]
  faqs: FaqItem[]
  focusKeyword: string
  secondaryKeywords: string[]
  tags: string[]
  jurisdictions: string[]
  seoTitle: string
  seoDescription: string
  canonicalUrl: string
  heroImageUrl: string
  heroImageAlt: string
  ogImageUrl: string
  noindex: boolean
  featured: boolean
  relatedSlugs: string[]
  categoryId: string
  authorId: string
  reviewerId: string
  status: BlogPostStatusValue
  publishedAt: string
}

const EMPTY: FormState = {
  title: '', slug: '', subtitle: '', excerpt: '', content: '<p></p>', answerSummary: '',
  keyTakeaways: [], faqs: [], focusKeyword: '', secondaryKeywords: [], tags: [],
  jurisdictions: [], seoTitle: '', seoDescription: '', canonicalUrl: '', heroImageUrl: '',
  heroImageAlt: '', ogImageUrl: '', noindex: false, featured: false, relatedSlugs: [],
  categoryId: '', authorId: '', reviewerId: '', status: 'DRAFT', publishedAt: '',
}

const STATUSES: { value: BlogPostStatusValue; label: string; help: string }[] = [
  { value: 'DRAFT', label: 'Draft', help: 'Not served publicly.' },
  { value: 'SCHEDULED', label: 'Scheduled', help: 'Goes live on its own once the date passes.' },
  { value: 'PUBLISHED', label: 'Published', help: 'Live at the URL below.' },
  { value: 'ARCHIVED', label: 'Archived', help: 'URL 404s; the article is kept.' },
]

// --- small field primitives -------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-relaxed text-ai-graphite-400">{hint}</span>}
    </label>
  )
}

const inputClass =
  'mt-1.5 w-full rounded-lg border border-paper-300 bg-white px-3 py-2 text-sm text-ai-graphite-900 placeholder:text-ai-graphite-300 focus:border-lamp-500 focus:outline-none focus:ring-1 focus:ring-lamp-500 disabled:bg-paper-50'

function TagInput({
  values,
  onChange,
  placeholder,
  disabled,
}: {
  values: string[]
  onChange: (next: string[]) => void
  placeholder: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState('')

  const commit = () => {
    const value = draft.trim().replace(/,$/, '')
    if (value && !values.includes(value)) onChange([...values, value])
    setDraft('')
  }

  return (
    <div className="mt-1.5 rounded-lg border border-paper-300 bg-white p-2">
      {values.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value} className="flex items-center gap-1 rounded bg-paper-100 px-2 py-1 text-xs text-ai-graphite-700">
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                disabled={disabled}
                className="text-ai-graphite-400 hover:text-wax-600"
                aria-label={`Remove ${value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="w-full bg-transparent px-1 text-sm placeholder:text-ai-graphite-300 focus:outline-none"
      />
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint: string
  disabled?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-paper-300 text-lamp-600 focus:ring-lamp-500"
      />
      <span className="text-sm">
        <span className="font-medium text-ai-graphite-800">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-ai-graphite-400">{hint}</span>
      </span>
    </label>
  )
}

// --- the composer -----------------------------------------------------------

export default function BlogComposer({ postId }: { postId?: string }) {
  const router = useRouter()
  const { toast } = useToast()

  const [form, setForm] = useState<FormState>(EMPTY)
  const [categories, setCategories] = useState<MetaOption[]>([])
  const [authors, setAuthors] = useState<MetaOption[]>([])
  const [related, setRelated] = useState<RelatedOption[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [slugTouched, setSlugTouched] = useState(Boolean(postId))

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${typeof window === 'undefined' ? '' : localStorage.getItem('auth_token')}`,
    }),
    []
  )

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const metaRes = await fetch('/api/super-admin/blog/meta', { headers: authHeaders() })
        const meta = await metaRes.json()
        if (!metaRes.ok) throw new Error(meta.error || 'Could not load editorial settings')
        if (cancelled) return

        setCategories(meta.categories)
        setAuthors(meta.authors)
        setRelated(meta.posts.filter((p: RelatedOption) => p.slug))
        setCanWrite(meta.canWrite)

        if (postId) {
          const res = await fetch(`/api/super-admin/blog/${postId}`, { headers: authHeaders() })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error || 'Could not load the post')
          if (cancelled) return

          const post = data.post
          setForm({
            ...EMPTY,
            ...post,
            subtitle: post.subtitle ?? '',
            answerSummary: post.answerSummary ?? '',
            focusKeyword: post.focusKeyword ?? '',
            seoTitle: post.seoTitle ?? '',
            seoDescription: post.seoDescription ?? '',
            canonicalUrl: post.canonicalUrl ?? '',
            heroImageUrl: post.heroImageUrl ?? '',
            heroImageAlt: post.heroImageAlt ?? '',
            ogImageUrl: post.ogImageUrl ?? '',
            reviewerId: post.reviewerId ?? '',
            faqs: Array.isArray(post.faqs) ? post.faqs : [],
            publishedAt: post.publishedAt ? String(post.publishedAt).slice(0, 16) : '',
          })
        } else {
          setForm((prev) => ({
            ...prev,
            categoryId: meta.categories[0]?.id ?? '',
            authorId: meta.authors[0]?.id ?? '',
          }))
        }
      } catch (error) {
        toast({
          title: 'Could not open the composer',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'error',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [postId, authHeaders, toast])

  // Slug follows the title until the author edits it by hand — after that it is
  // theirs, because a published slug must never move on its own.
  useEffect(() => {
    if (!slugTouched && form.title) set('slug', slugify(form.title))
  }, [form.title, slugTouched, set])

  const audit = useMemo(
    () =>
      auditPost({
        ...form,
        reviewerId: form.reviewerId || null,
        faqs: form.faqs,
      }),
    [form]
  )

  const save = async () => {
    if (!form.title.trim() || !form.excerpt.trim() || !form.categoryId || !form.authorId) {
      toast({
        title: 'Missing the essentials',
        description: 'A post needs a title, an excerpt, a category and an author.',
        variant: 'warning',
      })
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        subtitle: form.subtitle || null,
        answerSummary: form.answerSummary || null,
        focusKeyword: form.focusKeyword || null,
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
        canonicalUrl: form.canonicalUrl || null,
        heroImageUrl: form.heroImageUrl || null,
        heroImageAlt: form.heroImageAlt || null,
        ogImageUrl: form.ogImageUrl || null,
        reviewerId: form.reviewerId || null,
        publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : null,
      }

      const res = await fetch(postId ? `/api/super-admin/blog/${postId}` : '/api/super-admin/blog', {
        method: postId ? 'PATCH' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      toast({
        title: postId ? 'Article saved' : 'Article created',
        description: `SEO score ${data.post.seoScore}/100.`,
        variant: 'success',
      })
      if (!postId) router.replace(`/super-admin/blog/${data.post.id}`)
      else router.refresh()
    } catch (error) {
      toast({
        title: 'Could not save',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-ai-graphite-400" />
      </div>
    )
  }

  const disabled = !canWrite || saving

  return (
    <div className="min-h-screen bg-paper-100 pb-24">
      {/* Sticky action bar */}
      <div className="sticky top-0 z-30 border-b border-paper-300 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/super-admin/blog"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-paper-300 text-ai-graphite-500 hover:text-ai-graphite-900"
              aria-label="Back to the editorial desk"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ai-graphite-900">
                {form.title || 'Untitled article'}
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
                {postId ? `/blog/${form.slug}` : 'New article'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {postId && form.status === 'PUBLISHED' && (
              <a
                href={`/blog/${form.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden items-center gap-1.5 rounded-lg border border-paper-300 px-3 py-2 text-sm text-ai-graphite-600 hover:text-ai-graphite-900 sm:flex"
              >
                View live <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={save}
              disabled={disabled}
              className="flex items-center gap-2 rounded-lg bg-ai-graphite-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ai-graphite-800 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------- manuscript ---------- */}
        <div className="space-y-5">
          <section className="rounded-lg border border-paper-300 bg-white p-5 sm:p-6">
            <input
              value={form.title}
              disabled={disabled}
              onChange={(e) => set('title', e.target.value)}
              placeholder="How much does a patent cost in 2026?"
              className="w-full border-0 p-0 text-2xl font-semibold tracking-tight text-ai-graphite-900 placeholder:text-ai-graphite-300 focus:outline-none focus:ring-0"
            />

            <div className="mt-4 flex items-center gap-2 border-t border-paper-200 pt-4">
              <span className="font-mono text-xs text-ai-graphite-400">/blog/</span>
              <input
                value={form.slug}
                disabled={disabled}
                onChange={(e) => {
                  setSlugTouched(true)
                  set('slug', slugify(e.target.value))
                }}
                placeholder="patent-cost"
                className="flex-1 border-0 p-0 font-mono text-xs text-ai-graphite-700 placeholder:text-ai-graphite-300 focus:outline-none focus:ring-0"
              />
            </div>

            <div className="mt-5 space-y-4">
              <Field label="Standfirst" hint="One sentence under the headline. Optional.">
                <input
                  value={form.subtitle}
                  disabled={disabled}
                  onChange={(e) => set('subtitle', e.target.value)}
                  className={inputClass}
                  placeholder="Official fees, attorney fees and the costs nobody quotes you up front."
                />
              </Field>

              <Field label={`Card excerpt · ${form.excerpt.length} chars`} hint="Shown on listings and social shares.">
                <textarea
                  value={form.excerpt}
                  disabled={disabled}
                  onChange={(e) => set('excerpt', e.target.value)}
                  rows={2}
                  className={inputClass}
                />
              </Field>
            </div>
          </section>

          {/* The AEO block */}
          <section className="rounded-lg border border-lamp-200 bg-lamp-50/40 p-5 sm:p-6">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-lamp-700">
              The short answer · {audit.stats.answerWords} words
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ai-graphite-500">
              40–80 words answering the headline outright. This is what AI Overviews, ChatGPT and
              Perplexity quote — write it as if it will be read with no other context.
            </p>
            <textarea
              value={form.answerSummary}
              disabled={disabled}
              onChange={(e) => set('answerSummary', e.target.value)}
              rows={4}
              className="mt-3 w-full rounded-lg border border-lamp-200 bg-white px-3 py-2 text-sm leading-relaxed focus:border-lamp-500 focus:outline-none focus:ring-1 focus:ring-lamp-500"
            />
          </section>

          {/* Takeaways */}
          <section className="rounded-lg border border-paper-300 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
                  Key takeaways
                </p>
                <p className="mt-1 text-[11px] text-ai-graphite-400">
                  Each one must stand on its own when lifted out of the page.
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => set('keyTakeaways', [...form.keyTakeaways, ''])}
                className="flex items-center gap-1 rounded-lg border border-paper-300 px-2.5 py-1.5 text-xs text-ai-graphite-600 hover:text-ai-graphite-900 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            <ul className="mt-4 space-y-2">
              {form.keyTakeaways.map((item, index) => (
                <li key={index} className="flex items-start gap-2">
                  <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-ai-graphite-300" aria-hidden />
                  <textarea
                    value={item}
                    disabled={disabled}
                    rows={2}
                    onChange={(e) => {
                      const next = [...form.keyTakeaways]
                      next[index] = e.target.value
                      set('keyTakeaways', next)
                    }}
                    className="flex-1 rounded-lg border border-paper-300 px-3 py-2 text-sm focus:border-lamp-500 focus:outline-none focus:ring-1 focus:ring-lamp-500"
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => set('keyTakeaways', form.keyTakeaways.filter((_, i) => i !== index))}
                    className="mt-2 text-ai-graphite-300 hover:text-wax-600"
                    aria-label={`Remove takeaway ${index + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
              {form.keyTakeaways.length === 0 && (
                <li className="rounded-lg border border-dashed border-paper-300 py-6 text-center text-xs text-ai-graphite-400">
                  No takeaways yet — aim for four.
                </li>
              )}
            </ul>
          </section>

          {/* Body */}
          <section>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              Article body
            </p>
            <BlogEditor value={form.content} onChange={(html) => set('content', html)} disabled={disabled} />
          </section>

          {/* FAQs */}
          <section className="rounded-lg border border-paper-300 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
                  Follow-up questions · {form.faqs.length}
                </p>
                <p className="mt-1 text-[11px] text-ai-graphite-400">
                  Published as an accordion and as FAQPage structured data.
                </p>
              </div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => set('faqs', [...form.faqs, { question: '', answer: '' }])}
                className="flex items-center gap-1 rounded-lg border border-paper-300 px-2.5 py-1.5 text-xs text-ai-graphite-600 hover:text-ai-graphite-900 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </div>

            <ul className="mt-4 space-y-3">
              {form.faqs.map((faq, index) => (
                <li key={index} className="rounded-lg border border-paper-200 bg-paper-50 p-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-2">
                      <input
                        value={faq.question}
                        disabled={disabled}
                        placeholder="Can I file a patent myself?"
                        onChange={(e) => {
                          const next = [...form.faqs]
                          next[index] = { ...next[index], question: e.target.value }
                          set('faqs', next)
                        }}
                        className="w-full rounded border border-paper-300 bg-white px-3 py-2 text-sm font-medium focus:border-lamp-500 focus:outline-none"
                      />
                      <textarea
                        value={faq.answer}
                        disabled={disabled}
                        rows={3}
                        placeholder="Answer in 2–4 sentences, complete on its own."
                        onChange={(e) => {
                          const next = [...form.faqs]
                          next[index] = { ...next[index], answer: e.target.value }
                          set('faqs', next)
                        }}
                        className="w-full rounded border border-paper-300 bg-white px-3 py-2 text-sm leading-relaxed focus:border-lamp-500 focus:outline-none"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => set('faqs', form.faqs.filter((_, i) => i !== index))}
                      className="text-ai-graphite-300 hover:text-wax-600"
                      aria-label={`Remove question ${index + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* ---------- instruments ---------- */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-8">
          {!canWrite && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              You have read-only access. Changes cannot be saved.
            </p>
          )}

          <section className="rounded-lg border border-paper-300 bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              Publication
            </p>
            <div className="mt-3 space-y-3">
              <select
                value={form.status}
                disabled={disabled}
                onChange={(e) => set('status', e.target.value as BlogPostStatusValue)}
                className={inputClass}
              >
                {STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-ai-graphite-400">
                {STATUSES.find((s) => s.value === form.status)?.help}
              </p>

              <Field
                label="Publish date"
                hint="Leave empty to stamp now on publish. A future date with status Scheduled goes live by itself."
              >
                <input
                  type="datetime-local"
                  value={form.publishedAt}
                  disabled={disabled}
                  onChange={(e) => set('publishedAt', e.target.value)}
                  className={inputClass}
                />
              </Field>

              <div className="space-y-3 border-t border-paper-200 pt-3">
                <Toggle
                  checked={form.featured}
                  disabled={disabled}
                  onChange={(v) => set('featured', v)}
                  label="Feature on /blog"
                  hint="The newest featured article headlines the index."
                />
                <Toggle
                  checked={form.noindex}
                  disabled={disabled}
                  onChange={(v) => set('noindex', v)}
                  label="Hide from search engines"
                  hint="noindex + dropped from the sitemap. For thin or duplicate pages only."
                />
              </div>
            </div>
          </section>

          <SeoPanel
            audit={audit}
            title={form.seoTitle || form.title}
            slug={form.slug}
            description={form.seoDescription || form.answerSummary}
          />

          <section className="space-y-4 rounded-lg border border-paper-300 bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              Targeting
            </p>

            <Field label="Focus keyword" hint="The one query this article is written to win.">
              <input
                value={form.focusKeyword}
                disabled={disabled}
                onChange={(e) => set('focusKeyword', e.target.value)}
                className={inputClass}
                placeholder="patent cost"
              />
            </Field>

            <Field label="Secondary keywords">
              <TagInput
                values={form.secondaryKeywords}
                onChange={(v) => set('secondaryKeywords', v)}
                placeholder="Type and press Enter"
                disabled={disabled}
              />
            </Field>

            <Field label="Tags">
              <TagInput values={form.tags} onChange={(v) => set('tags', v)} placeholder="Type and press Enter" disabled={disabled} />
            </Field>

            <div>
              <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
                Applies to
              </span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(JURISDICTION_LABELS).map(([code, label]) => {
                  const active = form.jurisdictions.includes(code)
                  return (
                    <button
                      key={code}
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        set(
                          'jurisdictions',
                          active
                            ? form.jurisdictions.filter((j) => j !== code)
                            : [...form.jurisdictions, code]
                        )
                      }
                      className={cn(
                        'rounded border px-2 py-1 text-[11px] transition-colors',
                        active
                          ? 'border-lamp-600 bg-lamp-50 text-lamp-700'
                          : 'border-paper-300 text-ai-graphite-500 hover:border-paper-400'
                      )}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-lg border border-paper-300 bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              Attribution
            </p>

            <Field label="Topic hub">
              <select value={form.categoryId} disabled={disabled} onChange={(e) => set('categoryId', e.target.value)} className={inputClass}>
                <option value="">Choose a category…</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Author">
              <select value={form.authorId} disabled={disabled} onChange={(e) => set('authorId', e.target.value)} className={inputClass}>
                <option value="">Choose an author…</option>
                {authors.map((author) => (
                  <option key={author.id} value={author.id}>{author.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Reviewed by" hint="Required in practice for anything that reads as legal guidance.">
              <select value={form.reviewerId} disabled={disabled} onChange={(e) => set('reviewerId', e.target.value)} className={inputClass}>
                <option value="">No reviewer</option>
                {authors.filter((a) => a.id !== form.authorId).map((author) => (
                  <option key={author.id} value={author.id}>{author.name}</option>
                ))}
              </select>
            </Field>
          </section>

          <section className="space-y-4 rounded-lg border border-paper-300 bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              Metadata
            </p>

            <Field label={`SEO title · ${(form.seoTitle || form.title).length}/65`} hint="Defaults to the headline.">
              <input value={form.seoTitle} disabled={disabled} onChange={(e) => set('seoTitle', e.target.value)} className={inputClass} />
            </Field>

            <Field label={`Meta description · ${form.seoDescription.length}/165`}>
              <textarea value={form.seoDescription} disabled={disabled} rows={3} onChange={(e) => set('seoDescription', e.target.value)} className={inputClass} />
            </Field>

            <Field label="Hero image URL">
              <input value={form.heroImageUrl} disabled={disabled} onChange={(e) => set('heroImageUrl', e.target.value)} className={inputClass} placeholder="/images/blog/…" />
            </Field>

            <Field label="Hero image alt text" hint="Describe the image; never repeat the headline.">
              <input value={form.heroImageAlt} disabled={disabled} onChange={(e) => set('heroImageAlt', e.target.value)} className={inputClass} />
            </Field>

            <Field label="Canonical URL" hint="Only when this article was published elsewhere first.">
              <input value={form.canonicalUrl} disabled={disabled} onChange={(e) => set('canonicalUrl', e.target.value)} className={inputClass} placeholder="https://…" />
            </Field>
          </section>

          <section className="rounded-lg border border-paper-300 bg-white p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              Related articles
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ai-graphite-400">
              Hand-picked first; the rest fills from the same hub.
            </p>
            <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {related
                .filter((item) => item.slug !== form.slug)
                .map((item) => {
                  const checked = form.relatedSlugs.includes(item.slug)
                  return (
                    <label key={item.slug} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-paper-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled || (!checked && form.relatedSlugs.length >= 6)}
                        onChange={() =>
                          set(
                            'relatedSlugs',
                            checked
                              ? form.relatedSlugs.filter((s) => s !== item.slug)
                              : [...form.relatedSlugs, item.slug]
                          )
                        }
                        className="mt-0.5 h-3.5 w-3.5 rounded border-paper-300 text-lamp-600"
                      />
                      <span className="text-[12px] leading-snug text-ai-graphite-600">{item.title}</span>
                    </label>
                  )
                })}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
