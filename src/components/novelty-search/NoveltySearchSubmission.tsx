'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, FolderOpen, History, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type Project = { id: string; name: string }
type MatterGroup = { id: string; name: string; referenceCode?: string | null; client: { id: string; name: string } }
type Stage0Review = {
  searchQuery: string
  inventionFeatures: string[]
  featureDetails?: Array<{ feature: string; [key: string]: unknown }>
  epoTitleKeywords?: string[]
  epoAbstractKeywords?: string[]
  epoCombinedKeywords?: string[]
  [key: string]: unknown
}

export default function NoveltySearchSubmission(props: {
  initialProjectId?: string
  initialTitle?: string
  initialDescription?: string
  sourceMetadata?: {
    source: string
    sessionId?: string
    ideaFrameId?: string
    ideaId?: string
    [key: string]: unknown
  }
  onQueued?: (searchId: string) => void | Promise<void>
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
  const [review, setReview] = useState<Stage0Review | null>(null)
  const [editedSearchQuery, setEditedSearchQuery] = useState('')
  const [editedFeatures, setEditedFeatures] = useState<string[]>([])
  const [editedEpoTitleKeywords, setEditedEpoTitleKeywords] = useState<string[]>([])
  const [editedEpoAbstractKeywords, setEditedEpoAbstractKeywords] = useState<string[]>([])
  const [newEpoTitleKeyword, setNewEpoTitleKeyword] = useState('')
  const [newEpoAbstractKeyword, setNewEpoAbstractKeyword] = useState('')
  const [newFeature, setNewFeature] = useState('')
  const [isPreparing, setIsPreparing] = useState(false)
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

  const usesEpoSearch = sourceMode === 'EPO_ONLY' || sourceMode === 'PQAI_PLUS_EPO' || sourceMode === 'PQAI_PLUS_INDIAN_EPO'

  const stringList = (value: unknown) => Array.isArray(value)
    ? value.map(item => String(item || '').trim()).filter(Boolean)
    : []

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
      setReview(null)
      setUploadedName(body.fileName || file.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to extract text from the file.')
    } finally {
      setIsExtracting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const prepareReview = async () => {
    if (!title.trim() || !description.trim()) {
      setError('Invention title and description are required.')
      return
    }
    setIsPreparing(true)
    setError('')
    try {
      const response = await authFetch('/api/novelty-search/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          inventionDescription: description.trim(),
          jurisdiction,
          config: {
            jurisdiction,
            ...(props.sourceMetadata ? { sourceMetadata: props.sourceMetadata } : {}),
            searchSource: { mode: sourceMode, searchMode: 'intelligent', llmExpansion: true },
          },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to generate search terms.')
      const proposed = body.stage0 as Stage0Review
      const features = Array.isArray(proposed?.inventionFeatures) ? proposed.inventionFeatures.map(String).filter(Boolean) : []
      if (!proposed?.searchQuery || features.length === 0) throw new Error('The generated search plan was incomplete. Please regenerate it.')
      setReview(proposed)
      setEditedSearchQuery(String(proposed.searchQuery))
      setEditedFeatures(features)
      setEditedEpoTitleKeywords(usesEpoSearch ? stringList(proposed.epoTitleKeywords) : [])
      setEditedEpoAbstractKeywords(usesEpoSearch ? stringList(proposed.epoAbstractKeywords) : [])
      setNewFeature('')
      setNewEpoTitleKeyword('')
      setNewEpoAbstractKeyword('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to generate search terms.')
    } finally {
      setIsPreparing(false)
    }
  }

  const submit = async () => {
    const approvedQuery = editedSearchQuery.trim()
    const approvedFeatures = editedFeatures.map(feature => feature.trim()).filter(Boolean)
    if (!review || !approvedQuery || approvedFeatures.length === 0) {
      setError('Review and approve a search query and at least one invention feature.')
      return
    }
    setIsSubmitting(true)
    setError('')
    try {
      const approvedStage0 = {
        ...review,
        searchQuery: approvedQuery,
        inventionFeatures: approvedFeatures,
        ...(usesEpoSearch ? {
          epoTitleKeywords: editedEpoTitleKeywords.map(keyword => keyword.trim()).filter(Boolean),
          epoAbstractKeywords: editedEpoAbstractKeywords.map(keyword => keyword.trim()).filter(Boolean),
          epoCombinedKeywords: stringList(review.epoCombinedKeywords),
        } : {}),
      }
      if (!usesEpoSearch) {
        delete (approvedStage0 as any).epoTitleKeywords
        delete (approvedStage0 as any).epoAbstractKeywords
        delete (approvedStage0 as any).epoCombinedKeywords
      }
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
            ...(props.sourceMetadata ? { sourceMetadata: props.sourceMetadata } : {}),
            searchSource: { mode: sourceMode, searchMode: 'intelligent', llmExpansion: true },
          },
          approvedStage0,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to queue novelty search.')
      if (body.searchId && props.onQueued) {
        await props.onQueued(String(body.searchId))
      }
      router.push(`/novelty-search/history?highlight=${encodeURIComponent(body.searchId)}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to queue novelty search.')
      setIsSubmitting(false)
    }
  }

  const updateFeature = (index: number, value: string) => {
    setEditedFeatures(current => current.map((feature, featureIndex) => featureIndex === index ? value : feature))
  }

  const addFeature = () => {
    const value = newFeature.trim()
    if (!value || editedFeatures.some(feature => feature.trim().toLowerCase() === value.toLowerCase())) return
    setEditedFeatures(current => [...current, value])
    setNewFeature('')
  }

  const updateKeyword = (kind: 'title' | 'abstract', index: number, value: string) => {
    const setter = kind === 'title' ? setEditedEpoTitleKeywords : setEditedEpoAbstractKeywords
    setter(current => current.map((keyword, keywordIndex) => keywordIndex === index ? value : keyword))
  }

  const removeKeyword = (kind: 'title' | 'abstract', index: number) => {
    const setter = kind === 'title' ? setEditedEpoTitleKeywords : setEditedEpoAbstractKeywords
    setter(current => current.filter((_, keywordIndex) => keywordIndex !== index))
  }

  const addKeyword = (kind: 'title' | 'abstract') => {
    const value = (kind === 'title' ? newEpoTitleKeyword : newEpoAbstractKeyword).trim()
    if (!value) return
    const setter = kind === 'title' ? setEditedEpoTitleKeywords : setEditedEpoAbstractKeywords
    setter(current => current.some(keyword => keyword.trim().toLowerCase() === value.toLowerCase()) ? current : [...current, value])
    if (kind === 'title') setNewEpoTitleKeyword('')
    else setNewEpoAbstractKeyword('')
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">New Novelty Search</h1>
          <p className="mt-1 text-sm text-slate-600">Review and approve the proposed search query and invention features before the server begins the novelty search.</p>
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
          <input value={title} onChange={event => { setTitle(event.target.value); setReview(null) }} disabled={isPreparing || isSubmitting} maxLength={300} className="h-11 w-full rounded-lg border border-slate-300 px-3 font-normal disabled:bg-slate-50" placeholder="Enter a clear invention title" />
        </label>

        <label className="block space-y-2 text-sm font-medium text-slate-700">
          <span>Invention Description</span>
          <textarea value={description} onChange={event => { setDescription(event.target.value); setReview(null) }} disabled={isPreparing || isSubmitting} rows={10} className="w-full rounded-lg border border-slate-300 px-3 py-3 font-normal leading-6 disabled:bg-slate-50" placeholder="Describe the problem, core mechanism, operating steps, and key technical features." />
        </label>

        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Upload className="h-5 w-5 text-slate-500" />
              <div><div className="text-sm font-medium text-slate-800">Upload disclosure</div><div className="text-xs text-slate-500">Extracted text replaces the description above. Maximum 5 MB.</div></div>
            </div>
            <input ref={fileRef} type="file" disabled={isExtracting || isPreparing || isSubmitting} onChange={event => event.target.files?.[0] && void extractFile(event.target.files[0])} className="max-w-xs text-sm" />
          </div>
          {isExtracting && <p className="mt-2 text-xs text-blue-600">Extracting readable text…</p>}
          {uploadedName && <p className="mt-2 text-xs text-emerald-700">Loaded {uploadedName}</p>}
        </div>

        <div>
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span>Search Source</span>
            <select value={sourceMode} onChange={event => { setSourceMode(event.target.value); setReview(null) }} disabled={isPreparing || isSubmitting} className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal disabled:bg-slate-50">
              <option value="INDIAN_ONLY">Indian database only</option><option value="AUSTRALIA_ONLY">Australian database only</option><option value="EPO_ONLY">European patents only</option><option value="PQAI_ONLY">International patents only</option><option value="PQAI_PLUS_INDIAN">International + Indian database</option><option value="PQAI_PLUS_AUSTRALIA">International + Australian database</option><option value="PQAI_PLUS_EPO">International + European patents</option><option value="PQAI_PLUS_INDIAN_EPO">International + Indian + European patents</option>
            </select>
          </label>
        </div>

        {review && (
          <section className="space-y-5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><CheckCircle2 className="h-5 w-5 text-indigo-600" /> Review Search Plan</h2>
                <p className="mt-1 text-sm text-slate-600">Edit the proposed query and features. The patent search will use exactly what you approve below.</p>
              </div>
              <button type="button" onClick={() => void prepareReview()} disabled={isPreparing || isSubmitting} className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
                {isPreparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Regenerate
              </button>
            </div>

            <label className="block space-y-2 text-sm font-medium text-slate-700">
              <span>Patent Search Query</span>
              <textarea value={editedSearchQuery} onChange={event => setEditedSearchQuery(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 font-normal leading-6" />
            </label>

            <div className="space-y-3">
              <div className="text-sm font-medium text-slate-700">Key Invention Features ({editedFeatures.length})</div>
              {editedFeatures.map((feature, index) => (
                <div key={index} className="flex items-start gap-2">
                  <div className="mt-3 w-8 shrink-0 text-xs font-semibold text-slate-500">KF{index + 1}</div>
                  <textarea value={feature} onChange={event => updateFeature(index, event.target.value)} rows={2} className="min-h-11 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-5" />
                  <button type="button" onClick={() => setEditedFeatures(current => current.filter((_, featureIndex) => featureIndex !== index))} aria-label={`Remove feature ${index + 1}`} className="mt-1 rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex gap-2 pl-10">
                <input value={newFeature} onChange={event => setNewFeature(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addFeature() } }} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" placeholder="Add another technical feature" />
                <button type="button" onClick={addFeature} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add</button>
              </div>
            </div>

            {usesEpoSearch && (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">European patent keyword search</h3>
                  <p className="mt-1 text-xs text-slate-600">These phrases are used only for EPO OPS title and abstract searches.</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">Title keywords</div>
                    {editedEpoTitleKeywords.map((keyword, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input value={keyword} onChange={event => updateKeyword('title', index, event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                        <button type="button" onClick={() => removeKeyword('title', index)} aria-label={`Remove title keyword ${index + 1}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input value={newEpoTitleKeyword} onChange={event => setNewEpoTitleKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addKeyword('title') } }} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" placeholder="Add title phrase" />
                      <button type="button" onClick={() => addKeyword('title')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add</button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700">Abstract keywords</div>
                    {editedEpoAbstractKeywords.map((keyword, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <input value={keyword} onChange={event => updateKeyword('abstract', index, event.target.value)} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" />
                        <button type="button" onClick={() => removeKeyword('abstract', index)} aria-label={`Remove abstract keyword ${index + 1}`} className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input value={newEpoAbstractKeyword} onChange={event => setNewEpoAbstractKeyword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addKeyword('abstract') } }} className="h-10 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm" placeholder="Add abstract phrase" />
                      <button type="button" onClick={() => addKeyword('abstract')} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Plus className="h-4 w-4" /> Add</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900">
              Approval is required because these terms control patent retrieval and feature-by-feature comparison. Internal processing begins only after you approve and queue this plan.
            </div>
            {Array.isArray(review.warnings) && review.warnings.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-white px-4 py-3 text-xs leading-5 text-amber-900">
                <div className="font-semibold">Review warnings</div>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {review.warnings.slice(0, 5).map((warning: unknown, index: number) => (
                    <li key={index}>{String(warning)}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {!review ? (
          <button type="button" onClick={() => void prepareReview()} disabled={isPreparing || isExtracting} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
            {isPreparing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
            {isPreparing ? 'Generating search plan…' : 'Generate Search Query & Features'}
          </button>
        ) : (
          <button type="button" onClick={() => void submit()} disabled={isSubmitting || isPreparing || !editedSearchQuery.trim() || editedFeatures.every(feature => !feature.trim())} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
            {isSubmitting ? 'Queueing approved search…' : 'Approve & Queue Novelty Search'}
          </button>
        )}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500"><FileText className="h-3.5 w-3.5" /> After approval, processing continues in the background.</div>
      </div>
    </div>
  )
}
