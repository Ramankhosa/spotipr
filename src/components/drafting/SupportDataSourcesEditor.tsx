'use client'

import React, { useMemo, useState } from 'react'
import {
  Copy,
  Edit2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  SUPPORT_CLAIM_USE_VALUES,
  SUPPORT_DATA_SOURCE_KINDS,
  SUPPORT_FIGURE_USE_VALUES,
  SUPPORT_SECTION_TARGETS,
  SUPPORT_STATUS_VALUES,
  coerceSupportDataSources,
  previewSupportDataSource,
  type SupportClaimUse,
  type SupportDataSource,
  type SupportDataSourceKind,
  type SupportFigureUse,
  type SupportStatus,
} from '@/lib/support-data-sources'

type SupportDataSourcesEditorProps = {
  sources: SupportDataSource[]
  onChange: (sources: SupportDataSource[]) => void
  isEditing: boolean
}

const emptySource = (index: number): SupportDataSource => ({
  id: `SDS-${String(index + 1).padStart(3, '0')}`,
  kind: 'other',
  label: 'New support fact',
  value: '',
  sectionTargets: ['detailedDescription'],
  claimUse: 'none',
  figureUse: 'do_not_show',
  status: 'user_added',
})

function optionLabel(value: string) {
  return value.replace(/_/g, ' ')
}

function lineList(value: unknown) {
  return Array.isArray(value) ? value.map(item => String(item ?? '')).filter(Boolean).join('\n') : ''
}

function parseLineList(value: string) {
  return value.split('\n').map(line => line.trim()).filter(Boolean)
}

