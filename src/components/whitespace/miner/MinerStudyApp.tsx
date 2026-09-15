'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowLeft, CheckCircle2, Download, Loader2, Play, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { conflictRunId, wsApi } from '../api'
import type { WhitespaceRunProgress, WhitespaceScope } from '@/lib/whitespace/types'

type Run = { id: string; stage: string; status: string; params?: Record<string, unknown> | null; progress?: WhitespaceRunProgress | null; lastError?: string | null; results?: any; createdAt: string }
type Snapshot = { id: string; eligible: boolean; workload: any; coverage: any; limitations: string[]; approvedAt: string | null; createdAt: string }
type Lead = { id: string; title: string; origin: string; problemStatement: string; proposedMechanism?: string | null; elements: string[]; rationale: string; signals?: Record<string, unknown>; sourceRefs?: Record<string, unknown>; status: string; proposalVersion: number; currentProposalId?: string | null; currentAssessments?: Record<string, any>; currentBriefs?: Record<string, any>; snapshotId?: string | null }
type Proposal = { id: string; snapshotId: string; revision: number; content: any; approvedAt: string | null; reviews: any[] }
type StudyData = { study: { id: string; title: string; scope: WhitespaceScope; scopeVersion: number; inventionJson?: any }; runs: Run[] }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const officeName: Record<string, string> = { IN: 'India', US: 'United States', EP: 'European Patent Office' }

