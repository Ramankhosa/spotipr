'use client'

/**
 * Super Admin — Editorial desk
 *
 * Every article in one table, sorted by what changed last. The columns are the
 * ones an editor actually decides on: where it is in the pipeline, what it
 * scores, how long it is, and whether anyone is reading it. The SEO score is
 * recomputed on every save, so a post that regressed after an edit shows up here
 * without anyone re-auditing it by hand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ExternalLink,
  FileText,
  Loader2,
  PenSquare,
  Plus,
  RefreshCw,
  Search,
  Star,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { formatPostDate } from '@/lib/blog/content'
import { BLOG_STATUS_LABELS, BLOG_STATUS_STYLES, type BlogPostStatusValue } from '@/lib/blog/types'

interface DeskRow {
  id: string
  slug: string
  title: string
  status: BlogPostStatusValue
  featured: boolean
  noindex: boolean
  publishedAt: string | null
  updatedAt: string
  wordCount: number
  readingMinutes: number
  seoScore: number | null
  viewCount: number
  focusKeyword: string | null
  category: { id: string; name: string; slug: string }
  author: { id: string; name: string }
}

const TABS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'ARCHIVED', label: 'Archived' },
]

function scoreTone(score: number | null) {
  if (score === null) return 'text-ai-graphite-300'
  if (score >= 85) return 'text-emerald-600'
  if (score >= 65) return 'text-amber-500'
  return 'text-wax-600'
}

export default function BlogDeskPage() {
  const { toast } = useToast()
  const [rows, setRows] = useState<DeskRow[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [status, setStatus] = useState('ALL')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [canWrite, setCanWrite] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (query.trim()) params.set('q', query.trim())

      const res = await fetch(`/api/super-admin/blog?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load articles')

      setRows(data.posts)
      setCounts(data.counts)
      setCanWrite(data.canWrite)
    } catch (error) {
      toast({
        title: 'Could not load the desk',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [status, query, toast])

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, query])

  const total = useMemo(() => Object.values(counts).reduce((sum, n) => sum + n, 0), [counts])

  return (
    <div className="min-h-screen bg-paper-100">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
              Super admin · Editorial
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ai-graphite-900">
              The Journal desk
            </h1>
            <p className="mt-1.5 text-sm text-ai-graphite-500">
              {total} {total === 1 ? 'article' : 'articles'} · published at{' '}
              <Link href="/blog" className="text-lamp-700 hover:underline">/blog</Link>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-paper-300 bg-white text-ai-graphite-500 hover:text-ai-graphite-900"
              aria-label="Refresh"
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            {canWrite && (
              <Link
                href="/super-admin/blog/new"
                className="flex items-center gap-2 rounded-lg bg-ai-graphite-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ai-graphite-800"
              >
                <Plus className="h-4 w-4" /> New article
              </Link>
            )}
          </div>
        </header>

        {/* Filters */}
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex flex-wrap gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setStatus(tab.value)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  status === tab.value
                    ? 'bg-ai-graphite-900 text-white'
                    : 'text-ai-graphite-600 hover:bg-white hover:text-ai-graphite-900'
                )}
              >
                {tab.label}
                {tab.value !== 'ALL' && counts[tab.value] ? (
                  <span className={cn('ml-1.5 font-mono text-[10px]', status === tab.value ? 'text-paper-400' : 'text-ai-graphite-400')}>
                    {counts[tab.value]}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ai-graphite-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, slug or keyword"
              className="w-64 rounded-lg border border-paper-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-ai-graphite-300 focus:border-lamp-500 focus:outline-none focus:ring-1 focus:ring-lamp-500"
            />
          </div>
        </div>

        {/* Table */}
        <div className="mt-5 overflow-hidden rounded-lg border border-paper-300 bg-white">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-ai-graphite-300" />
            </div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <FileText className="mx-auto h-7 w-7 text-ai-graphite-300" />
              <p className="mt-3 text-sm text-ai-graphite-500">Nothing here yet.</p>
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-paper-200 bg-paper-50 font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
                  <th className="px-5 py-3 font-normal">Article</th>
                  <th className="px-3 py-3 font-normal">Status</th>
                  <th className="hidden px-3 py-3 font-normal lg:table-cell">Hub</th>
                  <th className="px-3 py-3 text-right font-normal">SEO</th>
                  <th className="hidden px-3 py-3 text-right font-normal sm:table-cell">Words</th>
                  <th className="hidden px-3 py-3 text-right font-normal lg:table-cell">Views</th>
                  <th className="hidden px-3 py-3 font-normal md:table-cell">Updated</th>
                  <th className="px-5 py-3 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-200">
                {rows.map((row) => (
                  <tr key={row.id} className="group hover:bg-paper-50">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/super-admin/blog/${row.id}`}
                        className="flex items-start gap-2 font-medium text-ai-graphite-900 hover:text-lamp-700"
                      >
                        {row.featured && <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Featured" />}
                        <span className="line-clamp-1">{row.title}</span>
                      </Link>
                      <p className="mt-1 flex items-center gap-2 font-mono text-[10px] text-ai-graphite-400">
                        <span className="truncate">/blog/{row.slug}</span>
                        {row.focusKeyword && (
                          <span className="hidden rounded bg-paper-100 px-1.5 py-0.5 sm:inline">{row.focusKeyword}</span>
                        )}
                        {row.noindex && <span className="text-wax-600">noindex</span>}
                      </p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className={cn('rounded-full px-2 py-1 text-[11px] font-medium ring-1 ring-inset', BLOG_STATUS_STYLES[row.status])}>
                        {BLOG_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="hidden px-3 py-3.5 text-ai-graphite-500 lg:table-cell">{row.category.name}</td>
                    <td className={cn('px-3 py-3.5 text-right font-mono text-sm font-medium', scoreTone(row.seoScore))}>
                      {row.seoScore ?? '—'}
                    </td>
                    <td className="hidden px-3 py-3.5 text-right font-mono text-xs text-ai-graphite-500 sm:table-cell">
                      {row.wordCount.toLocaleString()}
                    </td>
                    <td className="hidden px-3 py-3.5 text-right font-mono text-xs text-ai-graphite-500 lg:table-cell">
                      {row.viewCount.toLocaleString()}
                    </td>
                    <td className="hidden px-3 py-3.5 text-xs text-ai-graphite-500 md:table-cell">
                      {formatPostDate(row.updatedAt)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {row.status === 'PUBLISHED' && (
                          <a
                            href={`/blog/${row.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded p-1.5 text-ai-graphite-400 hover:bg-paper-100 hover:text-ai-graphite-900"
                            aria-label={`View ${row.title} live`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                        <Link
                          href={`/super-admin/blog/${row.id}`}
                          className="rounded p-1.5 text-ai-graphite-400 hover:bg-paper-100 hover:text-ai-graphite-900"
                          aria-label={`Edit ${row.title}`}
                        >
                          <PenSquare className="h-4 w-4" />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
