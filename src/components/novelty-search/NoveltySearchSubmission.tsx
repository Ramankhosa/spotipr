'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, FolderOpen, History, Loader2, Search, Upload } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type Project = { id: string; name: string }
type MatterGroup = { id: string; name: string; referenceCode?: string | null; client: { id: string; name: string } }

export default function NoveltySearchSubmission(props: {
  initialProjectId?: string
  initialTitle?: string
  initialDescription?: string
}) {
  const router = useRouter()
  const { authFetch } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(props.initialTitle || '')
  const [description, setDescription] = useState(props.initialDescription || '')
  const [projectId, setProjectId] = useState(props.initialProjectId || '')
  const [groupId, setGroupId] = useState('')
  const jurisdiction = 'IN'
  const [sourceMode, setSourceMode] = useState('INDIAN_ONLY')
  const [projects, setProjects] = useState<Project[]>([])
  const [groups, setGroups] = useState<MatterGroup[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [uploadedName, setUploadedName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      authFetch('/api/projects').then(response => response.ok ? response.json() : { projects: [] }),
      authFetch('/api/novelty-search/groups').then(response => response.ok ? response.json() : { groups: [] }),
    ]).then(([projectData, groupData]) => {
      const nextProjects = projectData.projects || []
      setProjects(nextProjects)
      setGroups(groupData.groups || [])
      if (!props.initialProjectId && nextProjects.length) {
        setProjectId(nextProjects.find((project: Project) => project.name === 'Default Project')?.id || nextProjects[0].id)
      }
    }).catch(() => setError('Failed to load search organization options.'))
  }, [authFetch, props.initialProjectId])

  const extractFile = async (file: File) => {
    const allowed = ['.txt', '.md', '.markdown', '.csv', '.tsv', '.xlsx', '.doc', '.docx', '.pdf']
    if (!allowed.some(extension => file.name.toLowerCase().endsWith(extension))) {
      setError('Unsupported file type. Upload a text-based PDF, DOC/DOCX, spreadsheet, Markdown, CSV, or TXT file.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5 MB.')
      return
    }
    setIsExtracting(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    try {
      const response = await authFetch('/api/patent-search/ingest-file', { method: 'POST', body: form })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to extract text from the file.')
      setDescription(body.textContent || '')
      setUploadedName(body.fileName || file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to extract text from the file.')
    } finally {
      setIsExtracting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Invention title and description are required.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      const response = await authFetch('/api/novelty-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          inventionDescription: description.trim(),
          projectId: projectId || undefined,
          groupId: groupId || undefined,
          jurisdiction,
          config: {
            jurisdiction,
            searchSource: { mode: sourceMode, searchMode: 'intelligent', llmExpansion: true },
          },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to queue novelty search.')
      router.push(`/novelty-search/history?highlight=${encodeURIComponent(body.searchId)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to queue novelty search.')
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">New Novelty Search</h1>
          <p className="mt-1 text-sm text-slate-600">Submit the invention once. Processing continues securely on the server and the final PDF is emailed to you.</p>
        </div>
        <button onClick={() => router.push('/novelty-search/history')} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          <History className="h-4 w-4" /> Search History
        </button>
      </div>

      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> Project</span>
            <select value={projectId} onChange={event => setProjectId(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal">
              <option value="">No project</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Client / Matter Group</span>
            <select value={groupId} onChange={event => setGroupId(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal">
              <option value="">Ungrouped</option>
              {groups.map(group => <option key={group.id} value={group.id}>{group.client.name} — {group.name}{group.referenceCode ? ` (${group.referenceCode})` : ''}</option>)}
            </select>
            <button type="button" onClick={() => router.push('/novelty-search/history?createGroup=1')} className="text-xs font-medium text-blue-600 hover:underline">Create a client matter group</button>
          </label>
        </div>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Invention Title</span>
          <input value={title} onChange={event => setTitle(event.target.value)} maxLength={300} className="h-11 w-full rounded-lg border border-slate-300 px-3 font-normal" placeholder="Enter a clear invention title" />
        </label>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Invention Description</span>
          <textarea value={description} onChange={event => setDescription(event.target.value)} rows={10} className="w-full rounded-lg border border-slate-300 px-3 py-3 font-normal leading-6" placeholder="Describe the problem, core mechanism, operating steps, and key technical features." />
        </label>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Upload className="h-5 w-5 text-slate-500" />
              <div><div className="text-sm font-medium text-slate-800">Upload disclosure</div><div className="text-xs text-slate-500">Extracted text replaces the description above. Maximum 5 MB.</div></div>
            </div>
            <input ref={fileRef} type="file" disabled={isExtracting} onChange={event => event.target.files?.[0] && void extractFile(event.target.files[0])} className="max-w-xs text-sm" />
          </div>
          {isExtracting && <p className="mt-2 text-xs text-blue-600">Extracting readable text…</p>}
          {uploadedName && <p className="mt-2 text-xs text-emerald-700">Loaded {uploadedName}</p>}
        </div>

        <div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Search Source</span>
            <select value={sourceMode} onChange={event => setSourceMode(event.target.value)} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal">
              <option value="INDIAN_ONLY">Indian database only</option><option value="PQAI_ONLY">International patents only</option><option value="PQAI_PLUS_INDIAN">International + Indian database</option>
            </select>
          </label>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <button onClick={submit} disabled={isSubmitting || isExtracting} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          {isSubmitting ? 'Queueing search…' : 'Submit Novelty Search'}
        </button>
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" /> You can close this page after submission.</div>
      </div>
    </div>
  )
}
