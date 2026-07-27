'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Compass, Plus, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'

interface StudySummary {
  id: string
  title: string
  scopeVersion: number
  createdAt: string
  updatedAt: string
  _count: { runs: number; clusters: number; hypotheses: number }
}

function formatWhen(iso: string) {
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return date.toLocaleDateString()
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' }
}

export function WhitespaceStudiesApp() {
  const router = useRouter()
  const { toast } = useToast()
  const { user, isLoading: authLoading } = useAuth()
  const [studies, setStudies] = useState<StudySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [brief, setBrief] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch('/api/whitespace/studies', { headers: authHeaders() })
      if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error || 'Could not load studies.')
      const data = await response.json()
      setStudies(Array.isArray(data.studies) ? data.studies : [])
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load studies.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Wait for the session to hydrate from localStorage before fetching — firing
  // early sends no Authorization header and the API answers 401.
  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setLoading(false)
      setLoadError(null)
      return
    }
    void load()
  }, [authLoading, user, load])

  const createStudy = useCallback(async () => {
    if (!user) {
      router.push('/login?next=/whitespace')
      return
    }
    if (brief.trim().length < 20) {
      toast({
        variant: 'warning',
        title: 'Describe the field first',
        description: 'A sentence or two is enough — a few words is not enough to build a search scope from.',
      })
      return
    }
    setCreating(true)
    try {
      const response = await fetch('/api/whitespace/studies', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ seedText: brief.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error || 'Could not create the study.')
      router.push(`/whitespace/${data.study.id}`)
    } catch (error) {
      toast({
        variant: 'error',
        title: 'Could not start the study',
        description: error instanceof Error ? error.message : 'Try again.',
      })
      setCreating(false)
    }
  }, [brief, router, toast, user])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <Compass className="h-5 w-5" />
          <span className="text-xs font-medium uppercase tracking-widest">Whitespace Studio</span>
        </div>
        <h1 className="font-serif text-3xl leading-tight text-foreground sm:text-4xl">
          Find what is left to invent — and why nobody has
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Describe a technology field. The studio maps what has already been patented, names the areas
          it breaks into, and shows you where the field is crowded and where it is not. An empty area is
          treated as a question, not an answer.
        </p>
      </header>

      <section className="mb-12 rounded-lg border border-border bg-card p-5 sm:p-6">
        <label htmlFor="brief" className="mb-2 block text-sm font-semibold text-foreground">
          What field do you want to understand?
        </label>
        <Textarea
          id="brief"
          value={brief}
          onChange={event => setBrief(event.target.value)}
          rows={4}
          placeholder="Describe the technology area or the problem you are trying to solve. Plain language is fine — you do not need classification codes or search syntax."
          className="resize-y"
          disabled={creating}
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            You will review and correct the research scope before anything runs.
          </p>
          <Button onClick={() => void createStudy()} disabled={creating}>
            {creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Start a study
              </>
            )}
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your studies
        </h2>

        {authLoading || loading ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading studies…</span>
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="flex-1">
              <p className="text-sm text-foreground">{loadError}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </div>
        ) : !user ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Sign in to see your studies and start a new one.
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push('/login')}>
              Sign in
            </Button>
          </div>
        ) : studies.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No studies yet. Describe a field above and the studio will build the research scope for you
              to review.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {studies.map(study => (
              <li key={study.id}>
                <Link
                  href={`/whitespace/${study.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{study.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Scope v{study.scopeVersion} · {study._count.runs}{' '}
                      {study._count.runs === 1 ? 'run' : 'runs'} · updated {formatWhen(study.updatedAt)}
                    </p>
                  </div>
                  {study._count.hypotheses > 0 && (
                    <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                      {study._count.hypotheses} hypotheses
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
