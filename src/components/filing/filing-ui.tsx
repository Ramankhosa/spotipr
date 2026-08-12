'use client'

/**
 * Shared UI for the filing settings cascade.
 *
 * The same controls render at all three layers — firm defaults, project defaults, and the
 * per-patent Filing tab — so a firm-level tick and a patent-level tick are visibly the same
 * decision. What differs is only the provenance badge beside each row, which tells the
 * attorney where the current value came from before they override it.
 */

import type { ReactNode } from 'react'

export type SettingSource = 'baseline' | 'rules' | 'firm' | 'project' | 'patent'
export type DeclarationState = 'tick' | 'cross' | 'strike'

export interface ResolvedFilingSettings {
  emptyFieldStyle: 'dash' | 'na' | 'blank'
  notApplicableStyle: 'dash' | 'na' | 'blank' | 'strike'
  inapplicableClauseStyle: 'cross' | 'strike'
  dateStyle: 'blankDay' | 'fullDate'
  officeBranch: string
  titleCase: 'preserve' | 'title' | 'upper'
  nameCase: 'preserve' | 'title' | 'upper'
  addressLineTerminalPeriod: boolean
  declarations: Record<string, DeclarationState>
  includeDocs: { form1: boolean; form5: boolean; drawings: boolean }
}

export const OFFICE_BRANCHES = ['Delhi', 'New Delhi', 'Mumbai', 'Chennai', 'Kolkata']

export const inputClass =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition placeholder:text-gray-400 focus:border-lamp-500 focus:outline-none focus:ring-2 focus:ring-lamp-500/30 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:disabled:bg-gray-800'

