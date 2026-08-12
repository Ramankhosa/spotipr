// Pure arithmetic for adaptive novelty report width: the complexity band that
// bounds how many references a report may show, and the greedy k-cover
// selection that decides when the shown set actually covers the invention.
//
// Client-safe on purpose (no Prisma, no server imports) — the same split as
// prior-art-studio/element-math.ts, so both the pipeline writer and the report
// renderer compute identical selections from identical inputs.

export type NoveltyComplexity = 'simple' | 'moderate' | 'complex' | 'crowded';

export type NoveltyFeatureType = 'core_technical' | 'implementation' | 'novelty_candidate' | 'generic_weak';

export interface ComplexityBand {
  complexity: NoveltyComplexity;
  floor: number;
  ceiling: number;
}

export interface CoverageImportantFeature {
  feature: string;
  type: NoveltyFeatureType;
}

export type KByType = Partial<Record<NoveltyFeatureType, number>>;

/**
 * Corroboration depth per feature type: how many distinct references must
 * evidence a feature before the report stops adding references for it. Features
 * claimed as novel warrant the deepest corroboration — an attorney reading
 * "novel" wants to see the closest three misses, not the closest one.
 */
export const DEFAULT_K_BY_TYPE: Required<KByType> = {
  novelty_candidate: 3,
  core_technical: 2,
  implementation: 1,
  generic_weak: 0,
};

/** Hard ceiling on any band; also the report-wide reference ceiling. */
export const REPORT_BAND_CEILING_MAX = 25;

const BAND_TABLE: Record<NoveltyComplexity, { floor: number; ceiling: number }> = {
  simple: { floor: 3, ceiling: 8 },
  moderate: { floor: 5, ceiling: 14 },
  complex: { floor: 7, ceiling: 20 },
  crowded: { floor: 8, ceiling: 25 },
};

/**
 * The width range a report is allowed to occupy, derived from the invention's
 * complexity classification (adaptiveComplexityProfile) rather than a constant.
 * The ceiling stretches for feature-heavy inventions — an 18-feature invention
 * deserves headroom even if the unit heuristic scored it 'moderate' — but never
 * past REPORT_BAND_CEILING_MAX.
 */
export function resolveComplexityBand(
  complexity: NoveltyComplexity | string | undefined,
  importantFeatureCount: number
): ComplexityBand {
  const normalized: NoveltyComplexity =
    complexity === 'moderate' || complexity === 'complex' || complexity === 'crowded'
      ? complexity
      : 'simple';
  const base = BAND_TABLE[normalized];
  const featureCount = Number.isFinite(importantFeatureCount) ? Math.max(0, Math.trunc(importantFeatureCount)) : 0;
  const ceiling = Math.min(
    REPORT_BAND_CEILING_MAX,
    Math.max(base.ceiling, Math.ceil(featureCount * 1.2))
  );
  return { complexity: normalized, floor: Math.min(base.floor, ceiling), ceiling };
}

/**
 * Same scale as the renderer's prioritizationFeatureWeight, so a
 * novelty-candidate feature pulls a reference into the report harder than an
 * implementation detail does.
 */
function featureWeight(type: NoveltyFeatureType): number {
  if (type === 'novelty_candidate') return 2;
  if (type === 'core_technical') return 1.5;
  if (type === 'implementation') return 0.7;
  return 0.2;
}

