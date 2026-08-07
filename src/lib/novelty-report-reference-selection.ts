import { normalizeRerankDecision, type RerankDecision } from './novelty-prior-art-visibility';

export const REPORT_REFERENCE_SELECTION_VERSION = 1 as const;

/**
 * Hard ceilings on caller-supplied selection options.
 *
 * `POST /api/novelty-search` forwards the client `config` straight into
 * `mergeConfig`, so these values are reachable from a request body. Clamping here
 * protects both the pipeline writer and the report renderer with one change.
 */
export const MAIN_REFERENCE_CEILING = 20;
const MIN_MAIN_REFERENCES_CEILING = 10;
const UNMAPPED_SUPPLEMENTARY_CEILING = 50;

/**
 * How many references `main` holds when the materiality bar admits fewer.
 *
 * Under `materiality_v1` this is the only thing standing between a report and a
 * three-reference prior-art section: `mainReferenceTarget` is not read by that
 * rule, so the floor — not the target — decides the report's baseline width. It
 * was 3, which is a sanity minimum rather than a usable report, and on a typical
 * run nothing clears the bar, so 3 was what attorneys actually got.
 *
 * Set to the ceiling on the floor itself, so a report shows ten detailed
 * references by default and the materiality bar can still promote above that up
 * to MAIN_REFERENCE_CEILING. Raising it further means raising
 * MIN_MAIN_REFERENCES_CEILING too.
 */
export const DEFAULT_MIN_MAIN_REFERENCES = 10;

/**
 * Which selection rule produced a stored selection.
 *
 * Carried inside the persisted blob rather than encoded in
 * REPORT_REFERENCE_SELECTION_VERSION on purpose: bumping the version would make
 * every historical selection fail validation and recompute, which would change
 * reports an attorney has already downloaded. The discriminator lets a stale or
 * absent selection recompute under the rule it was written with.
 *
 * - `fixed_target_v1` — fill `main` to `mainReferenceTarget` (legacy, the default).
 * - `materiality_v1`  — include references that clear the materiality bar.
 */
export type ReportReferenceSelectionRule = 'fixed_target_v1' | 'materiality_v1';

export const DEFAULT_REPORT_REFERENCE_SELECTION_RULE: ReportReferenceSelectionRule = 'fixed_target_v1';

export function normalizeReportReferenceSelectionRule(value: unknown): ReportReferenceSelectionRule {
  return value === 'materiality_v1' ? 'materiality_v1' : DEFAULT_REPORT_REFERENCE_SELECTION_RULE;
}

export type ReportReferencePriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type ReportReferenceSelectionReason =
  | 'decisive'
  | 'high_overlap'
  | 'ranked_fill'
  | 'coverage_diversity'
  | 'mapped_supplementary'
  | 'gate_accept'
  | 'gate_component'
  | 'gate_borderline';

export interface ReportReferenceCandidate {
  publicationNumber: string;
  mapped: boolean;
  sourceOrder?: number;
  priority?: ReportReferencePriority | string;
  priorityScore?: number | null;
  featureCoverage?: number | null;
  gateScore?: number | null;
  gateDecision?: string | null;
  hasGateRecord?: boolean;
  evidenceQuality?: string | null;
  canonicalDecisive?: boolean;
  noveltyThreat?: string | null;
  overlapRiskLevel?: string | null;
  /**
   * Priority tier before the display caps in `applySelectivePriorities` are
   * applied. The capped `priority` would re-impose an arbitrary bound of 12
   * (4 Critical + 8 High) on the materiality rule, so the bar reads this instead
   * and falls back to `priority` when a caller does not supply it.
   */
  desiredPriority?: ReportReferencePriority | string;
  /** Important features (core_technical / novelty_candidate) this reference maps with strong evidence. */
  mappedImportantFeatures?: string[];
  /** True when at least one feature is Present or Partial, i.e. not an all-Unknown degraded map. */
  hasMappedEvidence?: boolean;
  /**
   * Patent family this reference belongs to. When absent, or when it degrades to
   * the publication number itself, no family relationship is asserted and the
   * reference is treated as its own family.
   */
  familyKey?: string;
}

