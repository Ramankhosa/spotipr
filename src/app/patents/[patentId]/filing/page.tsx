'use client'

/**
 * Patent — Filing tab.
 *
 * Where an attorney turns a drafted patent into a filing-ready bundle. Almost everything on
 * this page arrives pre-resolved: the applicant and signatory come from the project, the
 * house style from the firm, and the declarations derive themselves from the application
 * type. What is left is the genuinely patent-specific work — who invented it, how many
 * pages — plus the option to override anything inherited.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { ArrowLeft, Check, Download, FileText, Loader2, Settings2, Users } from 'lucide-react'
import InventorCapture, {
  toInventorForm,
  toInventorPayload,
  type InventorForm,
} from '@/components/filing/InventorCapture'
import IncompleteFilingDialog from '@/components/filing/IncompleteFilingDialog'
import {
  DeclarationMatrix,
  Field,
  FilingStyleControls,
  IssueList,
  Section,
  inputClass,
  type DeclarationState,
  type FilingIssue,
  type ResolvedFilingSettings,
  type SettingSource,
} from '@/components/filing/filing-ui'

interface FilingDetailsForm {
  applicationType: 'ordinary' | 'convention' | 'pct_np'
  specType: 'provisional' | 'complete'
  isDivisional: boolean
  isPatentOfAddition: boolean
  officeBranch: string
  applicantRefNo: string
  specPages: number
  claimsCount: number
  claimsPages: number
  abstractPages: number
  drawingsCount: number
  drawingsPages: number
  feeAmount: number | null
  feeMode: string
  applicationNo: string
  parentApplicationNo: string
}

interface DeclarationRowData {
  key: string
  text: string
  state: DeclarationState
  source: SettingSource
  conflict?: string
}

export default function PatentFilingPage() {
  const params = useParams()
  const router = useRouter()
  const patentId = String(params?.patentId || '')
  const { token } = useAuth()
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [applicantAddress, setApplicantAddress] = useState<Partial<InventorForm> | null>(null)
  const [applicantName, setApplicantName] = useState('')
  const [signatory, setSignatory] = useState<{ name: string; designation: string } | null>(null)
  const [inventors, setInventors] = useState<InventorForm[]>([])
  const [directory, setDirectory] = useState<InventorForm[]>([])
  const [details, setDetails] = useState<FilingDetailsForm | null>(null)
  const [settings, setSettings] = useState<ResolvedFilingSettings | null>(null)
  const [provenance, setProvenance] = useState<Record<string, SettingSource>>({})
  const [declarations, setDeclarations] = useState<DeclarationRowData[]>([])
  const [clauseLabels, setClauseLabels] = useState<Record<string, string>>({})
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({})
  const [issues, setIssues] = useState<FilingIssue[]>([])
  const [showStyle, setShowStyle] = useState(false)
  // Confirmation before downloading a bundle that will print blanks.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmIssues, setConfirmIssues] = useState<FilingIssue[]>([])

  const canGenerate = useMemo(() => !issues.some(i => i.severity === 'blocking'), [issues])

  const load = useCallback(async () => {
    if (!token || !patentId) return
    setLoading(true)
    try {
      const [filingRes, inventorsRes] = await Promise.all([
        fetch(`/api/patents/${patentId}/filing`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/patents/${patentId}/filing/inventors`, { headers: { Authorization: `Bearer ${token}` } }),
      ])

      const filing = await filingRes.json()
      if (!filingRes.ok) throw new Error(filing.error || 'Failed to load filing details')

      setTitle(filing.title || '')
      setApplicantName(filing.applicant?.legalName || '')
      setApplicantAddress(filing.applicant?.address || null)
      setSignatory(filing.signatory || null)
      setSettings(filing.settings)
      setProvenance(filing.provenance || {})
      setDeclarations(filing.declarations || [])
      setClauseLabels(Object.fromEntries((filing.clauseLabels || []).map((c: { key: string; label: string }) => [c.key, c.label])))
      setGroupLabels(filing.groupLabels || {})
      setIssues(filing.issues || [])
      setDetails({
        applicationType: filing.details.applicationType,
        specType: filing.details.specType,
        isDivisional: filing.details.isDivisional,
        isPatentOfAddition: filing.details.isPatentOfAddition,
        officeBranch: filing.details.officeBranch,
        applicantRefNo: filing.details.applicantRefNo || '',
        specPages: filing.details.specPages,
        claimsCount: filing.details.claimsCount,
        claimsPages: filing.details.claimsPages,
        abstractPages: filing.details.abstractPages,
        drawingsCount: filing.details.drawingsCount,
        drawingsPages: filing.details.drawingsPages,
        feeAmount: filing.details.feeAmount,
        feeMode: filing.details.feeMode,
        applicationNo: filing.details.applicationNo || '',
        parentApplicationNo: filing.details.parentApplicationNo || '',
      })

      if (inventorsRes.ok) {
        const inv = await inventorsRes.json()
        setInventors((inv.inventors || []).map(toInventorForm))
        setDirectory((inv.directory || []).map(toInventorForm))
      }
    } catch (err) {
      toast({ title: 'Could not load the filing', description: String(err), variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [token, patentId, toast])

  useEffect(() => { load() }, [load])

  // Fetch the project id so "save as project default" knows where to write.
  useEffect(() => {
    if (!token || !patentId) return
    fetch(`/api/patents/${patentId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.patent?.projectId) setProjectId(d.patent.projectId) })
      .catch(() => {})
  }, [token, patentId])

  const saveAll = useCallback(async (silent = false) => {
    if (!token || !details || !settings) return false
    setSaving(true)
    try {
      const invRes = await fetch(`/api/patents/${patentId}/filing/inventors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ inventors: toInventorPayload(inventors) }),
      })
      if (!invRes.ok) throw new Error((await invRes.json()).error || 'Could not save inventors')

      // Only the clauses the attorney actually changed go into the patent-layer patch;
      // anything still tracing to rules/firm/project stays absent so it keeps inheriting.
      const overriddenClauses = Object.fromEntries(
        declarations.filter(d => d.source === 'patent').map(d => [d.key, d.state])
      )

      const detailRes = await fetch(`/api/patents/${patentId}/filing`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          applicationType: details.applicationType,
          specType: details.specType,
          isDivisional: details.isDivisional,
          isPatentOfAddition: details.isPatentOfAddition,
          officeBranch: details.officeBranch,
          applicantRefNo: details.applicantRefNo || null,
          specPages: details.specPages,
          claimsCount: details.claimsCount,
          claimsPages: details.claimsPages,
          abstractPages: details.abstractPages,
          drawingsCount: details.drawingsCount,
          drawingsPages: details.drawingsPages,
          feeAmount: details.feeAmount,
          feeMode: details.feeMode,
          applicationNo: details.applicationNo || null,
          parentApplicationNo: details.parentApplicationNo || null,
          filingSettings: Object.keys(overriddenClauses).length ? { declarations: overriddenClauses } : null,
        }),
      })
      const detailData = await detailRes.json()
      if (!detailRes.ok) throw new Error(detailData.error || 'Could not save filing details')

      setIssues(detailData.issues || [])
      setDeclarations(detailData.declarations || [])
      setProvenance(detailData.provenance || {})
      if (!silent) toast({ title: 'Filing saved', variant: 'success' })
      return true
    } catch (err) {
      toast({ title: 'Could not save', description: String(err), variant: 'error' })
      return false
    } finally {
      setSaving(false)
    }
  }, [token, patentId, details, settings, inventors, declarations, toast])

  /**
   * Saving first re-runs validation server-side, so the warning reflects what will actually
   * print rather than whatever the page last loaded. If anything would come out blank the
   * attorney confirms before the download starts.
   */
  const requestDownload = useCallback(async () => {
    if (!token) return
    const saved = await saveAll(true)
    if (!saved) return

    // saveAll refreshed `issues`; read the latest rather than the closure's copy.
    const latest = await fetch(`/api/patents/${patentId}/filing`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => (r.ok ? r.json() : null)).catch(() => null)

    const pending: FilingIssue[] = latest?.issues ?? issues
    setIssues(pending)

    if (pending.some(i => i.severity === 'blocking')) {
      setConfirmIssues(pending)
      setConfirmOpen(true)
      return
    }
    await runDownload()
  }, [token, patentId, saveAll, issues]) // eslint-disable-line react-hooks/exhaustive-deps

  const runDownload = useCallback(async () => {
    if (!token) return
    setDownloading(true)
    try {
      const res = await fetch(`/api/patents/${patentId}/filing/bundle`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Download failed')

      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = match?.[1] || 'filing-bundle.zip'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)

      const included = res.headers.get('X-Filing-Documents') || ''
      // Every form is always in the bundle; blanks are flagged so the attorney knows what
      // to write in before filing.
      const blanks = issues.filter(i => i.severity === 'blocking').length
      toast({
        title: 'Filing bundle downloaded',
        description: blanks
          ? `${included.split(',').filter(Boolean).join('  ·  ')} — ${blanks} detail${blanks === 1 ? '' : 's'} left blank for you to complete. See the READ ME in the zip.`
          : included.split(',').filter(Boolean).join('  ·  '),
        variant: blanks ? 'warning' : 'success',
        duration: blanks ? 10000 : 5000,
      })
    } catch (err) {
      toast({ title: 'Could not generate the bundle', description: String(err), variant: 'error' })
    } finally {
      setDownloading(false)
      setConfirmOpen(false)
    }
  }, [token, patentId, toast, issues])

  const saveAsProjectDefault = useCallback(async () => {
    if (!token || !projectId || !settings) return
    try {
      const res = await fetch(`/api/projects/${projectId}/filing-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      toast({
        title: 'Saved as the project default',
        description: 'Other patents in this project will inherit these settings.',
        variant: 'success',
      })
      await load()
    } catch (err) {
      toast({ title: 'Could not save the project default', description: String(err), variant: 'error' })
    }
  }, [token, projectId, settings, load, toast])

  if (loading || !details || !settings) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="mt-8 space-y-6">
            {[0, 1, 2].map(i => <div key={i} className="h-56 animate-pulse rounded-xl bg-white dark:bg-gray-800" />)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6 lg:px-8">
        <button
          onClick={() => router.push(`/patents/${patentId}/draft`)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 transition hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back to draft
        </button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Filing</h1>
            <p className="mt-1 truncate text-sm text-gray-500 dark:text-gray-400" title={title}>{title}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => saveAll()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
            </button>
            <button
              onClick={requestDownload}
              disabled={downloading}
              title={canGenerate
                ? undefined
                : 'Downloads now — anything still missing is left blank for you to complete by hand'}
              className="inline-flex items-center gap-2 rounded-lg bg-lamp-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-lamp-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {downloading
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
                : <><Download className="h-4 w-4" /> Download filing bundle</>}
            </button>
          </div>
        </div>

        {/* Applicant + signatory summary — inherited from the project, edited there. */}
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-400">Applicant</span>
              <p className="truncate font-medium text-gray-900 dark:text-white">{applicantName || '—'}</p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {signatory
                  ? <>Signed by <span className="font-medium text-gray-700 dark:text-gray-300">{signatory.name}</span>, {signatory.designation}</>
                  : <span className="text-red-600 dark:text-red-400">No authorised signatory set</span>}
              </p>
            </div>
            {projectId && (
              <button
                onClick={() => router.push(`/projects/${projectId}/applicant`)}
                className="shrink-0 text-xs font-medium text-lamp-600 hover:text-lamp-700"
              >
                Edit applicant &amp; signatory →
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {/* Inventors */}
          <Section
            icon={<Users className="h-4 w-4" />}
            title="Inventors"
            subtitle="Specific to this patent. They appear on Form 1 paragraph 4, sign paragraph 12(i), and are declared on Form 5."
          >
            <InventorCapture
              patentId={patentId}
              value={inventors}
              onChange={setInventors}
              directory={directory}
              applicantAddress={applicantAddress}
              applicantName={applicantName}
            />
          </Section>

          {/* Filing details */}
          <Section icon={<FileText className="h-4 w-4" />} title="Filing details" subtitle="Drives the tick boxes on Form 1 and the attachment table in paragraph 13.">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Application type" className="sm:col-span-2">
                <select value={details.applicationType} onChange={e => setDetails({ ...details, applicationType: e.target.value as FilingDetailsForm['applicationType'] })} className={inputClass}>
                  <option value="ordinary">Ordinary</option>
                  <option value="convention">Convention</option>
                  <option value="pct_np">PCT national phase</option>
                </select>
              </Field>
              <Field label="Specification" className="sm:col-span-2">
                <select value={details.specType} onChange={e => setDetails({ ...details, specType: e.target.value as FilingDetailsForm['specType'] })} className={inputClass}>
                  <option value="provisional">Provisional</option>
                  <option value="complete">Complete</option>
                </select>
              </Field>
              <Field label="Patent Office" className="sm:col-span-2">
                <input value={details.officeBranch} onChange={e => setDetails({ ...details, officeBranch: e.target.value })} className={inputClass} />
              </Field>
              <Field label="Your reference" hint="Optional" className="sm:col-span-2">
                <input value={details.applicantRefNo} onChange={e => setDetails({ ...details, applicantRefNo: e.target.value })} placeholder="Names the downloaded files" className={inputClass} />
              </Field>

              <div className="sm:col-span-4 mt-2 grid gap-3 sm:grid-cols-6">
                <NumField label="Spec pages" value={details.specPages} onChange={v => setDetails({ ...details, specPages: v })} />
                <NumField label="Claims" value={details.claimsCount} onChange={v => setDetails({ ...details, claimsCount: v })} />
                <NumField label="Claim pages" value={details.claimsPages} onChange={v => setDetails({ ...details, claimsPages: v })} />
                <NumField label="Abstract pages" value={details.abstractPages} onChange={v => setDetails({ ...details, abstractPages: v })} />
                <NumField label="Drawings" value={details.drawingsCount} onChange={v => setDetails({ ...details, drawingsCount: v })} />
                <NumField label="Drawing pages" value={details.drawingsPages} onChange={v => setDetails({ ...details, drawingsPages: v })} />
              </div>

              <Field label="Fee (₹)" hint="Suggested from the applicant category" className="sm:col-span-2">
                <input
                  type="number"
                  value={details.feeAmount ?? ''}
                  onChange={e => setDetails({ ...details, feeAmount: e.target.value === '' ? null : Number(e.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="Application no." hint="After filing" className="sm:col-span-2">
                <input
                  value={details.applicationNo}
                  onChange={e => setDetails({ ...details, applicationNo: e.target.value })}
                  placeholder="Blank until the Office allots one"
                  className={inputClass}
                />
              </Field>

              {(details.applicationType !== 'ordinary' || details.isDivisional || details.isPatentOfAddition) && (
                <Field label="Parent / priority application no." className="sm:col-span-4">
                  <input value={details.parentApplicationNo} onChange={e => setDetails({ ...details, parentApplicationNo: e.target.value })} className={inputClass} />
                </Field>
              )}

              <div className="sm:col-span-4 flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={details.isDivisional} onChange={e => setDetails({ ...details, isDivisional: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-lamp-600 focus:ring-lamp-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Divisional application</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={details.isPatentOfAddition} onChange={e => setDetails({ ...details, isPatentOfAddition: e.target.checked })} className="h-4 w-4 rounded border-gray-300 text-lamp-600 focus:ring-lamp-500" />
                  <span className="text-sm text-gray-700 dark:text-gray-300">Patent of addition</span>
                </label>
              </div>
            </div>
          </Section>

          {/* Declarations */}
          <Section
            icon={<Check className="h-4 w-4" />}
            title="Declarations"
            subtitle="Most of these follow from the application type above. Change one only when your filing genuinely differs. ☑ keeps a clause, ☒ marks it inapplicable, S̶ strikes the whole block out."
          >
            <DeclarationMatrix
              rows={declarations}
              labels={clauseLabels}
              groupLabels={groupLabels}
              onChange={(key, state) => setDeclarations(prev => prev.map(row =>
                row.key === key ? { ...row, state, source: 'patent' } : row
              ))}
            />
          </Section>

          {/* House style override */}
          <Section
            icon={<Settings2 className="h-4 w-4" />}
            title="House style"
            subtitle="Inherited from your firm and project. Override it here only for this filing."
            actions={
              <button onClick={() => setShowStyle(v => !v)} className="shrink-0 text-xs font-medium text-lamp-600 hover:text-lamp-700">
                {showStyle ? 'Hide' : 'Show'}
              </button>
            }
          >
            {showStyle ? (
              <>
                <FilingStyleControls
                  settings={settings}
                  sources={provenance}
                  onChange={patch => setSettings({ ...settings, ...patch })}
                />
                {projectId && (
                  <button
                    onClick={saveAsProjectDefault}
                    className="mt-4 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200"
                  >
                    Save as the project default
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Using your firm&apos;s settings. Nothing to do unless this filing is an exception.
              </p>
            )}
          </Section>

          {/* Readiness */}
          <Section icon={<Check className="h-4 w-4" />} title="Before you file">
            <IssueList issues={issues} />
          </Section>
        </div>
      </div>

      <IncompleteFilingDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        issues={confirmIssues}
        busy={downloading}
        confirmLabel="Download bundle anyway"
        onConfirm={runDownload}
      />
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">{label}</label>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(Math.max(0, Number(e.target.value) || 0))}
        className={inputClass}
      />
    </div>
  )
}