function featureKey(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export interface KCoverCandidate {
  /** Stable identity (canonical publication number). */
  key: string;
  /** Important features this candidate evidences (any Present/Partial cell). */
  coveredFeatures: string[];
  priorityScore?: number | null;
  sourceOrder?: number;
}

export interface KCoverFeatureStatus {
  feature: string;
  type: NoveltyFeatureType;
  /** min(k(type), candidates that can evidence it) — never demands what does not exist. */
  required: number;
  available: number;
  satisfiedBy: string[];
}

export interface KCoverResult {
  /** Keys in admission order (greedy, deterministic). */
  selectedKeys: string[];
  perFeature: KCoverFeatureStatus[];
  featuresCovered: number;
  featuresTotal: number;
}

/**
 * Greedy k-cover: admit candidates until every important feature has its
 * required number of distinct supporters, or no remaining candidate adds one.
 *
 * The invention decides the width: a simple idea whose features are all
 * evidenced by three references closes at three; a feature-heavy idea with low
 * redundancy keeps admitting. Deterministic by construction — ties break on
 * marginal weighted gain, then priorityScore, then sourceOrder, then key — so
 * the pipeline writer and a renderer recompute always agree.
 */
export interface KCoverOptions {
  kByType?: KByType;
  /**
   * Keys admitted before the greedy loop runs, in the given order, regardless
   * of gain. Their evidence counts toward feature demand, so closure only adds
   * references for demand the preselected set leaves unmet. Used to seed the
   * decisive + bar-cleared references a report must show anyway.
   */
  preselected?: string[];
}

export function kCoverSelect(
  candidates: KCoverCandidate[],
  importantFeatures: CoverageImportantFeature[],
  options: KCoverOptions = {}
): KCoverResult {
  const kByType = options.kByType || {};
  const k: Required<KByType> = { ...DEFAULT_K_BY_TYPE, ...sanitizeKByType(kByType) };
  const features = (Array.isArray(importantFeatures) ? importantFeatures : [])
    .map(entry => ({ feature: String(entry?.feature || '').trim(), type: normalizeFeatureType(entry?.type) }))
    .filter(entry => entry.feature);
  const byFeatureKey = new Map(features.map(entry => [featureKey(entry.feature), entry]));

  const pool = (Array.isArray(candidates) ? candidates : [])
    .filter(candidate => candidate && String(candidate.key || '').trim())
    .map((candidate, index) => ({
      key: String(candidate.key).trim(),
      covered: Array.from(new Set(
        (Array.isArray(candidate.coveredFeatures) ? candidate.coveredFeatures : [])
          .map(featureKey)
          .filter(name => byFeatureKey.has(name))
      )),
      priorityScore: Number.isFinite(Number(candidate.priorityScore)) ? Number(candidate.priorityScore) : 0,
      sourceOrder: Number.isFinite(Number(candidate.sourceOrder)) ? Number(candidate.sourceOrder) : index,
    }));

  const available = new Map<string, number>();
  for (const candidate of pool) {
    for (const name of candidate.covered) {
      available.set(name, (available.get(name) || 0) + 1);
    }
  }

  const status = new Map<string, KCoverFeatureStatus>();
  for (const entry of features) {
    const name = featureKey(entry.feature);
    if (status.has(name)) continue;
    const availableCount = available.get(name) || 0;
    status.set(name, {
      feature: entry.feature,
      type: entry.type,
      required: Math.min(Math.max(0, Math.trunc(k[entry.type])), availableCount),
      available: availableCount,
      satisfiedBy: [],
    });
  }

  const remaining = new Map(pool.map(candidate => [candidate.key, candidate]));
  const selectedKeys: string[] = [];

  const admit = (candidate: { key: string; covered: string[] }) => {
    remaining.delete(candidate.key);
    selectedKeys.push(candidate.key);
    for (const name of candidate.covered) {
      const feature = status.get(name);
      if (feature && feature.satisfiedBy.length < feature.required) {
        feature.satisfiedBy.push(candidate.key);
      }
    }
  };

  for (const key of Array.isArray(options.preselected) ? options.preselected : []) {
    const candidate = remaining.get(String(key || '').trim());
    if (candidate) admit(candidate);
  }

  for (;;) {
    let best: { candidate: typeof pool[number]; gain: number } | null = null;
    for (const candidate of Array.from(remaining.values())) {
      let gain = 0;
      for (const name of candidate.covered) {
        const feature = status.get(name);
        if (feature && feature.satisfiedBy.length < feature.required) {
          gain += featureWeight(feature.type);
        }
      }
      if (gain <= 0) continue;
      if (
        !best ||
        gain > best.gain ||
        (gain === best.gain && (
          candidate.priorityScore > best.candidate.priorityScore ||
          (candidate.priorityScore === best.candidate.priorityScore && (
            candidate.sourceOrder < best.candidate.sourceOrder ||
            (candidate.sourceOrder === best.candidate.sourceOrder && candidate.key < best.candidate.key)
          ))
        ))
      ) {
        best = { candidate, gain };
      }
    }
    if (!best) break;
    admit(best.candidate);
  }

  const perFeature = Array.from(status.values());
  return {
    selectedKeys,
    perFeature,
    featuresCovered: perFeature.filter(feature => feature.satisfiedBy.length > 0).length,
    featuresTotal: perFeature.length,
  };
}

function normalizeFeatureType(value: unknown): NoveltyFeatureType {
  if (value === 'novelty_candidate' || value === 'implementation' || value === 'generic_weak') return value;
  return 'core_technical';
}

function sanitizeKByType(value: KByType): KByType {
  const out: KByType = {};
  for (const type of Object.keys(DEFAULT_K_BY_TYPE) as NoveltyFeatureType[]) {
    const k = Number(value?.[type]);
    if (Number.isFinite(k) && k >= 0) out[type] = Math.trunc(k);
  }
  return out;
}
