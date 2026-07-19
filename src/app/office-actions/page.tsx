'use client'

/**
 * Office Action Studio — docket.
 * The attorney's triage view: every case sorted by days-to-deadline, with a
 * one-click path into the workspace and a dialog to open a new matter.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileText, Plus, Scale, ChevronRight } from 'lucide-react'

interface DocketCase {
  id: string
  jurisdictionCode: string
  applicationNumber: string
  title: string | null
  applicantName: string | null
  status: string
  createdAt: string
  updatedAt: string
  _count: { documents: number }
  // enriched client-side from the case view when needed
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token') || ''}` })

export default function OfficeActionsDocketPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const { toast } = useToast()

  const [cases, setCases] = useState<DocketCase[] | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ jurisdictionCode: 'IN', applicationNumber: '', applicantName: '', title: '' })

  useEffect(() => {
    if (!isLoading && !user) router.push('/login')
  }, [user, isLoading, router])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/office-actions', { headers: authHeaders() })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not load cases')
      const data = await res.json()
      setCases(data.cases || [])
    } catch (err) {
      toast({ title: 'Could not load the docket', description: err instanceof Error ? err.message : undefined, variant: 'error' })
      setCases([])
    }
  }, [toast])

  useEffect(() => { if (user) void load() }, [user, load])

  const createCase = async () => {
    if (!form.applicationNumber.trim()) {
      toast({ title: 'Application number is required', variant: 'warning' })
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/office-actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create the case')
      toast({ title: 'Case opened', variant: 'success' })
      router.push(`/office-actions/${data.case.id}`)
    } catch (err) {
      toast({ title: 'Could not create the case', description: err instanceof Error ? err.message : undefined, variant: 'error' })
      setCreating(false)
    }
  }

  const sorted = useMemo(() =>
    (cases || []).slice().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
  [cases])

  if (isLoading || (user && cases === null)) {
    return <PageLoadingBird message="Loading your docket..." />
  }
  if (!user) return null

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Scale className="w-6 h-6 text-primary" aria-hidden />
            FER Response
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Examination-report replies, deadline-first. Upload the report, review each objection, export the reply.
          </p>
        </div>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden /> New case
        </Button>
      </div>

      {sorted.length === 0 ? (
        <div className="border border-dashed rounded-lg p-12 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" aria-hidden />
          <h2 className="font-semibold mb-1">No cases yet</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Open a case for an application that has received a First Examination Report, then upload the report to
            extract the objections and compute the reply deadline.
          </p>
          <Button onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-1.5" aria-hidden /> Open your first case
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {sorted.map(c => (
            <li key={c.id}>
              <Link
                href={`/office-actions/${c.id}`}
                className="flex items-center gap-4 border rounded-lg px-4 py-3 bg-card hover:border-primary/60 transition-colors"
              >
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-secondary text-secondary-foreground shrink-0">
                  {c.jurisdictionCode}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">
                    {c.applicationNumber}{c.applicantName ? ` · ${c.applicantName}` : ''}
                  </span>
                  <span className="block text-xs text-muted-foreground truncate">
                    {c.title || 'Untitled matter'} · {c._count.documents} document{c._count.documents === 1 ? '' : 's'} · {c.status.toLowerCase()}
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-[12vh]" onClick={e => { if (e.target === e.currentTarget) setShowNew(false) }}>
          <div className="bg-background border rounded-lg shadow-xl w-full max-w-md p-6" role="dialog" aria-label="New case">
            <h2 className="font-semibold text-lg mb-4">Open a new case</h2>
            <div className="space-y-3">
              <div>
                <Label htmlFor="oa-app-no">Application number</Label>
                <Input id="oa-app-no" placeholder="e.g. 202541122810" value={form.applicationNumber}
                  onChange={e => setForm(f => ({ ...f, applicationNumber: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="oa-applicant">Applicant</Label>
                <Input id="oa-applicant" placeholder="Applicant name" value={form.applicantName}
                  onChange={e => setForm(f => ({ ...f, applicantName: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="oa-title">Matter title (optional)</Label>
                <Input id="oa-title" placeholder="Short internal title" value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="oa-jur">Jurisdiction</Label>
                <select
                  id="oa-jur"
                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.jurisdictionCode}
                  onChange={e => setForm(f => ({ ...f, jurisdictionCode: e.target.value }))}
                >
                  <option value="IN">India — First Examination Report</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="outline" onClick={() => setShowNew(false)} disabled={creating}>Cancel</Button>
              <Button onClick={createCase} disabled={creating}>{creating ? 'Opening…' : 'Open case'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
