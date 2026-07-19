'use client'

/**
 * Office Action Studio — case workspace.
 * Three zones: deadline strip (always visible), objection rail (left),
 * objection workbench (center, 4 tabs), source viewer (right). The attorney
 * reviews evidence, approves each reply, and exports the filing DOCX.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { PageLoadingBird } from '@/components/ui/loading-bird'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Clock,
  Download, FileText, FolderOpen, Loader2, RefreshCw, Sparkles, Upload, X
} from 'lucide-react'

// ---------- types (API view shapes; Prisma JSON fields stay loose) ----------

interface Deadline {
  id: string; what: string; basis?: string; dueDate: string
  extension?: { extendedDueDate: string; form?: string }
  consequence?: { type: string; basis?: string }
}
interface ObjectionRow {
  id: string; sortOrder: number; canonicalCode: string; subTypeId: string | null
  localBasis: string | null; examinerText: string; quoteVerified: boolean
  claimsAffected: number[] | null; citationLabels: string[] | null
  status: string; strategyJson: any; analysisJson: any
}
interface CitationRow {
  id: string; label: string; kind: string; docNumber: string | null
  fetchStatus: string; passagesJson: any; claimChartJson: any
}
interface CitedDocView {
  label: string; kind: string; publicationNumber?: string; office?: string
  title?: string; abstract?: string; claims?: string; description?: string
  examinerRelevance?: string; status: string; sourceLabel: string
}
interface CaseView {
  case: {
    id: string; jurisdictionCode: string; applicationNumber: string
    applicantName: string | null; title: string | null; status: string
    specificationText: string | null; claimsText: string | null
    documents: Array<{
      id: string; instrumentType: string | null; issueDate: string | null
      parseStatus: string; rawText: string | null
      objections: ObjectionRow[]; citations: CitationRow[]
    }>
  }
  deadlines: Deadline[]
  mostUrgent: Deadline | null
  citedDocuments: CitedDocView[]
  latestDraft: { id: string; version: number; sectionsJson: any; amendedClaimsJson: any; complianceJson: any } | null
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token') || ''}` })

const CODE_LABELS: Record<string, string> = {
  NOVELTY: 'Novelty', INVENTIVE_STEP: 'Inventive step', ELIGIBILITY: 'Non-patentability',
  SUFFICIENCY: 'Sufficiency', CLARITY: 'Clarity', UNITY: 'Unity',
  PROCEDURAL_DISCLOSURE: 'Foreign filings (s.8)', FORMALITIES: 'Formalities', OTHER: 'Other requirements'
}
const CODE_COLORS: Record<string, string> = {
  INVENTIVE_STEP: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  NOVELTY: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  ELIGIBILITY: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  SUFFICIENCY: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  CLARITY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  UNITY: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PROCEDURAL_DISCLOSURE: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-300',
  FORMALITIES: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-300',
  OTHER: 'bg-secondary text-secondary-foreground'
}

function daysUntil(iso: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86_400_000)
}
function urgencyClass(days: number): string {
  if (days < 0) return 'text-destructive'
  if (days <= 15) return 'text-destructive'
  if (days <= 45) return 'text-amber-600 dark:text-amber-400'
  return 'text-foreground'
}

// ============================================================================

export default function OfficeActionWorkspacePage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const params = useParams<{ caseId: string }>()
  const caseId = params?.caseId
  const { toast } = useToast()

  const [view, setView] = useState<CaseView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedObjectionId, setSelectedObjectionId] = useState<string | null>(null)
  const [tab, setTab] = useState<'objection' | 'evidence' | 'strategy' | 'draft'>('objection')
  const [busy, setBusy] = useState<string | null>(null)     // 'ingest' | 'prepare' | 'export' | 'save'
  const [showCaseFile, setShowCaseFile] = useState(false)
  const [preview, setPreview] = useState<{ lint: any; html: string } | null>(null)
  const [sourceTab, setSourceTab] = useState<string>('FER')
  const [highlight, setHighlight] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)       // small screens

  useEffect(() => { if (!isLoading && !user) router.push('/login') }, [user, isLoading, router])

  const load = useCallback(async () => {
    if (!caseId) return
    try {
      const res = await fetch(`/api/office-actions/${caseId}`, { headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the case')
      setView(data)
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the case')
    }
  }, [caseId])

  useEffect(() => { if (user) void load() }, [user, load])

  // Poll citation resolution while any document is still being retrieved.
  const pendingCitations = useMemo(() =>
    (view?.citedDocuments || []).filter(d => d.status === 'pending').length, [view])
  useEffect(() => {
    if (!pendingCitations) return
    const t = setInterval(() => void load(), 6000)
    return () => clearInterval(t)
  }, [pendingCitations, load])

  const objections = useMemo(() =>
    (view?.case.documents || []).flatMap(d => d.objections).sort((a, b) => a.sortOrder - b.sortOrder), [view])
  const selected = objections.find(o => o.id === selectedObjectionId) || objections[0] || null
  const replies: any[] = view?.latestDraft?.sectionsJson?.objectionReplies || []
  const replyFor = (id: string) => replies.find(r => r.objectionId === id)
  const approvedCount = replies.filter(r => r.approved).length

  // ---------- actions ----------

  const ingestFer = async (payload: { file?: File; text?: string }) => {
    setBusy('ingest')
    try {
      let res: Response
      if (payload.file) {
        const fd = new FormData(); fd.append('file', payload.file)
        res = await fetch(`/api/office-actions/${caseId}/documents`, { method: 'POST', headers: authHeaders(), body: fd })
      } else {
        res = await fetch(`/api/office-actions/${caseId}/documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ rawText: payload.text })
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not read the report')
      toast({ title: `Report read — ${data.objectionCount} objection${data.objectionCount === 1 ? '' : 's'} found`, variant: 'success' })
      await load()
    } catch (err) {
      toast({ title: 'Could not process the report', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  const prepare = async () => {
    setBusy('prepare')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/prepare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}'
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preparation failed')
      toast({
        title: `Reply prepared — ${data.objectionsDrafted} sections drafted`,
        description: data.judgmentFlags?.length ? `${data.judgmentFlags.length} objection(s) need your judgment.` : undefined,
        variant: 'success'
      })
      setTab('draft')
      await load()
    } catch (err) {
      toast({ title: 'Could not prepare the reply', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  const patchDraft = async (body: any, successMsg?: string) => {
    setBusy('save')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/draft`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save')
      if (successMsg) toast({ title: successMsg, variant: 'success' })
      await load()
    } catch (err) {
      toast({ title: 'Could not save', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  const previewReply = async () => {
    setBusy('export')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ preview: true })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preview failed')
      setPreview({ lint: data.lint, html: data.html })
    } catch (err) {
      toast({ title: 'Could not build the preview', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  const exportDocx = async () => {
    setBusy('export')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}'
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        if (data.lint) {
          setPreview({ lint: data.lint, html: '' })
          throw new Error('The compliance check found blocking items — review them below.')
        }
        throw new Error(data.error || 'Export failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `FER-Reply-${view?.case.applicationNumber || caseId}.docx`; a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Reply exported', variant: 'success' })
    } catch (err) {
      toast({ title: 'Export blocked', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  const jumpToSource = (tabId: string, passage?: string) => {
    setSourceTab(tabId)
    setHighlight(passage || null)
    setShowSource(true)
  }

  // ---------- render ----------

  if (isLoading || (user && !view && !loadError)) return <PageLoadingBird message="Opening the case..." />
  if (!user) return null
  if (loadError || !view) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto text-destructive mb-3" aria-hidden />
        <p className="font-medium mb-2">Could not open this case</p>
        <p className="text-sm text-muted-foreground mb-4">{loadError}</p>
        <Button variant="outline" onClick={() => router.push('/office-actions')}>
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden /> Back to docket
        </Button>
      </div>
    )
  }

  const hasReport = view.case.documents.length > 0
  const hasInvention = Boolean(view.case.specificationText && view.case.claimsText)

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <DeadlineStrip
        view={view}
        approved={approvedCount}
        total={replies.length || objections.length}
        onOpenCaseFile={() => setShowCaseFile(true)}
        onPrepare={prepare}
        onPreview={previewReply}
        onExport={exportDocx}
        busy={busy}
        hasDraft={Boolean(view.latestDraft)}
        hasReport={hasReport}
      />

      {!hasReport ? (
        <IntakePanel busy={busy === 'ingest'} onIngest={ingestFer} hasInvention={hasInvention}
          onOpenCaseFile={() => setShowCaseFile(true)} />
      ) : (
        <div className="flex flex-1 min-h-0">
          {/* objection rail */}
          <aside className="w-72 shrink-0 border-r overflow-y-auto hidden md:block">
            <div className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground border-b sticky top-0 bg-background">
              Objections · report order
            </div>
            <ul className="p-2 space-y-1.5">
              {objections.map(o => {
                const r = replyFor(o.id)
                const active = selected?.id === o.id
                const judgment = o.strategyJson?.judgmentFlag
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => { setSelectedObjectionId(o.id); setTab('objection') }}
                      className={`w-full text-left border rounded-md px-3 py-2.5 transition-colors ${active ? 'border-primary ring-1 ring-primary' : 'hover:border-muted-foreground/40'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${CODE_COLORS[o.canonicalCode] || CODE_COLORS.OTHER}`}>
                          {CODE_LABELS[o.canonicalCode] || o.canonicalCode}{o.subTypeId ? ` · ${o.subTypeId}` : ''}
                        </span>
                        {judgment && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" aria-label="Needs your judgment" />}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {o.localBasis || '—'}{o.claimsAffected?.length ? ` · claims ${compactRange(o.claimsAffected)}` : ''}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                        {r?.approved
                          ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium"><CheckCircle2 className="w-3 h-3" aria-hidden /> Approved</span>
                          : r
                            ? <span className="text-primary font-medium">Drafted — review</span>
                            : <span className="text-muted-foreground">Awaiting preparation</span>}
                        {!o.quoteVerified && <span className="text-destructive font-medium">· quote unverified</span>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {/* workbench */}
          <main className="flex-1 min-w-0 overflow-y-auto">
            {selected ? (
              <ObjectionWorkbench
                objection={selected}
                reply={replyFor(selected.id)}
                citations={(view.case.documents.flatMap(d => d.citations)).filter(c => (selected.citationLabels || []).includes(c.label))}
                citedDocs={view.citedDocuments}
                tab={tab}
                setTab={setTab}
                busy={busy}
                onApprove={(approved) => patchDraft({ objectionReplies: [{ objectionId: selected.id, approved }] }, approved ? 'Section approved' : 'Approval withdrawn')}
                onSaveText={(bodyText) => patchDraft({ objectionReplies: [{ objectionId: selected.id, bodyText }] }, 'Draft updated — re-approve when ready')}
                onJump={jumpToSource}
              />
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">No objections extracted yet.</div>
            )}
          </main>

          {/* source viewer */}
          <SourceViewer
            view={view}
            activeTab={sourceTab}
            setActiveTab={setSourceTab}
            highlight={highlight}
            open={showSource}
            onClose={() => setShowSource(false)}
          />
        </div>
      )}

      {showCaseFile && caseId && (
        <CaseFilePanel caseId={caseId} onClose={() => { setShowCaseFile(false); void load() }} />
      )}

      {preview && (
        <PreviewModal preview={preview} onClose={() => setPreview(null)} onExport={exportDocx} busy={busy === 'export'} />
      )}
    </div>
  )
}

