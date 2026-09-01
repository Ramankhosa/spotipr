'use client'

// Stage 0 Support Data editor — a grouped, routable fact list.
//
// Each fact row carries its destination controls inline (FactRoutingControls),
// the header strip forward-projects where facts will land using the SAME
// predicates the prompt builders use (projectSupportDataDestinations), and
// deletion is soft-first with an Undo toast. Ids are stable: minted above the
// highest suffix, never positional.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
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
import { useToast } from '@/components/ui/toast'
import {
  SUPPORT_CLAIM_USE_VALUES,
  SUPPORT_DATA_SOURCE_KINDS,
  SUPPORT_FIGURE_USE_VALUES,
  SUPPORT_SECTION_TARGETS,
  SUPPORT_SECTION_LABELS,
  SUPPORT_STATUS_VALUES,
  coerceSupportDataSources,
  mintSourceId,
  previewSupportDataSource,
  projectSupportDataDestinations,
  sectionMatches,
  type SupportClaimUse,
  type SupportDataSource,
  type SupportDataSourceKind,
  type SupportFigureUse,
  type SupportStatus,
} from '@/lib/support-data-sources'
import FactRoutingControls, {
  CLAIM_USE_OPTIONS,
  FIGURE_USE_OPTIONS,
  RoutingTooltip,
  type FactRoutingPatch,
} from '@/components/drafting/FactRoutingControls'

type SupportDataSourcesEditorProps = {
  sources: SupportDataSource[]
  onChange: (sources: SupportDataSource[]) => void
  isEditing: boolean
  // Incremented by the readiness header to focus the "needs attention" facts.
  attentionSignal?: number
}

const KIND_LABELS: Partial<Record<SupportDataSourceKind, string>> = {
  component: 'Components',
  subcomponent: 'Subcomponents',
  process_step: 'Process steps',
  material: 'Materials',
  composition: 'Compositions',
  numeric_value: 'Numbers & ranges',
  condition: 'Conditions',
  alternative: 'Alternatives',
  example: 'Examples',
  table: 'Tables',
  equation: 'Equations',
  data_schema: 'Data schemas',
  algorithm: 'Algorithms',
  figure: 'Figures',
  test_result: 'Test results',
  bio_sequence: 'Sequences',
  deposit: 'Deposits',
  prior_art: 'Prior art',
  advantage: 'Advantages',
  risk: 'Risks',
  do_not_claim: 'Keep-out items',
  missing_fact: 'Missing facts',
  other: 'Other facts',
}

const emptySource = (taken: Set<string>): SupportDataSource => ({
  id: mintSourceId(new Set(taken)),
  kind: 'other',
  label: 'New support fact',
  value: '',
  sectionTargets: ['detailedDescription'],
  claimUse: 'none',
  figureUse: 'do_not_show',
  status: 'user_added',
})

function optionLabel(value: string) {
  return value === 'deleted' ? 'removed' : value.replace(/_/g, ' ')
}

