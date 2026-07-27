'use client'

import { useState } from 'react'
import { ImportPlan, ImportIssue, authHeaders } from './import-types'

interface ImportDiffViewProps {
  plan: ImportPlan
  /** Called after an issue was resolved (e.g. alias added) so the parent can re-run preview */
  onIssueResolved?: () => void
}

function OpBadge({ op }: { op: string }) {
  const styles: Record<string, string> = {
    create: 'bg-green-100 text-green-800',
    update: 'bg-lamp-100 text-lamp-800',
    unchanged: 'bg-gray-100 text-gray-600',
    extra: 'bg-yellow-100 text-yellow-800',
    skip: 'bg-gray-100 text-gray-600'
  }
  return (
    <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${styles[op] || styles.unchanged}`}>
      {op}
    </span>
  )
}

function SummaryPill({ label, count, tone }: { label: string; count: number; tone: 'green' | 'blue' | 'gray' | 'yellow' }) {
  const tones = {
    green: 'bg-green-50 text-green-700 border-green-200',
    blue: 'bg-lamp-50 text-lamp-700 border-lamp-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
    yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200'
  }
  return (
    <div className={`px-3 py-2 border rounded-md text-center ${tones[tone]}`}>
      <div className="text-lg font-bold">{count}</div>
      <div className="text-xs">{label}</div>
    </div>
  )
}

function IssueRow({ issue, onResolved }: { issue: ImportIssue; onResolved?: () => void }) {
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [aliasTarget, setAliasTarget] = useState(issue.suggestion || '')

  const canAddAlias =
    (issue.code === 'UNRESOLVED_SECTION' || issue.code === 'UNRESOLVED_PROMPT_KEY' || issue.code === 'UNRESOLVED_VALIDATION_KEY') &&
    Boolean(issue.sectionId)

  const handleAddAlias = async () => {
    if (!aliasTarget || !issue.sectionId) return
    setResolving(true)
    setResolveError(null)
    try {
      const aliasKey = issue.candidates?.[0] || issue.sectionId
      const response = await fetch('/api/super-admin/superset-sections', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action: 'add_alias', sectionKey: aliasTarget, alias: aliasKey })
      })
      const result = await response.json()
      if (!response.ok) {
        setResolveError(result.error || 'Failed to add alias')
      } else {
        onResolved?.()
      }
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : 'Failed to add alias')
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className={`p-3 border rounded-md ${issue.severity === 'error' ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
      <div className="flex items-start">
        <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full mr-2 ${
          issue.severity === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
        }`}>
          {issue.severity}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-900">{issue.message}</div>
          {canAddAlias && (
            <div className="mt-2 flex items-center space-x-2">
              <span className="text-xs text-gray-600">Map &quot;{issue.candidates?.[0] || issue.sectionId}&quot; as alias of:</span>
              <input
                value={aliasTarget}
                onChange={e => setAliasTarget(e.target.value)}
                placeholder="superset sectionKey"
                className="px-2 py-1 border border-gray-300 rounded text-xs font-mono w-48"
              />
              <button
                onClick={handleAddAlias}
                disabled={resolving || !aliasTarget}
                className="px-2 py-1 bg-lamp-600 text-white rounded text-xs hover:bg-lamp-700 disabled:opacity-50"
              >
                {resolving ? 'Adding…' : 'Add alias & re-check'}
              </button>
            </div>
          )}
          {resolveError && <div className="mt-1 text-xs text-red-700">{resolveError}</div>}
        </div>
      </div>
    </div>
  )
}

export function ImportDiffView({ plan, onIssueResolved }: ImportDiffViewProps) {
  const [showUnchanged, setShowUnchanged] = useState(false)
  const errors = plan.issues.filter(i => i.severity === 'error')
  const warnings = plan.issues.filter(i => i.severity === 'warning')

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <div>
        <h3 className="text-lg font-medium mb-3">
          Import plan for {plan.countryName.name} ({plan.countryCode})
          <span className="ml-3 text-sm font-normal text-gray-500">
            Profile: <OpBadge op={plan.profile.op} />
            {plan.profile.op !== 'create' && ` v${plan.profile.fromVersion} → v${plan.profile.toVersion}`}
          </span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryPill label="Sections to create" count={plan.mappings.create.length} tone="green" />
          <SummaryPill label="Sections to update" count={plan.mappings.update.length} tone="blue" />
          <SummaryPill label="Prompts create/update" count={plan.prompts.create.length + plan.prompts.update.length} tone="green" />
          <SummaryPill
            label="Style rows"
            count={
              (plan.styles.diagramConfig !== 'skip' ? 1 : 0) +
              plan.styles.exportConfigs.length +
              plan.styles.sectionValidations.length +
              plan.styles.crossValidations.length
            }
            tone="blue"
          />
        </div>
      </div>

      {/* Issues */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Issues ({errors.length} blocking, {warnings.length} warnings)
          </h4>
          <div className="space-y-2">
            {[...errors, ...warnings].map((issue, i) => (
              <IssueRow key={`${issue.code}-${issue.sectionId || i}`} issue={issue} onResolved={onIssueResolved} />
            ))}
          </div>
        </div>
      )}

      {/* Section mappings */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Section mappings</h4>
        <div className="border rounded-md overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Op</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Order</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Superset key</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Heading</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Required</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {plan.mappings.create.map(m => (
                <tr key={`c-${m.sectionKey}`} className="bg-green-50/50">
                  <td className="px-4 py-2"><OpBadge op="create" /></td>
                  <td className="px-4 py-2">{m.displayOrder}</td>
                  <td className="px-4 py-2 font-mono text-xs">{m.sectionKey}</td>
                  <td className="px-4 py-2">{m.heading}</td>
                  <td className="px-4 py-2">{m.isRequired ? 'Yes' : 'No'}</td>
                </tr>
              ))}
              {plan.mappings.update.map(u => (
                <tr key={`u-${u.sectionKey}`} className="bg-lamp-50/50">
                  <td className="px-4 py-2"><OpBadge op="update" /></td>
                  <td className="px-4 py-2" colSpan={2}>
                    <span className="font-mono text-xs">{u.sectionKey}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-600" colSpan={2}>
                    {Object.keys(u.after).map(field => (
                      <div key={field}>
                        <span className="font-medium">{field}:</span>{' '}
                        <span className="line-through text-gray-400">{String(u.before[field])}</span>{' '}
                        → <span className="text-lamp-700">{String(u.after[field])}</span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
              {plan.mappings.extra.map(key => (
                <tr key={`e-${key}`} className="bg-yellow-50/50">
                  <td className="px-4 py-2"><OpBadge op="extra" /></td>
                  <td className="px-4 py-2 text-xs text-gray-600" colSpan={4}>
                    <span className="font-mono">{key}</span> exists in the database but not in this JSON (kept as-is)
                  </td>
                </tr>
              ))}
              {showUnchanged && plan.mappings.unchanged.map(key => (
                <tr key={`n-${key}`}>
                  <td className="px-4 py-2"><OpBadge op="unchanged" /></td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500" colSpan={4}>{key}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plan.mappings.unchanged.length > 0 && (
          <button
            onClick={() => setShowUnchanged(v => !v)}
            className="mt-1 text-xs text-lamp-600 hover:text-lamp-800"
          >
            {showUnchanged ? 'Hide' : 'Show'} {plan.mappings.unchanged.length} unchanged
          </button>
        )}
      </div>

      {/* Prompts */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Top-up prompts</h4>
        <div className="text-sm text-gray-700 space-y-1">
          {plan.prompts.create.length > 0 && (
            <div><OpBadge op="create" /> <span className="font-mono text-xs ml-1">{plan.prompts.create.join(', ')}</span></div>
          )}
          {plan.prompts.update.length > 0 && (
            <div><OpBadge op="update" /> <span className="font-mono text-xs ml-1">{plan.prompts.update.join(', ')}</span></div>
          )}
          {plan.prompts.unchanged.length > 0 && (
            <div><OpBadge op="unchanged" /> <span className="text-xs text-gray-500 ml-1">{plan.prompts.unchanged.length} prompts identical</span></div>
          )}
          {plan.prompts.create.length === 0 && plan.prompts.update.length === 0 && plan.prompts.unchanged.length === 0 && (
            <div className="text-gray-500 text-sm">No top-up prompts in this profile (sections will use superset base prompts).</div>
          )}
        </div>
      </div>

      {/* Styles */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Style configuration</h4>
        <div className="text-sm text-gray-700 space-y-1">
          <div>
            Diagram config: <OpBadge op={plan.styles.diagramConfig} />
            {plan.styles.diagramHints > 0 && <span className="text-xs text-gray-500 ml-2">{plan.styles.diagramHints} generation hints</span>}
          </div>
          <div>
            Export configs:{' '}
            {plan.styles.exportConfigs.length === 0
              ? <span className="text-gray-500">none</span>
              : plan.styles.exportConfigs.map(e => (
                  <span key={e.documentTypeId} className="mr-2">
                    <span className="font-mono text-xs">{e.documentTypeId}</span> <OpBadge op={e.op} />
                  </span>
                ))}
            {plan.styles.exportHeadings > 0 && <span className="text-xs text-gray-500 ml-2">{plan.styles.exportHeadings} section headings</span>}
          </div>
          <div>
            Validation rules:{' '}
            {plan.styles.sectionValidations.length === 0
              ? <span className="text-gray-500">none</span>
              : <span className="font-mono text-xs">{plan.styles.sectionValidations.map(v => v.sectionKey).join(', ')}</span>}
          </div>
          <div>
            Cross-section checks:{' '}
            {plan.styles.crossValidations.length === 0
              ? <span className="text-gray-500">none</span>
              : <span className="font-mono text-xs">{plan.styles.crossValidations.map(v => v.checkId).join(', ')}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
