'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Archive, Calendar, ChevronLeft, ChevronRight, FileText, FolderOpen, History, Loader2, Plus, RefreshCw, Search, XCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type Client = { id: string; name: string; groups: MatterGroup[] }
type MatterGroup = { id: string; name: string; referenceCode?: string | null; description?: string | null; archivedAt?: string | null; client?: { id: string; name: string }; _count?: { searchRuns: number } }
type Project = { id: string; name: string }
type HistoryItem = {
  id: string; title: string; inventionDescription: string; status: 'QUEUED' | 'PROCESSING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
  createdAt: string; completedAt?: string | null; jurisdiction: string; patentCount: number; error?: string | null;
  project?: Project | null; group?: { id: string; name: string; referenceCode?: string | null; client: { id: string; name: string } } | null;
  draftingHandoff?: { patentId: string; at?: string | null } | null;
}

const statusClasses: Record<HistoryItem['status'], string> = {
  QUEUED: 'border-amber-200 bg-amber-50 text-amber-800',
  PROCESSING: 'border-ai-blue-200 bg-ai-blue-50 text-ai-blue-800',
  COMPLETE: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  FAILED: 'border-red-200 bg-red-50 text-red-800',
  CANCELLED: 'border-slate-200 bg-slate-100 text-slate-700',
}

