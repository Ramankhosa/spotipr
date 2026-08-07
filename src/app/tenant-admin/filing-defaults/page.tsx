'use client'

/**
 * Tenant Admin — Filing defaults.
 *
 * The top layer of the firm -> project -> patent cascade. Set once, inherited by every
 * filing the firm makes. Firms serving mixed client types keep several named presets and
 * mark one as the default.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { Check, FileText, Plus, Settings2, Trash2 } from 'lucide-react'
import {
  DeclarationMatrix,
  Field,
  FilingStyleControls,
  Section,
  inputClass,
  type DeclarationState,
  type ResolvedFilingSettings,
} from '@/components/filing/filing-ui'

interface Preset {
  id: string
  name: string
  isDefault: boolean
  settings: Partial<ResolvedFilingSettings>
}

interface ClauseDef {
  key: string
  label: string
}

export default function FilingDefaultsPage() {
  const { token } = useAuth()
  const { toast } = useToast()

  const [presets, setPresets] = useState<Preset[]>([])
  const [clauses, setClauses] = useState<ClauseDef[]>([])
  const [baseline, setBaseline] = useState<ResolvedFilingSettings | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; isDefault: boolean; settings: ResolvedFilingSettings } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [canEdit, setCanEdit] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch('/api/tenant-admin/filing-defaults', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load filing defaults')
      const data = await res.json()
      setPresets(data.presets || [])
      setClauses(data.clauses || [])
      setBaseline(data.baseline)
      setCanEdit(Boolean(data.canEdit))

      const first: Preset | undefined = (data.presets || [])[0]
      if (first) {
        setActiveId(first.id)
        setDraft({
          name: first.name,
          isDefault: first.isDefault,
          settings: { ...data.baseline, ...first.settings, declarations: { ...(first.settings?.declarations || {}) } },
        })
      } else {
        setActiveId(null)
        setDraft(null)
      }
    } catch (err) {
      toast({ title: 'Could not load filing defaults', description: String(err), variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => { load() }, [load])

  const startNew = () => {
    if (!baseline) return
    setActiveId(null)
    setDraft({
      name: '',
      isDefault: presets.length === 0,
      settings: { ...baseline, declarations: {} },
    })
  }

  const selectPreset = (preset: Preset) => {
    if (!baseline) return
    setActiveId(preset.id)
    setDraft({
      name: preset.name,
      isDefault: preset.isDefault,
      settings: { ...baseline, ...preset.settings, declarations: { ...(preset.settings?.declarations || {}) } },
    })
  }

  const save = async () => {
    if (!draft || !token) return
    if (!draft.name.trim()) {
      toast({ title: 'Name this preset', description: 'Give it a name your team will recognise, e.g. "University — ordinary provisional".', variant: 'error' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/tenant-admin/filing-defaults', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: activeId || undefined,
          name: draft.name.trim(),
          isDefault: draft.isDefault,
          settings: toPatch(draft.settings, baseline),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      toast({ title: 'Filing defaults saved', description: 'New filings in this firm will inherit these settings.' })
      await load()
    } catch (err) {
      toast({ title: 'Could not save', description: String(err), variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (preset: Preset) => {
    if (!token) return
    try {
      const res = await fetch(`/api/tenant-admin/filing-defaults?id=${encodeURIComponent(preset.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed')
      toast({ title: 'Preset removed' })
      await load()
    } catch (err) {
      toast({ title: 'Could not remove the preset', description: String(err), variant: 'error' })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
          <div className="h-8 w-56 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
          <div className="mt-8 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="h-64 animate-pulse rounded-xl bg-white dark:bg-gray-800" />
            <div className="h-96 animate-pulse rounded-xl bg-white dark:bg-gray-800" />
          </div>
        </div>
      </div>
    )
  }

  const disabled = !canEdit || saving

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Filing defaults</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
              Your firm&apos;s house style for Indian filing forms. Every project inherits these, and any project or
              individual filing can still override them.
            </p>
          </div>
          {canEdit && draft && (
            <button
              onClick={save}
              disabled={disabled}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-lamp-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-lamp-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving
                ? <><span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> Saving…</>
                : <><Check className="h-4 w-4" /> Save preset</>}
            </button>
          )}
        </div>

        {!canEdit && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            You have read-only access. Only an Owner or Admin can change the firm&apos;s filing defaults.
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
          {/* Preset list */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Presets</h2>
              {canEdit && (
                <button onClick={startNew} className="inline-flex items-center gap-1 text-xs font-medium text-lamp-600 hover:text-lamp-700">
                  <Plus className="h-3.5 w-3.5" /> New
                </button>
              )}
            </div>
            {presets.length === 0 && !draft && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No presets yet. Create one to set your firm&apos;s house style.
              </p>
            )}
            <ul className="space-y-1">
              {presets.map(preset => (
                <li key={preset.id}>
                  <div className={`group flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    activeId === preset.id
                      ? 'bg-lamp-50 text-lamp-800 dark:bg-lamp-900/30 dark:text-lamp-200'
                      : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/40'
                  }`}>
                    <button onClick={() => selectPreset(preset)} className="min-w-0 flex-1 truncate text-left">
                      {preset.name}
                      {preset.isDefault && (
                        <span className="ml-2 rounded bg-lamp-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-lamp-700 dark:bg-lamp-900/50 dark:text-lamp-300">
                          default
                        </span>
                      )}
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => remove(preset)}
                        title="Remove preset"
                        className="opacity-0 transition group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-500" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Editor */}
          {draft ? (
            <div className="space-y-6">
              <Section icon={<Settings2 className="h-4 w-4" />} title="Preset" subtitle="Name it after the kind of client and filing it covers.">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Preset name" required className="sm:col-span-2">
                    <input
                      type="text"
                      value={draft.name}
                      onChange={e => setDraft({ ...draft, name: e.target.value })}
                      disabled={disabled}
                      placeholder="e.g. University — ordinary provisional"
                      className={inputClass}
                    />
                  </Field>
                  <label className="flex items-center gap-2 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={draft.isDefault}
                      onChange={e => setDraft({ ...draft, isDefault: e.target.checked })}
                      disabled={disabled}
                      className="h-4 w-4 rounded border-gray-300 text-lamp-600 focus:ring-lamp-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Use as the firm default — applied when a project has not picked a preset.
                    </span>
                  </label>
                </div>
              </Section>

              <Section icon={<FileText className="h-4 w-4" />} title="House style" subtitle="How the forms render the details your firm formats its own way.">
                <FilingStyleControls
                  settings={draft.settings}
                  disabled={disabled}
                  onChange={patch => setDraft({ ...draft, settings: { ...draft.settings, ...patch } })}
                />
              </Section>

              <Section
                icon={<Check className="h-4 w-4" />}
                title="Pinned declarations"
                subtitle="Most of paragraph 12(iii) is decided automatically from the application type. Pin only the clauses your firm always answers the same way."
              >
                <DeclarationMatrix
                  labels={Object.fromEntries(clauses.map(c => [c.key, c.label]))}
                  disabled={disabled}
                  rows={clauses.map(clause => ({
                    key: clause.key,
                    text: clause.label,
                    state: (draft.settings.declarations?.[clause.key] as DeclarationState) || 'tick',
                    source: draft.settings.declarations?.[clause.key] ? 'firm' : 'rules',
                  }))}
                  onChange={(key, state) => setDraft({
                    ...draft,
                    settings: {
                      ...draft.settings,
                      declarations: { ...draft.settings.declarations, [key]: state },
                    },
                  })}
                />
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  A clause you leave alone keeps deriving itself from each filing&apos;s application type — that is
                  usually what you want. Pinning is for clauses like biological material, where nothing in the filing
                  can tell us the answer.
                </p>
              </Section>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center dark:border-gray-600 dark:bg-gray-800">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Select a preset to edit it, or create your first one.
              </p>
              {canEdit && (
                <button onClick={startNew} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-lamp-600 px-4 py-2 text-sm font-semibold text-white hover:bg-lamp-700">
                  <Plus className="h-4 w-4" /> New preset
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Send only genuine deviations from the baseline. Storing a full copy would freeze values
 * that should keep tracking the platform baseline as it evolves.
 */
function toPatch(
  settings: ResolvedFilingSettings,
  baseline: ResolvedFilingSettings | null
): Partial<ResolvedFilingSettings> {
  if (!baseline) return settings
  const patch: Record<string, unknown> = {}
  const scalarKeys: Array<keyof ResolvedFilingSettings> = [
    'emptyFieldStyle', 'notApplicableStyle', 'inapplicableClauseStyle', 'dateStyle',
    'officeBranch', 'titleCase', 'nameCase', 'addressLineTerminalPeriod',
  ]
  for (const key of scalarKeys) {
    if (settings[key] !== baseline[key]) patch[key] = settings[key]
  }
  if (settings.declarations && Object.keys(settings.declarations).length) {
    patch.declarations = settings.declarations
  }
  return patch as Partial<ResolvedFilingSettings>
}