function variableText(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${String(item ?? '')}`)
    .join('\n')
}

function parseVariables(value: string) {
  const out: Record<string, string> = {}
  value.split('\n').forEach((line) => {
    const [key, ...rest] = line.split(':')
    const name = key?.trim()
    const description = rest.join(':').trim()
    if (name) out[name] = description
  })
  return out
}

function fieldText(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value.map((field: any) => {
    if (field && typeof field === 'object') {
      return [field.name, field.type, field.required ? 'required' : 'optional', field.description].filter(Boolean).join(' | ')
    }
    return String(field ?? '')
  }).join('\n')
}

function parseFields(value: string) {
  return value.split('\n').map((line) => {
    const [name, type, required, description] = line.split('|').map(part => part.trim())
    return {
      name,
      type: type || '',
      required: /^(required|true|yes|y)$/i.test(required || ''),
      description: description || '',
    }
  }).filter(field => field.name)
}

function constituentText(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value.map((part: any) => {
    if (part && typeof part === 'object') {
      return [part.name, part.amount || part.range, part.role].filter(Boolean).join(' | ')
    }
    return String(part ?? '')
  }).join('\n')
}

function parseConstituents(value: string) {
  return value.split('\n').map((line) => {
    const [name, range, role] = line.split('|').map(part => part.trim())
    return { name, range: range || '', role: role || '' }
  }).filter(part => part.name)
}

function tableRowsText(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value.map((row: any) => Array.isArray(row) ? row.join('\t') : String(row ?? '')).join('\n')
}

function parseTableRows(value: string) {
  return value.split('\n')
    .map(line => line.split('\t').map(cell => cell.trim()))
    .filter(row => row.some(Boolean))
}

export default function SupportDataSourcesEditor({
  sources,
  onChange,
  isEditing,
}: SupportDataSourcesEditorProps) {
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | SupportDataSourceKind>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | SupportStatus>('active')
  const [draft, setDraft] = useState<SupportDataSource | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  const normalizedSources = useMemo(() => coerceSupportDataSources(sources), [sources])
  const activeCount = normalizedSources.filter(source => source.status !== 'deleted').length

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return normalizedSources.filter((source) => {
      if (kindFilter !== 'all' && source.kind !== kindFilter) return false
      if (statusFilter === 'active' && source.status === 'deleted') return false
      if (statusFilter !== 'active' && statusFilter !== 'all' && source.status !== statusFilter) return false
      if (!needle) return true
      return [
        source.id,
        source.kind,
        source.label,
        source.value,
        source.claimUse,
        source.figureUse,
        source.status,
        source.sectionTargets.join(' '),
      ].join(' ').toLowerCase().includes(needle)
    })
  }, [kindFilter, normalizedSources, query, statusFilter])

  const commitSources = (nextSources: SupportDataSource[]) => {
    onChange(coerceSupportDataSources(nextSources))
  }

  const openNew = () => {
    setEditingId(null)
    setDraft(emptySource(normalizedSources.length))
  }

  const openEdit = (source: SupportDataSource) => {
    setEditingId(source.id)
    setDraft({ ...source, details: source.details ? JSON.parse(JSON.stringify(source.details)) : undefined })
  }

  const saveDraft = () => {
    if (!draft) return
    const next = editingId
      ? normalizedSources.map(source => source.id === editingId ? draft : source)
      : [...normalizedSources, draft]
    commitSources(next)
    setDraft(null)
    setEditingId(null)
  }

  const updateDraft = <K extends keyof SupportDataSource>(field: K, value: SupportDataSource[K]) => {
    setDraft(prev => prev ? { ...prev, [field]: value } : prev)
  }

  const updateDetails = (patch: Record<string, any>) => {
    setDraft(prev => prev ? { ...prev, details: { ...(prev.details || {}), ...patch } } : prev)
  }

  const duplicateSource = (source: SupportDataSource) => {
    commitSources([
      ...normalizedSources,
      {
        ...source,
        id: `SDS-${String(normalizedSources.length + 1).padStart(3, '0')}`,
        label: `${source.label} copy`,
        status: 'user_added',
      },
    ])
  }

  const softDelete = (source: SupportDataSource) => {
    commitSources(normalizedSources.map(item => item.id === source.id ? { ...item, status: 'deleted' } : item))
  }

  const restoreSource = (source: SupportDataSource) => {
    commitSources(normalizedSources.map(item => item.id === source.id ? { ...item, status: 'user_added' } : item))
  }

  const hardDelete = (source: SupportDataSource) => {
    commitSources(normalizedSources.filter(item => item.id !== source.id))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-sm font-medium text-gray-900">
            Support Data Sources <span className="text-xs font-normal text-gray-400">({activeCount})</span>
          </h4>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Attorney-source facts for claims, description, drawings, background, abstract, and guardrails.
          </p>
        </div>
        {isEditing && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Source
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_180px_180px]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ID, kind, label, value, targets..."
            className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-3 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </label>
        <select
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value as any)}
          className="rounded-md border border-gray-300 bg-white px-2 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="all">All kinds</option>
          {SUPPORT_DATA_SOURCE_KINDS.map(kind => (
            <option key={kind} value={kind}>{optionLabel(kind)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as any)}
          className="rounded-md border border-gray-300 bg-white px-2 py-2 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="active">Active only</option>
          <option value="all">All statuses</option>
          {SUPPORT_STATUS_VALUES.map(status => (
            <option key={status} value={status}>{optionLabel(status)}</option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2 font-semibold">ID</th>
              <th className="px-3 py-2 font-semibold">Kind</th>
              <th className="px-3 py-2 font-semibold">Label</th>
              <th className="px-3 py-2 font-semibold">Value Preview</th>
              <th className="px-3 py-2 font-semibold">Claim Use</th>
              <th className="px-3 py-2 font-semibold">Section Targets</th>
              <th className="px-3 py-2 font-semibold">Figure</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredSources.length ? filteredSources.map(source => (
              <tr key={source.id} className={source.status === 'deleted' ? 'bg-gray-50 text-gray-400' : 'bg-white text-gray-700'}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px]">{source.id}</td>
                <td className="whitespace-nowrap px-3 py-2">{optionLabel(source.kind)}</td>
                <td className="max-w-[180px] px-3 py-2 font-medium text-gray-900">
                  <span className="line-clamp-2">{source.label}</span>
                </td>
                <td className="max-w-[280px] px-3 py-2">
                  <span className="line-clamp-2">{previewSupportDataSource(source)}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{optionLabel(source.claimUse)}</td>
                <td className="max-w-[220px] px-3 py-2">
                  <span className="line-clamp-2">{source.sectionTargets.join(', ')}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{optionLabel(source.figureUse)}</td>
                <td className="whitespace-nowrap px-3 py-2">{optionLabel(source.status)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => openEdit(source)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-indigo-600" title="Edit">
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    {isEditing && (
                      <>
                        <button type="button" onClick={() => duplicateSource(source)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-indigo-600" title="Duplicate">
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        {source.status === 'deleted' ? (
                          <button type="button" onClick={() => restoreSource(source)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-emerald-600" title="Restore">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button type="button" onClick={() => softDelete(source)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-amber-600" title="Soft delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button type="button" onClick={() => hardDelete(source)} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-red-600" title="Hard delete">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-sm text-gray-500">
                  No support data sources match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{editingId ? `Edit ${draft.id}` : 'Add support data source'}</h3>
                <p className="text-xs text-gray-500">Keep this tied to source-stated or attorney-added facts.</p>
              </div>
              <button type="button" onClick={() => setDraft(null)} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Kind</span>
                  <select value={draft.kind} onChange={(event) => updateDraft('kind', event.target.value as SupportDataSourceKind)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs">
                    {SUPPORT_DATA_SOURCE_KINDS.map(kind => <option key={kind} value={kind}>{optionLabel(kind)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Label</span>
                  <input value={draft.label} onChange={(event) => updateDraft('label', event.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs" />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Value</span>
                  <textarea value={draft.value} onChange={(event) => updateDraft('value', event.target.value)} rows={3} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs" />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Source Text</span>
                  <textarea value={draft.sourceText || ''} onChange={(event) => updateDraft('sourceText', event.target.value)} rows={2} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Claim Use</span>
                  <select value={draft.claimUse} onChange={(event) => updateDraft('claimUse', event.target.value as SupportClaimUse)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs">
                    {SUPPORT_CLAIM_USE_VALUES.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Figure Use</span>
                  <select value={draft.figureUse} onChange={(event) => updateDraft('figureUse', event.target.value as SupportFigureUse)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs">
                    {SUPPORT_FIGURE_USE_VALUES.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Status</span>
                  <select value={draft.status} onChange={(event) => updateDraft('status', event.target.value as SupportStatus)} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs">
                    {SUPPORT_STATUS_VALUES.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <span className="mb-2 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Section Targets</span>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {SUPPORT_SECTION_TARGETS.map(target => {
                    const checked = draft.sectionTargets.includes(target)
                    return (
                      <label key={target} className="flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const nextTargets = event.target.checked
                              ? [...draft.sectionTargets, target]
                              : draft.sectionTargets.filter(item => item !== target)
                            updateDraft('sectionTargets', nextTargets.length ? nextTargets : ['detailedDescription'])
                          }}
                          className="rounded border-gray-300"
                        />
                        {target}
                      </label>
                    )
                  })}
                </div>
              </div>

              <KindSpecificEditor draft={draft} updateDetails={updateDetails} updateValue={(value) => updateDraft('value', value)} />
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={saveDraft} className="bg-indigo-600 text-white hover:bg-indigo-700">
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save Source
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KindSpecificEditor({
  draft,
  updateDetails,
  updateValue,
}: {
  draft: SupportDataSource
  updateDetails: (patch: Record<string, any>) => void
  updateValue: (value: string) => void
}) {
  const details = draft.details || {}

  if (draft.kind === 'table') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Table Details</h5>
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Headers, comma separated</span>
            <input value={Array.isArray(details.headers) ? details.headers.join(', ') : ''} onChange={(event) => updateDetails({ headers: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-gray-500">Rows, tab separated</span>
            <textarea value={tableRowsText(details.rows)} onChange={(event) => updateDetails({ rows: parseTableRows(event.target.value) })} rows={6} className="w-full rounded-md border border-gray-300 px-2 py-2 font-mono text-xs" />
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input placeholder="Units or column unit notes" value={details.units || ''} onChange={(event) => updateDetails({ units: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
            <input placeholder="Notes" value={details.notes || ''} onChange={(event) => updateDetails({ notes: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
          </div>
        </div>
      </div>
    )
  }

  if (draft.kind === 'equation') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Equation Details</h5>
        <div className="grid gap-3">
          <input value={details.expression || draft.value} onChange={(event) => { updateDetails({ expression: event.target.value }); updateValue(event.target.value) }} placeholder="Expression or formula" className="rounded-md border border-gray-300 px-2 py-2 font-mono text-xs" />
          <textarea value={variableText(details.variables)} onChange={(event) => updateDetails({ variables: parseVariables(event.target.value) })} rows={4} placeholder="x: sensor reading" className="rounded-md border border-gray-300 px-2 py-2 font-mono text-xs" />
          <textarea value={lineList(details.constraints)} onChange={(event) => updateDetails({ constraints: parseLineList(event.target.value) })} rows={3} placeholder="Constraints, one per line" className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
        </div>
      </div>
    )
  }

  if (draft.kind === 'data_schema') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Schema Details</h5>
        <textarea value={fieldText(details.fields)} onChange={(event) => updateDetails({ fields: parseFields(event.target.value) })} rows={7} placeholder="name | type | required | description" className="w-full rounded-md border border-gray-300 px-2 py-2 font-mono text-xs" />
      </div>
    )
  }

  if (draft.kind === 'algorithm') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Algorithm Steps</h5>
        <textarea value={lineList(details.steps)} onChange={(event) => updateDetails({ steps: parseLineList(event.target.value) })} rows={7} placeholder="One ordered step per line" className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs" />
      </div>
    )
  }

  if (draft.kind === 'composition') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Composition Details</h5>
        <textarea value={constituentText(details.constituents)} onChange={(event) => updateDetails({ constituents: parseConstituents(event.target.value) })} rows={7} placeholder="constituent | amount/range | role" className="w-full rounded-md border border-gray-300 px-2 py-2 font-mono text-xs" />
      </div>
    )
  }

  if (draft.kind === 'bio_sequence') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Sequence Details</h5>
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input placeholder="Sequence ID" value={details.sequenceId || ''} onChange={(event) => updateDetails({ sequenceId: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
            <input placeholder="Organism/source" value={details.organism || ''} onChange={(event) => updateDetails({ organism: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
          </div>
          <textarea value={details.sequence || ''} onChange={(event) => updateDetails({ sequence: event.target.value.replace(/\s+/g, '') })} rows={6} placeholder="Sequence" className="w-full rounded-md border border-gray-300 px-2 py-2 font-mono text-xs" />
          <input placeholder="Deposit or accession information" value={details.depositInfo || ''} onChange={(event) => updateDetails({ depositInfo: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
        </div>
      </div>
    )
  }

  if (draft.kind === 'figure') {
    return (
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <h5 className="mb-3 text-xs font-semibold text-gray-800">Figure Details</h5>
        <div className="grid gap-3 md:grid-cols-3">
          <input placeholder="Figure number" value={details.figureNo || ''} onChange={(event) => updateDetails({ figureNo: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
          <input placeholder="View" value={details.view || ''} onChange={(event) => updateDetails({ view: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
          <input placeholder="Caption" value={details.caption || ''} onChange={(event) => updateDetails({ caption: event.target.value })} className="rounded-md border border-gray-300 px-2 py-2 text-xs" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <h5 className="mb-3 text-xs font-semibold text-gray-800">Simple Fact Details</h5>
      <textarea value={details.notes || ''} onChange={(event) => updateDetails({ notes: event.target.value })} rows={4} placeholder="Optional notes, units, ranges, source caveats, or attorney comments" className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs" />
    </div>
  )
}
