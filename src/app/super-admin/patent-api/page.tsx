'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Copy, KeyRound, Plus, RefreshCw, Shield, XCircle } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

type ApiKey = { id: string; name: string; keyPrefix: string; keyLastFour: string; status: 'ACTIVE' | 'REVOKED'; expiresAt?: string | null; lastUsedAt?: string | null; revokedAt?: string | null; createdAt: string }
type RequestLog = { id: string; requestId: string; endpoint: string; method: string; statusCode: number; durationMs: number; resultCount?: number | null; errorCode?: string | null; createdAt: string }
type Client = {
  id: string; name: string; slug: string; description?: string | null; status: 'ACTIVE' | 'SUSPENDED'
  rateLimitPerMinute: number; dailyRequestLimit: number; monthlyRequestLimit: number; createdAt: string; lastRequestAt?: string | null
  keys: ApiKey[]; usage: { minute: number; day: number; month: number }; requestLogs?: RequestLog[]
}
type Readiness = {
  enabled: boolean; ready: boolean; embeddingModel: string; embeddingApiKeyAvailable: boolean; pgvectorAvailable: boolean
  minimumCoveragePercent: number; coverageReady: boolean
  indianCorpus: { totalPatents: number; patentsWithCompletedEmbedding: number; patentsWithoutCompletedEmbedding: number; coveragePercent: number }
}

const inputClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-600'
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50'
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString() : 'Never'

