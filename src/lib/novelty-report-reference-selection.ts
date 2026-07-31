import { normalizeRerankDecision, type RerankDecision } from './novelty-prior-art-visibility';

export const REPORT_REFERENCE_SELECTION_VERSION = 1 as const;

export type ReportReferencePriority = 'Critical' | 'High' | 'Medium' | 'Low';
export type ReportReferenceSelectionReason =
  | 'decisive'
  | 'high_overlap'
  | 'ranked_fill'
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
}

export interface SelectedReportReference {
  publicationNumber: string;
  canonicalPublicationNumber: string;
  reason: ReportReferenceSelectionReason;
  gateDecision?: RerankDecision;
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
}

export interface ReportReferenceSelectionV1 {
  version: typeof REPORT_REFERENCE_SELECTION_VERSION;
  main: SelectedReportReference[];
  mappedSupplementary: SelectedReportReference[];
  unmappedSupplementary: SelectedReportReference[];
  counts: ReportReferenceSelectionCounts;
}

export interface ReportReferenceSelectionOptions {
  mainReferenceTarget?: number;
  minMainReferences?: number;
  maxUnmappedSupplementaryReferences?: number;
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

function boundedInteger(value: unknown, fallback: number, minimum: number): number {
  const numeric = Math.trunc(finiteNumber(value, fallback));
  return Math.max(minimum, numeric);
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
  return {
    publicationNumber: candidate.publicationNumber,
    canonicalPublicationNumber: candidate.canonicalPublicationNumber,
    reason,
    ...(gateDecision ? { gateDecision } : {}),
  };
}

function unmappedReason(decision: RerankDecision): ReportReferenceSelectionReason {
  if (decision === 'accept') return 'gate_accept';
  if (decision === 'component') return 'gate_component';
  return 'gate_borderline';
}

export function selectNoveltyReportReferences(
  inputCandidates: ReportReferenceCandidate[],
  options: ReportReferenceSelectionOptions = {}
): ReportReferenceSelectionV1 {
  const { candidates, invalidPublicationNumbersExcluded } = normalizeCandidates(inputCandidates);
  const mainReferenceTarget = boundedInteger(options.mainReferenceTarget, 10, 0);
  const minMainReferences = boundedInteger(options.minMainReferences, 3, 0);
  const maxUnmappedSupplementaryReferences = boundedInteger(
    options.maxUnmappedSupplementaryReferences,
    20,
    0
  );
  const effectiveMainTarget = Math.max(mainReferenceTarget, minMainReferences);

  const mapped = candidates.filter(candidate => candidate.mapped).sort(compareMapped);
  const protectedMapped = mapped.filter(candidate => Boolean(protectedReason(candidate)));
  const protectedKeys = new Set(protectedMapped.map(candidate => candidate.canonicalPublicationNumber));
  const rankedFill = mapped.filter(candidate => !protectedKeys.has(candidate.canonicalPublicationNumber));
  const mainCandidates = [
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
    main: mainCandidates.map(candidate => selectedReference(
      candidate,
      protectedReason(candidate) || 'ranked_fill'
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
