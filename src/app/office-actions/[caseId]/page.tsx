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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ACCEPTED_UPLOAD_EXTENSIONS, ACCEPTED_UPLOAD_LABEL, MAX_OA_UPLOAD_LABEL } from '@/lib/office-action/upload-formats'
import { formatParagraphRefsForPreview, type ParagraphNumbering } from '@/lib/office-action/document-intake'
import {
  AlertTriangle, ArrowLeft, BookOpen, Check, CheckCheck, CheckCircle2, ChevronRight, Clock,
  Download, ExternalLink, FileText, FolderOpen, Loader2, PanelRightClose, PanelRightOpen, Pause,
  RefreshCw, Sparkles, Upload, X
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
  /** Patent register page, or the DOI for a paper — when one can be derived. */
  externalUrl?: string
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
  /** How the as-filed specification is numbered — drives whether citations may be rendered. */
  numbering?: {
    mode: ParagraphNumbering
    confidence: 'HIGH' | 'MEDIUM' | 'LOW'
    reasons: string[]
    firstMarker?: string
    lastMarker?: string
    paragraphCount: number
    structureUsable: boolean
  }
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('auth_token') || localStorage.getItem('token') || ''}` })

const CODE_LABELS: Record<string, string> = {
  NOVELTY: 'Novelty', INVENTIVE_STEP: 'Inventive step', ELIGIBILITY: 'Non-patentability',
  SUFFICIENCY: 'Sufficiency', CLARITY: 'Clarity', UNITY: 'Unity',
  // Covers s.8 foreign filings and the biological-source / NBA requirements —
  // the subtype chip (e.g. "· nba_approval") names which one.
  PROCEDURAL_DISCLOSURE: 'Statutory disclosures', FORMALITIES: 'Formalities', OTHER: 'Other requirements'
}
// Objection taxonomy — a CATEGORICAL palette, deliberately separate from the
// brand cobalt (which means action/AI) so a type badge never reads as a button.
// Hues are chosen to stay mutually distinguishable at the 100/800 pair.
const CODE_COLORS: Record<string, string> = {
  INVENTIVE_STEP: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  NOVELTY: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  ELIGIBILITY: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  SUFFICIENCY: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  CLARITY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  UNITY: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  PROCEDURAL_DISCLOSURE: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-300',
  FORMALITIES: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-300',
  OTHER: 'bg-secondary text-secondary-foreground'
}

// ---------- source viewer sizing ----------
// The docked report panel is the attorney's reading surface, so its width and
// collapsed state are a preference, not a per-visit accident.
const SOURCE_PREFS_KEY = 'oa.sourceViewer'
const SOURCE_DEFAULT_WIDTH = 384          // = the previous fixed w-96
const SOURCE_MIN_WIDTH = 280
/**
 * Never let the panel crowd out the workbench, whatever the window size.
 * The objection rail and the app nav take ~350px, so reserving 700 leaves the
 * workbench a readable column at every width the docked layout appears at.
 */
const sourceMaxWidth = () => {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth
  return Math.max(SOURCE_MIN_WIDTH, Math.min(Math.round(vw * 0.7), vw - 700))
}
const clampSourceWidth = (px: number) => Math.min(sourceMaxWidth(), Math.max(SOURCE_MIN_WIDTH, Math.round(px)))

function readSourcePrefs(): { collapsed: boolean; width: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(SOURCE_PREFS_KEY) || '{}')
    return {
      collapsed: Boolean(raw.collapsed),
      width: clampSourceWidth(Number(raw.width) || SOURCE_DEFAULT_WIDTH)
    }
  } catch {
    return { collapsed: false, width: SOURCE_DEFAULT_WIDTH }
  }
}
function writeSourcePrefs(prefs: { collapsed: boolean; width: number }) {
  try { localStorage.setItem(SOURCE_PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode — the session default is fine */ }
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
  const [prepareStep, setPrepareStep] = useState<string | null>(null)
  const [showCaseFile, setShowCaseFile] = useState(false)
  const [showAddDocument, setShowAddDocument] = useState(false)
  const [preview, setPreview] = useState<{ lint: any; html: string } | null>(null)
  const [sourceTab, setSourceTab] = useState<string>('FER')
  const [highlight, setHighlight] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)       // small screens
  const [intakeStep, setIntakeStep] = useState<string | null>(null)
  // Structured intake progress: what is being processed, and where it got to.
  const [intakeSteps, setIntakeSteps] = useState<IntakeStep[]>([])
  const [intakeStartedAt, setIntakeStartedAt] = useState<number | null>(null)
  const [pausing, setPausing] = useState(false)
  // Docked source viewer: the attorney sets how much room the report gets, and
  // both the width and the collapsed state survive a reload (see SOURCE_PREFS).
  // Saving happens inside the updater rather than in an effect — an effect would
  // fire once on mount with the pre-hydration defaults and overwrite the file.
  const [sourcePrefs, setSourcePrefs] = useState({ collapsed: false, width: SOURCE_DEFAULT_WIDTH })
  const updateSourcePrefs = useCallback((patch: Partial<{ collapsed: boolean; width: number }>) => {
    setSourcePrefs(prev => {
      const next = { ...prev, ...patch }
      writeSourcePrefs(next)
      return next
    })
  }, [])
  // Width accepts an updater so repeated key nudges compound instead of all
  // reading the same pre-render value. Clamping lives here, once.
  const resizeSource = useCallback((next: number | ((prev: number) => number)) => {
    setSourcePrefs(prev => {
      const merged = { ...prev, width: clampSourceWidth(typeof next === 'function' ? next(prev.width) : next) }
      writeSourcePrefs(merged)
      return merged
    })
  }, [])

  useEffect(() => { setSourcePrefs(readSourcePrefs()) }, [])
  // A width set on a wide monitor must not swallow the workbench on a laptop.
  useEffect(() => {
    const onResize = () => setSourcePrefs(prev => ({ ...prev, width: clampSourceWidth(prev.width) }))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => { if (!isLoading && !user) router.push('/login') }, [user, isLoading, router])

  /**
   * Case refetch, ordered.
   *
   * Five callers can have a `load()` in flight at once (mount, the 6s citation
   * poll, the 2.5s prepare poll, and the completion handlers). Without a
   * sequence guard a slow earlier response could resolve last and overwrite a
   * newer view — restoring a mid-run partial draft after the run had finished,
   * with nothing left to refetch it. Only the newest request may write state.
   */
  const loadSeqRef = useRef(0)
  const load = useCallback(async () => {
    if (!caseId) return
    const seq = ++loadSeqRef.current
    try {
      const res = await fetch(`/api/office-actions/${caseId}`, { headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not load the case')
      if (seq !== loadSeqRef.current) return      // a newer load has already landed
      setView(data)
      setLoadError(null)
    } catch (err) {
      if (seq !== loadSeqRef.current) return
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

  /**
   * Follow the prepare job wherever it is running.
   *
   * The run lives in a background job, not in this tab, so the workspace has to
   * pick it up on mount too: reload the page mid-run (or come back to the case
   * later) and the sections must keep streaming in. Announcing completion is
   * keyed on the job id so a refresh cannot toast the same run twice.
   */
  const announcedJobRef = useRef<string | null>(null)
  const seenPollRef = useRef(false)
  const [prepareActive, setPrepareActive] = useState(false)
  /** Stages the worker reported, newest last — the run's visible trail. */
  const [prepareLog, setPrepareLog] = useState<Array<{ step: string; at: number }>>([])

  /**
   * A failed seed poll must not make a live run invisible.
   *
   * The mount-time poll ran once, and a transient 500 or network blip returned
   * early — leaving prepareActive false, which is also the condition the retry
   * interval is gated on. The workspace then sat static while the job actually
   * ran: no progress, no sections streaming in, and Export still enabled over a
   * half-built draft. Keep a slow heartbeat alive until one poll succeeds.
   */
  const [pollSeeded, setPollSeeded] = useState(false)

  const pollPrepare = useCallback(async () => {
    if (!caseId) return
    try {
      const res = await fetch(`/api/office-actions/${caseId}/prepare`, { headers: authHeaders() })
      if (!res.ok) return
      const job = (await res.json()).job
      setPollSeeded(true)
      if (!job) { setPrepareActive(false); return }

      const running = job.status === 'QUEUED' || job.status === 'PROCESSING'
      if (running) seenPollRef.current = true    // this run is live: announce its result

      // Keep the steps the pipeline actually reported. Nothing is invented here:
      // a line appears only because the worker recorded that stage.
      if (running && job.currentStep) {
        setPrepareLog(prev => prev.length && prev[prev.length - 1].step === job.currentStep
          ? prev
          : [...prev, { step: job.currentStep as string, at: Date.now() }].slice(-40))
      }
      if (!running) setPrepareLog([])
      setPrepareActive(running)
      setPrepareStep(running ? (job.currentStep || 'Working…') : null)
      // Drive the toolbar's own busy state, without stomping on an upload that
      // happens to be in flight.
      setBusy(b => running ? (b === null ? 'prepare' : b) : (b === 'prepare' ? null : b))
      // Pull the partial draft in on every tick — sections land one at a time.
      if (running) { void load(); return }

      if (announcedJobRef.current === job.id) return
      // A run that was already finished when the workspace opened is history —
      // record it as seen, but do not toast a result the attorney has had for
      // hours every time they revisit the case.
      const wasFirstLook = !seenPollRef.current
      seenPollRef.current = true
      announcedJobRef.current = job.id
      if (wasFirstLook) return
      if (job.status === 'COMPLETED') {
        const r = job.result || {}
        toast({
          title: `Reply prepared — ${r.objectionsDrafted ?? ''} section${r.objectionsDrafted === 1 ? '' : 's'} drafted`,
          description: [
            r.judgmentFlags?.length ? `${r.judgmentFlags.length} objection(s) need your judgment.` : '',
            r.draftErrors ? `${r.draftErrors} section(s) could not be drafted — write or retry them.` : ''
          ].filter(Boolean).join(' ') || undefined,
          variant: r.draftErrors ? 'warning' : 'success'
        })
        setTab('draft')
        await load()
      } else if (job.status === 'CANCELLED') {
        const r = job.result || {}
        toast({
          title: 'Preparation paused',
          description: `${r.objectionsDrafted ?? 0} section(s) are saved. Upload any prior art you need, then choose “Resume preparation”.`,
          variant: 'warning'
        })
        await load()
      } else if (job.status === 'FAILED') {
        toast({ title: 'Could not prepare the reply', description: job.lastError || undefined, variant: 'error' })
        await load()
      }
    } catch { /* transient — the next tick retries */ }
  }, [caseId, load, toast])

  // Seed from any run already in flight when the workspace opens.
  useEffect(() => { if (user) void pollPrepare() }, [user, pollPrepare])
  useEffect(() => {
    if (!prepareActive) return
    const t = setInterval(() => void pollPrepare(), 2500)
    return () => clearInterval(t)
  }, [prepareActive, pollPrepare])
  // Retry the seed until it lands, so one failed poll cannot hide a running job.
  useEffect(() => {
    if (!user || pollSeeded || prepareActive) return
    const t = setInterval(() => void pollPrepare(), 8000)
    return () => clearInterval(t)
  }, [user, pollSeeded, prepareActive, pollPrepare])

  const objections = useMemo(() =>
    (view?.case.documents || []).flatMap(d => d.objections).sort((a, b) => a.sortOrder - b.sortOrder), [view])
  const selected = objections.find(o => o.id === selectedObjectionId) || objections[0] || null
  const replies: any[] = view?.latestDraft?.sectionsJson?.objectionReplies || []
  const replyFor = (id: string) => replies.find(r => r.objectionId === id)
  const approvedCount = replies.filter(r => r.approved).length

  /**
   * A run that stopped part-way leaves its draft flagged inProgress with no job
   * still working. Preparing again resumes that draft — the finished sections
   * are kept and only the missing objections are drafted.
   */
  const failedSections = replies.filter(r => !(r.bodyText || '').trim()).length
  // "Approve all" only appears once the reply is complete — a bulk approval over
  // a half-drafted set would sign off sections that do not exist yet.
  const liveObjections = objections.filter(o => o.status !== 'DISMISSED')
  const draftedSections = liveObjections.filter(o =>
    ((replies.find(r => r.objectionId === o.id)?.bodyText) || '').trim()).length
  const allSectionsDrafted = liveObjections.length > 0 && draftedSections === liveObjections.length
  const pendingApproval = liveObjections.filter(o => {
    const r = replies.find(x => x.objectionId === o.id)
    return r && (r.bodyText || '').trim() && !r.approved
  }).length
  const preparationInterrupted = Boolean(
    ((view?.latestDraft?.sectionsJson as any)?.inProgress || failedSections > 0) && !prepareActive
  )

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
      if (data.warning) {
        toast({ title: `Report read — ${data.objectionCount} objection${data.objectionCount === 1 ? '' : 's'} extracted`, description: data.warning, variant: 'warning' })
      } else {
        toast({ title: `Report read — ${data.objectionCount} objection${data.objectionCount === 1 ? '' : 's'} found`, variant: 'success' })
      }
      setShowAddDocument(false)
      await load()
    } catch (err) {
      toast({ title: 'Could not process the report', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  /**
   * Open the case from one screen: the invention material goes in first (so the
   * pipeline has amendment basis the moment objections exist), then the report
   * is read. Each piece is reported separately — a rejected specification must
   * not cost the attorney the FER run, and vice versa.
   */
  const startCase = async (payload: {
    fer: { file?: File; text?: string }
    materials: Array<{ kind: string; file?: File; text?: string; title?: string; intentNote?: string }>
    citedDocuments?: Array<{ label: string; file?: File; text?: string; title?: string }>
  }) => {
    setBusy('ingest')
    const failures: string[] = []

    // The plan, built before anything runs, so the attorney sees the whole job
    // and where it currently is rather than one shifting sentence.
    const steps: IntakeStep[] = [
      ...payload.materials.map((m, i) => ({
        id: `material-${i}`,
        label: `Reading the ${MATERIAL_LABELS[m.kind] || 'document'}`,
        detail: m.file ? m.file.name : 'pasted text',
        stages: m.kind === 'SPECIFICATION' || m.kind === 'CLAIMS'
          ? ['Extracting the text', 'Numbering the paragraphs for amendment basis', 'Indexing for retrieval']
          : ['Extracting the text', 'Indexing for retrieval'],
        status: 'pending' as IntakeStepStatus
      })),
      {
        id: 'fer',
        label: 'Reading the examination report',
        detail: payload.fer.file ? payload.fer.file.name : 'pasted text',
        stages: [
          'Extracting the text layer',
          'Identifying the instrument and its deadlines',
          'Extracting every objection verbatim',
          'Classifying each objection against Indian practice',
          'Verifying each quote against the report',
          'Retrieving the cited patents'
        ],
        status: 'pending' as IntakeStepStatus
      },
      ...(payload.citedDocuments || []).map((c, i) => ({
        id: `cited-${i}`,
        label: `Attaching ${c.label}`,
        detail: c.file ? c.file.name : 'pasted text',
        stages: ['Extracting the text', 'Matching it to the citation in the report'],
        status: 'pending' as IntakeStepStatus
      }))
    ]
    const mark = (id: string, status: IntakeStepStatus, note?: string) =>
      setIntakeSteps(prev => prev.map(st => st.id === id ? { ...st, status, note } : st))

    setIntakeSteps(steps)
    setIntakeStartedAt(Date.now())

    try {
      // Counted as they land. Deriving this as materials.length - failures.length
      // subtracted the cited-document failures too, so the toast under-reported
      // (and could go negative).
      let materialsAdded = 0
      for (let i = 0; i < payload.materials.length; i++) {
        const m = payload.materials[i]
        setIntakeStep(`Adding the ${MATERIAL_LABELS[m.kind] || 'document'}…`)
        mark(`material-${i}`, 'active')
        try {
          let res: Response
          if (m.file) {
            const fd = new FormData()
            fd.append('file', m.file); fd.append('kind', m.kind)
            if (m.title) fd.append('title', m.title)
            if (m.intentNote) fd.append('intentNote', m.intentNote)
            res = await fetch(`/api/office-actions/${caseId}/case-documents`, { method: 'POST', headers: authHeaders(), body: fd })
          } else {
            res = await fetch(`/api/office-actions/${caseId}/case-documents`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ kind: m.kind, text: m.text, title: m.title || undefined, intentNote: m.intentNote || undefined })
            })
          }
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error || 'Could not add the document')
          if (data.warning) toast({ title: `${MATERIAL_LABELS[m.kind] || 'Document'} added`, description: data.warning, variant: 'warning' })
          mark(`material-${i}`, 'done', data.warning || undefined)
          materialsAdded++
        } catch (err) {
          const why = err instanceof Error ? err.message : 'could not be added'
          mark(`material-${i}`, 'failed', why)
          failures.push(`${MATERIAL_LABELS[m.kind] || 'Document'}: ${why}`)
        }
      }

      setIntakeStep('Reading the examination report…')
      mark('fer', 'active')
      let res: Response
      if (payload.fer.file) {
        const fd = new FormData(); fd.append('file', payload.fer.file)
        res = await fetch(`/api/office-actions/${caseId}/documents`, { method: 'POST', headers: authHeaders(), body: fd })
      } else {
        res = await fetch(`/api/office-actions/${caseId}/documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ rawText: payload.fer.text })
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { mark('fer', 'failed', data.error || 'Could not read the report'); throw new Error(data.error || 'Could not read the report') }
      mark('fer', 'done', `${data.objectionCount} objection${data.objectionCount === 1 ? '' : 's'} extracted`)

      // Cited art can only be attached now — D1/D2 exist once the report is parsed.
      let citedAttached = 0
      const citedList = payload.citedDocuments || []
      for (let ci = 0; ci < citedList.length; ci++) {
        const c = citedList[ci]
        setIntakeStep(`Attaching ${c.label}…`)
        mark(`cited-${ci}`, 'active')
        try {
          let cres: Response
          if (c.file) {
            const fd = new FormData()
            fd.append('file', c.file); fd.append('label', c.label)
            if (c.title) fd.append('title', c.title)
            cres = await fetch(`/api/office-actions/${caseId}/citations`, { method: 'POST', headers: authHeaders(), body: fd })
          } else {
            cres = await fetch(`/api/office-actions/${caseId}/citations`, {
              method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
              body: JSON.stringify({ label: c.label, text: c.text, title: c.title })
            })
          }
          const cdata = await cres.json().catch(() => ({}))
          if (!cres.ok) throw new Error(cdata.error || 'Could not attach the document')
          citedAttached++
          mark(`cited-${ci}`, 'done')
        } catch (err) {
          const why = err instanceof Error ? err.message : 'could not be attached'
          mark(`cited-${ci}`, 'failed', why)
          failures.push(`${c.label}: ${why}`)
        }
      }

      const added = materialsAdded
      toast({
        title: `Report read — ${data.objectionCount} objection${data.objectionCount === 1 ? '' : 's'} found`,
        description: [
          added > 0 ? `${added} case-file document${added === 1 ? '' : 's'} added.` : '',
          citedAttached ? `${citedAttached} cited document${citedAttached === 1 ? '' : 's'} attached.` : '',
          data.warning || ''
        ].filter(Boolean).join(' ') || undefined,
        variant: data.warning ? 'warning' : 'success'
      })
      await load()
    } catch (err) {
      toast({ title: 'Could not process the report', description: err instanceof Error ? err.message : undefined, variant: 'error' })
      await load()   // the material that did land is on file — show it
    } finally {
      setBusy(null); setIntakeStep(null); setIntakeSteps([]); setIntakeStartedAt(null)
      // Anything rejected is reported on its own so it can be fixed in the case file.
      for (const f of failures) toast({ title: 'One document was not added', description: f, variant: 'error' })
    }
  }

  /**
   * Redraft one objection's section to the attorney's direction. One LLM call,
   * run in the foreground: it is fast enough to wait for, and the attorney is
   * looking at the section they asked to change.
   */
  const redraftSection = async (objectionId: string, remarks: string) => {
    setBusy('redraft')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ objectionId, remarks })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not redraft the section')
      toast({ title: 'Section redrafted to your remarks', description: 'Read it and approve when you are happy.', variant: 'success' })
      await load()
    } catch (err) {
      toast({ title: 'Could not redraft the section', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  /**
   * Pause the run. It stops at the next objection boundary rather than
   * immediately — the objection in flight is finished and saved, so nothing
   * paid for is thrown away.
   */
  const pausePrepare = async () => {
    setPausing(true)
    try {
      const res = await fetch(`/api/office-actions/${caseId}/prepare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'pause' })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not pause the run')
      setPrepareStep('Pausing after the current objection…')
      toast({ title: 'Pausing after the current objection', description: 'Upload any prior art you need — resuming keeps the sections already drafted.' })
    } catch (err) {
      toast({ title: 'Could not pause', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setPausing(false) }
  }

  // Prepare runs as a background job (a real FER is ~3 LLM calls per objection,
  // far beyond any request timeout) — start it, then poll for progress.
  const prepare = async () => {
    const anyWork = replies.some(r => r.approved || r.bodyText)
    // Resuming an interrupted run adds the missing sections — nothing is
    // replaced, so the "your edits will be lost" warning would be a lie.
    if (view?.latestDraft && anyWork && !preparationInterrupted) {
      const ok = window.confirm('Re-preparing drafts a fresh reply: your edits and approvals on the current draft will be replaced. Continue?')
      if (!ok) return
    }
    setBusy('prepare')
    setPrepareStep('Starting…')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/prepare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        // Continuing keeps the finished sections and redrafts only the gaps.
        body: JSON.stringify(preparationInterrupted ? { action: 'resume' } : {})
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Preparation failed')
      if (data.alreadyRunning) toast({ title: 'Preparation already running — showing its progress', variant: 'warning' })
      // A new run must be announced even if a previous one was announced here.
      announcedJobRef.current = null
      // The poller owns progress from here: it survives a reload and keeps
      // pulling in sections as they are persisted, one objection at a time.
      setPrepareActive(true)
      void pollPrepare()
    } catch (err) {
      setBusy(null); setPrepareStep(null)
      toast({ title: 'Could not prepare the reply', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    }
  }

  const dismissObjection = async (objectionId: string, dismiss: boolean) => {
    setBusy('save')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/objections`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ objectionId, dismiss })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not update the objection')
      toast({ title: dismiss ? 'Objection dismissed — it will not be required in the reply' : 'Objection restored', variant: 'success' })
      await load()
    } catch (err) {
      toast({ title: 'Could not update the objection', description: err instanceof Error ? err.message : undefined, variant: 'error' })
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

  /**
   * Approve every drafted section at once, once the whole reply exists.
   *
   * Sections that are a filing rather than an argument (Form 3, annexures, the
   * NBA undertaking) are named in the confirmation: approving those is the
   * attorney asserting to the office that the act is done or undertaken, and
   * that assertion must not be something they clicked past.
   */
  const approveAll = async () => {
    const pending = replies.filter(r => (r.bodyText || '').trim() && !r.approved
      && !objections.find(o => o.id === r.objectionId && o.status === 'DISMISSED'))
    if (!pending.length) return

    const filings = pending.filter(r => r.attorneyAction)
    const lines = [
      `Approve ${pending.length} section${pending.length === 1 ? '' : 's'} for the reply?`,
      filings.length
        ? `\n${filings.length} of them ${filings.length === 1 ? 'is a filing, not an argument' : 'are filings, not arguments'}:\n` +
          filings.map(r => `  • ${r.title}`).join('\n') +
          `\n\nApproving those states to the Controller that the document is filed or undertaken. Confirm you have done so.`
        : ''
    ].filter(Boolean).join('\n')
    if (!window.confirm(lines)) return

    await patchDraft(
      { objectionReplies: pending.map(r => ({ objectionId: r.objectionId, approved: true })) },
      `${pending.length} section${pending.length === 1 ? '' : 's'} approved — the reply is ready to preview and export`
    )
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

  const exportDocx = async (acknowledgeSignature?: string) => {
    setBusy('export')
    try {
      const res = await fetch(`/api/office-actions/${caseId}/export`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(acknowledgeSignature ? { acknowledgeSignature } : {})
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        // Outstanding findings do not block the export — they ask to be read
        // first. Keep whatever document is already on screen; replacing it with
        // an empty pane would hide the very thing they need to review.
        if (data.requiresAcknowledgement) {
          setPreview(prev => ({ lint: data.lint, html: prev?.html || '' }))
          throw new Error(data.error || 'Review the outstanding items, then export.')
        }
        if (data.lint) {
          setPreview(prev => ({ lint: data.lint, html: prev?.html || '' }))
          throw new Error(data.error || 'Export failed')
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
      toast({ title: 'Not exported yet', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(null) }
  }

  const jumpToSource = (tabId: string, passage?: string) => {
    setSourceTab(tabId)
    setHighlight(passage || null)
    setShowSource(true)
    updateSourcePrefs({ collapsed: false })   // a citation jump must never land on a collapsed panel
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

  // Only a successfully parsed communication counts — a failed upload must
  // bring the attorney straight back to the intake panel, not a dead end.
  const completedDocs = view.case.documents.filter(d => d.parseStatus === 'COMPLETED')
  const failedDocs = view.case.documents.filter(d => d.parseStatus === 'FAILED')
  const hasReport = completedDocs.length > 0
  const hasInvention = Boolean(view.case.specificationText && view.case.claimsText)

  return (
    <div className="flex flex-col min-h-[calc(100vh-4rem)]">
      <DeadlineStrip
        view={view}
        approved={approvedCount}
        // Every objection that must be answered, not just the ones a partial run
        // happened to draft. `replies.length` read "3/3 · ready to export" while
        // two objections had no section at all.
        total={objections.filter(o => o.status !== 'DISMISSED').length || replies.length}
        onOpenCaseFile={() => setShowCaseFile(true)}
        onAddDocument={() => setShowAddDocument(true)}
        onPrepare={prepare}
        onPause={pausePrepare}
        pausing={pausing}
        onPreview={previewReply}
        onExport={exportDocx}
        busy={busy}
        prepareStep={prepareStep}
        hasDraft={Boolean(view.latestDraft)}
        interrupted={preparationInterrupted}
        failedSections={failedSections}
        canApproveAll={allSectionsDrafted && pendingApproval > 0 && !prepareActive}
        pendingApproval={pendingApproval}
        onApproveAll={approveAll}
        hasReport={hasReport}
      />

      <NumberingNotice numbering={view.numbering} hasSpec={Boolean(view.case.specificationText)} />

      {!hasReport && intakeSteps.length > 0 ? (
        /* Processing takes minutes; the form gives way to the work itself. */
        <IntakeProgress steps={intakeSteps} startedAt={intakeStartedAt} />
      ) : !hasReport ? (
        <>
          {failedDocs.length > 0 && (
            <div className="max-w-2xl mx-auto w-full px-4 pt-6">
              <div className="border border-destructive/40 bg-destructive/5 rounded-md px-4 py-3 text-sm flex gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden />
                <div>
                  <span className="font-medium">The previous upload could not be read</span>
                  <span className="text-muted-foreground"> ({failedDocs.length === 1 ? '1 failed attempt' : `${failedDocs.length} failed attempts`}). Try again below — upload a text-based PDF of the report, or paste its text.</span>
                </div>
              </div>
            </div>
          )}
          <IntakePanel busy={busy === 'ingest'} step={intakeStep} onStart={startCase} hasInvention={hasInvention}
            onOpenCaseFile={() => setShowCaseFile(true)} />
        </>
      ) : (
        <>
        {prepareActive && (
          <PrepareActivity
            log={prepareLog}
            step={prepareStep}
            drafted={replies.filter(r => (r.bodyText || '').trim()).length}
            total={objections.length}
          />
        )}
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
                const dismissed = o.status === 'DISMISSED'
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => { setSelectedObjectionId(o.id); setTab('objection') }}
                      className={`w-full text-left border rounded-md px-3 py-2.5 transition-colors ${active ? 'border-primary ring-1 ring-primary' : 'hover:border-muted-foreground/40'} ${dismissed ? 'opacity-55' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${CODE_COLORS[o.canonicalCode] || CODE_COLORS.OTHER}`}>
                          {CODE_LABELS[o.canonicalCode] || o.canonicalCode}{o.subTypeId ? ` · ${o.subTypeId}` : ''}
                        </span>
                        {judgment && !dismissed && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" aria-label="Needs your judgment" />}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {o.localBasis || '—'}{o.claimsAffected?.length ? ` · claims ${compactRange(o.claimsAffected)}` : ''}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                        {dismissed
                          ? <span className="text-muted-foreground font-medium">Dismissed — not in the reply</span>
                          : r?.approved
                            ? <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium"><CheckCircle2 className="w-3 h-3" aria-hidden /> Approved</span>
                            : r?.attorneyAction
                              ? <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium"><AlertTriangle className="w-3 h-3" aria-hidden /> You must file this</span>
                              : r
                                ? <span className="text-primary font-medium">Drafted — review</span>
                                : <span className="text-muted-foreground">Awaiting preparation</span>}
                        {!o.quoteVerified && !dismissed && <span className="text-destructive font-medium">· quote unverified</span>}
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
                includedAmendments={(view.latestDraft?.amendedClaimsJson?.claims || []) as any[]}
                tab={tab}
                setTab={setTab}
                numbering={view.numbering?.mode || 'DERIVED'}
                onConfirmCompliance={(confirmed) => patchDraft(
                  { objectionReplies: [{ objectionId: selected.id, compliance: { status: confirmed ? 'CONFIRMED' : 'PENDING' } }] },
                  confirmed ? 'Compliance confirmed — the statement will now be filed' : 'Confirmation withdrawn')}
                busy={busy}
                onApprove={(approved) => patchDraft({ objectionReplies: [{ objectionId: selected.id, approved }] }, approved ? 'Section approved' : 'Approval withdrawn')}
                onSaveText={(bodyText) => patchDraft({ objectionReplies: [{ objectionId: selected.id, bodyText }] }, 'Draft updated — re-approve when ready')}
                onDismiss={(dismiss) => dismissObjection(selected.id, dismiss)}
                onToggleAmendment={(a, include) => patchDraft(
                  { amendedClaims: [include
                    ? { claimNumber: a.claimNumber, markedText: a.markedText, cleanText: a.cleanText, basisRefs: a.basisRefs || [] }
                    : { claimNumber: a.claimNumber, remove: true }] },
                  include ? `Claim ${a.claimNumber} amendment included in the reply` : `Claim ${a.claimNumber} amendment excluded from the reply`)}
                onJump={jumpToSource}
                onCitationUploaded={load}
                onRedraft={(remarks) => redraftSection(selected.id, remarks)}
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
            collapsed={sourcePrefs.collapsed}
            // Collapsing from the overlay (a citation jump on a wide screen puts
            // the panel there) has to dismiss the overlay too, or the button
            // would appear to do nothing.
            onToggleCollapsed={() => { updateSourcePrefs({ collapsed: !sourcePrefs.collapsed }); setShowSource(false) }}
            width={sourcePrefs.width}
            onResize={resizeSource}
            onCitationUploaded={load}
          />
        </div>
        </>
      )}

      {showCaseFile && caseId && (
        <CaseFilePanel caseId={caseId} onClose={() => { setShowCaseFile(false); void load() }} />
      )}

      {showAddDocument && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-[8vh]" onClick={e => { if (e.target === e.currentTarget) setShowAddDocument(false) }}>
          <div className="bg-background border rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto" role="dialog" aria-label="Add a communication">
            <div className="px-5 py-3.5 border-b flex items-center justify-between">
              <h2 className="font-semibold">Add another office communication</h2>
              <button onClick={() => setShowAddDocument(false)} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <AddCommunicationForm busy={busy === 'ingest'} onIngest={ingestFer} />
          </div>
        </div>
      )}

      {preview && (
        <PreviewModal
          preview={preview}
          onClose={() => setPreview(null)}
          onExport={exportDocx}
          busy={busy === 'export'}
          agent={(view.latestDraft?.complianceJson as any)?.agent || {}}
          onSaveAgent={(agent) => patchDraft({ agent })}
          onConfirmForm3={() => patchDraft({ formsStatus: { form3Filed: true } }, 'Form 3 noted as filed').then(() => previewReply())}
        />
      )}
    </div>
  )
}

// ============================================================================
// deadline strip

/**
 * How we read the specification's paragraph numbering, stated plainly.
 *
 * This is the backstop for the one failure nothing downstream can catch: if we
 * read a document's numbering wrongly, the reply cites a number that resolves
 * in our own table, so every automated check passes and the citation is still
 * wrong. An attorney spots a wrong reading in one glance — but only if we show
 * it to them. Nobody audits a JSON field.
 */
function NumberingNotice(props: {
  numbering?: CaseView['numbering']
  hasSpec: boolean
}) {
  const n = props.numbering
  if (!n || !props.hasSpec) return null

  const unusable = n.structureUsable === false
  const tone = unusable
    ? 'border-destructive/40 bg-destructive/5'
    : n.mode === 'AUTHORED'
      ? 'border-border bg-muted/40'
      : 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/30'

  return (
    <div className="max-w-6xl mx-auto w-full px-4 pt-3">
      <div className={`border rounded-md px-3 py-2 text-sm flex gap-2 items-start ${tone}`}>
        {unusable
          ? <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden />
          : <BookOpen className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />}
        <div>
          {unusable ? (
            <>
              <span className="font-medium">The specification did not read cleanly.</span>
              <span className="text-muted-foreground"> Its paragraph structure could not be recovered, so amendment
                basis and paragraph citations are unavailable. Upload a text-based PDF or a Word file and try again.</span>
            </>
          ) : n.mode === 'AUTHORED' ? (
            <>
              <span className="font-medium">Paragraph numbering read from your specification: [{n.firstMarker}]–[{n.lastMarker}]</span>
              <span className="text-muted-foreground"> · {n.paragraphCount} paragraphs. The reply will cite these numbers
                — check they match your document.</span>
              {n.confidence === 'MEDIUM' && n.reasons.length > 0 && (
                <div className="text-muted-foreground mt-1">Worth a look: {n.reasons.join(' ')}</div>
              )}
            </>
          ) : (
            <>
              <span className="font-medium">Your specification does not number its own paragraphs.</span>
              <span className="text-muted-foreground"> The reply will cite sections and quote the supporting wording
                instead of paragraph numbers — citing numbers the document does not have would misstate your own file.</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DeadlineStrip(props: {
  view: CaseView; approved: number; total: number
  onOpenCaseFile: () => void; onAddDocument: () => void; onPrepare: () => void; onPreview: () => void
  onExport: (acknowledgeSignature?: string) => void | Promise<void>
  onPause: () => void; pausing: boolean
  /** Every section is drafted and at least one is still unapproved. */
  canApproveAll: boolean; pendingApproval: number; onApproveAll: () => void
  busy: string | null; prepareStep: string | null; hasDraft: boolean; hasReport: boolean
  /** A previous run stopped part-way, or left sections undrafted. */
  interrupted: boolean
  /** Sections with no text — failures the next run should redraft. */
  failedSections: number
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
              {/* Appears only once every section exists — sign off the set in one pass. */}
              {props.canApproveAll && (
                <Button size="sm" variant="secondary" onClick={props.onApproveAll} disabled={props.busy !== null}
                  title="Approve every drafted section at once">
                  {props.busy === 'save'
                    ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Approving…</>
                    : <><CheckCircle2 className="w-4 h-4 mr-1.5" aria-hidden /> Approve all {props.pendingApproval}</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={props.onAddDocument} disabled={props.busy !== null}
                title="Upload a further communication (subsequent report, hearing notice…)">
                <Upload className="w-4 h-4 mr-1.5" aria-hidden /> Add document
              </Button>
              <Button size="sm" onClick={props.onPrepare} disabled={props.busy !== null}
                title={props.interrupted ? 'Continues the current draft: the finished sections are kept, only the missing ones are drafted' : undefined}>
                {props.busy === 'prepare'
                  ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> {props.prepareStep || 'Preparing…'}</>
                  : props.interrupted
                    ? <><RefreshCw className="w-4 h-4 mr-1.5" aria-hidden />
                        {props.failedSections
                          ? `Draft the ${props.failedSections} missing section${props.failedSections === 1 ? '' : 's'}`
                          : 'Resume preparation'}</>
                    : <><Sparkles className="w-4 h-4 mr-1.5" aria-hidden /> {props.hasDraft ? 'Re-prepare reply' : 'Prepare reply'}</>}
              </Button>
              {props.busy === 'prepare' && (
                <Button variant="outline" size="sm" onClick={props.onPause} disabled={props.pausing}
                  title="Stop after the current objection — drafted sections are kept, and you can upload prior art before resuming">
                  {props.pausing
                    ? <>Pausing…</>
                    : <><Pause className="w-4 h-4 mr-1.5" aria-hidden /> Pause</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={props.onPreview} disabled={props.busy !== null || !props.hasDraft}>
                <BookOpen className="w-4 h-4 mr-1.5" aria-hidden /> Preview
              </Button>
              <Button variant="outline" size="sm" onClick={() => props.onExport()} disabled={props.busy !== null || !props.hasDraft}>
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

/**
 * Live view of the drafting run.
 *
 * Preparing a reply is the longest wait in the product — several LLM passes per
 * objection — and it used to show one word on a button. This strip carries the
 * stages the worker actually reported: every line appeared because the pipeline
 * recorded that step, so the trail is a record of work, not an animation.
 */
function PrepareActivity(props: {
  log: Array<{ step: string; at: number }>
  step: string | null
  drafted: number
  total: number
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Follow the newest line, the way a build log does.
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [props.log.length])

  const pct = props.total ? Math.round((props.drafted / props.total) * 100) : 0
  const recent = props.log.slice(-6)

  return (
    <div className="border-b bg-muted/30">
      <div className="max-w-[1800px] mx-auto px-4 py-2.5">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden />
            Preparing the reply
          </span>
          <span className="text-sm text-muted-foreground truncate min-w-0 flex-1">
            {props.step || 'Working…'}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {props.drafted} of {props.total} sections drafted
          </span>
        </div>

        <div className="h-1 rounded-full bg-muted mt-2 overflow-hidden" role="progressbar"
          aria-valuenow={props.drafted} aria-valuemin={0} aria-valuemax={props.total}
          aria-label="Sections drafted">
          <div className="h-full bg-primary transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>

        {recent.length > 0 && (
          <div ref={bodyRef} className="mt-2 max-h-24 overflow-y-auto font-mono text-[11px] leading-relaxed text-muted-foreground">
            {recent.map((entry, i) => (
              <div key={`${entry.at}-${i}`} className={i === recent.length - 1 ? 'text-foreground' : ''}>
                <span className="opacity-60 mr-2 tabular-nums">
                  {new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                {entry.step}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export type IntakeStepStatus = 'pending' | 'active' | 'done' | 'failed'
export interface IntakeStep {
  id: string
  label: string
  /** File name, or "pasted text". */
  detail?: string
  /** What this step actually performs, listed so the wait reads as work. */
  stages: string[]
  status: IntakeStepStatus
  /** Outcome line once finished, or the reason it failed. */
  note?: string
}

/**
 * Intake progress.
 *
 * Opening a case runs for two or three minutes — the report alone is two LLM
 * passes — and a form that just sits there reads as a hung screen. This shows
 * the whole plan up front, marks each document as it is processed, and lists
 * what the current step is doing. Nothing here is simulated: the ticks follow
 * the requests, and no stage claims to be complete before it is.
 */
function IntakeProgress(props: { steps: IntakeStep[]; startedAt: number | null }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!props.startedAt) return
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - props.startedAt!) / 1000)), 1000)
    return () => clearInterval(t)
  }, [props.startedAt])

  const done = props.steps.filter(s => s.status === 'done').length
  const failed = props.steps.filter(s => s.status === 'failed').length
  const active = props.steps.find(s => s.status === 'active')
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  return (
    <div className="max-w-2xl mx-auto w-full px-4 py-10">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold">Opening the case</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{mmss}</span>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        {active
          ? <>Working on <span className="text-foreground font-medium">{active.label.toLowerCase()}</span>. This usually takes two to three minutes — you can leave this page, the work continues.</>
          : 'Finishing up…'}
      </p>

      {/* Overall bar — counts finished documents, never guesses at a percentage. */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-6" role="progressbar"
        aria-valuenow={done} aria-valuemin={0} aria-valuemax={props.steps.length}
        aria-label="Documents processed">
        <div className="h-full bg-primary transition-all duration-500"
          style={{ width: `${Math.round((done / Math.max(1, props.steps.length)) * 100)}%` }} />
      </div>

      <ol className="space-y-2.5">
        {props.steps.map(step => (
          <li key={step.id}
            className={`border rounded-lg px-4 py-3 transition-colors ${
              step.status === 'active' ? 'border-primary bg-primary/[0.03]'
              : step.status === 'failed' ? 'border-destructive/50 bg-destructive/[0.03]'
              : 'border-border'}`}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0">
                {step.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                  : step.status === 'active' ? <Loader2 className="w-4 h-4 text-primary animate-spin" aria-hidden />
                  : step.status === 'failed' ? <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden />
                  : <span className="block w-4 h-4 rounded-full border-2 border-muted-foreground/30" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-sm font-medium ${step.status === 'pending' ? 'text-muted-foreground' : ''}`}>{step.label}</span>
                  {step.detail && <span className="text-xs text-muted-foreground truncate max-w-[45%]">{step.detail}</span>}
                </div>
                {step.note && (
                  <div className={`text-xs mt-1 ${step.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{step.note}</div>
                )}
                {/* The stage list appears only while the step runs — it is what
                    that request is doing, not a claim about which one is live. */}
                {step.status === 'active' && (
                  <ul className="mt-2 space-y-1">
                    {step.stages.map(stage => (
                      <li key={stage} className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-primary/60 shrink-0" aria-hidden />
                        {stage}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <p className="text-xs text-muted-foreground mt-5">
        {done} of {props.steps.length} processed{failed ? ` · ${failed} could not be read` : ''}.
        Anything that fails here can be added later from the case file — the rest still goes through.
      </p>
    </div>
  )
}

/** One slot of material: an uploaded file OR pasted text, never both. */
interface MaterialSlot { file: File | null; text: string }
const EMPTY_SLOT: MaterialSlot = { file: null, text: '' }
const slotFilled = (s: MaterialSlot) => Boolean(s.file || s.text.trim())

/**
 * Everything the studio can take at intake, in the order the pipeline wants it.
 * Kinds match CaseDocumentKind on the server.
 */
const MATERIAL_LABELS: Record<string, string> = {
  SPECIFICATION: 'as-filed specification',
  CLAIMS: 'as-filed claims',
  DRAWINGS: 'drawings',
  SUPPLEMENTARY: 'supporting material'
}

/** File-or-paste input used for every material in the intake form. */
function MaterialInput(props: {
  id: string
  value: MaterialSlot
  onChange: (s: MaterialSlot) => void
  disabled?: boolean
  placeholder: string
  rows?: number
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const { value } = props
  return (
    <div>
      <input ref={fileRef} type="file" accept={ACCEPTED_UPLOAD_EXTENSIONS} className="hidden"
        id={props.id}
        onChange={e => { const f = e.target.files?.[0]; if (f) props.onChange({ file: f, text: '' }) }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={value.file ? 'secondary' : 'outline'} size="sm"
          disabled={props.disabled} onClick={() => fileRef.current?.click()}>
          <Upload className="w-3.5 h-3.5 mr-1.5" aria-hidden /> {value.file ? 'Replace file' : 'Choose file'}
        </Button>
        {value.file && (
          <span className="text-xs flex items-center gap-1.5 min-w-0">
            <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate max-w-[16rem]">{value.file.name}</span>
            <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
              aria-label={`Remove ${value.file.name}`}
              onClick={() => { props.onChange(EMPTY_SLOT); if (fileRef.current) fileRef.current.value = '' }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </span>
        )}
      </div>
      {!value.file && (
        <Textarea className="mt-2" rows={props.rows || 4} value={value.text} disabled={props.disabled}
          placeholder={props.placeholder}
          onChange={e => props.onChange({ file: null, text: e.target.value })} />
      )}
    </div>
  )
}

/**
 * A later communication (SER, hearing notice, further FER) — report only: the
 * invention is already on file by then, and the case file handles the rest.
 */
function AddCommunicationForm(props: { busy: boolean; onIngest: (p: { file?: File; text?: string }) => void }) {
  const [slot, setSlot] = useState<MaterialSlot>(EMPTY_SLOT)
  return (
    <div className="p-5">
      <p className="text-sm text-muted-foreground mb-3">
        Upload the communication as issued, or paste its text. Its objections and deadlines join this case.
      </p>
      <MaterialInput id="oa-next-communication" value={slot} onChange={setSlot} disabled={props.busy} rows={6}
        placeholder="Paste the full text of the communication…" />
      <div className="flex items-center gap-3 mt-3">
        <Button disabled={props.busy || !slotFilled(slot)}
          onClick={() => props.onIngest(slot.file ? { file: slot.file } : { text: slot.text })}>
          {props.busy
            ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Reading the report…</>
            : 'Read the communication'}
        </Button>
        <span className="text-xs text-muted-foreground">{ACCEPTED_UPLOAD_LABEL}, up to {MAX_OA_UPLOAD_LABEL}.</span>
      </div>
    </div>
  )
}

/**
 * Case intake — everything in one pass.
 *
 * The report alone opens a case, but the strategy and amendment stages need the
 * as-filed specification and claims, and supporting material is what answers an
 * evidence-based objection. Asking for all of it here saves the attorney a
 * second trip; anything skipped can still be added later from the case file.
 */
function IntakePanel(props: {
  busy: boolean
  step: string | null
  hasInvention: boolean
  onStart: (p: {
    fer: { file?: File; text?: string }
    materials: Array<{ kind: string; file?: File; text?: string; title?: string; intentNote?: string }>
    citedDocuments: Array<{ label: string; file?: File; text?: string; title?: string }>
  }) => void
  onOpenCaseFile: () => void
}) {
  const [fer, setFer] = useState<MaterialSlot>(EMPTY_SLOT)
  const [spec, setSpec] = useState<MaterialSlot>(EMPTY_SLOT)
  const [claims, setClaims] = useState<MaterialSlot>(EMPTY_SLOT)
  const [supplementary, setSupplementary] = useState<Array<{ key: string; slot: MaterialSlot; title: string; intentNote: string }>>([])
  // The examiner's own cited art (D1, D2…), attached after the report is read
  // — the labels only exist once the FER has been parsed.
  const [cited, setCited] = useState<Array<{ key: string; slot: MaterialSlot; label: string; title: string }>>([])
  /**
   * Row keys must be unique for the life of the form, not derived from length.
   *
   * `c${list.length}` collided after a remove-then-add: the new row reused a
   * surviving row's key, so patchCited mirrored every keystroke and file choice
   * into both, and removing one deleted both. A monotonic counter cannot repeat.
   */
  const citedKeyRef = useRef(0)
  const addCited = () =>
    setCited(list => [...list, {
      key: `c${citedKeyRef.current++}`,
      slot: EMPTY_SLOT,
      label: `D${list.length + 1}`,
      title: ''
    }])
  const patchCited = (key: string, patch: Partial<{ slot: MaterialSlot; label: string; title: string }>) =>
    setCited(list => list.map(c => c.key === key ? { ...c, ...patch } : c))

  const addSupplementary = () =>
    setSupplementary(list => [...list, { key: `s${list.length}-${list.length ? list[list.length - 1].key : 'first'}`, slot: EMPTY_SLOT, title: '', intentNote: '' }])
  const patchSupplementary = (key: string, patch: Partial<{ slot: MaterialSlot; title: string; intentNote: string }>) =>
    setSupplementary(list => list.map(s => s.key === key ? { ...s, ...patch } : s))

  const submit = () => {
    const materials: Array<{ kind: string; file?: File; text?: string; title?: string; intentNote?: string }> = []
    const push = (kind: string, slot: MaterialSlot, extra?: { title?: string; intentNote?: string }) => {
      if (!slotFilled(slot)) return
      materials.push({ kind, ...(slot.file ? { file: slot.file } : { text: slot.text }), ...extra })
    }
    push('SPECIFICATION', spec)
    push('CLAIMS', claims)
    for (const s of supplementary) push('SUPPLEMENTARY', s.slot, { title: s.title || undefined, intentNote: s.intentNote || undefined })

    const citedDocuments = cited
      .filter(c => c.label.trim() && slotFilled(c.slot))
      .map(c => ({
        label: c.label.trim(), title: c.title.trim() || undefined,
        ...(c.slot.file ? { file: c.slot.file } : { text: c.slot.text })
      }))

    props.onStart({ fer: fer.file ? { file: fer.file } : { text: fer.text }, materials, citedDocuments })
  }

  const optionalCount = [spec, claims].filter(slotFilled).length
    + supplementary.filter(s => slotFilled(s.slot)).length
    + cited.filter(c => slotFilled(c.slot) && c.label.trim()).length

  return (
    <div className="max-w-5xl mx-auto w-full px-4 py-10">
      <h2 className="text-lg font-semibold mb-1">Open the case</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Give the studio everything you have in one go. Only the examination report is required —
        the rest sharpens the drafted reply, and anything you skip can be added later from the case file.
      </p>

      {/* 1 — the report (required), above both columns: it is what the case is about */}
      <section className="border rounded-lg p-4 mb-5">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <h3 className="font-medium">Examination report</h3>
          <span className="text-[11px] uppercase tracking-wide text-primary font-semibold">Required</span>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          The FER as issued. Objections, cited documents and the reply deadline are extracted from it;
          cited patents are then retrieved in the background.
        </p>
        <MaterialInput id="oa-fer" value={fer} onChange={setFer} disabled={props.busy} rows={5}
          placeholder="Paste the full text of the First Examination Report…" />
      </section>

      {/*
        Two columns, because these are two different things and mixing them is
        the expensive mistake: what YOU filed can support an amendment under
        s.59, what the EXAMINER cited never can. Keeping them apart on screen
        keeps them apart in the reply.
      */}
      <div className="grid lg:grid-cols-2 gap-5 mb-5 items-start">

        {/* LEFT — the applicant's own record */}
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/40">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-muted-foreground" aria-hidden /> Your application
              </h3>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Recommended</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              What you filed. <span className="text-foreground font-medium">Only this can support a claim amendment</span> (Section 59) —
              without it the studio can argue but not amend.
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" htmlFor="oa-spec">Complete specification / description</label>
              <MaterialInput id="oa-spec" value={spec} onChange={setSpec} disabled={props.busy} rows={4}
                placeholder="Paste the as-filed description…" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" htmlFor="oa-claims">Claims as filed</label>
              <p className="text-[11px] text-muted-foreground mb-1.5">
                Leave empty if the specification above already contains them — they are detected automatically.
              </p>
              <MaterialInput id="oa-claims" value={claims} onChange={setClaims} disabled={props.busy} rows={3}
                placeholder="Paste the as-filed claims…" />
            </div>
          </div>
        </div>

        {/* RIGHT — the examiner's case, and what you will answer it with */}
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/40">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="font-medium flex items-center gap-1.5">
                <BookOpen className="w-4 h-4 text-muted-foreground" aria-hidden /> The case against you
              </h3>
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Optional</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              The prior art the examiner relied on, and your evidence answering it.{' '}
              <span className="text-foreground font-medium">Never used as amendment basis</span> — argument and evidence only.
            </p>
          </div>
          <div className="p-4 space-y-5">

      {/* 3 — the examiner's cited art */}
      <section>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Prior art cited in the report</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Patents are fetched automatically where they can be found. Journal papers and other
          non-patent literature usually cannot be — add your copies here, labelled as the report
          labels them (D1, D2…), and each one feeds the claim chart instead of the examiner&rsquo;s summary.
        </p>
        {cited.map(d => (
          <div key={d.key} className="border rounded-md p-3 mb-2">
            <div className="flex items-center gap-2 mb-2">
              <Input className="h-8 text-sm w-24 font-mono" placeholder="D1" value={d.label} disabled={props.busy}
                onChange={e => patchCited(d.key, { label: e.target.value })} />
              <Input className="h-8 text-sm" placeholder="Title (optional)" value={d.title} disabled={props.busy}
                onChange={e => patchCited(d.key, { title: e.target.value })} />
              <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Remove this cited document"
                onClick={() => setCited(list => list.filter(x => x.key !== d.key))}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <MaterialInput id={`oa-cited-${d.key}`} value={d.slot} rows={3} disabled={props.busy}
              onChange={slot => patchCited(d.key, { slot })}
              placeholder="Paste the document text…" />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addCited} disabled={props.busy}>
          Add a cited document
        </Button>
      </section>

      {/* 4 — supporting material */}
      <section className="border-t pt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Your supporting evidence</h4>
        <p className="text-xs text-muted-foreground mb-3">
          Comparative data, affidavits, publications, prosecution history — anything that answers an
          evidence-based objection such as Section 3(d) enhanced efficacy.
        </p>
        {supplementary.map(s => (
          <div key={s.key} className="border rounded-md p-3 mb-2">
            <div className="flex items-center gap-2 mb-2">
              <Input className="h-8 text-sm" placeholder="What is it? (e.g. comparative efficacy data)"
                value={s.title} disabled={props.busy}
                onChange={e => patchSupplementary(s.key, { title: e.target.value })} />
              <button type="button" className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Remove this supporting document"
                onClick={() => setSupplementary(list => list.filter(x => x.key !== s.key))}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <MaterialInput id={`oa-supp-${s.key}`} value={s.slot} rows={3} disabled={props.busy}
              onChange={slot => patchSupplementary(s.key, { slot })}
              placeholder="Paste the supporting text…" />
            <Input className="h-8 text-sm mt-2" placeholder="How should it be used? (optional)"
              value={s.intentNote} disabled={props.busy}
              onChange={e => patchSupplementary(s.key, { intentNote: e.target.value })} />
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addSupplementary} disabled={props.busy}>
          Add supporting document
        </Button>
      </section>

          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={submit} disabled={props.busy || !slotFilled(fer)}>
          {props.busy
            ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> {props.step || 'Working…'}</>
            : <>Open the case{optionalCount ? ` with ${optionalCount + 1} document${optionalCount ? 's' : ''}` : ''}</>}
        </Button>
        {!props.busy && (
          <span className="text-xs text-muted-foreground">
            {ACCEPTED_UPLOAD_LABEL}, up to {MAX_OA_UPLOAD_LABEL} each. Scanned files need OCR first.
          </span>
        )}
      </div>

      {props.hasInvention && (
        <div className="mt-5 border rounded-lg p-4 border-emerald-300 dark:border-emerald-900">
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden />
            <div>
              <span className="font-medium">The invention is already on file.</span>{' '}
              <span className="text-muted-foreground">You only need the report above.</span>{' '}
              <button className="text-primary underline underline-offset-2" onClick={props.onOpenCaseFile}>
                Review the case file
              </button>
            </div>
          </div>
        </div>
      )}
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
  includedAmendments: any[]
  tab: 'objection' | 'evidence' | 'strategy' | 'draft'
  setTab: (t: 'objection' | 'evidence' | 'strategy' | 'draft') => void
  numbering: ParagraphNumbering
  onConfirmCompliance: (confirmed: boolean) => void
  busy: string | null
  onApprove: (approved: boolean) => void
  onSaveText: (text: string) => void
  onDismiss: (dismiss: boolean) => void
  onToggleAmendment: (amendment: any, include: boolean) => void
  onJump: (tab: string, passage?: string) => void
  onCitationUploaded: () => void | Promise<void>
  onRedraft: (remarks: string) => Promise<void>
}) {
  const { objection: o, reply } = props
  const strategy = o.strategyJson || null
  const dismissed = o.status === 'DISMISSED'
  const officeNo = (o.analysisJson?.officeNumber as string) || String(o.sortOrder + 1)
  const [editing, setEditing] = useState(false)
  const [draftText, setDraftText] = useState('')
  // Redraft box, per objection: closed and cleared whenever the selection changes.
  const [redrafting, setRedrafting] = useState(false)
  const [remarks, setRemarks] = useState('')
  /**
   * Never discard text the attorney is currently typing.
   *
   * This effect used to run on every change to `reply.bodyText`, which the 2.5s
   * prepare poll changes whenever the background run persists that section — so
   * an attorney writing a failed section by hand had the editor closed and their
   * work thrown away mid-sentence, with no warning. Switching objections resets
   * the editor; an update arriving underneath an OPEN editor does not.
   */
  // Keyed on o.id ALONE, deliberately: reacting to bodyText here is the bug.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setEditing(false); setDraftText(reply?.bodyText || '') }, [o.id])
  useEffect(() => {
    if (editing) return                       // their text wins while they are in it
    setDraftText(reply?.bodyText || '')
  }, [reply?.bodyText, editing])
  useEffect(() => { setRedrafting(false); setRemarks((reply as any)?.attorneyRemarks || '') }, [o.id])

  const tabs: Array<[typeof props.tab, string]> = [['objection', 'Objection'], ['evidence', 'Evidence'], ['strategy', 'Strategy'], ['draft', 'Draft']]

  // One definition, rendered at the top and the bottom of the drafted section.
  const approveControl = reply ? (
    reply.approved ? (
      <span className="flex items-center gap-2">
        <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> Approved
        </span>
        <Button size="sm" variant="outline" onClick={() => props.onApprove(false)} disabled={props.busy !== null}>
          Withdraw approval
        </Button>
      </span>
    ) : (
      <Button size="sm" onClick={() => props.onApprove(true)} disabled={props.busy !== null || !(reply.bodyText || '').trim()}
        title={!(reply.bodyText || '').trim() ? 'Write the section before approving it' : undefined}>
        <CheckCircle2 className="w-4 h-4 mr-1.5" aria-hidden /> Approve section
      </Button>
    )
  ) : null

  return (
    <div className="px-5 py-4 max-w-3xl">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="text-lg font-semibold flex items-center gap-2 min-w-0">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded shrink-0 ${CODE_COLORS[o.canonicalCode] || CODE_COLORS.OTHER}`}>
            {CODE_LABELS[o.canonicalCode] || o.canonicalCode}
          </span>
          <span className="truncate">Objection {officeNo}{o.localBasis ? ` · ${o.localBasis}` : ''}</span>
        </h2>
        <Button size="sm" variant="outline" onClick={() => props.onDismiss(!dismissed)} disabled={props.busy !== null}
          title={dismissed ? 'Bring this objection back into the reply' : 'Exclude this card (misparse, duplicate, or handled elsewhere) — the reply will not require it'}>
          {dismissed ? 'Restore objection' : 'Dismiss'}
        </Button>
      </div>
      {dismissed && (
        <div className="mt-2 border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 rounded-md px-3 py-2 text-sm">
          Dismissed — this card is excluded from the reply and from the compliance check.
        </div>
      )}
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
            <dt className="text-muted-foreground">Prior art cited</dt>
            <dd>{o.citationLabels?.length ? o.citationLabels.join(', ') : 'None'}</dd>
            <dt className="text-muted-foreground">Statutory basis</dt>
            <dd>{o.localBasis || '—'}</dd>
          </dl>
        </section>
      )}

      {props.tab === 'evidence' && (
        <EvidenceTab citations={props.citations} citedDocs={props.citedDocs} onJump={props.onJump}
          onCitationUploaded={props.onCitationUploaded} />
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
                      const included = props.includedAmendments.some((c: any) => c.claimNumber === a.claimNumber)
                      const passes = verdict?.verdict === 'pass'
                      return (
                        <div key={i} className="border rounded-md px-3 py-2.5">
                          <div className="text-sm font-serif leading-relaxed" dangerouslySetInnerHTML={{ __html: renderMarked(a.markedText, a.claimNumber) }} />
                          <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                            <span className="text-muted-foreground">Basis: {(a.basisRefs || []).join(', ') || 'none'}</span>
                            {verdict && (
                              <span className={`font-semibold px-1.5 py-0.5 rounded ${passes ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'}`}>
                                Amendment check: {passes ? 'within scope ✓' : 'blocked'}
                              </span>
                            )}
                            {passes && (
                              <span className={`px-1.5 py-0.5 rounded ${included ? 'bg-primary/10 text-primary font-medium' : 'bg-secondary text-secondary-foreground'}`}>
                                {included ? 'In the reply' : 'Not in the reply'}
                              </span>
                            )}
                            {passes && (
                              <button
                                className="text-primary underline underline-offset-2 disabled:opacity-50"
                                disabled={props.busy !== null}
                                onClick={() => props.onToggleAmendment(a, !included)}>
                                {included ? 'Exclude from reply' : 'Include in reply'}
                              </button>
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
              {/*
                The approve control sits at BOTH ends of the section: a drafted
                reply runs to several hundred words, and having to scroll to the
                bottom to sign off the one you just read at the top is friction
                paid on every objection.
              */}
              <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{reply.heading || 'Reply section'}</div>
                {!editing && approveControl}
              </div>
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
                  {reply.draftError && !reply.bodyText && (
                    <div className="mb-2 border border-destructive/40 bg-destructive/5 rounded-md px-3 py-2 text-sm flex gap-2">
                      <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden />
                      <div>Drafting this section failed ({reply.draftError}). Write it with &ldquo;Edit&rdquo;, or run &ldquo;Re-prepare reply&rdquo;.</div>
                    </div>
                  )}
                  {reply.attorneyAction && (
                    <div className="mb-2 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-sm">
                      <div className="font-medium flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden />
                        You must complete this one — it is a filing, not an argument
                      </div>
                      <p className="text-muted-foreground mt-1">
                        {reply.compliance?.status === 'CONFIRMED'
                          ? 'You have confirmed this. The sentence below is what will be filed.'
                          : 'The reply says nothing about this until you confirm it — a statement that a form is filed cannot go to the Controller before you have filed it. Do the acts listed, then confirm.'}
                      </p>
                      {Boolean(reply.actionItems?.length) && (
                        <ul className="mt-2 space-y-1 list-disc pl-5">
                          {reply.actionItems.map((a: string, i: number) => <li key={i}>{a}</li>)}
                        </ul>
                      )}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {reply.compliance?.status === 'CONFIRMED' ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                              <CheckCircle2 className="w-4 h-4" aria-hidden /> Confirmed
                            </span>
                            <Button size="sm" variant="outline" disabled={props.busy !== null}
                              onClick={() => props.onConfirmCompliance(false)}>Withdraw confirmation</Button>
                          </>
                        ) : (
                          <Button size="sm" disabled={props.busy !== null}
                            onClick={() => props.onConfirmCompliance(true)}>
                            I have done this
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className={`border rounded-md px-4 py-3 font-serif text-[15px] leading-relaxed whitespace-pre-wrap ${
                    reply.attorneyAction ? 'bg-amber-100/70 dark:bg-amber-950/60 border-amber-400' : 'bg-card'}`}>
                    {/* Shown as it will be filed. An anchor that could not be filed
                        appears as a visible placeholder rather than a plausible number. */}
                    {formatParagraphRefsForPreview(reply.bodyText, props.numbering)
                      || <span className="text-muted-foreground font-sans text-sm">Empty section.</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
                    {!reply.attorneyAction && (
                      <Button size="sm" variant="outline" onClick={() => setRedrafting(v => !v)} disabled={props.busy !== null}
                        title="Rewrite this section the way you want it, in your own words">
                        <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden /> Redraft with my remarks
                      </Button>
                    )}
                    {approveControl}
                    {reply.approved && (
                      <span className="text-xs text-muted-foreground">Will be included in the reply</span>
                    )}
                  </div>

                  {redrafting && !reply.attorneyAction && (
                    <div className="mt-3 border rounded-md p-3 bg-muted/30">
                      <label className="text-xs font-medium block mb-1.5" htmlFor="oa-remarks">
                        What should change? The drafter keeps the same evidence and authorities and rewrites to your direction.
                      </label>
                      <Textarea id="oa-remarks" rows={3} value={remarks} disabled={props.busy === 'redraft'}
                        onChange={e => setRemarks(e.target.value)}
                        placeholder="e.g. Lead with the D1 distinction and drop the efficacy argument — we have no comparative data. Keep it under 200 words." />
                      <div className="flex items-center gap-2 mt-2">
                        <Button size="sm" disabled={props.busy !== null || !remarks.trim()}
                          onClick={async () => { await props.onRedraft(remarks.trim()); setRedrafting(false) }}>
                          {props.busy === 'redraft'
                            ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Redrafting…</>
                            : 'Redraft this section'}
                        </Button>
                        <Button size="sm" variant="outline" disabled={props.busy === 'redraft'}
                          onClick={() => setRedrafting(false)}>Cancel</Button>
                        <span className="text-xs text-muted-foreground">The rewritten section comes back unapproved.</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}

/**
 * Attach the attorney's own copy of a cited document the office relied on.
 * Papers and foreign patents often are not retrievable; without the text the
 * claim chart cannot run and the reply argues against the examiner's summary
 * rather than the document itself.
 */
function CitedDocumentUpload(props: {
  label: string; caseId?: string; onUploaded: () => void | Promise<void>
  /** Icon-only, for the source panel header. */
  compact?: boolean
  /** The document is already on file — this replaces it. */
  replace?: boolean
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const params = useParams<{ caseId: string }>()
  const caseId = props.caseId || params?.caseId

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file); fd.append('label', props.label)
      const res = await fetch(`/api/office-actions/${caseId}/citations`, { method: 'POST', headers: authHeaders(), body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not attach the document')
      toast({ title: data.message || `${props.label} attached`, variant: 'success' })
      await props.onUploaded()
    } catch (err) {
      toast({ title: `Could not attach ${props.label}`, description: err instanceof Error ? err.message : undefined, variant: 'error' })
    } finally { setBusy(false) }
  }

  const picker = (
    <input ref={fileRef} type="file" accept={ACCEPTED_UPLOAD_EXTENSIONS} className="hidden"
      onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = '' }} />
  )
  const hint = `${props.replace ? 'Replace' : 'Upload'} ${props.label} — your copy of the prior art the examiner cited (${ACCEPTED_UPLOAD_LABEL})`

  if (props.compact) {
    return (
      <span className="flex items-center">
        {picker}
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
          aria-label={hint} title={hint}
          className="text-muted-foreground hover:text-foreground disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Upload className="w-4 h-4" aria-hidden />}
        </button>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 shrink-0">
      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">Document to be provided</span>
      {picker}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()} title={hint}>
        {busy
          ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden /> Reading…</>
          : <><Upload className="w-3.5 h-3.5 mr-1.5" aria-hidden /> Upload {props.label}</>}
      </Button>
    </span>
  )
}

function EvidenceTab(props: {
  citations: CitationRow[]; citedDocs: CitedDocView[]
  onJump: (tab: string, passage?: string) => void
  onCitationUploaded: () => void | Promise<void>
}) {
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
                {doc?.externalUrl && (
                  <a href={doc.externalUrl} target="_blank" rel="noopener noreferrer"
                    className="ml-2 text-xs text-primary underline underline-offset-2 whitespace-nowrap"
                    title={`Open ${c.label} on ${doc.externalUrl.includes('doi.org') ? 'doi.org' : 'Google Patents'}`}>
                    {doc.externalUrl.includes('doi.org') ? 'View paper ↗' : 'Google Patents ↗'}
                  </a>
                )}
              </div>
              {doc?.status === 'available' ? (
                <Button size="sm" variant="outline" onClick={() => props.onJump(c.label)}>
                  Read <ChevronRight className="w-3.5 h-3.5 ml-1" aria-hidden />
                </Button>
              ) : doc?.status === 'pending' ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden /> Retrieving…</span>
              ) : (
                <CitedDocumentUpload label={c.label} onUploaded={props.onCitationUploaded} />
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
                              onClick={() => props.onJump(c.label, r.cell.passage)}>
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


// ============================================================================
// source viewer

function SourceViewer(props: {
  view: CaseView; activeTab: string; setActiveTab: (t: string) => void
  highlight: string | null; open: boolean; onClose: () => void
  /** Docked (xl+) only — the small-screen panel is an overlay driven by `open`. */
  collapsed: boolean; onToggleCollapsed: () => void
  width: number; onResize: (next: number | ((prev: number) => number)) => void
  onCitationUploaded: () => void | Promise<void>
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // Show the report actually in play: the most recent successfully parsed one.
  const parsedDocs = props.view.case.documents.filter(d => d.parseStatus === 'COMPLETED')
  const ferText = (parsedDocs[parsedDocs.length - 1] || props.view.case.documents[0])?.rawText || ''
  const docs = props.view.citedDocuments.filter(d => d.status === 'available')
  const missingDocs = props.view.citedDocuments.filter(d => d.status !== 'available')

  // Prior art the examiner cited. Documents still missing get a tab too — that
  // is where the attorney supplies their own copy, and an invisible gap is a
  // gap nobody fills.
  const sources: Array<{ id: string; label: string; text: string; heading: string; missing?: boolean; externalUrl?: string }> = [
    { id: 'FER', label: 'FER', heading: 'First Examination Report — as issued', text: ferText },
    ...docs.map(d => ({
      id: d.label, label: d.label, externalUrl: d.externalUrl,
      heading: `${d.label} · ${d.title || d.publicationNumber || 'Prior art cited by the examiner'} — ${d.sourceLabel}`,
      text: [d.abstract && `ABSTRACT\n${d.abstract}`, d.claims && `CLAIMS\n${d.claims}`, d.description && `DESCRIPTION\n${d.description}`].filter(Boolean).join('\n\n')
    })),
    ...missingDocs.map(d => ({
      id: d.label, label: d.label, missing: true, externalUrl: d.externalUrl,
      heading: `${d.label} · ${d.title || d.publicationNumber || 'Prior art cited by the examiner'} — not on file`,
      text: ''
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

  // Collapsed only applies to the docked panel; the small-screen overlay is
  // dismissed with its own close button.
  const collapsedDocked = props.collapsed && !props.open

  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()                                   // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, startWidth: props.width }
    setDragging(true)
  }
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    // The panel is right-anchored, so dragging left makes it wider.
    props.onResize(drag.current.startWidth + (drag.current.startX - e.clientX))
  }
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
    setDragging(false)
  }
  const onHandleKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') { e.preventDefault(); props.onResize(w => w + step) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); props.onResize(w => w - step) }
    else if (e.key === 'Home') { e.preventDefault(); props.onResize(SOURCE_DEFAULT_WIDTH) }
  }

  if (collapsedDocked) {
    return (
      <aside className="hidden xl:flex w-10 shrink-0 border-l bg-card flex-col items-center gap-3 py-3">
        <button
          onClick={props.onToggleCollapsed}
          aria-label="Show source documents" aria-expanded={false} title="Show source documents"
          className="text-muted-foreground hover:text-foreground"
        >
          <PanelRightOpen className="w-4 h-4" aria-hidden />
        </button>
        <button
          onClick={props.onToggleCollapsed}
          tabIndex={-1}
          className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground [writing-mode:vertical-rl] rotate-180 whitespace-nowrap"
        >
          Source documents
        </button>
      </aside>
    )
  }

  // At xl the panel is docked, so a citation jump reveals it in place; below xl
  // there is no room for a column and it comes in as an overlay.
  return (
    <aside
      style={{ width: props.width, maxWidth: '90vw' }}
      // No position utility in the base list: `relative` would out-rank the
      // overlay's `fixed` in the stylesheet regardless of class order.
      className={`shrink-0 min-w-0 border-l bg-card flex-col min-h-0 ${dragging ? 'select-none' : ''} ${
        props.open
          ? 'flex fixed right-0 top-0 bottom-0 z-40 shadow-2xl xl:relative xl:inset-auto xl:z-auto xl:shadow-none'
          : 'hidden xl:flex relative'}`}
    >
      {/* drag-to-resize edge — pointer, or arrow keys once focused */}
      <div
        role="separator" aria-orientation="vertical" tabIndex={0}
        aria-label="Resize the source documents panel"
        aria-valuenow={props.width} aria-valuemin={SOURCE_MIN_WIDTH} aria-valuemax={sourceMaxWidth()}
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
        onKeyDown={onHandleKey}
        onDoubleClick={() => props.onResize(SOURCE_DEFAULT_WIDTH)}
        title="Drag to resize · double-click to reset"
        className={`absolute left-0 top-0 bottom-0 z-10 w-1.5 -translate-x-1/2 cursor-col-resize touch-none
          hover:bg-primary/40 focus-visible:outline-none focus-visible:bg-primary/60 ${dragging ? 'bg-primary/60' : ''}`}
      />
      <div className="px-3 py-2.5 border-b flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Report &amp; prior art
        </span>
        <div className="flex items-center gap-1">
          {/* Upload sits with the document it belongs to: the active prior-art tab. */}
          {active?.externalUrl && (
            <a href={active.externalUrl} target="_blank" rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`Open ${active.label} on ${active.externalUrl.includes('doi.org') ? 'doi.org' : 'Google Patents'}`}
              title={`Open ${active.label} on ${active.externalUrl.includes('doi.org') ? 'doi.org' : 'Google Patents'}`}>
              <ExternalLink className="w-4 h-4" aria-hidden />
            </a>
          )}
          {active && active.id !== 'FER' && (
            <CitedDocumentUpload
              label={active.id}
              compact
              replace={!active.missing}
              onUploaded={props.onCitationUploaded}
            />
          )}
          <button
            className="hidden xl:inline-flex text-muted-foreground hover:text-foreground"
            onClick={props.onToggleCollapsed}
            aria-label="Hide source documents" aria-expanded={true} title="Hide source documents"
          >
            <PanelRightClose className="w-4 h-4" aria-hidden />
          </button>
          <button className="xl:hidden text-muted-foreground" onClick={props.onClose} aria-label="Close sources"><X className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="flex gap-1 px-2 pt-2 flex-wrap">
        {sources.map(s => (
          <button key={s.id}
            className={`text-xs font-mono px-2 py-1 rounded-t border-b-2 ${active?.id === s.id ? 'border-primary text-foreground bg-muted/50' : 'border-transparent text-muted-foreground hover:text-foreground'} ${s.missing ? 'italic opacity-70' : ''}`}
            title={s.missing ? `${s.label} is not on file — upload your copy` : undefined}
            onClick={() => props.setActiveTab(s.id)}>
            {s.label}{s.missing ? ' ·' : ''}
          </button>
        ))}
      </div>
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-[11px] text-muted-foreground mb-2">{active?.heading}</div>
        {active?.missing ? (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>
              This prior-art document could not be retrieved — journal papers and some foreign
              patents are not available to fetch.
            </p>
            <p>
              Upload your copy and it reads like any other source here: the claim chart runs against
              its actual text, and the reply argues the document rather than the examiner&rsquo;s summary of it.
            </p>
            <CitedDocumentUpload label={active.id} onUploaded={props.onCitationUploaded} />
          </div>
        ) : (
          <div className="font-serif text-[13.5px] leading-relaxed whitespace-pre-wrap">
            {rendered.length === 3
              ? <>{rendered[0]}<mark className="bg-emerald-200 dark:bg-emerald-900 rounded px-0.5">{rendered[1]}</mark>{rendered[2]}</>
              : rendered[0] || <span className="font-sans text-sm text-muted-foreground">No text available.</span>}
          </div>
        )}
      </div>
    </aside>
  )
}

// ============================================================================
// case file panel (invention + supplementary)

/**
 * Readiness of one case-file document, in the attorney's terms — "can the
 * studio search this when it drafts?" — not the job state behind it.
 * The double tick is the delivered signal; a single tick means the text is used
 * whole and needs no search index.
 */
function IndexBadge({ status }: { status: string }) {
  if (status === 'INDEXED') {
    return (
      <span className="flex items-center gap-1 text-xs text-primary mt-0.5" title="Searchable — the studio can pull the exact paragraphs it needs from this document">
        <CheckCheck className="w-3.5 h-3.5" aria-hidden /> Searchable
      </span>
    )
  }
  if (status === 'NOT_REQUIRED') {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5" title="Used in full, so it needs no search index">
        <Check className="w-3.5 h-3.5" aria-hidden /> On file
      </span>
    )
  }
  // PENDING and FAILED read the same to the attorney: indexing runs once, at
  // upload, and there is no background retry — so neither is "in progress".
  // The document is on file and still used; only paragraph search is missing.
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5" title="The full text is on file and still used for drafting; only paragraph-level search is unavailable. Re-add the document to index it.">
      <Check className="w-3.5 h-3.5" aria-hidden /> On file — not searchable
    </span>
  )
}

function CaseFilePanel(props: { caseId: string; onClose: () => void }) {
  const { toast } = useToast()
  const [docs, setDocs] = useState<any[] | null>(null)
  const [kind, setKind] = useState('SPECIFICATION')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [intent, setIntent] = useState('')
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  /**
   * A failed load must not read as "nothing on file".
   *
   * Rendering the empty state on an HTTP error invited the attorney to re-upload
   * a specification that is already there — silently changing which copy is
   * latest, and with it the amendment basis. A network throw left the panel on
   * "Loading…" forever with no retry.
   */
  const [docsError, setDocsError] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/office-actions/${props.caseId}/case-documents`, { headers: authHeaders() })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setDocsError(data.error || 'Could not load the case file.')
        return
      }
      setDocsError(null)
      setDocs(data.documents || [])
    } catch {
      setDocsError('Could not reach the server. Check your connection and try again.')
      setDocs(d => d ?? [])
    }
  }, [props.caseId])
  useEffect(() => { void load() }, [load])

  const removeDoc = async (documentId: string) => {
    if (!window.confirm('Remove this document from the case file? Its indexed text is deleted; the invention text re-points to the latest remaining copy.')) return
    try {
      const res = await fetch(`/api/office-actions/${props.caseId}/case-documents?documentId=${encodeURIComponent(documentId)}`, {
        method: 'DELETE', headers: authHeaders()
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not remove the document')
      toast({ title: 'Document removed', variant: 'success' })
      await load()
    } catch (err) {
      toast({ title: 'Could not remove the document', description: err instanceof Error ? err.message : undefined, variant: 'error' })
    }
  }

  const submit = async (file?: File) => {
    setSaving(true)
    try {
      let res: Response
      if (file) {
        const fd = new FormData()
        fd.append('file', file); fd.append('kind', kind)
        if (title) fd.append('title', title)
        if (intent) fd.append('intentNote', intent)
        res = await fetch(`/api/office-actions/${props.caseId}/case-documents`, { method: 'POST', headers: authHeaders(), body: fd })
      } else {
        res = await fetch(`/api/office-actions/${props.caseId}/case-documents`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ kind, text, title: title || undefined, intentNote: intent || undefined })
        })
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not add the document')
      toast({
        title: 'Document added to the case file',
        description: data.warning || undefined,
        variant: data.warning ? 'warning' : 'success'
      })
      setText(''); setIntent(''); setTitle('')
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
          {docsError ? (
            <div className="text-sm text-destructive flex items-center gap-2">
              <span>{docsError}</span>
              <button type="button" className="underline hover:no-underline" onClick={() => void load()}>Retry</button>
            </div>
          ) : docs === null ? (
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
                    <IndexBadge status={d.indexStatus} />
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                      {d.newMatterSafe ? 'amendment basis' : 'argument / affidavit only'}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove this document"
                      title="Remove (wrong upload / superseded)"
                      onClick={() => void removeDoc(d.id)}
                    ><X className="w-4 h-4" /></button>
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
          {kind === 'SPECIFICATION' && (
            <p className="text-xs text-muted-foreground">
              Upload the full patent draft as filed — the complete specification. If it contains the claims
              (the usual Indian filing) they are detected and used automatically, so a separate claims upload is optional.
            </p>
          )}
          {kind === 'SUPPLEMENTARY' && (
            <>
              <Input value={title} onChange={e => setTitle(e.target.value)}
                placeholder="Title, e.g. “Annexure A — comparative data”" />
              <Textarea rows={2} value={intent} onChange={e => setIntent(e.target.value)}
                placeholder='How should this be used? e.g. "Comparative efficacy data — for the Section 3(d) objection."' />
            </>
          )}
          <Textarea rows={6} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the text…" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => submit()} disabled={saving || !text.trim()}>
              {saving ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Adding…</> : 'Add pasted text'}
            </Button>
            <input ref={fileRef} type="file" accept={ACCEPTED_UPLOAD_EXTENSIONS} className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) void submit(f); e.target.value = '' }} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={saving}>
              <Upload className="w-4 h-4 mr-1.5" aria-hidden /> Upload file
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ACCEPTED_UPLOAD_LABEL}, up to {MAX_OA_UPLOAD_LABEL}. Add as many supplementary documents as the reply needs — upload them one at a time.
          </p>
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

function PreviewModal(props: {
  preview: { lint: any; html: string }
  onClose: () => void
  onExport: (acknowledgeSignature?: string) => void | Promise<void>
  busy: boolean
  agent: { name?: string; regNo?: string }
  onSaveAgent: (agent: { name?: string; regNo?: string }) => Promise<any> | void
  onConfirmForm3: () => void
}) {
  const { lint, html } = props.preview
  const [agentName, setAgentName] = useState(props.agent?.name || '')
  const [agentRegNo, setAgentRegNo] = useState(props.agent?.regNo || '')
  const form3Blocked = (lint?.checks || []).some((c: any) => c.id === 'form3' && c.status === 'fail')
  const outstanding = (lint?.checks || []).filter((c: any) => c.status !== 'pass')
  const [acknowledged, setAcknowledged] = useState(false)
  /**
   * The signature-block save and the export must not overlap.
   *
   * Both used the shared toolbar `busy` flag, whose `finally` cleared it while
   * the export fetch was still running — so Export re-enabled mid-export and a
   * second click issued a duplicate export (a second REPLIED write and a second
   * download). Worse, clicking Save then Export immediately could send the
   * export before the agent PATCH committed, producing a DOCX with no signatory
   * block after the attorney had explicitly saved one.
   */
  const [savingAgent, setSavingAgent] = useState(false)
  const [exporting, setExporting] = useState(false)
  // A new set of findings is a new thing to read — an earlier tick cannot cover it.
  useEffect(() => { setAcknowledged(false) }, [lint?.signature])
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
                  {c.id === 'form3' && c.status === 'fail' && (
                    <button className="block text-xs text-primary underline underline-offset-2 mt-0.5" onClick={props.onConfirmForm3}>
                      Confirm: the updated Form 3 is filed / accompanies this reply
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2 mt-3">
            <div className="min-w-0">
              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5" htmlFor="oa-agent-name">Signatory (agent) name</label>
              <input id="oa-agent-name" className="h-8 w-56 rounded-md border border-input bg-background px-2 text-sm"
                placeholder="e.g. A. Sharma" value={agentName} onChange={e => setAgentName(e.target.value)} />
            </div>
            <div className="min-w-0">
              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-0.5" htmlFor="oa-agent-reg">Agent reg. no.</label>
              <input id="oa-agent-reg" className="h-8 w-36 rounded-md border border-input bg-background px-2 text-sm"
                placeholder="IN/PA-…" value={agentRegNo} onChange={e => setAgentRegNo(e.target.value)} />
            </div>
            <Button size="sm" variant="outline" disabled={savingAgent || props.busy}
              onClick={async () => {
                setSavingAgent(true)
                try { await props.onSaveAgent({ name: agentName, regNo: agentRegNo }) }
                finally { setSavingAgent(false) }
              }}>
              {savingAgent ? 'Saving…' : 'Save signature block'}
            </Button>
            {form3Blocked && <span className="text-xs text-muted-foreground">Re-run Preview after resolving checks.</span>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 bg-muted/30">
          {html
            ? <div dangerouslySetInnerHTML={{ __html: html }} />
            : <p className="text-sm text-muted-foreground">Run Preview to see the reply document.</p>}
        </div>
        <div className="px-5 py-3.5 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose}>Close</Button>
          {outstanding.length > 0 && (
            <label className="flex items-start gap-2 text-sm mr-auto max-w-xl cursor-pointer">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)} />
              <span>
                I have read the {outstanding.length} item{outstanding.length === 1 ? '' : 's'} above and will deal with
                {outstanding.length === 1 ? ' it' : ' them'}.
                <span className="text-muted-foreground"> Some are resolved outside this system; exporting records that you reviewed them.</span>
              </span>
            </label>
          )}
          <Button
            onClick={async () => {
              if (exporting) return
              setExporting(true)
              try { await props.onExport(outstanding.length ? lint?.signature : undefined) }
              finally { setExporting(false) }
            }}
            disabled={props.busy || exporting || savingAgent || (outstanding.length > 0 && !acknowledged)}>
            {props.busy || exporting
              ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden /> Exporting…</>
              : <><Download className="w-4 h-4 mr-1.5" aria-hidden /> Export DOCX</>}
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