export interface SelectedReportReference {
  publicationNumber: string;
  canonicalPublicationNumber: string;
  reason: ReportReferenceSelectionReason;
  gateDecision?: RerankDecision;
  /** Persisted so a later render reproduces the same family decision without its own lookup. */
  familyKey?: string;
}

export interface ReportReferenceSelectionCounts {
  mappedTotal: number;
  mainDisplayed: number;
  mappedSupplementaryDisplayed: number;
  unmappedEligibleTotal: number;
  unmappedDisplayed: number;
  unmappedOmitted: number;
  explicitlyRejectedExcluded: number;
  ungatedExcluded: number;
  invalidPublicationNumbersExcluded: number;
  protectedOverflow: number;
  /** materiality_v1 only: references that cleared the bar but did not fit under the ceiling. */
  materialityOverflow?: number;
  /** materiality_v1 only: references admitted purely to cover an otherwise-uncovered important feature. */
  diversityAdmitted?: number;
  /** materiality_v1 only: references moved to the appendix because a family sibling is already shown. */
  familyDemoted?: number;
}

export interface ReportReferenceSelectionV1 {
  version: typeof REPORT_REFERENCE_SELECTION_VERSION;
  /** Absent on selections written before the rule was introduced; treat as `fixed_target_v1`. */
  rule?: ReportReferenceSelectionRule;
  main: SelectedReportReference[];
  mappedSupplementary: SelectedReportReference[];
  unmappedSupplementary: SelectedReportReference[];
  counts: ReportReferenceSelectionCounts;
}

export interface ReportReferenceSelectionOptions {
  /** `fixed_target_v1` only. `materiality_v1` sizes `main` from the bar and the floor. */
  mainReferenceTarget?: number;
  /** Defaults to DEFAULT_MIN_MAIN_REFERENCES. Clamped to MIN_MAIN_REFERENCES_CEILING. */
  minMainReferences?: number;
  maxUnmappedSupplementaryReferences?: number;
  /** Defaults to `fixed_target_v1` so existing call sites are unchanged. */
  rule?: ReportReferenceSelectionRule;
}

export interface ReportReferenceSelectionValidation {
  valid: boolean;
  reason?: string;
}

type NormalizedCandidate = ReportReferenceCandidate & {
  canonicalPublicationNumber: string;
  sourceOrder: number;
};

export function canonicalReportPublicationNumber(value: unknown): string {
  const compact = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('PAPER')) return compact;
  return compact.match(/^(.+\d)[A-Z]\d?$/)?.[1] || compact;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  const numeric = Math.trunc(finiteNumber(value, fallback));
  return Math.min(maximum, Math.max(minimum, numeric));
}

function priorityRank(value: unknown): number {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'critical') return 4;
  if (normalized === 'high') return 3;
  if (normalized === 'medium') return 2;
  return 1;
}

function evidenceQualityRank(value: unknown): number {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'high' || normalized === 'strong') return 3;
  if (normalized === 'medium' || normalized === 'moderate') return 2;
  if (normalized === 'low' || normalized === 'weak') return 1;
  return 0;
}

function gateDecisionRank(value: unknown): number {
  const decision = normalizeRerankDecision(value);
  if (decision === 'accept') return 3;
  if (decision === 'component') return 2;
  if (decision === 'borderline') return 1;
  return 0;
}

function isHighOverlap(candidate: ReportReferenceCandidate): boolean {
  const threat = String(candidate.noveltyThreat || '').trim().toLowerCase();
  const risk = String(candidate.overlapRiskLevel || '').trim().toLowerCase();
  return threat === 'high_overlap' || threat === 'high overlap' || risk === 'high';
}

function protectedReason(candidate: ReportReferenceCandidate): ReportReferenceSelectionReason | undefined {
  if (candidate.canonicalDecisive) return 'decisive';
  if (isHighOverlap(candidate)) return 'high_overlap';
  return undefined;
}