export default function PatentApiAdminPage() {
  const { user } = useAuth()
  const [clients, setClients] = useState<Client[]>([])
  const [selected, setSelected] = useState<Client | null>(null)
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const roles = user?.roles || []
  const canAccess = roles.includes('SUPER_ADMIN') || roles.includes('SUPER_ADMIN_VIEWER')
  const readOnly = !roles.includes('SUPER_ADMIN')
  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` }), [])

  const load = useCallback(async (selectedId?: string) => {
    setLoading(true); setError(null)
    try {
      const [clientsResponse, readinessResponse] = await Promise.all([
        fetch('/api/super-admin/patent-api/clients', { headers: authHeaders() }),
        fetch('/api/super-admin/patent-api/readiness', { headers: authHeaders() }),
      ])
      if (!clientsResponse.ok || !readinessResponse.ok) throw new Error('Could not load patent API administration data.')
      const clientsBody = await clientsResponse.json(); const readinessBody = await readinessResponse.json()
      const nextClients = clientsBody.clients || []
      setClients(nextClients); setReadiness(readinessBody.readiness)
      const id = selectedId || selected?.id || nextClients[0]?.id
      if (id) {
        const detailResponse = await fetch(`/api/super-admin/patent-api/clients/${id}`, { headers: authHeaders() })
        if (detailResponse.ok) setSelected((await detailResponse.json()).client)
      } else setSelected(null)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load patent API data.') }
    finally { setLoading(false) }
  }, [authHeaders, selected?.id])

  useEffect(() => {
    if (!user) return
    if (!canAccess) { window.location.href = '/dashboard'; return }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, canAccess])

  const selectClient = async (id: string) => {
    setError(null)
    const response = await fetch(`/api/super-admin/patent-api/clients/${id}`, { headers: authHeaders() })
    if (response.ok) setSelected((await response.json()).client); else setError('Could not load API client details.')
  }

  const createClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); setWorking(true); setError(null)
    try {
      const response = await fetch('/api/super-admin/patent-api/clients', { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), description: form.get('description'), rateLimitPerMinute: Number(form.get('rateLimitPerMinute')), dailyRequestLimit: Number(form.get('dailyRequestLimit')), monthlyRequestLimit: Number(form.get('monthlyRequestLimit')) }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not create client.')
      setShowCreate(false); await load(body.client.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create client.') } finally { setWorking(false) }
  }

  const saveClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return
    const form = new FormData(event.currentTarget); setWorking(true); setError(null)
    try {
      const response = await fetch(`/api/super-admin/patent-api/clients/${selected.id}`, { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), description: form.get('description'), status: form.get('status'), rateLimitPerMinute: Number(form.get('rateLimitPerMinute')), dailyRequestLimit: Number(form.get('dailyRequestLimit')), monthlyRequestLimit: Number(form.get('monthlyRequestLimit')) }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not update client.'); await load(selected.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update client.') } finally { setWorking(false) }
  }

  const issueKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!selected) return
    const formElement = event.currentTarget
    const form = new FormData(formElement); setWorking(true); setError(null); setSecret(null)
    try {
      const response = await fetch(`/api/super-admin/patent-api/clients/${selected.id}/keys`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.get('name'), expiresAt: form.get('expiresAt') || null }) })
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not issue key.')
      setSecret(body.secret); formElement.reset(); await load(selected.id)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not issue key.') } finally { setWorking(false) }
  }

  const revokeKey = async (keyId: string) => {
    if (!selected || !window.confirm('Revoke this API key immediately?')) return
    setWorking(true)
    const response = await fetch(`/api/super-admin/patent-api/clients/${selected.id}/keys/${keyId}/revoke`, { method: 'POST', headers: authHeaders() })
    if (!response.ok) setError((await response.json()).error || 'Could not revoke key.')
    await load(selected.id); setWorking(false)
  }

  const readinessItems = useMemo(() => readiness ? [
    ['Feature enabled', readiness.enabled], ['Embedding key', readiness.embeddingApiKeyAvailable], ['pgvector', readiness.pgvectorAvailable], [`Coverage ≥ ${readiness.minimumCoveragePercent}%`, readiness.coverageReady],
  ] as Array<[string, boolean]> : [], [readiness])

  if (!user || loading) return <div className="min-h-screen bg-slate-50 p-8 text-slate-600">Loading patent API administration...</div>
  if (!canAccess) return <div className="min-h-screen bg-slate-50 p-8 text-red-700">Access denied.</div>

  return <main className="min-h-screen bg-slate-50 text-slate-900"><div className="mx-auto max-w-7xl px-6 py-8">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-sm text-slate-500"><Shield className="h-4 w-4" /> Super Admin</div><h1 className="text-2xl font-semibold">Indian Patent API</h1><p className="mt-1 text-sm text-slate-600">Issue server credentials, control quotas, and inspect API usage.</p></div><div className="flex gap-2"><Link href="/developers/patent-api" target="_blank" className={`${buttonClass} border border-slate-300 bg-white`}>Developer docs</Link><Link href="/super-admin/patent-corpus" className={`${buttonClass} border border-slate-300 bg-white`}><ArrowLeft className="h-4 w-4" /> Corpus</Link><button onClick={() => load()} className={`${buttonClass} border border-slate-300 bg-white`}><RefreshCw className="h-4 w-4" /> Refresh</button></div></header>
    {error && <div className="mb-5 flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="h-4 w-4" />{error}</div>}
    {readiness && <section className={`mb-6 rounded-lg border p-5 ${readiness.ready ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2 font-semibold">{readiness.ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-amber-600" />} Public search {readiness.ready ? 'ready' : 'not ready'}</div><p className="mt-1 text-sm text-slate-600">{readiness.indianCorpus.patentsWithCompletedEmbedding.toLocaleString()} / {readiness.indianCorpus.totalPatents.toLocaleString()} Indian patents embedded ({readiness.indianCorpus.coveragePercent}%) with {readiness.embeddingModel}.</p></div><div className="flex flex-wrap gap-2">{readinessItems.map(([label, ok]) => <span key={label} className={`rounded-full px-3 py-1 text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{label}</span>)}</div></div></section>}
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <aside className="rounded-lg border border-slate-200 bg-white p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">API clients</h2>{!readOnly && <button onClick={() => setShowCreate(value => !value)} className={`${buttonClass} bg-slate-900 text-white`}><Plus className="h-4 w-4" /> New</button>}</div>
        {showCreate && <form onSubmit={createClient} className="mb-4 space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"><input name="name" required minLength={2} placeholder="Client name" className={inputClass} /><textarea name="description" placeholder="Description" className={inputClass} /><div className="grid grid-cols-3 gap-2"><input name="rateLimitPerMinute" type="number" min="1" defaultValue="30" title="Requests/minute" className={inputClass} /><input name="dailyRequestLimit" type="number" min="1" defaultValue="2000" title="Daily requests" className={inputClass} /><input name="monthlyRequestLimit" type="number" min="1" defaultValue="50000" title="Monthly requests" className={inputClass} /></div><button disabled={working} className={`${buttonClass} w-full bg-slate-900 text-white`}>Create client</button></form>}
        <div className="space-y-2">{clients.map(client => <button key={client.id} onClick={() => selectClient(client.id)} className={`w-full rounded-md border p-3 text-left ${selected?.id === client.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-2"><span className="font-medium">{client.name}</span><span className={`h-2 w-2 rounded-full ${client.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-red-500'}`} /></div><div className="mt-1 text-xs text-slate-500">{client.usage.day.toLocaleString()} today · {client.keys.filter(key => key.status === 'ACTIVE').length} active keys</div></button>)}{!clients.length && <p className="py-8 text-center text-sm text-slate-500">No API clients yet.</p>}</div>
      </aside>
      <section className="space-y-6">{selected ? <>
        <form onSubmit={saveClient} className="rounded-lg border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Client configuration</h2><span className="text-xs text-slate-500">{selected.slug}</span></div><div className="grid gap-4 md:grid-cols-2"><label className="text-sm">Name<input name="name" defaultValue={selected.name} disabled={readOnly} className={`mt-1 ${inputClass}`} /></label><label className="text-sm">Status<select name="status" defaultValue={selected.status} disabled={readOnly} className={`mt-1 ${inputClass}`}><option>ACTIVE</option><option>SUSPENDED</option></select></label><label className="text-sm md:col-span-2">Description<textarea name="description" defaultValue={selected.description || ''} disabled={readOnly} className={`mt-1 ${inputClass}`} /></label><label className="text-sm">Requests/minute<input name="rateLimitPerMinute" type="number" min="1" defaultValue={selected.rateLimitPerMinute} disabled={readOnly} className={`mt-1 ${inputClass}`} /></label><label className="text-sm">Requests/day<input name="dailyRequestLimit" type="number" min="1" defaultValue={selected.dailyRequestLimit} disabled={readOnly} className={`mt-1 ${inputClass}`} /></label><label className="text-sm">Requests/month<input name="monthlyRequestLimit" type="number" min="1" defaultValue={selected.monthlyRequestLimit} disabled={readOnly} className={`mt-1 ${inputClass}`} /></label></div>{!readOnly && <button disabled={working} className={`${buttonClass} mt-4 bg-slate-900 text-white`}>Save configuration</button>}</form>
        <div className="grid gap-3 sm:grid-cols-3">{([['This minute', selected.usage.minute, selected.rateLimitPerMinute], ['Today', selected.usage.day, selected.dailyRequestLimit], ['This month', selected.usage.month, selected.monthlyRequestLimit]] as const).map(([label, value, limit]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-4"><div className="text-sm text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value.toLocaleString()} <span className="text-sm font-normal text-slate-400">/ {limit.toLocaleString()}</span></div></div>)}</div>
        <section className="rounded-lg border border-slate-200 bg-white p-5"><div className="mb-4 flex items-center gap-2"><KeyRound className="h-5 w-5" /><h2 className="text-lg font-semibold">API keys</h2></div>{!readOnly && <form onSubmit={issueKey} className="mb-4 flex flex-wrap gap-2"><input name="name" required minLength={2} placeholder="Key name, e.g. Production" className={`${inputClass} max-w-xs`} /><input name="expiresAt" type="date" className={`${inputClass} max-w-48`} /><button disabled={working} className={`${buttonClass} bg-slate-900 text-white`}>Issue key</button></form>}{secret && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4"><div className="font-medium text-amber-900">Copy this key now. It cannot be retrieved again.</div><div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded bg-white p-2 text-sm">{secret}</code><button type="button" onClick={() => navigator.clipboard.writeText(secret)} className={`${buttonClass} border border-amber-300 bg-white`}><Copy className="h-4 w-4" /></button></div></div>}<div className="divide-y divide-slate-100">{selected.keys.map(key => <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="font-medium">{key.name}</div><code className="text-xs text-slate-500">{key.keyPrefix}…{key.keyLastFour}</code></div><div className="text-right text-xs text-slate-500"><div>{key.status} · Last used {dateTime(key.lastUsedAt)}</div><div>Created {dateTime(key.createdAt)}</div></div>{!readOnly && key.status === 'ACTIVE' && <button type="button" disabled={working} onClick={() => revokeKey(key.id)} className={`${buttonClass} border border-red-200 bg-red-50 text-red-700`}><XCircle className="h-4 w-4" /> Revoke</button>}</div>)}{!selected.keys.length && <p className="py-6 text-sm text-slate-500">No keys issued.</p>}</div></section>
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white"><div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4"><Activity className="h-5 w-5" /><h2 className="text-lg font-semibold">Recent requests</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Time</th><th className="px-4 py-3">Endpoint</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Latency</th><th className="px-4 py-3">Results</th></tr></thead><tbody className="divide-y divide-slate-100">{selected.requestLogs?.map(log => <tr key={log.id}><td className="whitespace-nowrap px-4 py-3">{dateTime(log.createdAt)}</td><td className="px-4 py-3 font-mono text-xs">{log.method} {log.endpoint}</td><td className="px-4 py-3"><span className={log.statusCode < 400 ? 'text-emerald-700' : 'text-red-700'}>{log.statusCode}</span>{log.errorCode ? ` · ${log.errorCode}` : ''}</td><td className="px-4 py-3">{log.durationMs} ms</td><td className="px-4 py-3">{log.resultCount ?? '—'}</td></tr>)}{!selected.requestLogs?.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No requests logged.</td></tr>}</tbody></table></div></section>
      </> : <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">Create or select an API client.</div>}</section>
    </div>
  </div></main>
}