// ============================================================================
// deadline strip

function DeadlineStrip(props: {
  view: CaseView; approved: number; total: number
  onOpenCaseFile: () => void; onPrepare: () => void; onPreview: () => void; onExport: () => void
  busy: string | null; hasDraft: boolean; hasReport: boolean
}) {
  const { view } = props
  const primary = view.deadlines.find(d => d.consequence) || view.deadlines[0]
  const others = view.deadlines.filter(d => d !== primary)
  return (
    <div className="border-b bg-card">
      <div className="flex flex-wrap items-stretch gap-x-6 gap-y-2 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Case</div>
          <div className="font-semibold truncate">{view.case.applicationNumber}</div>
          <div className="text-xs text-muted-foreground truncate">{view.case.applicantName || view.case.title || '—'}</div>
        </div>

        {primary && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3" aria-hidden /> {primary.what}
            </div>
            <div className={`font-bold tabular-nums ${urgencyClass(daysUntil(primary.dueDate))}`}>
              {formatDate(primary.dueDate)} · {describeDays(daysUntil(primary.dueDate))}
            </div>
            {primary.consequence && (
              <div className="text-[11px] text-destructive">{humanConsequence(primary.consequence.type)}{primary.consequence.basis ? ` · ${primary.consequence.basis}` : ''}</div>
            )}
          </div>
        )}

        {others.map(d => (
          <div key={d.id} className="hidden lg:block">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{d.what}</div>
            <div className={`text-sm font-medium tabular-nums ${urgencyClass(daysUntil(d.dueDate))}`}>
              {formatDate(d.dueDate)} · {describeDays(daysUntil(d.dueDate))}
            </div>
          </div>
        ))}

        {props.total > 0 && (
          <div className="hidden sm:block">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Approved</div>
            <div className="font-semibold tabular-nums">{props.approved}/{props.total}</div>
            <div className="text-[11px] text-muted-foreground">{props.approved === props.total && props.total > 0 ? 'ready to export' : 'sections'}</div>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={props.onOpenCaseFile}>
            <FolderOpen className="w-4 h-4 mr-1.5" aria-hidden /> Case file
          </Button>
          {props.hasReport && (
            <>
              <Button size="sm" onClick={props.onPrepare} disabled={props.busy !== null}>
                {props.busy === 'prepare'
                  ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Preparing…</>
                  : <><Sparkles className="w-4 h-4 mr-1.5" aria-hidden /> {props.hasDraft ? 'Re-prepare reply' : 'Prepare reply'}</>}
              </Button>
              <Button variant="outline" size="sm" onClick={props.onPreview} disabled={props.busy !== null || !props.hasDraft}>
                <BookOpen className="w-4 h-4 mr-1.5" aria-hidden /> Preview
              </Button>
              <Button variant="outline" size="sm" onClick={props.onExport} disabled={props.busy !== null || !props.hasDraft}>
                <Download className="w-4 h-4 mr-1.5" aria-hidden /> Export
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// intake (no report yet)

function IntakePanel(props: {
  busy: boolean
  hasInvention: boolean
  onIngest: (p: { file?: File; text?: string }) => void
  onOpenCaseFile: () => void
}) {
  const [pasted, setPasted] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-10">
      <h2 className="text-lg font-semibold mb-1">Upload the examination report</h2>
      <p className="text-sm text-muted-foreground mb-5">
        Upload the FER as issued (PDF), or paste its text. The objections, cited documents and the reply
        deadline are extracted automatically; cited patents are retrieved in the background.
      </p>

      <div className="border rounded-lg p-4 mb-4">
        <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) props.onIngest({ file: f }) }} />
        <Button onClick={() => fileRef.current?.click()} disabled={props.busy}>
          {props.busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Reading the report…</> : <><Upload className="w-4 h-4 mr-1.5" aria-hidden /> Upload FER (PDF)</>}
        </Button>
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">Or paste the report text:</div>
          <Textarea rows={6} value={pasted} onChange={e => setPasted(e.target.value)}
            placeholder="Paste the full text of the First Examination Report…" />
          <Button variant="outline" size="sm" className="mt-2" disabled={props.busy || !pasted.trim()}
            onClick={() => props.onIngest({ text: pasted })}>
            Read the pasted text
          </Button>
        </div>
      </div>

      <div className={`border rounded-lg p-4 ${props.hasInvention ? 'border-emerald-300 dark:border-emerald-900' : 'border-amber-300 dark:border-amber-900'}`}>
        <div className="flex items-start gap-2">
          {props.hasInvention
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden />
            : <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden />}
          <div className="text-sm">
            <span className="font-medium">{props.hasInvention ? 'Invention on file.' : 'Add the invention.'}</span>{' '}
            <span className="text-muted-foreground">
              The as-filed specification and claims power the amendment checks and the drafted arguments.
            </span>{' '}
            <button className="text-primary underline underline-offset-2" onClick={props.onOpenCaseFile}>
              Open the case file
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// workbench

function ObjectionWorkbench(props: {
  objection: ObjectionRow
  reply: any | undefined
  citations: CitationRow[]
  citedDocs: CitedDocView[]
  tab: 'objection' | 'evidence' | 'strategy' | 'draft'
  setTab: (t: 'objection' | 'evidence' | 'strategy' | 'draft') => void
  busy: string | null
  onApprove: (approved: boolean) => void
  onSaveText: (text: string) => void
  onJump: (tab: string, passage?: string) => void
}) {
  const { objection: o, reply } = props
  const strategy = o.strategyJson || null
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  useEffect(() => { setEditing(false); setDraftText(reply?.bodyText || '') }, [o.id, reply?.bodyText])

  const tabs: Array<[typeof props.tab, string]> = [['objection', 'Objection'], ['evidence', 'Evidence'], ['strategy', 'Strategy'], ['draft', 'Draft']]

  return (
    <div className="px-5 py-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold flex items-center gap-2 min-w-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${CODE_COLORS[o.canonicalCode] || CODE_COLORS.OTHER}`}>
            {CODE_LABELS[o.canonicalCode] || o.canonicalCode}
          </span>
          <span className="truncate">Objection {o.sortOrder + 1}{o.localBasis ? ` · ${o.localBasis}` : ''}</span>
        </h2>
      </div>
      {strategy?.judgmentFlag && (
        <div className="mt-2 border border-destructive/40 bg-destructive/5 rounded-md px-3 py-2 text-sm flex gap-2">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden />
          <div><span className="font-medium">Your judgment is needed: </span>{strategy.judgmentFlag}</div>
        </div>
      )}

      <nav className="flex gap-1 border-b mt-3 mb-4" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={props.tab === k}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${props.tab === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => props.setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      {props.tab === 'objection' && (
        <section>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-2">
            Examiner&rsquo;s objection — verbatim
            {o.quoteVerified
              ? <span className="text-emerald-600 dark:text-emerald-400 normal-case font-medium inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" aria-hidden /> verified against the report</span>
              : <span className="text-destructive normal-case font-medium">not verified — check the report</span>}
          </div>
          <blockquote
            className="border rounded-md bg-muted/40 px-4 py-3 text-[15px] leading-relaxed font-serif cursor-pointer hover:border-primary/50"
            title="Show in the report"
            onClick={() => props.onJump('FER', o.examinerText.slice(0, 120))}
          >
            {o.examinerText}
          </blockquote>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm mt-4">
            <dt className="text-muted-foreground">Claims affected</dt>
            <dd>{o.claimsAffected?.length ? compactRange(o.claimsAffected) : '—'}</dd>
            <dt className="text-muted-foreground">Cited documents</dt>
            <dd>{o.citationLabels?.length ? o.citationLabels.join(', ') : 'None'}</dd>
            <dt className="text-muted-foreground">Statutory basis</dt>
            <dd>{o.localBasis || '—'}</dd>
          </dl>
        </section>
      )}

      {props.tab === 'evidence' && (
        <EvidenceTab citations={props.citations} citedDocs={props.citedDocs} onJump={props.onJump} />
      )}

      {props.tab === 'strategy' && (
        <section className="space-y-4">
          {!strategy ? (
            <EmptyHint text='Run "Prepare reply" to analyse this objection and propose a strategy.' />
          ) : (
            <>
              {strategy.assessment && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Assessment</h3>
                  <p className="text-sm leading-relaxed">{strategy.assessment}</p>
                </div>
              )}
              {Array.isArray(strategy.options) && strategy.options.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Options</h3>
                  <div className="space-y-2">
                    {strategy.options.map((opt: any) => (
                      <div key={opt.id} className={`border rounded-md px-3 py-2.5 ${opt.recommended ? 'border-primary/60 bg-primary/5' : ''}`}>
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span>{opt.id} · {opt.title}</span>
                          {opt.recommended && <span className="text-[11px] uppercase tracking-wide text-primary font-semibold">Recommended</span>}
                        </div>
                        {opt.rationale && <p className="text-xs text-muted-foreground mt-1">{opt.rationale}</p>}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {(opt.pros || []).map((p: string, i: number) => (
                            <span key={`p${i}`} className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">+ {p}</span>
                          ))}
                          {(opt.cons || []).map((c: string, i: number) => (
                            <span key={`c${i}`} className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">− {c}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(strategy.amendments) && strategy.amendments.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Proposed amendments</h3>
                  <div className="space-y-2">
                    {strategy.amendments.map((a: any, i: number) => {
                      const verdict = (strategy.basisVerdicts || []).find((v: any) => v.claimNumber === a.claimNumber)
                      return (
                        <div key={i} className="border rounded-md px-3 py-2.5">
                          <div className="text-sm font-serif leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarked(a.markedText, a.claimNumber) }} />
                          <div className="mt-2 flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Basis: {(a.basisRefs || []).join(', ') || 'none'}</span>
                            {verdict && (
                              <span className={`font-semibold px-1.5 py-0.5 rounded ${verdict.verdict === 'pass' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
                                Amendment check: {verdict.verdict === 'pass' ? 'within scope ✓' : 'blocked'}
                              </span>
                            )}
                          </div>
                          {verdict && verdict.verdict !== 'pass' && <p className="text-xs text-destructive mt-1">{verdict.note}</p>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {props.tab === 'draft' && (
        <section>
          {!reply ? (
            <EmptyHint text='No draft yet — run "Prepare reply" to draft this section.' />
          ) : (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">{reply.heading || 'Reply section'}</div>
              {editing ? (
                <>
                  <Textarea rows={12} value={draftText} onChange={e => setDraftText(e.target.value)} className="font-serif text-[15px] leading-relaxed" />
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" onClick={() => { props.onSaveText(draftText); setEditing(false) }} disabled={props.busy !== null}>Save</Button>
                    <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraftText(reply.bodyText || '') }}>Cancel</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="border rounded-md px-4 py-3 bg-card font-serif text-[15px] leading-relaxed whitespace-pre-wrap">
                    {reply.bodyText || <span className="text-muted-foreground font-sans text-sm">Empty section.</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
                    {reply.approved ? (
                      <Button size="sm" variant="outline" onClick={() => props.onApprove(false)} disabled={props.busy !== null}>Withdraw approval</Button>
                    ) : (
                      <Button size="sm" onClick={() => props.onApprove(true)} disabled={props.busy !== null}>
                        <CheckCircle2 className="w-4 h-4 mr-1.5" aria-hidden /> Approve section
                      </Button>
                    )}
                    {reply.approved && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Approved — will be included in the reply
                      </span>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}

function EvidenceTab(props: { citations: CitationRow[]; citedDocs: CitedDocView[]; onJump: (tab: string, passage?: string) => void }) {
  if (!props.citations.length) {
    return <EmptyHint text="This objection cites no documents — the evidence is the specification itself. Open the case file to review it." />
  }
  return (
    <section className="space-y-4">
      {props.citations.map(c => {
        const doc = props.citedDocs.find(d => d.label === c.label)
        const seed = c.passagesJson?.examinerSeed
        const chart = c.claimChartJson
        return (
          <div key={c.id} className="border rounded-md">
            <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-semibold">{c.label}</span>
                <span className="text-sm text-muted-foreground"> · {doc?.title || c.docNumber || 'Document'}</span>
              </div>
              {doc?.status === 'available' ? (
                <Button size="sm" variant="outline" onClick={() => props.onJump(c.label)}>
                  Read <ChevronRight className="w-3.5 h-3.5 ml-1" aria-hidden />
                </Button>
              ) : doc?.status === 'pending' ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Retrieving…</span>
              ) : (
                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Document to be provided</span>
              )}
            </div>
            <div className="px-3 py-2.5 space-y-2 text-sm">
              {seed?.relevantDescription && (
                <div><span className="text-muted-foreground">Examiner&rsquo;s pinpoint: </span>{seed.relevantDescription}</div>
              )}
              {chart?.rows?.length ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Claim features vs this document</div>
                  <ul className="space-y-1">
                    {chart.rows.map((r: any, i: number) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className={`mt-1 w-2 h-2 rounded-sm shrink-0 ${r.cell?.verdict === 'NOT_DISCLOSED' ? 'bg-emerald-500' : r.cell?.verdict === 'DISCLOSED' ? 'bg-muted-foreground/50' : 'bg-amber-500'}`} aria-hidden />
                        <span className="min-w-0">
                          <span className="text-sm">{r.feature}</span>{' '}
                          <span className={`text-xs font-medium ${r.cell?.verdict === 'NOT_DISCLOSED' ? 'text-emerald-600 dark:text-emerald-400' : r.cell?.verdict === 'DISCLOSED' ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'}`}>
                            {r.cell?.verdict === 'NOT_DISCLOSED' ? 'absent — your distinction' : r.cell?.verdict === 'DISCLOSED' ? 'disclosed' : 'verify'}
                          </span>
                          {r.cell?.passage && (
                            <button className="block text-xs text-primary text-left underline underline-offset-2 truncate max-w-full"
                              onClick={() => props.onJump(chartLabelToTab(r, chart, props.citations), r.cell.passage)}>
                              “{r.cell.passage.slice(0, 90)}{r.cell.passage.length > 90 ? '…' : ''}”
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">Feature chart appears here after &ldquo;Prepare reply&rdquo;.</div>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}

// The per-citation chart slice belongs to its own citation tab.
function chartLabelToTab(_row: any, _chart: any, citations: CitationRow[]): string {
  return citations[0]?.label || 'FER'
}

// ============================================================================
// source viewer

function SourceViewer(props: {
  view: CaseView; activeTab: string; setActiveTab: (t: string) => void
  highlight: string | null; open: boolean; onClose: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const ferText = props.view.case.documents[0]?.rawText || ''
  const docs = props.view.citedDocuments.filter(d => d.status === 'available')

  const sources: Array<{ id: string; label: string; text: string; heading: string }> = [
    { id: 'FER', label: 'FER', heading: 'First Examination Report — as issued', text: ferText },
    ...docs.map(d => ({
      id: d.label, label: d.label,
      heading: `${d.label} · ${d.title || d.publicationNumber || 'Cited document'} — ${d.sourceLabel}`,
      text: [d.abstract && `ABSTRACT\n${d.abstract}`, d.claims && `CLAIMS\n${d.claims}`, d.description && `DESCRIPTION\n${d.description}`].filter(Boolean).join('\n\n')
    }))
  ]
  const active = sources.find(s => s.id === props.activeTab) || sources[0]

  useEffect(() => {
    if (!props.highlight || !bodyRef.current) return
    const mark = bodyRef.current.querySelector('mark')
    mark?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [props.highlight, props.activeTab])

  const rendered = useMemo(() => {
    const text = active?.text || ''
    if (!props.highlight) return [text]
    const needle = props.highlight.replace(/\s+/g, ' ').trim()
    const folded = text.replace(/\s+/g, ' ')
    const idx = folded.toLowerCase().indexOf(needle.toLowerCase())
    if (idx === -1) return [text]
    // Map the folded index back approximately by using the folded text for display.
    return [folded.slice(0, idx), folded.slice(idx, idx + needle.length), folded.slice(idx + needle.length)]
  }, [active, props.highlight])

  return (
    <aside className={`w-96 shrink-0 border-l bg-card flex-col min-h-0 ${props.open ? 'flex fixed right-0 top-0 bottom-0 z-40 shadow-2xl' : 'hidden xl:flex'}`}>
      <div className="px-3 py-2.5 border-b flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source documents</span>
        <button className="xl:hidden text-muted-foreground" onClick={props.onClose} aria-label="Close sources"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-1 px-2 pt-2 flex-wrap">
        {sources.map(s => (
          <button key={s.id}
            className={`text-xs font-mono px-2 py-1 rounded-t border-b-2 ${active?.id === s.id ? 'border-primary text-foreground bg-muted/50' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
            onClick={() => props.setActiveTab(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-[11px] text-muted-foreground mb-2">{active?.heading}</div>
        <div className="font-serif text-[13.5px] leading-relaxed whitespace-pre-wrap">
          {rendered.length === 3
            ? <>{rendered[0]}<mark className="bg-emerald-200 dark:bg-emerald-900 rounded px-0.5">{rendered[1]}</mark>{rendered[2]}</>
            : rendered[0] || <span className="font-sans text-sm text-muted-foreground">No text available.</span>}
        </div>
      </div>
    </aside>
  )
}

// ============================================================================
// case file panel (invention + supplementary)

function CaseFilePanel(props: { caseId: string; onClose: () => void }) {
  const { toast } = useToast()
  const [docs, setDocs] = useState<any[] | null>(null)
  const [kind, setKind] = useState('SPECIFICATION')
  const [text, setText] = useState('')
  const [intent, setIntent] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/office-actions/${props.caseId}/case-documents`, { headers: authHeaders() })
    const data = await res.json().catch(() => ({}))
    setDocs(res.ok ? data.documents || [] : [])
  }, [props.caseId])
  useEffect(() => { void load() }, [load])

  const submit = async (file?: File) => {
    setSaving(true)
    try {
      let res: Response
      if (file) {
        const fd = new FormData()
        fd.append('file', file); fd.append('kind', kind)
        if (intent) fd.append('intentNote', intent)
        res = await fetch(`/api/office-actions/${props.caseId}/case-documents`, { method: 'POST', headers: authHeaders(), body: fd })
      } else {
        res = await fetch(`/api/office-actions/${props.caseId}/case-documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ kind, text, intentNote: intent || undefined })
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not add the document')
      toast({ title: 'Document added to the case file', variant: 'success' })
      setText(''); setIntent('')
      await load()
    } catch (err) {
      toast({ title: 'Could not add the document', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
      <div className="w-full max-w-lg bg-background border-l h-full overflow-y-auto p-5" role="dialog" aria-label="Case file">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Case file</h2>
          <button onClick={props.onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>

        <div className="mb-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">On file</h3>
          {docs === null ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nothing yet — add the as-filed specification and claims below.</div>
          ) : (
            <ul className="space-y-1.5">
              {docs.map(d => (
                <li key={d.id} className="border rounded-md px-3 py-2 text-sm flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="font-medium">{d.kind === 'SUPPLEMENTARY' ? (d.title || 'Supplementary document') : d.kind.toLowerCase()}</span>
                    {d.intentNote && <span className="block text-xs text-muted-foreground truncate">“{d.intentNote}”</span>}
                  </span>
                  <span className="text-[11px] shrink-0 px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                    {d.newMatterSafe ? 'amendment basis' : 'argument / affidavit only'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Add a document</h3>
        <div className="space-y-3">
          <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="SPECIFICATION">As-filed specification</option>
            <option value="CLAIMS">As-filed claims</option>
            <option value="SUPPLEMENTARY">Supplementary material (data, declaration…)</option>
          </select>
          {kind === 'SUPPLEMENTARY' && (
            <Textarea rows={2} value={intent} onChange={e => setIntent(e.target.value)}
              placeholder='How should this be used? e.g. "Comparative efficacy data — for the Section 3(d) objection."' />
          )}
          <Textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the text…" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit()} disabled={saving || !text.trim()}>
              {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Adding…</> : 'Add pasted text'}
            </Button>
            <input ref={fileRef} type="file" accept=".pdf,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void submit(f) }} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={saving}>
              <Upload className="w-4 h-4 mr-1.5" aria-hidden /> Upload PDF
            </Button>
          </div>
          {kind === 'SUPPLEMENTARY' && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Supplementary material supports arguments and affidavits — it is never used as claim-amendment basis.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// preview modal

function PreviewModal(props: { preview: { lint: any; html: string }; onClose: () => void; onExport: () => void; busy: boolean }) {
  const { lint, html } = props.preview
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 pt-[6vh]" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
      <div className="bg-background border rounded-lg shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col" role="dialog" aria-label="Reply preview">
        <div className="px-5 py-3.5 border-b flex items-center justify-between">
          <h2 className="font-semibold">Reply preview &amp; compliance check</h2>
          <button onClick={props.onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-3 border-b">
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
            {(lint?.checks || []).map((c: any) => (
              <li key={c.id} className="text-sm flex items-start gap-2">
                {c.status === 'pass'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden />
                  : <AlertTriangle className={`w-4 h-4 mt-0.5 shrink-0 ${c.status === 'fail' ? 'text-destructive' : 'text-amber-500'}`} aria-hidden />}
                <span className="min-w-0">
                  {c.label}
                  {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex-1 overflow-y-auto p-5 bg-muted/30">
          {html
            ? <div dangerouslySetInnerHTML={{ __html: html }} />
            : <p className="text-sm text-muted-foreground">Resolve the blocking items above, then preview again.</p>}
        </div>
        <div className="px-5 py-3.5 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>Close</Button>
          <Button onClick={props.onExport} disabled={props.busy || !lint?.pass}>
            {props.busy ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Exporting…</> : <><Download className="w-4 h-4 mr-1.5" aria-hidden /> Export DOCX</>}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// small helpers

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="border border-dashed rounded-md px-4 py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
      <RefreshCw className="w-4 h-4" aria-hidden /> {text}
    </div>
  )
}

function compactRange(nums: number[]): string {
  const sorted = Array.from(new Set(nums)).sort((a, b) => a - b)
  if (!sorted.length) return '—'
  const parts: string[] = []
  let start = sorted[0], prev = sorted[0]
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i]
    if (n !== prev + 1) {
      parts.push(start === prev ? String(start) : `${start}–${prev}`)
      start = n
    }
    prev = n
  }
  return parts.join(', ')
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return iso }
}

function describeDays(d: number): string {
  if (d < 0) return `${Math.abs(d)} days overdue`
  if (d === 0) return 'due today'
  return `${d} days left`
}

function humanConsequence(type: string): string {
  const map: Record<string, string> = {
    DEEMED_ABANDONED: 'Application deemed abandoned if missed',
    LAPSED: 'Application lapses if missed',
    TREATED_REFUSED: 'Application treated as refused if missed',
    SUBMISSIONS_NOT_CONSIDERED: 'Late submissions may be disregarded'
  }
  return map[type] || type.replace(/_/g, ' ').toLowerCase()
}

function escapeHtml(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Render <ins>/<del> claim markup safely (only those two tags survive). */
function renderMarked(marked: string, claimNumber: number): string {
  const safe = escapeHtml(marked)
    .replace(/&lt;ins&gt;([\s\S]*?)&lt;\/ins&gt;/g, '<ins class="no-underline border-b-2 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40">$1</ins>')
    .replace(/&lt;del&gt;([\s\S]*?)&lt;\/del&gt;/g, '<del class="text-destructive/80">$1</del>')
  return `<span class="font-semibold">${claimNumber}.</span> ${safe}`
}