function compareMapped(a: NormalizedCandidate, b: NormalizedCandidate): number {
  return (
    priorityRank(b.priority) - priorityRank(a.priority) ||
    finiteNumber(b.priorityScore) - finiteNumber(a.priorityScore) ||
    finiteNumber(b.featureCoverage) - finiteNumber(a.featureCoverage) ||
    finiteNumber(b.gateScore) - finiteNumber(a.gateScore) ||
    a.sourceOrder - b.sourceOrder ||
    a.canonicalPublicationNumber.localeCompare(b.canonicalPublicationNumber)
  );
}

function compareUnmapped(a: NormalizedCandidate, b: NormalizedCandidate): number {
  return (
    gateDecisionRank(b.gateDecision) - gateDecisionRank(a.gateDecision) ||
    finiteNumber(b.gateScore) - finiteNumber(a.gateScore) ||
    evidenceQualityRank(b.evidenceQuality) - evidenceQualityRank(a.evidenceQuality) ||
    a.sourceOrder - b.sourceOrder ||
    a.canonicalPublicationNumber.localeCompare(b.canonicalPublicationNumber)
  );
}

function mergeDuplicateCandidate(current: NormalizedCandidate, incoming: NormalizedCandidate): NormalizedCandidate {
  const preferred = current.mapped !== incoming.mapped
    ? (incoming.mapped ? incoming : current)
    : ([current, incoming].sort(current.mapped ? compareMapped : compareUnmapped)[0]);
  const other = preferred === current ? incoming : current;
  return {
    ...other,
    ...preferred,
    mapped: current.mapped || incoming.mapped,
    sourceOrder: Math.min(current.sourceOrder, incoming.sourceOrder),
    canonicalPublicationNumber: current.canonicalPublicationNumber,
    canonicalDecisive: Boolean(current.canonicalDecisive || incoming.canonicalDecisive),
    noveltyThreat: isHighOverlap(current) ? current.noveltyThreat : incoming.noveltyThreat,
    overlapRiskLevel: String(current.overlapRiskLevel || '').toLowerCase() === 'high'
      ? current.overlapRiskLevel
      : incoming.overlapRiskLevel,
    hasGateRecord: Boolean(current.hasGateRecord || incoming.hasGateRecord),
    priorityScore: Math.max(finiteNumber(current.priorityScore), finiteNumber(incoming.priorityScore)),
    featureCoverage: Math.max(finiteNumber(current.featureCoverage), finiteNumber(incoming.featureCoverage)),
    gateScore: Math.max(finiteNumber(current.gateScore), finiteNumber(incoming.gateScore)),
  };
}

function normalizeCandidates(candidates: ReportReferenceCandidate[]): {
  candidates: NormalizedCandidate[];
  invalidPublicationNumbersExcluded: number;
} {
  const byPublication = new Map<string, NormalizedCandidate>();
  let invalidPublicationNumbersExcluded = 0;
  (Array.isArray(candidates) ? candidates : []).forEach((candidate, index) => {
    const canonicalPublicationNumber = canonicalReportPublicationNumber(candidate?.publicationNumber);
    if (!canonicalPublicationNumber) {
      invalidPublicationNumbersExcluded += 1;
      return;
    }
    const normalized: NormalizedCandidate = {
      ...candidate,
      publicationNumber: String(candidate.publicationNumber || '').trim(),
      canonicalPublicationNumber,
      sourceOrder: Number.isFinite(Number(candidate.sourceOrder)) ? Number(candidate.sourceOrder) : index,
    };
    const current = byPublication.get(canonicalPublicationNumber);
    byPublication.set(
      canonicalPublicationNumber,
      current ? mergeDuplicateCandidate(current, normalized) : normalized
    );
  });
  return { candidates: Array.from(byPublication.values()), invalidPublicationNumbersExcluded };
}