export default function NoveltySearchHistory() {
  const { authFetch } = useAuth()
  const searchParams = useSearchParams()
  const highlight = searchParams?.get('highlight') || ''
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [projectId, setProjectId] = useState('')
  const [clientId, setClientId] = useState('')
  const [groupId, setGroupId] = useState('')
  const [sort, setSort] = useState('newest')
  const [showGroups, setShowGroups] = useState(searchParams?.get('createGroup') === '1')
  const [newClientName, setNewClientName] = useState('')
  const [newGroupClientId, setNewGroupClientId] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [newReference, setNewReference] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  const [cancellingId, setCancellingId] = useState('')

  const groups = useMemo(() => clients.flatMap(client => (client.groups || []).map(group => ({ ...group, client: { id: client.id, name: client.name } }))), [clients])
  const selectedClientGroups = clientId ? groups.filter(group => group.client?.id === clientId) : groups

  const loadOrganization = useCallback(async () => {
    const [clientResponse, projectResponse] = await Promise.all([authFetch('/api/novelty-search/clients'), authFetch('/api/projects')])
    if (clientResponse.ok) setClients((await clientResponse.json()).clients || [])
    if (projectResponse.ok) setProjects((await projectResponse.json()).projects || [])
  }, [authFetch])

  const loadHistory = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), pageSize: '10', sort })
    if (q.trim()) params.set('q', q.trim())
    if (status) params.set('status', status)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    if (projectId) params.set('projectId', projectId)
    if (clientId) params.set('clientId', clientId)
    if (groupId) params.set('groupId', groupId)
    try {
      const response = await authFetch(`/api/novelty-search/history?${params.toString()}`, { cache: 'no-store' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to load novelty search history.')
      setHistory(body.history || [])
      setPagination(body.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to load novelty search history.')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [authFetch, clientId, dateFrom, dateTo, groupId, page, projectId, q, sort, status])

  useEffect(() => { void loadOrganization() }, [loadOrganization])
  useEffect(() => { const timer = setTimeout(() => void loadHistory(), 200); return () => clearTimeout(timer) }, [loadHistory])
  useEffect(() => {
    if (!history.some(item => item.status === 'QUEUED' || item.status === 'PROCESSING')) return
    const timer = setInterval(() => void loadHistory(true), 8000)
    return () => clearInterval(timer)
  }, [history, loadHistory])

  const resetPage = (action: () => void) => { setPage(1); action() }

  const createGroup = async () => {
    if (!newGroupName.trim() || (!newGroupClientId && !newClientName.trim())) {
      setError('Select or create a client and enter a matter group name.')
      return
    }
    setSavingGroup(true)
    setError('')
    try {
      let resolvedClientId = newGroupClientId
      if (!resolvedClientId) {
        const response = await authFetch('/api/novelty-search/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newClientName }) })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error || 'Failed to create client.')
        resolvedClientId = body.client.id
      }
      const response = await authFetch('/api/novelty-search/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: resolvedClientId, name: newGroupName, referenceCode: newReference, description: newDescription }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to create matter group.')
      setNewClientName(''); setNewGroupClientId(''); setNewGroupName(''); setNewReference(''); setNewDescription('')
      await loadOrganization()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to create matter group.')
    } finally { setSavingGroup(false) }
  }

  const updateGroup = async (group: MatterGroup, data: Record<string, unknown>) => {
    const response = await authFetch(`/api/novelty-search/groups/${group.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    if (!response.ok) setError((await response.json().catch(() => ({}))).error || 'Failed to update matter group.')
    await loadOrganization()
  }

  const moveSearch = async (searchId: string, nextGroupId: string) => {
    const response = await authFetch(`/api/novelty-search/${searchId}/organization`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: nextGroupId || null }) })
    if (!response.ok) setError((await response.json().catch(() => ({}))).error || 'Failed to move search.')
    await loadHistory(true)
    await loadOrganization()
  }

  const retry = async (searchId: string) => {
    const response = await authFetch(`/api/novelty-search/${searchId}/retry`, { method: 'POST' })
    if (!response.ok) setError((await response.json().catch(() => ({}))).error || 'Failed to retry search.')
    await loadHistory(true)
  }

  const cancel = async (item: HistoryItem) => {
    if (!window.confirm(`Cancel the novelty search “${item.title}”? Completed processing cannot be restored.`)) return
    setCancellingId(item.id)
    setError('')
    try {
      const response = await authFetch(`/api/novelty-search/${item.id}/cancel`, { method: 'POST' })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Failed to cancel search.')
      await loadHistory(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Failed to cancel search.')
    } finally {
      setCancellingId('')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900"><History className="h-6 w-6 text-ai-blue-600" /> Novelty Search History</h1><p className="mt-1 text-sm text-slate-600">Your private client matters and background novelty reports.</p></div>
        <div className="flex gap-2">
          <button onClick={() => setShowGroups(value => !value)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><FolderOpen className="h-4 w-4" /> Manage Groups</button>
          <Link href="/novelty-search" className="inline-flex items-center gap-2 rounded-lg bg-ai-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-ai-blue-700"><Plus className="h-4 w-4" /> New Search</Link>
        </div>
      </div>

      {showGroups && <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">Create Client Matter Group</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <select value={newGroupClientId} onChange={event => { setNewGroupClientId(event.target.value); if (event.target.value) setNewClientName('') }} className="h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="">Create new client…</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          {!newGroupClientId && <input value={newClientName} onChange={event => setNewClientName(event.target.value)} placeholder="Client name" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />}
          <input value={newGroupName} onChange={event => setNewGroupName(event.target.value)} placeholder="Matter / group name" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <input value={newReference} onChange={event => setNewReference(event.target.value)} placeholder="Internal reference (optional)" className="h-10 rounded-lg border border-slate-300 px-3 text-sm" />
          <input value={newDescription} onChange={event => setNewDescription(event.target.value)} placeholder="Description (optional)" className="h-10 rounded-lg border border-slate-300 px-3 text-sm lg:col-span-3" />
          <button onClick={createGroup} disabled={savingGroup} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-50">{savingGroup && <Loader2 className="h-4 w-4 animate-spin" />} Create Group</button>
        </div>
        {groups.length > 0 && <div className="mt-5 divide-y divide-slate-100 border-t border-slate-200">{groups.map(group => <div key={group.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"><div><span className="font-medium text-slate-900">{group.client?.name} — {group.name}</span>{group.referenceCode && <span className="ml-2 text-slate-500">{group.referenceCode}</span>}<span className="ml-2 text-xs text-slate-400">{group._count?.searchRuns || 0} searches</span></div><div className="flex gap-2"><button onClick={() => { const name = window.prompt('Rename matter group', group.name); if (name && name !== group.name) void updateGroup(group, { name }) }} className="text-xs font-medium text-ai-blue-600 hover:underline">Rename</button><button onClick={() => void updateGroup(group, { archived: true })} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:underline"><Archive className="h-3 w-3" /> Archive</button></div></div>)}</div>}
      </section>}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={q} onChange={event => resetPage(() => setQ(event.target.value))} placeholder="Search invention titles" className="h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm" /></label>
          <select value={status} onChange={event => resetPage(() => setStatus(event.target.value))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="">All statuses</option><option value="QUEUED">Queued</option><option value="PROCESSING">Processing</option><option value="COMPLETE">Complete</option><option value="FAILED">Failed</option><option value="CANCELLED">Cancelled</option></select>
          <select value={clientId} onChange={event => resetPage(() => { setClientId(event.target.value); setGroupId('') })} className="h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="">All clients</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <select value={groupId} onChange={event => resetPage(() => setGroupId(event.target.value))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="">All matter groups</option>{selectedClientGroups.map(group => <option key={group.id} value={group.id}>{group.client?.name} — {group.name}</option>)}</select>
          <select value={projectId} onChange={event => resetPage(() => setProjectId(event.target.value))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="">All projects</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <label className="flex items-center gap-2"><Calendar className="h-4 w-4 text-slate-400" /><input type="date" value={dateFrom} onChange={event => resetPage(() => setDateFrom(event.target.value))} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <label className="flex items-center gap-2"><span className="text-xs text-slate-500">to</span><input type="date" value={dateTo} onChange={event => resetPage(() => setDateTo(event.target.value))} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 px-2 text-sm" /></label>
          <select value={sort} onChange={event => resetPage(() => setSort(event.target.value))} className="h-10 rounded-lg border border-slate-300 px-3 text-sm"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div className="text-sm text-slate-600">{pagination.total} search{pagination.total === 1 ? '' : 'es'}</div><button onClick={() => void loadHistory()} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" title="Refresh"><RefreshCw className="h-4 w-4" /></button></div>
        {loading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /> Loading history…</div> : history.length === 0 ? <div className="py-16 text-center text-slate-500"><Search className="mx-auto mb-3 h-9 w-9 text-slate-300" /><p>No novelty searches match these filters.</p></div> : <div className="divide-y divide-slate-100">{history.map(item => <article key={item.id} className={`p-5 transition-colors ${highlight === item.id ? 'bg-ai-blue-50 ring-1 ring-inset ring-ai-blue-200' : 'hover:bg-slate-50'}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{item.title}</h3><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses[item.status]}`}>{item.status === 'COMPLETE' ? 'Complete' : item.status.charAt(0) + item.status.slice(1).toLowerCase()}</span>{(item.status === 'QUEUED' || item.status === 'PROCESSING') && <Loader2 className="h-4 w-4 animate-spin text-ai-blue-500" />}</div><p className="mt-2 line-clamp-2 text-sm leading-5 text-slate-600">{item.inventionDescription}</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{new Date(item.createdAt).toLocaleString()}</span><span>{item.jurisdiction}</span>{item.project && <span>Project: {item.project.name}</span>}<span>{item.patentCount} candidates</span></div>{item.error && <p className="mt-2 text-xs text-red-600">{item.error}</p>}</div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <select value={item.group?.id || ''} onChange={event => void moveSearch(item.id, event.target.value)} className="h-9 max-w-56 rounded-lg border border-slate-300 bg-white px-2 text-xs">
                <option value="">Ungrouped</option>
                {groups.map(group => <option key={group.id} value={group.id}>{group.client?.name} — {group.name}</option>)}
              </select>
              {item.status === 'COMPLETE' && <Link href={`/novelty-search/${item.id}/pdf`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-ai-blue-600 px-3 text-xs font-medium text-white hover:bg-ai-blue-700"><FileText className="h-4 w-4" /> View PDF</Link>}
              {item.status === 'COMPLETE' && (item.draftingHandoff?.patentId
                ? <Link href={`/patents/${item.draftingHandoff.patentId}/draft`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-lamp-300 bg-lamp-50 px-3 text-xs font-medium text-lamp-800 hover:bg-lamp-100"><FileText className="h-4 w-4" /> Open draft</Link>
                : <Link href={`/novelty-search/${item.id}/to-drafting`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-lamp-600 px-3 text-xs font-medium text-white hover:bg-lamp-700"><FileText className="h-4 w-4" /> Draft this</Link>
              )}
              {item.status === 'FAILED' && <button onClick={() => void retry(item.id)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-red-300 bg-white px-3 text-xs font-medium text-red-700 hover:bg-red-50"><RefreshCw className="h-4 w-4" /> Retry</button>}
              {(item.status === 'QUEUED' || item.status === 'PROCESSING') && (
                <button onClick={() => void cancel(item)} disabled={cancellingId === item.id} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50">
                  {cancellingId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel
                </button>
              )}
            </div>
          </div>
          {item.group && <div className="mt-3 inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600"><FolderOpen className="h-3 w-3" /> {item.group.client.name} / {item.group.name}{item.group.referenceCode ? ` / ${item.group.referenceCode}` : ''}</div>}
        </article>)}</div>}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-xs text-slate-500">Page {pagination.page} of {pagination.totalPages}</span><div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="rounded-lg border border-slate-300 p-2 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><button disabled={page >= pagination.totalPages} onClick={() => setPage(value => value + 1)} className="rounded-lg border border-slate-300 p-2 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div>
      </section>
    </div>
  )
}