export function MinerStudyApp({ studyId }: { studyId: string }) {
  const { toast } = useToast()
  const [study, setStudy] = useState<StudyData['study'] | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [generated, setGenerated] = useState<any[]>([])
  const [selectedProposal, setSelectedProposal] = useState<any | null>(null)
  const [briefs, setBriefs] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('I reviewed the unresolved risks and limitations recorded in this assessment.')
  const [editingField, setEditingField] = useState(false)
  const [conceptLines, setConceptLines] = useState('')
  const [exclusionLine, setExclusionLine] = useState('')
  const [jurisdictionLine, setJurisdictionLine] = useState('')

  const load = useCallback(async () => {
    try {
      const [studyData, leadData] = await Promise.all([
        wsApi<StudyData>(`/api/whitespace/studies/${studyId}`),
        wsApi<{ leads: Lead[]; snapshots: Snapshot[] }>(`/api/whitespace/studies/${studyId}/leads`),
      ])
      setStudy(studyData.study); setRuns(studyData.runs || []); setLeads(leadData.leads || []); setSnapshots(leadData.snapshots || [])
      if (!editingField) {
        setConceptLines(studyData.study.scope.concepts.map(concept => `${concept.required ? '* ' : ''}${concept.label}${concept.synonyms.length ? ` | ${concept.synonyms.join(', ')}` : ''}`).join('\n'))
        setExclusionLine(studyData.study.scope.exclusions.map(item => item.term).join(', '))
        setJurisdictionLine(studyData.study.scope.filters.jurisdictions.join(', '))
      }
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load the Miner study.') }
    finally { setLoading(false) }
  }, [editingField, studyId])

  const loadLead = useCallback(async (leadId: string) => {
    const detail = await wsApi<{ lead: Lead; proposals: Proposal[]; runs: Run[] }>(`/api/whitespace/studies/${studyId}/leads/${leadId}`)
    setLeads(current => current.map(item => item.id === leadId ? detail.lead : item))
    setProposals(detail.proposals || [])
    const nextBriefs: Record<string, any> = {}
    const pointers = detail.lead.currentBriefs ?? {}
    for (const run of detail.runs || []) if (run.stage === 'MINER_BRIEF' && run.status === 'COMPLETED' && run.results?.office && pointers[run.results.office]?.runId === run.id) nextBriefs[run.results.office] = run.results
    setBriefs(nextBriefs)
  }, [studyId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (selectedLeadId) void loadLead(selectedLeadId) }, [selectedLeadId, loadLead])
  const liveRun = runs.find(run => run.status === 'QUEUED' || run.status === 'PROCESSING') ?? null
  useEffect(() => {
    if (!liveRun) return
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [liveRun, load])

  const waitFor = useCallback(async (runId: string) => {
    for (let i = 0; i < 900; i++) {
      const run = await wsApi<Run>(`/api/whitespace/studies/${studyId}/runs/${runId}`)
      setRuns(current => [run, ...current.filter(item => item.id !== run.id)])
      if (run.status === 'COMPLETED') return run
      if (run.status === 'FAILED') throw new Error(run.lastError || 'The Miner action failed.')
      await sleep(2000)
    }
    throw new Error('The action is still running. You can safely leave and reopen this study later.')
  }, [studyId])

  const runAction = useCallback(async (stage: string, params?: Record<string, unknown>, refresh = false) => {
    setBusy(stage); setError(null)
    try {
      let runId = ''
      try {
        runId = (await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/runs`, { method: 'POST', body: JSON.stringify({ stage, params, refresh }) })).runId
      } catch (cause) {
        runId = conflictRunId(cause) || ''
        if (!runId) throw cause
      }
      const result = await waitFor(runId)
      await load()
      if (typeof params?.leadId === 'string') await loadLead(params.leadId)
      return result
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The Miner action failed.'
      setError(message); toast({ variant: 'error', title: 'Miner action stopped', description: message })
      return null
    } finally { setBusy(null) }
  }, [load, loadLead, studyId, toast, waitFor])

  useEffect(() => {
    if (!study || study.scope.concepts.length || busy === 'compile') return
    setBusy('compile')
    void wsApi(`/api/whitespace/studies/${studyId}/scope/compile`, { method: 'POST', body: JSON.stringify({ force: false }) })
      .then(load).catch(cause => setError(cause instanceof Error ? cause.message : 'Could not define the field.')).finally(() => setBusy(null))
  }, [busy, load, study, studyId])

  const latestSnapshot = snapshots[0] ?? null
  // Approval is for the exact preflight the user is looking at. If a newer
  // preflight exists, do not silently continue on an older approved snapshot.
  const approvedSnapshot = latestSnapshot?.approvedAt ? latestSnapshot : null
  const harvest = runs.find(run => run.stage === 'MINER_HARVEST' && run.status === 'COMPLETED' && run.params?.snapshotId === approvedSnapshot?.id)
  const engines = runs.find(run => run.stage === 'MINER_ENGINES' && run.status === 'COMPLETED' && run.params?.snapshotId === approvedSnapshot?.id)
  const currentLeads = approvedSnapshot ? leads.filter(item => item.snapshotId === approvedSnapshot.id && item.signals?.stale !== true) : []
  const lead = currentLeads.find(item => item.id === selectedLeadId) ?? null
  const currentProposal = proposals.find(item => item.id === lead?.currentProposalId) ?? null
  const latestProposal = proposals[0] ?? null
  const scopeSummary = useMemo(() => study ? [
    ...study.scope.concepts.filter(c => c.required).map(c => c.label),
    ...study.scope.classifications.filter(c => c.accepted).map(c => c.code),
  ].join(' · ') : '', [study])
  const assessmentOffices: string[] = Array.isArray(study?.inventionJson?.assessmentOffices)
    ? (study.inventionJson.assessmentOffices as unknown[]).filter((office: unknown): office is string => typeof office === 'string' && ['IN', 'US', 'EP'].includes(office))
    : ['IN', 'US', 'EP']

  const preflight = async () => {
    setBusy('MINER_PREFLIGHT')
    try {
      let runId = ''
      try { runId = (await wsApi<{ runId: string }>(`/api/whitespace/studies/${studyId}/miner/preflight`, { method: 'POST', body: '{}' })).runId }
      catch (cause) { runId = conflictRunId(cause) || ''; if (!runId) throw cause }
      await waitFor(runId); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Preflight failed.') }
    finally { setBusy(null) }
  }
  const approveSnapshot = async () => {
    if (!latestSnapshot) return
    setBusy('approve-field')
    try { await wsApi(`/api/whitespace/studies/${studyId}/miner/field-snapshots/${latestSnapshot.id}/approve`, { method: 'POST', body: '{}' }); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not approve the field.') }
    finally { setBusy(null) }
  }
  const saveField = async () => {
    if (!study) return
    const concepts = conceptLines.split('\n').map((line, index) => {
      const required = line.trim().startsWith('*')
      const [label, synonymText = ''] = line.replace(/^\s*\*\s*/, '').split('|')
      return { id: `user-${index + 1}`, label: label.trim(), synonyms: synonymText.split(',').map(value => value.trim()).filter(Boolean), required, origin: 'user' as const }
    }).filter(item => item.label)
    if (!concepts.length) { setError('Keep at least one field concept.'); return }
    const scope = structuredClone(study.scope)
    scope.concepts = concepts
    scope.exclusions = exclusionLine.split(',').map(term => ({ term: term.trim(), origin: 'user' as const })).filter(item => item.term)
    scope.filters.jurisdictions = jurisdictionLine.split(',').map(value => value.trim().toUpperCase()).filter(Boolean)
    setBusy('save-field')
    try { await wsApi(`/api/whitespace/studies/${studyId}`, { method: 'PATCH', body: JSON.stringify({ scope }) }); setEditingField(false); await load() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the field.') }
    finally { setBusy(null) }
  }
  const saveProposal = async () => {
    if (!lead || !selectedProposal) return
    setBusy('save-proposal')
    try {
      const result = await wsApi<{ proposal: Proposal }>(`/api/whitespace/studies/${studyId}/leads/${lead.id}/proposals`, { method: 'POST', body: JSON.stringify({ proposal: selectedProposal, expectedRevision: lead.proposalVersion }) })
      await load(); await loadLead(lead.id); setGenerated([]); setSelectedProposal(result.proposal.content)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the proposal.') }
    finally { setBusy(null) }
  }
  const review = async (proposal: Proposal, verdict: string, assessmentRunId?: string) => {
    if (!lead) return
    setBusy(`review-${verdict}`)
    try {
      await wsApi(`/api/whitespace/studies/${studyId}/leads/${lead.id}/review`, { method: 'POST', body: JSON.stringify({ proposalRevisionId: proposal.id, verdict, note: assessmentRunId ? reviewNote : 'Reviewed the concrete mechanism and approved this exact revision for assessment.', ...(assessmentRunId ? { assessmentRunId } : {}) }) })
      await load(); await loadLead(lead.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record the review.') }
    finally { setBusy(null) }
  }
  const createHandoff = async (target: 'novelty' | 'drafting', office: string) => {
    if (!lead) return
    setBusy(`${target}-${office}`)
    try {
      const result = await wsApi<{ destinationUrl: string }>(`/api/whitespace/studies/${studyId}/leads/${lead.id}/handoffs`, { method: 'POST', body: JSON.stringify({ target, office }) })
      window.location.href = result.destinationUrl
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not prepare the handoff.'); setBusy(null) }
  }
  const cancelRun = async () => {
    if (!liveRun) return
    setBusy('cancel')
    try {
      await wsApi(`/api/whitespace/studies/${studyId}/runs/${liveRun.id}/cancel`, { method: 'POST', body: '{}' })
      await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel the active work.') }
    finally { setBusy(null) }
  }

  if (loading) return <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-16"><Loader2 className="h-4 w-4 animate-spin" /> Loading Invention Miner…</div>
  if (!study) return <div className="mx-auto max-w-4xl px-4 py-16 text-destructive">{error || 'Study not found.'}</div>
  const card = 'rounded-xl border border-border bg-card p-5'

  return <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
    <header><Link href="/whitespace" className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" />Whitespace Studio</Link><h1 className="font-serif text-3xl">{study.title}</h1><p className="mt-2 text-muted-foreground">Mine a field → review a solution → assess by office → prepare a brief.</p></header>
    {error && <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"><AlertCircle className="h-5 w-5 text-destructive" /><p className="text-sm">{error}</p></div>}
    {liveRun && <div className="rounded-lg border border-primary/30 bg-primary/5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Work continues in the background</p><p className="mt-1 text-sm text-muted-foreground">{liveRun.progress?.detail || (liveRun.status === 'QUEUED' ? 'Waiting for a Miner worker.' : 'Processing the current step.')}</p></div><Button variant="outline" onClick={() => void cancelRun()} disabled={busy === 'cancel'}>{busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Cancel</Button></div>{liveRun.progress?.steps && <div className="mt-3 grid gap-2 sm:grid-cols-2">{liveRun.progress.steps.map(step => <div key={step.key} className="rounded border bg-background px-3 py-2 text-xs"><span className="font-medium">{step.label}</span><span className="ml-2 uppercase text-muted-foreground">{step.state}</span>{typeof step.n === 'number' && <span className="ml-2 tabular-nums text-muted-foreground">{step.n}{typeof step.total === 'number' ? ` / ${step.total}` : ''}</span>}</div>)}</div>}</div>}

    <section className={card}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">1 · Define and approve the field</p><h2 className="mt-1 text-lg font-semibold">{study.scope.summary || 'Defining the field…'}</h2><p className="mt-2 text-sm text-muted-foreground">{scopeSummary || 'The field definition is being prepared from your brief.'}</p><p className="mt-2 text-xs text-muted-foreground">Exclusions: {study.scope.exclusions.map(e => e.term).join(', ') || 'none'} · Required filters: {study.scope.filters.jurisdictions.join(', ') || 'global'} · Matching: at least {study.scope.matching?.minimumOptionalConcepts ?? 'automatic'} optional concepts</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => setEditingField(value => !value)} disabled={!!busy}>Edit field</Button><Button variant="outline" onClick={() => void preflight()} disabled={!!busy || !study.scope.concepts.length}>{busy === 'MINER_PREFLIGHT' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Check field and workload</Button></div></div>
      {editingField && <div className="mt-4 space-y-3 rounded-lg border p-4"><label className="block text-sm font-medium">Field concepts <span className="font-normal text-muted-foreground">— one per line; start required concepts with *</span></label><Textarea rows={6} value={conceptLines} onChange={event => setConceptLines(event.target.value)} /><label className="block text-sm font-medium">Exclusions</label><Input value={exclusionLine} onChange={event => setExclusionLine(event.target.value)} placeholder="comma-separated" /><label className="block text-sm font-medium">Jurisdiction filters</label><Input value={jurisdictionLine} onChange={event => setJurisdictionLine(event.target.value)} placeholder="blank for global; or IN, US, EP" /><Button onClick={() => void saveField()} disabled={!!busy}>Save field definition</Button></div>}
      {latestSnapshot && <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm"><div className="grid gap-2 sm:grid-cols-5"><Metric label="Families" value={latestSnapshot.coverage?.familiesTotal} /><Metric label="Families to read" value={latestSnapshot.workload?.sampledFamilies} /><Metric label="Model calls, at most" value={latestSnapshot.workload?.extractionCallsUpperBound} /><Metric label="Token ceiling" value={latestSnapshot.workload?.tokenCeiling} /><Metric label="Operations" value={(latestSnapshot.workload?.harvestUnits ?? 0) + (latestSnapshot.workload?.engineUnits ?? 0)} /></div><p className="mt-3 text-xs text-muted-foreground">Cache reuse is measured after the exact source text and extraction-contract hash are known; preflight does not guess it.</p>{Array.isArray(latestSnapshot.workload?.examples) && latestSnapshot.workload.examples.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Representative publications to inspect</p><ul className="mt-2 grid gap-2 sm:grid-cols-2">{latestSnapshot.workload.examples.slice(0, 6).map((example: any) => <li key={example.publicationNumber} className="rounded border bg-background p-2"><span className="font-medium">{example.title}</span><span className="mt-1 block text-xs text-muted-foreground">{example.publicationNumber}</span></li>)}</ul></div>}{latestSnapshot.limitations?.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{latestSnapshot.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul>}{!latestSnapshot.approvedAt && <Button className="mt-4" onClick={() => void approveSnapshot()} disabled={!!busy || !!liveRun || !latestSnapshot.eligible}><CheckCircle2 className="mr-2 h-4 w-4" />Approve this field and workload</Button>}{latestSnapshot.approvedAt && <p className="mt-3 text-xs font-medium text-emerald-700">Approved field snapshot</p>}</div>}
    </section>

    <section className={card}><p className="text-xs font-semibold uppercase tracking-wide text-primary">2 · Harvest and find leads</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void runAction('MINER_HARVEST', { snapshotId: approvedSnapshot?.id })} disabled={!!busy || !!liveRun || !approvedSnapshot}>{busy === 'MINER_HARVEST' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Read the approved field</Button>{harvest && <Button variant="outline" onClick={() => void runAction('MINER_HARVEST', { snapshotId: approvedSnapshot?.id }, true)} disabled={!!busy || !!liveRun}>Refresh reading (new operation)</Button>}<Button variant="outline" onClick={() => void runAction('MINER_ENGINES', { snapshotId: approvedSnapshot?.id })} disabled={!!busy || !!liveRun || !harvest}>{busy === 'MINER_ENGINES' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Run four lead engines</Button>{engines && <Button variant="outline" onClick={() => void runAction('MINER_ENGINES', { snapshotId: approvedSnapshot?.id }, true)} disabled={!!busy || !!liveRun}>Refresh leads (new operation)</Button>}</div><p className="mt-3 text-sm text-muted-foreground">{harvest ? `Harvest completed${typeof harvest.results?.cacheHits === 'number' ? ` with ${harvest.results.cacheHits} cached reading(s) reused` : ''}. ` : 'No harvest yet. '}{engines ? `${currentLeads.length} current leads available.` : 'Engines have not completed.'}</p>
      {Array.isArray(engines?.results?.engines) && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{engines.results.engines.map((engine: any) => <div key={engine.key} className="rounded-lg border p-3 text-xs"><p className="font-semibold capitalize">{engine.key === 'expiry' ? 'Age-based signal' : engine.key}</p><p className="mt-1 text-muted-foreground">{engine.ran ? `${engine.leads} lead(s); ${engine.deduped} deduplicated.` : engine.skipReason || 'Skipped without a reported reason.'}</p></div>)}</div>}
      {!!currentLeads.length && <div className="mt-4 grid gap-3 md:grid-cols-2">{currentLeads.map(item => <button key={item.id} onClick={() => setSelectedLeadId(item.id)} className={`rounded-lg border p-4 text-left ${selectedLeadId === item.id ? 'border-primary bg-primary/5' : 'border-border'}`}><span className="text-[10px] font-semibold uppercase text-muted-foreground">{item.origin.replace(/_/g, ' ')}</span><h3 className="mt-1 font-semibold">{item.title}</h3><p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{item.problemStatement}</p></button>)}</div>}
    </section>

    {lead && <section className={card}><p className="text-xs font-semibold uppercase tracking-wide text-primary">3 · Review a concrete solution</p><h2 className="mt-1 text-xl font-semibold">{lead.title}</h2><p className="mt-2 text-sm">{lead.problemStatement}</p><p className="mt-2 text-sm text-muted-foreground">{lead.rationale}</p><div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" disabled={!!busy || !!liveRun || !approvedSnapshot} onClick={async () => { const result = await runAction('MINER_PROPOSE', { leadId: lead.id, snapshotId: approvedSnapshot?.id }); if (result?.results?.proposals) { setGenerated(result.results.proposals); setSelectedProposal(result.results.proposals[0]) } }}><Play className="mr-2 h-4 w-4" />Generate alternatives</Button>{lead.proposedMechanism && !latestProposal && <Button variant="outline" onClick={() => setSelectedProposal({ title: lead.title, problem: lead.problemStatement, mechanism: lead.proposedMechanism, elements: Array.isArray(lead.elements) && lead.elements.length >= 2 ? lead.elements : ['Primary mechanism', 'Interacting component'], relationships: ['The interacting components cooperate to perform the proposed mechanism.'], intendedEffects: ['Hypothesis: the mechanism addresses the cited problem.'], constraints: [], assumptions: [], experimentsNeeded: ['Verify feasibility and the intended technical effect.'], provenance: 'SOURCE_DISCLOSURE', sourceRefs: sourceReferenceIds(lead.sourceRefs), outsideFieldInspiration: lead.origin === 'CROSS_DOMAIN_TRANSFER' })}>Use engine mechanism</Button>}<Button variant="outline" onClick={() => setSelectedProposal({ title: lead.title, problem: lead.problemStatement, mechanism: '', elements: ['', ''], relationships: [''], intendedEffects: ['Hypothesis: '], constraints: [], assumptions: [], experimentsNeeded: ['Verify feasibility and the intended technical effect.'], provenance: 'USER_ASSERTION', sourceRefs: [], outsideFieldInspiration: false })}>Write my own solution</Button></div>
      {!!generated.length && <div className="mt-4 grid gap-3 md:grid-cols-3">{generated.map((proposal, i) => <button key={i} onClick={() => setSelectedProposal(proposal)} className={`rounded-lg border p-3 text-left ${selectedProposal === proposal ? 'border-primary' : ''}`}><strong className="text-sm">{proposal.title}</strong><p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{proposal.mechanism}</p></button>)}</div>}
      {selectedProposal && <div className="mt-4 space-y-3 rounded-lg border p-4"><label className="block text-sm font-medium">Proposal title</label><Input value={selectedProposal.title ?? ''} onChange={event => setSelectedProposal({ ...selectedProposal, title: event.target.value })} /><label className="block text-sm font-medium">Concrete mechanism</label><Textarea rows={4} value={selectedProposal.mechanism ?? ''} onChange={event => setSelectedProposal({ ...selectedProposal, mechanism: event.target.value })} /><label className="block text-sm font-medium">Interacting elements <span className="font-normal text-muted-foreground">— one per line</span></label><Textarea rows={4} value={(selectedProposal.elements ?? []).join('\n')} onChange={event => setSelectedProposal({ ...selectedProposal, elements: lines(event.target.value) })} /><label className="block text-sm font-medium">Relationships <span className="font-normal text-muted-foreground">— one per line</span></label><Textarea rows={3} value={(selectedProposal.relationships ?? []).join('\n')} onChange={event => setSelectedProposal({ ...selectedProposal, relationships: lines(event.target.value) })} /><label className="block text-sm font-medium">Expected effects <span className="font-normal text-muted-foreground">— hypotheses, one per line</span></label><Textarea rows={3} value={(selectedProposal.intendedEffects ?? []).join('\n')} onChange={event => setSelectedProposal({ ...selectedProposal, intendedEffects: lines(event.target.value) })} /><label className="block text-sm font-medium">Feasibility constraints <span className="font-normal text-muted-foreground">— one per line</span></label><Textarea rows={2} value={(selectedProposal.constraints ?? []).join('\n')} onChange={event => setSelectedProposal({ ...selectedProposal, constraints: lines(event.target.value) })} /><Button className="mt-3" onClick={() => void saveProposal()} disabled={!!busy}>Save as a new revision</Button></div>}
      {latestProposal && <div className="mt-4 rounded-lg bg-muted/50 p-4"><p className="text-sm font-semibold">Proposal revision {latestProposal.revision}</p><p className="mt-1 text-sm">{latestProposal.content.mechanism}</p>{latestProposal.approvedAt ? <p className="mt-2 text-xs font-medium text-emerald-700">Approved for assessment</p> : <div className="mt-3 flex gap-2"><Button onClick={() => void review(latestProposal, 'APPROVED')} disabled={!!busy}>Approve exact revision</Button><Button variant="outline" onClick={() => void review(latestProposal, 'REJECTED')} disabled={!!busy}>Reject</Button></div>}</div>}
    </section>}

    {lead && currentProposal && <section className={card}><p className="text-xs font-semibold uppercase tracking-wide text-primary">4 · Assess by patent office</p><div className="mt-4 grid gap-4 md:grid-cols-3">{assessmentOffices.map(office => { const assessment = lead.currentAssessments?.[office]; const brief = briefs[office]; return <div key={office} className="rounded-lg border p-4"><h3 className="font-semibold">{officeName[office]}</h3><p className="mt-1 text-xs text-muted-foreground">{assessment ? `Outcome: ${assessment.outcome}` : 'Not assessed'}</p><Button className="mt-3 w-full" variant="outline" disabled={!!busy || !!liveRun} onClick={() => void runAction('MINER_GATE', { leadId: lead.id, snapshotId: currentProposal.snapshotId, proposalRevisionId: currentProposal.id, office })}>{busy === 'MINER_GATE' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Assess</Button>{assessment && <Button className="mt-2 w-full" variant="ghost" disabled={!!busy || !!liveRun} onClick={() => void runAction('MINER_GATE', { leadId: lead.id, snapshotId: currentProposal.snapshotId, proposalRevisionId: currentProposal.id, office }, true)}>Refresh assessment (new operation)</Button>}{assessment?.outcome === 'CONDITIONAL' && <><Textarea className="mt-3" value={reviewNote} onChange={e => setReviewNote(e.target.value)} /><Button className="mt-2 w-full" variant="outline" onClick={() => void review(currentProposal, 'NEEDS_INVESTIGATION', assessment.runId)}>Record risk review</Button></>}<Button className="mt-2 w-full" disabled={!!busy || !!liveRun || !assessment || assessment.outcome === 'BLOCKED' || assessment.outcome === 'UNASSESSED'} onClick={() => void runAction('MINER_BRIEF', { leadId: lead.id, snapshotId: currentProposal.snapshotId, proposalRevisionId: currentProposal.id, assessmentRunId: assessment.runId, office })}>Prepare brief</Button>{brief && <div className="mt-3 space-y-2 text-xs"><p>{brief.brief?.executiveSummary}</p><a className="inline-flex items-center text-primary" href={`/api/whitespace/studies/${studyId}/report?leadId=${lead.id}&office=${office}`}><Download className="mr-1 h-3 w-3" />Download Word brief</a><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void createHandoff('novelty', office)}>Novelty search</Button><Button size="sm" onClick={() => void createHandoff('drafting', office)}>Start draft</Button></div></div>}</div>})}</div></section>}
  </div>
}

function Metric({ label, value }: { label: string; value: unknown }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : '—'}</p></div> }

function lines(value: string) { return value.split('\n').map(line => line.trim()).filter(Boolean) }

function sourceReferenceIds(sourceRefs?: Record<string, unknown>) {
  if (!sourceRefs) return []
  const values = Object.values(sourceRefs).flatMap(value => Array.isArray(value) ? value : [value])
  return Array.from(new Set(values.filter(value => typeof value === 'string').map(value => value.slice(0, 160)))).slice(0, 40)
}