function needsAttention(source: SupportDataSource) {
  if (source.status === 'deleted') return false
  return source.status === 'not_stated' ||
    source.status === 'unsupported' ||
    source.kind === 'missing_fact' ||
    source.kind === 'risk'
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
  attentionSignal,
}: SupportDataSourcesEditorProps) {
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | SupportDataSourceKind>('all')
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | SupportStatus>('active')
  const [sectionFocus, setSectionFocus] = useState<string | null>(null)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<SupportDataSource | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmHardDelete, setConfirmHardDelete] = useState<{ source: SupportDataSource; inputValue: string } | null>(null)

  const normalizedSources = useMemo(() => coerceSupportDataSources(sources), [sources])
  // Latest list for the Undo closure — restoring from a stale snapshot would
  // revert edits made between the delete and the undo click.
  const sourcesRef = useRef(normalizedSources)
  sourcesRef.current = normalizedSources
  const activeSources = useMemo(() => normalizedSources.filter(source => source.status !== 'deleted'), [normalizedSources])
  const activeCount = activeSources.length
  const removedCount = normalizedSources.length - activeCount
  const attentionCount = useMemo(() => activeSources.filter(needsAttention).length, [activeSources])
  const destinations = useMemo(() => projectSupportDataDestinations(activeSources), [activeSources])

  useEffect(() => {
    if (attentionSignal) {
      setAttentionOnly(true)
      setStatusFilter('active')
      setSectionFocus(null)
    }
  }, [attentionSignal])

  // Leaving edit mode drops the selection — the bulk toolbar is edit-only.
  useEffect(() => {
    if (!isEditing) setSelectedIds(new Set())
  }, [isEditing])

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return normalizedSources.filter((source) => {
      if (kindFilter !== 'all' && source.kind !== kindFilter) return false
      if (statusFilter === 'active' && source.status === 'deleted') return false
      if (statusFilter !== 'active' && statusFilter !== 'all' && source.status !== statusFilter) return false
      if (attentionOnly && !needsAttention(source)) return false
      if (sectionFocus && !sectionMatches(source, sectionFocus)) return false
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
  }, [attentionOnly, kindFilter, normalizedSources, query, sectionFocus, statusFilter])

  const groupedSources = useMemo(() => {
    const groups: Array<{ kind: SupportDataSourceKind; items: SupportDataSource[] }> = []
    SUPPORT_DATA_SOURCE_KINDS.forEach((kind) => {
      const items = filteredSources.filter(source => source.kind === kind)
      if (items.length) groups.push({ kind, items })
    })
    return groups
  }, [filteredSources])

  const commitSources = (nextSources: SupportDataSource[]) => {
    onChange(coerceSupportDataSources(nextSources))
  }

  const takenIds = useMemo(() => new Set(normalizedSources.map(source => source.id)), [normalizedSources])

  const openNew = () => {
    setEditingId(null)
    setDraft(emptySource(takenIds))
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

  const patchSource = (id: string, patch: FactRoutingPatch) => {
    commitSources(normalizedSources.map(source => source.id === id ? { ...source, ...patch } : source))
  }

  const duplicateSource = (source: SupportDataSource) => {
    commitSources([
      ...normalizedSources,
      {
        ...source,
        id: mintSourceId(new Set(takenIds)),
        label: `${source.label} copy`,
        status: 'user_added',
      },
    ])
  }

  const softDeleteMany = (ids: string[]) => {
    const idSet = new Set(ids)
    const priorStatuses = new Map<string, SupportStatus>()
    normalizedSources.forEach((source) => {
      if (idSet.has(source.id) && source.status !== 'deleted') priorStatuses.set(source.id, source.status)
    })
    if (!priorStatuses.size) return
    commitSources(normalizedSources.map(source =>
      priorStatuses.has(source.id) ? { ...source, status: 'deleted' as SupportStatus } : source
    ))
    setSelectedIds(prev => {
      const next = new Set(prev)
      priorStatuses.forEach((_, id) => next.delete(id))
      return next
    })
    toast({
      title: priorStatuses.size === 1 ? 'Fact removed' : `${priorStatuses.size} facts removed`,
      description: 'Removed facts stay recoverable under the Removed filter.',
      duration: 8000,
      action: {
        label: 'Undo',
        onClick: () => {
          onChange(coerceSupportDataSources(sourcesRef.current.map(source =>
            priorStatuses.has(source.id)
              ? { ...source, status: priorStatuses.get(source.id) as SupportStatus }
              : source
          )))
        },
      },
    })
  }

  const restoreSource = (source: SupportDataSource) => {
    commitSources(normalizedSources.map(item => item.id === source.id ? { ...item, status: 'user_added' as SupportStatus } : item))
  }

  const hardDelete = (source: SupportDataSource) => {
    commitSources(normalizedSources.filter(item => item.id !== source.id))
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleSelectable = filteredSources.filter(source => source.status !== 'deleted')
  const allVisibleSelected = visibleSelectable.length > 0 && visibleSelectable.every(source => selectedIds.has(source.id))

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleSelectable.forEach(source => next.delete(source.id))
      else visibleSelectable.forEach(source => next.add(source.id))
      return next
    })
  }

  const bulkPatch = (patch: FactRoutingPatch) => {
    if (!selectedIds.size) return
    commitSources(normalizedSources.map(source => selectedIds.has(source.id) ? { ...source, ...patch } : source))
  }

  const bulkDescription = (include: boolean) => {
    if (!selectedIds.size) return
    commitSources(normalizedSources.map((source) => {
      if (!selectedIds.has(source.id)) return source
      const has = source.sectionTargets.includes('detailedDescription')
      if (include === has) return source
      if (!include && source.sectionTargets.length === 1) return source // sole destination stays
      return {
        ...source,
        sectionTargets: include
          ? [...source.sectionTargets, 'detailedDescription']
          : source.sectionTargets.filter(target => target !== 'detailedDescription'),
      }
    }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h4 className="text-sm font-medium text-ai-graphite-900">
            Support Data Sources <span className="text-xs font-normal text-ai-graphite-400">({activeCount})</span>
          </h4>
          <p className="mt-0.5 text-[11px] text-ai-graphite-500">
            The facts and evidence themselves — each routed to the sections that may use it.
          </p>
        </div>
        {isEditing && (
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded-md bg-ai-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ai-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Fact
          </button>
        )}
      </div>

      {/* Where this lands — forward projection sharing the prompt builders' predicates */}
      {destinations.length > 0 && (
        <div>
          <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-[0.06em] text-ai-graphite-400">
            Where this lands
          </span>
          <div className="flex flex-wrap gap-1.5">
            {destinations.map((projection) => {
              const label = SUPPORT_SECTION_LABELS[projection.section] || projection.section
              const total = projection.positives + projection.guardrails
              const active = sectionFocus === projection.section
              const help = [
                projection.viaEvidenceSelection
                  ? `${projection.positiveTotal} fact${projection.positiveTotal === 1 ? '' : 's'} eligible — the evidence-selection step makes the final pick.`
                  : `${projection.positives} of ${projection.positiveTotal} fact${projection.positiveTotal === 1 ? '' : 's'} will be injected here.`,
                projection.guardrailTotal
                  ? `${projection.guardrails} of ${projection.guardrailTotal} guardrail${projection.guardrailTotal === 1 ? '' : 's'} travel along.`
                  : '',
                'Click to see just these facts.',
              ].filter(Boolean).join(' ')
              return (
                <RoutingTooltip key={projection.section} content={help} align="start">
                  <button
                    type="button"
                    onClick={() => setSectionFocus(active ? null : projection.section)}
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      active
                        ? 'border-ai-blue-600 bg-ai-blue-600 text-white'
                        : 'border-ai-blue-200 bg-ai-blue-50 text-ai-blue-700 hover:bg-ai-blue-100'
                    }`}
                  >
                    {label}
                    <span className="ml-1 tabular-nums opacity-80">
                      {projection.truncated ? `${total} of ${projection.positiveTotal + projection.guardrailTotal}` : total}
                    </span>
                    {projection.viaEvidenceSelection && <span className="ml-1 opacity-60">· via selection</span>}
                  </button>
                </RoutingTooltip>
              )
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_170px_150px_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-ai-graphite-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search facts..."
            className="w-full rounded-md border border-paper-400 py-2 pl-8 pr-3 text-xs focus:border-ai-blue-500 focus:outline-none focus:ring-1 focus:ring-ai-blue-500"
          />
        </label>
        <select
          value={kindFilter}
          onChange={(event) => setKindFilter(event.target.value as any)}
          className="rounded-md border border-paper-400 bg-white px-2 py-2 text-xs focus:border-ai-blue-500 focus:outline-none focus:ring-1 focus:ring-ai-blue-500"
        >
          <option value="all">All kinds</option>
          {SUPPORT_DATA_SOURCE_KINDS.map(kind => (
            <option key={kind} value={kind}>{KIND_LABELS[kind] || optionLabel(kind)}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as any)}
          className="rounded-md border border-paper-400 bg-white px-2 py-2 text-xs focus:border-ai-blue-500 focus:outline-none focus:ring-1 focus:ring-ai-blue-500"
        >
          <option value="active">Active only</option>
          <option value="all">All statuses</option>
          {SUPPORT_STATUS_VALUES.map(status => (
            <option key={status} value={status}>
              {status === 'deleted' ? `Removed${removedCount ? ` (${removedCount})` : ''}` : optionLabel(status)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAttentionOnly(v => !v)}
          aria-pressed={attentionOnly}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors ${
            attentionOnly
              ? 'border-amber-400 bg-amber-50 text-amber-800'
              : 'border-paper-400 bg-white text-ai-graphite-600 hover:bg-paper-100'
          }`}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Needs attention{attentionCount ? ` (${attentionCount})` : ''}
        </button>
      </div>

      {sectionFocus && (
        <div className="flex items-center gap-2 rounded-md border border-ai-blue-200 bg-ai-blue-50 px-3 py-1.5 text-[11px] text-ai-blue-700">
          Showing facts routed to <strong>{SUPPORT_SECTION_LABELS[sectionFocus] || sectionFocus}</strong>
          <button type="button" onClick={() => setSectionFocus(null)} className="rounded p-0.5 hover:bg-ai-blue-100" aria-label="Clear section filter">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Bulk toolbar */}
      {isEditing && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ai-blue-200 bg-ai-blue-50/60 px-3 py-2">
          <span className="text-xs font-medium text-ai-blue-800 tabular-nums">{selectedIds.size} selected</span>
          <span className="hidden h-4 w-px bg-ai-blue-200 sm:block" />
          <label className="flex items-center gap-1.5 text-[11px] text-ai-graphite-600">
            Claims
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) bulkPatch({ claimUse: event.target.value as SupportClaimUse })
                event.target.value = ''
              }}
              className="rounded-md border border-paper-400 bg-white px-1.5 py-1 text-[11px]"
            >
              <option value="" disabled>Set...</option>
              {CLAIM_USE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-ai-graphite-600">
            Drawings
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) bulkPatch({ figureUse: event.target.value as SupportFigureUse })
                event.target.value = ''
              }}
              className="rounded-md border border-paper-400 bg-white px-1.5 py-1 text-[11px]"
            >
              <option value="" disabled>Set...</option>
              {FIGURE_USE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-ai-graphite-600">
            Description
            <select
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) bulkDescription(event.target.value === 'in')
                event.target.value = ''
              }}
              className="rounded-md border border-paper-400 bg-white px-1.5 py-1 text-[11px]"
            >
              <option value="" disabled>Set...</option>
              <option value="in">In</option>
              <option value="out">Out</option>
            </select>
          </label>
          <span className="hidden h-4 w-px bg-ai-blue-200 sm:block" />
          <button
            type="button"
            onClick={() => softDeleteMany(Array.from(selectedIds))}
            className="inline-flex items-center gap-1 rounded-md border border-paper-400 bg-white px-2 py-1 text-[11px] font-medium text-ai-graphite-700 hover:border-amber-300 hover:text-amber-700"
          >
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-[11px] text-ai-graphite-500 hover:text-ai-graphite-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Grouped fact list */}
      <div className="rounded-lg border border-paper-300 bg-white">
        {isEditing && visibleSelectable.length > 0 && (
          <label className="flex items-center gap-2 border-b border-paper-200 bg-paper-100/60 px-3 py-2 text-[11px] text-ai-graphite-600">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
            />
            Select all shown
          </label>
        )}
        {groupedSources.length ? groupedSources.map(group => (
          <div key={group.kind}>
            <div className="flex items-center gap-2 border-b border-paper-200 bg-paper-100/70 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ai-graphite-500">
                {KIND_LABELS[group.kind] || optionLabel(group.kind)}
              </span>
              <span className="text-[10px] text-ai-graphite-400 tabular-nums">{group.items.length}</span>
            </div>
            {group.items.map((source) => {
              const removed = source.status === 'deleted'
              return (
                <div
                  key={source.id}
                  className={`flex flex-col gap-2 border-b border-paper-100 px-3 py-2.5 last:border-b-0 ${removed ? 'bg-paper-100/60' : 'bg-white'}`}
                >
                  <div className="flex items-start gap-2.5">
                    {isEditing && !removed && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(source.id)}
                        onChange={() => toggleSelected(source.id)}
                        className="mt-0.5 h-4 w-4 rounded border-paper-400 text-ai-blue-600 focus:ring-ai-blue-500"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-medium ${removed ? 'text-ai-graphite-400 line-through' : 'text-ai-graphite-900'}`}>
                          {source.label}
                        </span>
                        <span className="font-mono text-[10px] text-ai-graphite-400">{source.id}</span>
                        {source.status !== 'source_stated' && (
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            removed
                              ? 'bg-paper-200 text-ai-graphite-500'
                              : needsAttention(source)
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-paper-100 text-ai-graphite-500'
                          }`}>
                            {optionLabel(source.status)}
                          </span>
                        )}
                      </div>
                      <p className={`mt-0.5 text-xs ${removed ? 'text-ai-graphite-400' : 'text-ai-graphite-600'} line-clamp-2`}>
                        {previewSupportDataSource(source)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {isEditing && !removed && (
                        <>
                          <button type="button" onClick={() => openEdit(source)} className="rounded p-1 text-ai-graphite-500 hover:bg-paper-200 hover:text-ai-blue-600" title="Edit details">
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => duplicateSource(source)} className="rounded p-1 text-ai-graphite-500 hover:bg-paper-200 hover:text-ai-blue-600" title="Duplicate">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => softDeleteMany([source.id])} className="rounded p-1 text-ai-graphite-500 hover:bg-paper-200 hover:text-amber-600" title="Remove">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                      {isEditing && removed && (
                        <>
                          <button type="button" onClick={() => restoreSource(source)} className="rounded p-1 text-ai-graphite-500 hover:bg-paper-200 hover:text-emerald-600" title="Restore">
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => setConfirmHardDelete({ source, inputValue: '' })} className="rounded p-1 text-ai-graphite-500 hover:bg-paper-200 hover:text-red-600" title="Delete forever">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {!removed && (
                    <div className={isEditing ? '' : 'opacity-80'}>
                      <FactRoutingControls
                        source={source}
                        disabled={!isEditing}
                        onChange={(patch) => patchSource(source.id, patch)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )) : (
          <div className="px-3 py-10 text-center text-sm text-ai-graphite-500">
            No support facts match the current filters.
          </div>
        )}
      </div>

      {/* Hard delete confirm — removed facts only */}
      {confirmHardDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <Trash2 className="h-4 w-4 text-red-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-ai-graphite-900">Delete this fact forever?</h3>
                <p className="mt-1 text-xs text-ai-graphite-600">
                  <span className="font-medium">{confirmHardDelete.source.label}</span>{' '}
                  <span className="font-mono text-[10px] text-ai-graphite-400">{confirmHardDelete.source.id}</span>{' '}
                  will be gone for good — a removed fact costs nothing to keep.
                </p>
                <input
                  type="text"
                  value={confirmHardDelete.inputValue}
                  onChange={(event) => setConfirmHardDelete(prev => prev ? { ...prev, inputValue: event.target.value } : prev)}
                  placeholder='Type "DELETE" to confirm'
                  className="mt-3 w-full rounded-md border border-paper-400 px-2 py-1.5 text-xs focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmHardDelete(null)}>
                Cancel
              </Button>
              <button
                type="button"
                disabled={confirmHardDelete.inputValue !== 'DELETE'}
                onClick={() => {
                  hardDelete(confirmHardDelete.source)
                  setConfirmHardDelete(null)
                }}
                className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:bg-red-300"
              >
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-paper-300 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-ai-graphite-900">{editingId ? `Edit ${draft.id}` : 'Add support fact'}</h3>
                <p className="text-xs text-ai-graphite-500">Keep this tied to source-stated or attorney-added facts.</p>
              </div>
              <button type="button" onClick={() => setDraft(null)} className="rounded p-1 text-ai-graphite-500 hover:bg-paper-200">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Kind</span>
                  <select value={draft.kind} onChange={(event) => updateDraft('kind', event.target.value as SupportDataSourceKind)} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs">
                    {SUPPORT_DATA_SOURCE_KINDS.map(kind => <option key={kind} value={kind}>{KIND_LABELS[kind] || optionLabel(kind)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Label</span>
                  <input value={draft.label} onChange={(event) => updateDraft('label', event.target.value)} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs" />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Value</span>
                  <textarea value={draft.value} onChange={(event) => updateDraft('value', event.target.value)} rows={3} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs" />
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Source Text</span>
                  <textarea value={draft.sourceText || ''} onChange={(event) => updateDraft('sourceText', event.target.value)} rows={2} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs" />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Claim Use</span>
                  <select value={draft.claimUse} onChange={(event) => updateDraft('claimUse', event.target.value as SupportClaimUse)} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs">
                    {SUPPORT_CLAIM_USE_VALUES.map(value => {
                      const option = CLAIM_USE_OPTIONS.find(item => item.value === value)
                      return <option key={value} value={value}>{option?.label || optionLabel(value)}</option>
                    })}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Figure Use</span>
                  <select value={draft.figureUse} onChange={(event) => updateDraft('figureUse', event.target.value as SupportFigureUse)} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs">
                    {SUPPORT_FIGURE_USE_VALUES.map(value => {
                      const option = FIGURE_USE_OPTIONS.find(item => item.value === value)
                      return <option key={value} value={value}>{option?.label || optionLabel(value)}</option>
                    })}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Status</span>
                  <select value={draft.status} onChange={(event) => updateDraft('status', event.target.value as SupportStatus)} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs">
                    {SUPPORT_STATUS_VALUES.map(value => <option key={value} value={value}>{optionLabel(value)}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-4">
                <span className="mb-2 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Section Targets</span>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  {SUPPORT_SECTION_TARGETS.map(target => {
                    const checked = draft.sectionTargets.includes(target)
                    return (
                      <label key={target} className="flex items-center gap-2 rounded-md border border-paper-300 px-2 py-1.5 text-xs text-ai-graphite-700">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const nextTargets = event.target.checked
                              ? [...draft.sectionTargets, target]
                              : draft.sectionTargets.filter(item => item !== target)
                            updateDraft('sectionTargets', nextTargets.length ? nextTargets : ['detailedDescription'])
                          }}
                          className="rounded border-paper-400"
                        />
                        {SUPPORT_SECTION_LABELS[target] || target}
                      </label>
                    )
                  })}
                </div>
              </div>

              <KindSpecificEditor draft={draft} updateDetails={updateDetails} updateValue={(value) => updateDraft('value', value)} />
            </div>

            <div className="flex justify-end gap-2 border-t border-paper-300 bg-paper-100 px-5 py-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={saveDraft} className="bg-ai-blue-600 text-white hover:bg-ai-blue-700">
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save Fact
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
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Table Details</h5>
        <div className="grid gap-3">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Headers, comma separated</span>
            <input value={Array.isArray(details.headers) ? details.headers.join(', ') : ''} onChange={(event) => updateDetails({ headers: event.target.value.split(',').map(item => item.trim()).filter(Boolean) })} className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ai-graphite-500">Rows, tab separated</span>
            <textarea value={tableRowsText(details.rows)} onChange={(event) => updateDetails({ rows: parseTableRows(event.target.value) })} rows={6} className="w-full rounded-md border border-paper-400 px-2 py-2 font-mono text-xs" />
          </label>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input placeholder="Units or column unit notes" value={details.units || ''} onChange={(event) => updateDetails({ units: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
            <input placeholder="Notes" value={details.notes || ''} onChange={(event) => updateDetails({ notes: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
          </div>
        </div>
      </div>
    )
  }

  if (draft.kind === 'equation') {
    return (
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Equation Details</h5>
        <div className="grid gap-3">
          <input value={details.expression || draft.value} onChange={(event) => { updateDetails({ expression: event.target.value }); updateValue(event.target.value) }} placeholder="Expression or formula" className="rounded-md border border-paper-400 px-2 py-2 font-mono text-xs" />
          <textarea value={variableText(details.variables)} onChange={(event) => updateDetails({ variables: parseVariables(event.target.value) })} rows={4} placeholder="x: sensor reading" className="rounded-md border border-paper-400 px-2 py-2 font-mono text-xs" />
          <textarea value={lineList(details.constraints)} onChange={(event) => updateDetails({ constraints: parseLineList(event.target.value) })} rows={3} placeholder="Constraints, one per line" className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
        </div>
      </div>
    )
  }

  if (draft.kind === 'data_schema') {
    return (
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Schema Details</h5>
        <textarea value={fieldText(details.fields)} onChange={(event) => updateDetails({ fields: parseFields(event.target.value) })} rows={7} placeholder="name | type | required | description" className="w-full rounded-md border border-paper-400 px-2 py-2 font-mono text-xs" />
      </div>
    )
  }

  if (draft.kind === 'algorithm') {
    return (
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Algorithm Steps</h5>
        <textarea value={lineList(details.steps)} onChange={(event) => updateDetails({ steps: parseLineList(event.target.value) })} rows={7} placeholder="One ordered step per line" className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs" />
      </div>
    )
  }

  if (draft.kind === 'composition') {
    return (
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Composition Details</h5>
        <textarea value={constituentText(details.constituents)} onChange={(event) => updateDetails({ constituents: parseConstituents(event.target.value) })} rows={7} placeholder="constituent | amount/range | role" className="w-full rounded-md border border-paper-400 px-2 py-2 font-mono text-xs" />
      </div>
    )
  }

  if (draft.kind === 'bio_sequence') {
    return (
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Sequence Details</h5>
        <div className="grid gap-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <input placeholder="Sequence ID" value={details.sequenceId || ''} onChange={(event) => updateDetails({ sequenceId: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
            <input placeholder="Organism/source" value={details.organism || ''} onChange={(event) => updateDetails({ organism: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
          </div>
          <textarea value={details.sequence || ''} onChange={(event) => updateDetails({ sequence: event.target.value.replace(/\s+/g, '') })} rows={6} placeholder="Sequence" className="w-full rounded-md border border-paper-400 px-2 py-2 font-mono text-xs" />
          <input placeholder="Deposit or accession information" value={details.depositInfo || ''} onChange={(event) => updateDetails({ depositInfo: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
        </div>
      </div>
    )
  }

  if (draft.kind === 'figure') {
    return (
      <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
        <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Figure Details</h5>
        <div className="grid gap-3 md:grid-cols-3">
          <input placeholder="Figure number" value={details.figureNo || ''} onChange={(event) => updateDetails({ figureNo: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
          <input placeholder="View" value={details.view || ''} onChange={(event) => updateDetails({ view: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
          <input placeholder="Caption" value={details.caption || ''} onChange={(event) => updateDetails({ caption: event.target.value })} className="rounded-md border border-paper-400 px-2 py-2 text-xs" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-4 rounded-lg border border-paper-300 bg-paper-100 p-3">
      <h5 className="mb-3 text-xs font-semibold text-ai-graphite-800">Simple Fact Details</h5>
      <textarea value={details.notes || ''} onChange={(event) => updateDetails({ notes: event.target.value })} rows={4} placeholder="Optional notes, units, ranges, source caveats, or attorney comments" className="w-full rounded-md border border-paper-400 px-2 py-2 text-xs" />
    </div>
  )
}