function selectedReference(
  candidate: NormalizedCandidate,
  reason: ReportReferenceSelectionReason
): SelectedReportReference {
  const gateDecision = candidate.hasGateRecord
    ? normalizeRerankDecision(candidate.gateDecision)
    : undefined;
  const familyKey = familyKeyOf(candidate);
  return {
    publicationNumber: candidate.publicationNumber,
    canonicalPublicationNumber: candidate.canonicalPublicationNumber,
    reason,
    ...(gateDecision ? { gateDecision } : {}),
    ...(familyKey ? { familyKey } : {}),
  };
}

/**
 * The family this reference belongs to, or undefined when no family relationship
 * is known. A key equal to the reference's own canonical publication number
 * carries no grouping information — that is what the family-key helper returns
 * when a provider supplied no family id — so it is treated as absent.
 */
function familyKeyOf(candidate: ReportReferenceCandidate & { canonicalPublicationNumber?: string }): string | undefined {
  const raw = String(candidate.familyKey || '').trim();
  if (!raw) return undefined;
  const canonicalSelf = candidate.canonicalPublicationNumber
    || canonicalReportPublicationNumber(candidate.publicationNumber);
  if (canonicalReportPublicationNumber(raw) === canonicalSelf) return undefined;
  return raw;
}

function unmappedReason(decision: RerankDecision): ReportReferenceSelectionReason {
  if (decision === 'accept') return 'gate_accept';
  if (decision === 'component') return 'gate_component';
  return 'gate_borderline';
}

/**
 * The materiality bar: a reference earns a detailed feature-by-feature card when
 * its uncapped priority tier is Critical or High.
 *
 * Those tiers already encode the thresholds used elsewhere in the report
 * (`Critical` = a mapped primary claim relationship, or >=75% important-feature
 * coverage with >=2 strongly mapped important features; `High` = >=2 strongly
 * mapped important features, or >=1 novelty-candidate feature, or >=50% important
 * coverage). A looser bar such as "maps any important feature" admits nearly every
 * mapped reference and simply relocates the fixed count.
 */
function clearsMaterialityBar(candidate: NormalizedCandidate): boolean {
  const tier = String(candidate.desiredPriority ?? candidate.priority ?? '').trim().toLowerCase();
  return tier === 'critical' || tier === 'high';
}

