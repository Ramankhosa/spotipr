'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { repairCountryProfile, RepairResult } from '@/lib/country-profile-repair'
import { ImportPlan, CountryReadiness, authHeaders } from './import-types'
import { ImportDiffView } from './ImportDiffView'
import { ReadinessChecklist } from './ReadinessChecklist'

type WizardStep = 'source' | 'preview' | 'import' | 'readiness' | 'activate'

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'source', label: '1. Profile JSON' },
  { id: 'preview', label: '2. Preview changes' },
  { id: 'import', label: '3. Import' },
  { id: 'readiness', label: '4. Readiness' },
  { id: 'activate', label: '5. Activate' }
]

interface ImportWizardProps {
  onFinished: () => void
}

export function ImportWizard({ onFinished }: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('source')
  const [profileData, setProfileData] = useState<any>(null)
  const [jsonText, setJsonText] = useState('')
  const [sourceTab, setSourceTab] = useState<'file' | 'text'>('file')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null)
  const [clientValid, setClientValid] = useState(false)
  const [clientErrors, setClientErrors] = useState<string[]>([])
  const [clientWarnings, setClientWarnings] = useState<string[]>([])
  const [parseError, setParseError] = useState<string | null>(null)

  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [serverWarnings, setServerWarnings] = useState<string[]>([])
  const [readiness, setReadiness] = useState<CountryReadiness | null>(null)
  const [importSummary, setImportSummary] = useState<Record<string, number> | null>(null)

  const [resetAdminState, setResetAdminState] = useState(false)
  const [disableExtras, setDisableExtras] = useState(false)

  const [busy, setBusy] = useState(false)
  const [stepError, setStepError] = useState<string | null>(null)
  const [activated, setActivated] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
    }
  }, [])

  const processParsedProfile = useCallback(async (parsed: any) => {
    setParseError(null)
    const repair = await repairCountryProfile(parsed)
    setRepairResult(repair)
    const repaired = repair.success && repair.repairedProfile ? repair.repairedProfile : parsed
    setProfileData(repaired)
    setClientValid(Boolean(repair.validationResult?.valid))
    setClientErrors(repair.validationResult?.errors || [])
    setClientWarnings(repair.validationResult?.warnings || [])
  }, [])

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setParseError('Please select a valid JSON file')
      return
    }
    setUploadedFile(file)
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string)
        setJsonText(JSON.stringify(parsed, null, 2))
        await processParsedProfile(parsed)
      } catch (error) {
        setParseError('Invalid JSON file: ' + (error instanceof Error ? error.message : 'Unknown error'))
        setProfileData(null)
        setClientValid(false)
      }
    }
    reader.readAsText(file)
  }

  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = event.target.value
    setJsonText(text)
    if (textDebounceRef.current) clearTimeout(textDebounceRef.current)
    textDebounceRef.current = setTimeout(async () => {
      if (!text.trim()) {
        setParseError(null)
        setProfileData(null)
        setClientValid(false)
        setRepairResult(null)
        return
      }
      try {
        const parsed = JSON.parse(text)
        await processParsedProfile(parsed)
      } catch (error) {
        setParseError('Invalid JSON: ' + (error instanceof Error ? error.message : 'Unknown error'))
        setProfileData(null)
        setClientValid(false)
      }
    }, 500)
  }

  const runPreview = useCallback(async () => {
    if (!profileData) return
    setBusy(true)
    setStepError(null)
    try {
      const response = await fetch('/api/super-admin/countries/import', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'preview',
          profileData,
          options: { resetAdminState, disableExtras }
        })
      })
      const result = await response.json()
      if (!response.ok) {
        setStepError(
          result.errors?.length
            ? `Validation failed: ${result.errors.slice(0, 5).join('; ')}`
            : result.error || 'Preview failed'
        )
        setPlan(null)
        return
      }
      setPlan(result.plan)
      setServerWarnings(result.warnings || [])
      setStep('preview')
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setBusy(false)
    }
  }, [profileData, resetAdminState, disableExtras])

  const runImport = async () => {
    if (!profileData) return
    setBusy(true)
    setStepError(null)
    try {
      const response = await fetch('/api/super-admin/countries/import', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          action: 'apply',
          profileData,
          options: { resetAdminState, disableExtras }
        })
      })
      const result = await response.json()
      if (!response.ok) {
        if (result.plan) setPlan(result.plan)
        setStepError(result.error || 'Import failed')
        return
      }
      setPlan(result.plan)
      setImportSummary(result.summary || null)
      setReadiness(result.readiness || null)
      setStep('readiness')
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const refreshReadiness = async () => {
    if (!plan) return
    setBusy(true)
    try {
      const response = await fetch(`/api/super-admin/countries/readiness?countryCode=${plan.countryCode}`, {
        headers: authHeaders()
      })
      const result = await response.json()
      if (response.ok) setReadiness(result.readiness)
    } finally {
      setBusy(false)
    }
  }

  const runActivate = async (force = false) => {
    if (!plan) return
    setBusy(true)
    setStepError(null)
    try {
      const response = await fetch('/api/super-admin/countries', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ countryCode: plan.countryCode, status: 'ACTIVE', ...(force ? { force: true } : {}) })
      })
      const result = await response.json()
      if (response.status === 409 && result.readiness) {
        setReadiness(result.readiness)
        setStepError('Activation blocked by readiness failures — fix the blockers below, or force-activate.')
        return
      }
      if (!response.ok) {
        setStepError(result.error || 'Activation failed')
        return
      }
      setActivated(true)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Activation failed')
    } finally {
      setBusy(false)
    }
  }

  const hasBlockingIssues = Boolean(plan?.issues.some(i => i.severity === 'error'))
  const stepIndex = STEPS.findIndex(s => s.id === step)

  return (
    <div className="p-6">
      {/* Stepper header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold mb-1">Import Country Profile</h2>
        <p className="text-gray-600 text-sm mb-4">
          Upload a country_profile.json — the importer provisions the profile, section mappings,
          top-up prompts, and style configuration in one step, then walks you through activation.
        </p>
        <div className="flex items-center space-x-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                i < stepIndex ? 'bg-green-100 text-green-800'
                : i === stepIndex ? 'bg-lamp-600 text-white'
                : 'bg-gray-100 text-gray-500'
              }`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="mx-1 text-gray-300">→</span>}
            </div>
          ))}
        </div>
      </div>

      {stepError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">
          {stepError}
        </div>
      )}

      {/* Step 1: Source */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-6">
              {(['file', 'text'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSourceTab(tab)}
                  className={`py-2 px-1 border-b-2 font-medium text-sm ${
                    sourceTab === tab
                      ? 'border-lamp-500 text-lamp-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab === 'file' ? 'Upload File' : 'Paste JSON'}
                </button>
              ))}
            </nav>
          </div>

          {sourceTab === 'file' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-lamp-50 file:text-lamp-700 hover:file:bg-lamp-100"
              />
              {uploadedFile && (
                <p className="mt-2 text-sm text-gray-600">
                  Selected: {uploadedFile.name} ({(uploadedFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          )}

          {sourceTab === 'text' && (
            <textarea
              value={jsonText}
              onChange={handleTextChange}
              placeholder="Paste your country profile JSON here..."
              className="w-full h-80 px-3 py-2 border border-gray-300 rounded-md font-mono text-sm"
              spellCheck={false}
            />
          )}

          {parseError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{parseError}</div>
          )}

          {repairResult && repairResult.repairs.length > 0 && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md">
              <div className="text-sm font-medium text-green-800 mb-1">
                {repairResult.repairs.length} auto-repairs applied
              </div>
              <div className="flex flex-wrap gap-1">
                {repairResult.repairs.slice(0, 12).map((r, i) => (
                  <span key={i} className="inline-flex px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs">
                    {r.field}
                  </span>
                ))}
                {repairResult.repairs.length > 12 && (
                  <span className="text-xs text-green-700">+{repairResult.repairs.length - 12} more</span>
                )}
              </div>
            </div>
          )}

          {clientErrors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="text-sm font-medium text-red-800 mb-1">Errors ({clientErrors.length})</div>
              <ul className="list-disc list-inside text-sm text-red-700 space-y-0.5">
                {clientErrors.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}
          {clientWarnings.length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <div className="text-sm font-medium text-yellow-800 mb-1">Warnings ({clientWarnings.length})</div>
              <ul className="list-disc list-inside text-sm text-yellow-700 space-y-0.5">
                {clientWarnings.slice(0, 8).map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {clientValid && profileData && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-800">
              Valid profile: {profileData.meta?.name} ({profileData.meta?.code})
            </div>
          )}

          <details className="text-sm">
            <summary className="cursor-pointer text-gray-600 font-medium">Advanced options</summary>
            <div className="mt-2 space-y-2 pl-1">
              <label className="flex items-center space-x-2">
                <input type="checkbox" checked={resetAdminState} onChange={e => setResetAdminState(e.target.checked)} />
                <span>Reset admin tuning (overwrite enable/disable toggles and context overrides)</span>
              </label>
              <label className="flex items-center space-x-2">
                <input type="checkbox" checked={disableExtras} onChange={e => setDisableExtras(e.target.checked)} />
                <span>Disable existing sections that are not in this JSON</span>
              </label>
            </div>
          </details>

          <div className="flex justify-end">
            <button
              onClick={runPreview}
              disabled={!clientValid || busy}
              className="px-6 py-2 bg-lamp-600 text-white rounded-md hover:bg-lamp-700 disabled:opacity-50"
            >
              {busy ? 'Analyzing…' : 'Preview changes →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && plan && (
        <div className="space-y-4">
          {serverWarnings.length > 0 && (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
              {serverWarnings.length} schema warnings (non-blocking)
            </div>
          )}
          <ImportDiffView plan={plan} onIssueResolved={runPreview} />
          <div className="flex justify-between">
            <button onClick={() => setStep('source')} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              ← Back
            </button>
            <button
              onClick={runImport}
              disabled={busy || hasBlockingIssues}
              className="px-6 py-2 bg-lamp-600 text-white rounded-md hover:bg-lamp-700 disabled:opacity-50"
              title={hasBlockingIssues ? 'Resolve the blocking issues first' : undefined}
            >
              {busy ? 'Importing…' : hasBlockingIssues ? 'Blocked by errors' : 'Import everything →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 3/4: Readiness after import */}
      {step === 'readiness' && (
        <div className="space-y-4">
          {importSummary && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-md">
              <div className="text-sm font-medium text-green-800 mb-1">Import complete</div>
              <div className="text-sm text-green-700">
                {importSummary.mappingsCreated} mappings created, {importSummary.mappingsUpdated} updated ·{' '}
                {importSummary.promptsCreated} prompts created, {importSummary.promptsUpdated} updated ·{' '}
                {importSummary.exportConfigs} export configs · {importSummary.sectionValidations} validation rules ·{' '}
                {importSummary.crossValidations} cross-checks
              </div>
            </div>
          )}
          {readiness && <ReadinessChecklist readiness={readiness} />}
          <div className="flex justify-between">
            <button onClick={refreshReadiness} disabled={busy} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              {busy ? 'Checking…' : 'Re-check readiness'}
            </button>
            <div className="space-x-3">
              <button onClick={onFinished} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                Keep as draft
              </button>
              <button
                onClick={() => setStep('activate')}
                disabled={busy}
                className="px-6 py-2 bg-lamp-600 text-white rounded-md hover:bg-lamp-700 disabled:opacity-50"
              >
                Continue to activation →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Activate */}
      {step === 'activate' && plan && (
        <div className="space-y-4">
          {activated ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-md">
              <div className="text-lg font-medium text-green-800 mb-1">
                {plan.countryName.name} ({plan.countryCode}) is live 🎉
              </div>
              <div className="text-sm text-green-700">
                The country now appears in the drafting country selector for all users.
              </div>
              <button
                onClick={onFinished}
                className="mt-3 px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="p-4 bg-lamp-50 border border-lamp-200 rounded-md text-sm text-lamp-800">
                Activating makes <strong>{plan.countryName.name} ({plan.countryCode})</strong> available to all
                users in the drafting country selector. Readiness is re-checked server-side.
              </div>
              {readiness && !readiness.ready && (
                <>
                  <ReadinessChecklist readiness={readiness} />
                  <label className="flex items-center space-x-2 text-sm text-red-700">
                    <input type="checkbox" id="force-activate" onChange={() => setStepError(null)} />
                    <span>I understand the blockers above and want to force-activate anyway</span>
                  </label>
                </>
              )}
              <div className="flex justify-between">
                <button onClick={() => setStep('readiness')} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                  ← Back
                </button>
                <button
                  onClick={() => {
                    const forceBox = document.getElementById('force-activate') as HTMLInputElement | null
                    runActivate(Boolean(forceBox?.checked))
                  }}
                  disabled={busy}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                >
                  {busy ? 'Activating…' : `Activate ${plan.countryCode}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
