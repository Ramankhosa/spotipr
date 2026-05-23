'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type SearchResult = {
  publicationNumber?: string | null
  applicationNumberRaw?: string | null
  applicationNumber?: string | null
  title?: string | null
  abstract?: string | null
  snippet?: string | null
  sourcePdfName?: string | null
  sourcePageNumber?: number | null
  extractionConfidence?: number | null
  hybridScore?: number
  scores?: Record<string, number>
}

function formatConfidence(value?: number | null) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : '-'
}

export default function PatentCorpusSearchPage() {
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<SearchResult[]>([])

  const canAccess = useMemo(() => {
    const roles = user?.roles || []
    return roles.includes('SUPER_ADMIN') || roles.includes('SUPER_ADMIN_VIEWER')
  }, [user])

  const authHeaders = useCallback(() => ({
    Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}`,
  }), [])

  useEffect(() => {
    if (!user) return
    if (!canAccess) window.location.href = '/dashboard'
  }, [canAccess, user])

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const response = await fetch('/api/patent-corpus/search', {
        method: 'POST',
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 25 }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Search failed')
      }
      const body = await response.json()
      setResults(body.results || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  if (!user) {
    return <div className="min-h-screen bg-slate-50 p-8 text-slate-600">Loading patent corpus search...</div>
  }

  if (!canAccess) {
    return <div className="min-h-screen bg-slate-50 p-8 text-red-700">Access denied.</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Patent Corpus Search</h1>
            <p className="mt-1 text-sm text-slate-600">Search extracted Indian patent corpus titles, abstracts, classifications, and RAG text.</p>
          </div>
          <a
            href="/super-admin/patent-corpus"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Imports
          </a>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <div className="flex max-w-3xl gap-2">
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') runSearch()
                }}
                placeholder="Search abstracts, titles, applicants, inventors, classifications"
                className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
              />
              <button
                onClick={runSearch}
                disabled={searching || !query.trim()}
                className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                <Search className="h-4 w-4" />
                {searching ? 'Searching' : 'Search'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Publication</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, index) => (
                  <tr key={`${result.publicationNumber || index}-${index}`} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs font-medium">{result.publicationNumber || '-'}</div>
                      {(result.applicationNumberRaw || result.applicationNumber) && (
                        <div className="mt-1 text-xs text-slate-500">{result.applicationNumberRaw || result.applicationNumber}</div>
                      )}
                    </td>
                    <td className="max-w-3xl px-4 py-3">
                      <div className="font-medium leading-5">{result.title || 'Untitled patent'}</div>
                      {(result.abstract || result.snippet) && (
                        <p className="mt-1 line-clamp-3 text-xs leading-5 text-slate-600">{result.abstract || result.snippet}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div className="max-w-xs truncate">{result.sourcePdfName || '-'}</div>
                      {result.sourcePageNumber && <div className="mt-1">Page {result.sourcePageNumber}</div>}
                    </td>
                    <td className="px-4 py-3">{formatConfidence(result.extractionConfidence)}</td>
                  </tr>
                ))}
                {!results.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                      No search results yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