function importantFeatureKeys(candidate: NormalizedCandidate): string[] {
  if (!Array.isArray(candidate.mappedImportantFeatures)) return [];
  return candidate.mappedImportantFeatures
    .map(feature => String(feature || '').trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A reference with no Present/Partial cell anywhere carries no evidence — an
 * all-Unknown degraded batch produces exactly that. It may still be admitted to
 * satisfy the floor, but only after every reference that does carry evidence.
 */
function hasEvidence(candidate: NormalizedCandidate): boolean {
  if (typeof candidate.hasMappedEvidence === 'boolean') return candidate.hasMappedEvidence;
  return finiteNumber(candidate.featureCoverage) > 0 || importantFeatureKeys(candidate).length > 0;
}

interface MaterialityMainSelection {
  main: NormalizedCandidate[];
  reasons: Map<string, ReportReferenceSelectionReason>;
  materialityOverflow: number;
  diversityAdmitted: number;
  familyDemoted: number;
}

/**
 * Build `main` from evidence rather than from a fixed count.
 *
 * Order of operations:
 * 1. Every decisive reference, exempt from the ceiling — a report must always show
 *    the reference its own verdict names, and the decisive set is small by
 *    construction.
 * 2. References clearing the materiality bar, plus high-overlap references. Unlike
 *    decisive, high overlap is model-assigned and unbounded, so it competes for
 *    slots under the ceiling instead of overflowing it.
 * 3. Diversity: a reference that is the only remaining source of an important
 *    feature no selected reference maps. It displaces the lowest-ranked ordinary
 *    fill when the ceiling is already reached, never a decisive reference.
 * 4. Floor: top up to `floor` so a report is never built on one or two references,
 *    preferring references that carry evidence.
 */
function selectMaterialityMain(
  mapped: NormalizedCandidate[],
  ceiling: number,
  floor: number
): MaterialityMainSelection {
  const reasons = new Map<string, ReportReferenceSelectionReason>();
  const keyOf = (candidate: NormalizedCandidate) => candidate.canonicalPublicationNumber;

  const decisive = mapped.filter(candidate => Boolean(candidate.canonicalDecisive));
  decisive.forEach(candidate => reasons.set(keyOf(candidate), 'decisive'));
  const decisiveKeys = new Set(decisive.map(keyOf));

  const rest = mapped.filter(candidate => !decisiveKeys.has(keyOf(candidate)));

  // Family demotion: the same invention filed in three countries is one piece of
  // prior art, and letting all three occupy detail slots crowds out distinct
  // references. Decisive references are never demoted — the report's own verdict
  // names them. Applied only to `main`; the partition is untouched, so every
  // sibling is still counted as analysed and still appears in the appendix.
  const familySeen = new Set<string>();
  decisive.forEach(candidate => {
    const family = familyKeyOf(candidate);
    if (family) familySeen.add(family);
  });
  const familyDemoted: NormalizedCandidate[] = [];
  const familyEligible = rest.filter(candidate => {
    const family = familyKeyOf(candidate);
    if (!family) return true;
    if (familySeen.has(family)) {
      familyDemoted.push(candidate);
      return false;
    }
    familySeen.add(family);
    return true;
  });

  const qualifying = familyEligible.filter(candidate => clearsMaterialityBar(candidate) || isHighOverlap(candidate));
  const slots = Math.max(0, ceiling - decisive.length);
  const admitted = qualifying.slice(0, slots);
  admitted.forEach(candidate => reasons.set(
    keyOf(candidate),
    isHighOverlap(candidate) ? 'high_overlap' : 'ranked_fill'
  ));
  const materialityOverflow = Math.max(0, qualifying.length - admitted.length);

  let main = [...decisive, ...admitted];
  let diversityAdmitted = 0;

  // 3. Coverage diversity.
  const selectedKeys = new Set(main.map(keyOf));
  const covered = new Set<string>();
  main.forEach(candidate => importantFeatureKeys(candidate).forEach(feature => covered.add(feature)));
  const displaceable = () => {
    for (let index = main.length - 1; index >= 0; index -= 1) {
      const candidate = main[index];
      if (reasons.get(keyOf(candidate)) === 'ranked_fill') return index;
    }
    return -1;
  };
  for (const candidate of familyEligible) {
    if (selectedKeys.has(keyOf(candidate))) continue;
    const unique = importantFeatureKeys(candidate).filter(feature => !covered.has(feature));
    if (unique.length === 0) continue;
    if (main.length >= ceiling) {
      const displaceIndex = displaceable();
      if (displaceIndex < 0) break;
      const removed = main[displaceIndex];
      main.splice(displaceIndex, 1);
      reasons.delete(keyOf(removed));
      selectedKeys.delete(keyOf(removed));
    }
    main.push(candidate);
    selectedKeys.add(keyOf(candidate));
    reasons.set(keyOf(candidate), 'coverage_diversity');
    unique.forEach(feature => covered.add(feature));
    diversityAdmitted += 1;
  }

  // 4. Floor. Never fabricates: it can only promote references that exist.
  // Distinct families first — a family sibling is only re-admitted when there is
  // nothing else left to show.
  if (main.length < floor) {
    const remaining = [...familyEligible, ...familyDemoted]
      .filter(candidate => !selectedKeys.has(keyOf(candidate)))
      .sort((a, b) => Number(hasEvidence(b)) - Number(hasEvidence(a)));
    for (const candidate of remaining) {
      if (main.length >= floor) break;
      main.push(candidate);
      selectedKeys.add(keyOf(candidate));
      reasons.set(keyOf(candidate), 'ranked_fill');
    }
  }

  // Keep `main` in ranked order so downstream consumers that take the first N
  // (the drafting handoff digest takes 5) get the strongest references.
  main = main.sort(compareMapped);
  const familyDemotedFromMain = familyDemoted.filter(candidate => !selectedKeys.has(keyOf(candidate))).length;
  return { main, reasons, materialityOverflow, diversityAdmitted, familyDemoted: familyDemotedFromMain };
}

export function selectNoveltyReportReferences(
  inputCandidates: ReportReferenceCandidate[],
  options: ReportReferenceSelectionOptions = {}
): ReportReferenceSelectionV1 {
  const { candidates, invalidPublicationNumbersExcluded } = normalizeCandidates(inputCandidates);
  const rule = normalizeReportReferenceSelectionRule(options.rule);
  const mainReferenceTarget = boundedInteger(options.mainReferenceTarget, 10, 0, MAIN_REFERENCE_CEILING);
  const minMainReferences = boundedInteger(
    options.minMainReferences,
    DEFAULT_MIN_MAIN_REFERENCES,
    0,
    MIN_MAIN_REFERENCES_CEILING
  );
  const maxUnmappedSupplementaryReferences = boundedInteger(
    options.maxUnmappedSupplementaryReferences,
    20,
    0,
    UNMAPPED_SUPPLEMENTARY_CEILING
  );
  const effectiveMainTarget = Math.max(mainReferenceTarget, minMainReferences);

  const mapped = candidates.filter(candidate => candidate.mapped).sort(compareMapped);
  const protectedMapped = mapped.filter(candidate => Boolean(protectedReason(candidate)));
  const protectedKeys = new Set(protectedMapped.map(candidate => candidate.canonicalPublicationNumber));
  const rankedFill = mapped.filter(candidate => !protectedKeys.has(candidate.canonicalPublicationNumber));

  const materiality = rule === 'materiality_v1'
    ? selectMaterialityMain(mapped, MAIN_REFERENCE_CEILING, minMainReferences)
    : null;
  const mainCandidates = materiality
    ? materiality.main
    : [
      ...protectedMapped,
      ...rankedFill.slice(0, Math.max(0, effectiveMainTarget - protectedMapped.length)),
    ];
  const mainKeys = new Set(mainCandidates.map(candidate => candidate.canonicalPublicationNumber));
  const mappedSupplementaryCandidates = mapped.filter(candidate => !mainKeys.has(candidate.canonicalPublicationNumber));

  const unmapped = candidates.filter(candidate => !candidate.mapped);
  const eligibleUnmapped = unmapped.filter(candidate => {
    if (!candidate.hasGateRecord) return false;
    return normalizeRerankDecision(candidate.gateDecision) !== 'reject';
  }).sort(compareUnmapped);
  const displayedUnmapped = eligibleUnmapped.slice(0, maxUnmappedSupplementaryReferences);
  const explicitlyRejectedExcluded = unmapped.filter(candidate =>
    candidate.hasGateRecord && normalizeRerankDecision(candidate.gateDecision) === 'reject'
  ).length;
  const ungatedExcluded = unmapped.filter(candidate => !candidate.hasGateRecord).length;

  return {
    version: REPORT_REFERENCE_SELECTION_VERSION,
    rule,
    main: mainCandidates.map(candidate => selectedReference(
      candidate,
      materiality
        ? (materiality.reasons.get(candidate.canonicalPublicationNumber) || 'ranked_fill')
        : (protectedReason(candidate) || 'ranked_fill')
    )),
    mappedSupplementary: mappedSupplementaryCandidates.map(candidate =>
      selectedReference(candidate, 'mapped_supplementary')
    ),
    unmappedSupplementary: displayedUnmapped.map(candidate => {
      const decision = normalizeRerankDecision(candidate.gateDecision);
      return selectedReference(candidate, unmappedReason(decision));
    }),
    counts: {
      mappedTotal: mapped.length,
      mainDisplayed: mainCandidates.length,
      mappedSupplementaryDisplayed: mappedSupplementaryCandidates.length,
      unmappedEligibleTotal: eligibleUnmapped.length,
      unmappedDisplayed: displayedUnmapped.length,
      unmappedOmitted: Math.max(0, eligibleUnmapped.length - displayedUnmapped.length),
      explicitlyRejectedExcluded,
      ungatedExcluded,
      invalidPublicationNumbersExcluded,
      protectedOverflow: Math.max(0, protectedMapped.length - effectiveMainTarget),
      ...(materiality ? {
        materialityOverflow: materiality.materialityOverflow,
        diversityAdmitted: materiality.diversityAdmitted,
        familyDemoted: materiality.familyDemoted,
      } : {}),
    },
  };
}

function selectionKeys(items: unknown): string[] | null {
  if (!Array.isArray(items)) return null;
  const keys: string[] = [];
  for (const item of items) {
    const key = canonicalReportPublicationNumber((item as any)?.canonicalPublicationNumber || (item as any)?.publicationNumber);
    if (!key) return null;
    keys.push(key);
  }
  return keys;
}

export function validateReportReferenceSelection(
  value: unknown,
  candidates: ReportReferenceCandidate[]
): ReportReferenceSelectionValidation {
  const selection = value as ReportReferenceSelectionV1 | null | undefined;
  if (!selection || selection.version !== REPORT_REFERENCE_SELECTION_VERSION) {
    return { valid: false, reason: 'missing_or_unsupported_version' };
  }
  const main = selectionKeys(selection.main);
  const mappedSupplementary = selectionKeys(selection.mappedSupplementary);
  const unmappedSupplementary = selectionKeys(selection.unmappedSupplementary);
  if (!main || !mappedSupplementary || !unmappedSupplementary || !selection.counts) {
    return { valid: false, reason: 'invalid_selection_shape' };
  }
  const allSelected = [...main, ...mappedSupplementary, ...unmappedSupplementary];
  if (new Set(allSelected).size !== allSelected.length) {
    return { valid: false, reason: 'duplicate_or_overlapping_references' };
  }

  const normalizedResult = normalizeCandidates(candidates);
  const normalized = normalizedResult.candidates;
  const mappedExpected = new Set(normalized.filter(candidate => candidate.mapped).map(candidate => candidate.canonicalPublicationNumber));
  const mappedActual = new Set([...main, ...mappedSupplementary]);
  if (mappedActual.size !== mappedExpected.size || Array.from(mappedExpected).some(key => !mappedActual.has(key))) {
    return { valid: false, reason: 'mapped_partition_is_stale_or_incomplete' };
  }
  const eligibleUnmapped = normalized.filter(candidate =>
    !candidate.mapped && candidate.hasGateRecord && normalizeRerankDecision(candidate.gateDecision) !== 'reject'
  );
  const explicitlyRejectedExcluded = normalized.filter(candidate =>
    !candidate.mapped && candidate.hasGateRecord && normalizeRerankDecision(candidate.gateDecision) === 'reject'
  ).length;
  const ungatedExcluded = normalized.filter(candidate => !candidate.mapped && !candidate.hasGateRecord).length;
  const eligibleKeys = new Set(eligibleUnmapped.map(candidate => candidate.canonicalPublicationNumber));
  if (unmappedSupplementary.some(key => !eligibleKeys.has(key))) {
    return { valid: false, reason: 'unmapped_selection_contains_ineligible_reference' };
  }
  if (
    selection.counts.mappedTotal !== mappedExpected.size ||
    selection.counts.mainDisplayed !== main.length ||
    selection.counts.mappedSupplementaryDisplayed !== mappedSupplementary.length ||
    selection.counts.unmappedEligibleTotal !== eligibleUnmapped.length ||
    selection.counts.unmappedDisplayed !== unmappedSupplementary.length ||
    selection.counts.unmappedOmitted !== Math.max(0, eligibleUnmapped.length - unmappedSupplementary.length) ||
    selection.counts.explicitlyRejectedExcluded !== explicitlyRejectedExcluded ||
    selection.counts.ungatedExcluded !== ungatedExcluded ||
    selection.counts.invalidPublicationNumbersExcluded !== normalizedResult.invalidPublicationNumbersExcluded
  ) {
    return { valid: false, reason: 'selection_counts_are_stale_or_inconsistent' };
  }
  return { valid: true };
}