export function Section({ icon, title, subtitle, children, actions }: {
  icon?: ReactNode
  title: string
  subtitle?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
      <div className="mb-5 flex items-start gap-2.5">
        {icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lamp-50 text-lamp-600 dark:bg-lamp-900/30 dark:text-lamp-300">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function Field({ label, required, hint, className, children }: {
  label: string
  required?: boolean
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && <span className="ml-auto text-xs font-normal text-gray-400">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

const SOURCE_LABELS: Record<SettingSource, string> = {
  baseline: 'default',
  rules: 'rules',
  firm: 'firm default',
  project: 'project',
  patent: 'you changed this',
}

const SOURCE_STYLES: Record<SettingSource, string> = {
  baseline: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  rules: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  firm: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  project: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  patent: 'bg-lamp-50 text-lamp-700 dark:bg-lamp-900/30 dark:text-lamp-300',
}

/** Tells the attorney where a value came from, so an override is a deliberate act. */
export function ProvenanceBadge({ source }: { source: SettingSource }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${SOURCE_STYLES[source]}`}>
      {SOURCE_LABELS[source]}
    </span>
  )
}

/** A labelled group of mutually-exclusive choices. */
export function ChoiceRow<T extends string>({ label, hint, value, options, onChange, disabled, source }: {
  label: string
  hint?: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  disabled?: boolean
  source?: SettingSource
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-gray-100 py-3 last:border-0 dark:border-gray-700/60 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
          {source && <ProvenanceBadge source={source} />}
        </div>
        {hint && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === option.value
                ? 'bg-white text-lamp-700 shadow-sm dark:bg-gray-700 dark:text-lamp-300'
                : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * The house-style controls. Identical at every layer of the cascade; `sources` is supplied
 * only where provenance is meaningful (the Filing tab), and omitted at the firm layer where
 * everything is by definition a firm setting.
 */
export function FilingStyleControls({ settings, onChange, disabled, sources }: {
  settings: ResolvedFilingSettings
  onChange: (patch: Partial<ResolvedFilingSettings>) => void
  disabled?: boolean
  sources?: Record<string, SettingSource>
}) {
  const src = (key: string) => sources?.[key]
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
      <ChoiceRow
        label="Empty field"
        hint="A field with no value, such as Street on an address that has none."
        value={settings.emptyFieldStyle}
        source={src('emptyFieldStyle')}
        disabled={disabled}
        onChange={v => onChange({ emptyFieldStyle: v })}
        options={[
          { value: 'dash', label: '–' },
          { value: 'na', label: 'NA' },
          { value: 'blank', label: 'Blank' },
        ]}
      />
      <ChoiceRow
        label="Inapplicable section"
        hint="A whole block that does not apply, such as the agent details when self-filing."
        value={settings.notApplicableStyle}
        source={src('notApplicableStyle')}
        disabled={disabled}
        onChange={v => onChange({ notApplicableStyle: v })}
        options={[
          { value: 'na', label: 'NA' },
          { value: 'dash', label: '–' },
          { value: 'blank', label: 'Blank' },
          { value: 'strike', label: 'Strike out' },
        ]}
      />
      <ChoiceRow
        label="Inapplicable declaration"
        hint="How a clause in paragraph 12(iii) is marked when it does not apply."
        value={settings.inapplicableClauseStyle}
        source={src('inapplicableClauseStyle')}
        disabled={disabled}
        onChange={v => onChange({ inapplicableClauseStyle: v })}
        options={[
          { value: 'cross', label: '☒ Cross' },
          { value: 'strike', label: 'Strike through' },
        ]}
      />
      <ChoiceRow
        label="Date style"
        hint="A blank day lets the signatory ink it in when they physically sign."
        value={settings.dateStyle}
        source={src('dateStyle')}
        disabled={disabled}
        onChange={v => onChange({ dateStyle: v })}
        options={[
          { value: 'blankDay', label: 'Dated this …… day of' },
          { value: 'fullDate', label: 'Full date' },
        ]}
      />
      <ChoiceRow
        label="Invention title"
        value={settings.titleCase}
        source={src('titleCase')}
        disabled={disabled}
        onChange={v => onChange({ titleCase: v })}
        options={[
          { value: 'upper', label: 'UPPER CASE' },
          { value: 'title', label: 'Title Case' },
          { value: 'preserve', label: 'As typed' },
        ]}
      />
      <ChoiceRow
        label="Names"
        hint="As typed is safest — automatic capitalisation mangles names like D'Souza and van der Berg."
        value={settings.nameCase}
        source={src('nameCase')}
        disabled={disabled}
        onChange={v => onChange({ nameCase: v })}
        options={[
          { value: 'preserve', label: 'As typed' },
          { value: 'title', label: 'Title Case' },
          { value: 'upper', label: 'UPPER CASE' },
        ]}
      />
      <ChoiceRow
        label="Patent Office branch"
        value={settings.officeBranch}
        source={src('officeBranch')}
        disabled={disabled}
        onChange={v => onChange({ officeBranch: v })}
        options={OFFICE_BRANCHES.map(b => ({ value: b, label: b }))}
      />
    </div>
  )
}

export interface DeclarationRow {
  key: string
  text: string
  state: DeclarationState
  source: SettingSource
  /** Which form/section this belongs to; rows are grouped under a heading per group. */
  group?: string
  conflict?: string
}

/**
 * Paragraph 12(iii), rendered in form order. Most rows are decided by the rules from the
 * filing facts, so an ordinary provisional filing needs no clicks here at all.
 */
export function DeclarationMatrix({ rows, labels, onChange, disabled, groupLabels }: {
  rows: DeclarationRow[]
  labels: Record<string, string>
  onChange: (key: string, state: DeclarationState) => void
  disabled?: boolean
  /** When supplied, rows are grouped under these headings in first-seen order. */
  groupLabels?: Record<string, string>
}) {
  // Group when we have headings and more than one group is present — otherwise a heading
  // above a single list is just noise.
  const groups = groupLabels
    ? rows.reduce<Array<{ key: string; label: string; items: DeclarationRow[] }>>((acc, r) => {
        const key = r.group || 'default'
        const existing = acc.find(g => g.key === key)
        if (existing) existing.items.push(r)
        else acc.push({ key, label: groupLabels[key] || '', items: [r] })
        return acc
      }, [])
    : null

  if (groups && groups.length > 1) {
    return (
      <div className="space-y-5">
        {groups.map(group => (
          <div key={group.key}>
            {group.label && (
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{group.label}</p>
            )}
            <DeclarationMatrix rows={group.items} labels={labels} onChange={onChange} disabled={disabled} />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-700/60">
      {rows.map(rowItem => (
        <div key={rowItem.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {labels[rowItem.key] || rowItem.key}
              </span>
              <ProvenanceBadge source={rowItem.source} />
            </div>
            {/* At the firm layer there is no per-filing clause text, so the row would
                otherwise print its own label twice. */}
            {rowItem.text && rowItem.text !== (labels[rowItem.key] || rowItem.key) && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400" title={rowItem.text}>
                {rowItem.text}
              </p>
            )}
            {rowItem.conflict && (
              <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">⚠ {rowItem.conflict}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900">
            {(['tick', 'cross', 'strike'] as DeclarationState[]).map(state => (
              <button
                key={state}
                type="button"
                disabled={disabled}
                onClick={() => onChange(rowItem.key, state)}
                title={state === 'tick' ? 'Applies' : state === 'cross' ? 'Does not apply' : 'Strike out'}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  rowItem.state === state
                    ? 'bg-white text-lamp-700 shadow-sm dark:bg-gray-700 dark:text-lamp-300'
                    : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                {state === 'tick' ? '☑' : state === 'cross' ? '☒' : 'S̶'}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface FilingIssue {
  severity: 'blocking' | 'advisory'
  field: string
  message: string
  section: string
}

/** The pre-generation checklist. Blocking issues stop the download; advisory ones do not. */
export function IssueList({ issues }: { issues: FilingIssue[] }) {
  const blocking = issues.filter(i => i.severity === 'blocking')
  const advisory = issues.filter(i => i.severity === 'advisory')

  if (!issues.length) {
    return (
      <p className="text-sm text-emerald-700 dark:text-emerald-400">
        Everything needed is present. The forms will generate complete.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {blocking.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800/50 dark:bg-amber-900/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Will print blank ({blocking.length})
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            The bundle still downloads. Fill these in here to have them printed, or complete them by hand on the forms.
          </p>
          <ul className="mt-1.5 space-y-1">
            {blocking.map((issue, i) => (
              <li key={`${issue.field}-${i}`} className="text-sm text-amber-900 dark:text-amber-200">• {issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      {advisory.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-amber-900/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
            Worth checking ({advisory.length})
          </p>
          <ul className="mt-1.5 space-y-1">
            {advisory.map((issue, i) => (
              <li key={`${issue.field}-${i}`} className="text-sm text-amber-800 dark:text-amber-200">• {issue.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
