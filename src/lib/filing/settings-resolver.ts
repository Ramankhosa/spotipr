/**
 * India filing forms — the settings cascade.
 *
 *     baseline  ->  firm preset  ->  project  ->  patent
 *
 * Each layer above the baseline is a SPARSE patch: only keys that layer deliberately set.
 * An absent key means "inherit" and must never collapse into the same thing as an explicit
 * value, which is why the layers are objects with optional keys rather than fully-populated
 * records.
 *
 * Every resolved key carries provenance so the UI can tell the attorney where a value came
 * from before they override it — and so "reset to project default" can actually work.
 */

import type {
  FilingSettingsPatch,
  Provenance,
  ResolvedFilingSettings,
  SettingSource,
} from './types'

/**
 * The built-in baseline — what a firm gets before it has expressed any preference. Chosen
 * to match the conventions in real attorney-prepared bundles: "-" for an empty field, "NA"
 * across an inapplicable section, ☒ for an inapplicable clause, and a blank-day date so the
 * day can be inked in at signing.
 */
export const BASELINE_SETTINGS: ResolvedFilingSettings = {
  emptyFieldStyle: 'dash',
  notApplicableStyle: 'na',
  inapplicableClauseStyle: 'cross',
  dateStyle: 'blankDay',
  officeBranch: 'Delhi',
  titleCase: 'upper',
  nameCase: 'preserve',
  addressLineTerminalPeriod: true,
  declarations: {},
  includeDocs: { form1: true, form5: true, drawings: true },
}

export interface CascadeLayer {
  source: SettingSource
  patch?: FilingSettingsPatch | null
}

export interface ResolvedSettingsWithProvenance {
  settings: ResolvedFilingSettings
  /** Per-key origin, for the "source" column in the settings UI. */
  provenance: Record<string, SettingSource>
  /** Per-clause origin for the declarations matrix. */
  declarationProvenance: Record<string, SettingSource>
}

/** Scalar keys that participate in the cascade. `declarations`/`includeDocs` merge specially. */
const SCALAR_KEYS = [
  'emptyFieldStyle',
  'notApplicableStyle',
  'inapplicableClauseStyle',
  'dateStyle',
  'officeBranch',
  'titleCase',
  'nameCase',
  'addressLineTerminalPeriod',
] as const

/**
 * Fold the layers in order. Later layers win per key, so a firm can set twelve keys, a
 * project override two of them, and a patent override one — with the other nine still
 * tracing back to the firm.
 */
export function resolveFilingSettings(layers: CascadeLayer[]): ResolvedSettingsWithProvenance {
  const settings: ResolvedFilingSettings = {
    ...BASELINE_SETTINGS,
    declarations: {},
    includeDocs: { ...BASELINE_SETTINGS.includeDocs },
  }
  const provenance: Record<string, SettingSource> = {}
  const declarationProvenance: Record<string, SettingSource> = {}

  for (const key of SCALAR_KEYS) provenance[key] = 'baseline'

  for (const layer of layers) {
    const patch = layer.patch
    if (!patch) continue

    for (const key of SCALAR_KEYS) {
      const value = patch[key]
      if (value !== undefined && value !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (settings as any)[key] = value
        provenance[key] = layer.source
      }
    }

    if (patch.declarations) {
      for (const [clause, state] of Object.entries(patch.declarations)) {
        if (!state) continue
        settings.declarations[clause as keyof typeof settings.declarations] = state
        declarationProvenance[clause] = layer.source
      }
    }

    if (patch.includeDocs) {
      for (const [doc, enabled] of Object.entries(patch.includeDocs)) {
        if (enabled === undefined || enabled === null) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (settings.includeDocs as any)[doc] = enabled
        provenance[`includeDocs.${doc}`] = layer.source
      }
    }
  }

  return { settings, provenance, declarationProvenance }
}

/**
 * Build the ordered layer list. Callers pass the raw JSON columns; this keeps the ordering
 * decision — firm, then project, then patent — in exactly one place.
 */
export function buildCascade(input: {
  firmPreset?: unknown
  projectPatch?: unknown
  patentPatch?: unknown
}): CascadeLayer[] {
  return [
    { source: 'firm', patch: asPatch(input.firmPreset) },
    { source: 'project', patch: asPatch(input.projectPatch) },
    { source: 'patent', patch: asPatch(input.patentPatch) },
  ]
}

/**
 * Prisma `Json` columns arrive as `unknown`. Anything that is not a plain object is treated
 * as "no patch" rather than throwing — a malformed preference row must never block a filing.
 */
export function asPatch(value: unknown): FilingSettingsPatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as FilingSettingsPatch
}

/**
 * Diff a full settings object against what the layers *below* it already resolve to, and
 * return only the genuine deviations.
 *
 * This is what "Save as project default" / "Save as firm default" writes: storing a full
 * copy at every layer would freeze inherited values and silently detach a project from
 * later firm-level changes.
 */
export function diffToPatch(
  desired: ResolvedFilingSettings,
  inheritedLayers: CascadeLayer[]
): FilingSettingsPatch {
  const { settings: inherited } = resolveFilingSettings(inheritedLayers)
  const patch: FilingSettingsPatch = {}

  for (const key of SCALAR_KEYS) {
    if (desired[key] !== inherited[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = desired[key]
    }
  }

  const declarations: FilingSettingsPatch['declarations'] = {}
  for (const [clause, state] of Object.entries(desired.declarations || {})) {
    if (state && inherited.declarations?.[clause as keyof typeof inherited.declarations] !== state) {
      declarations[clause as keyof typeof declarations] = state
    }
  }
  if (Object.keys(declarations).length) patch.declarations = declarations

  const includeDocs: NonNullable<FilingSettingsPatch['includeDocs']> = {}
  for (const doc of ['form1', 'form5', 'drawings'] as const) {
    if (desired.includeDocs[doc] !== inherited.includeDocs[doc]) includeDocs[doc] = desired.includeDocs[doc]
  }
  if (Object.keys(includeDocs).length) patch.includeDocs = includeDocs

  return patch
}

/**
 * Drop a key at one layer so it falls through to the layer below — the "reset to inherited"
 * action in the UI.
 */
export function clearFromPatch(
  patch: FilingSettingsPatch | null | undefined,
  key: keyof FilingSettingsPatch
): FilingSettingsPatch {
  const next: FilingSettingsPatch = { ...(patch || {}) }
  delete next[key]
  return next
}

/** Fee suggestions (rupees, e-filing) by applicant category. Config, not law — always
 *  overridable on the filing, and kept here so a fee revision is a one-line change. */
export const EFILING_FEE_BY_CATEGORY: Record<string, number> = {
  natural_person: 1600,
  startup: 1600,
  small_entity: 1600,
  educational_institute: 1600,
  others: 8000,
}

export function suggestFee(category: string): number {
  return EFILING_FEE_BY_CATEGORY[category] ?? EFILING_FEE_BY_CATEGORY.others
}
