// Registry of runtime-tunable settings.
//
// Each entry is the single source of truth for a knob: its type, default, valid
// range, and what it does. The super-admin UI is generated from this registry, the
// API validates against it, and the retrieval code reads through it — so adding a
// new tunable in future is one entry here, not a change in four places.
//
// The DEFAULT of each setting still comes from its env var where one exists, so an
// untouched deployment behaves exactly as it did before this module landed. A row in
// `system_settings` overrides that default at runtime.
//
// Deliberately absent: PATENT_CORPUS_EMBEDDING_MODEL / _DIMENSIONS / _DTYPE. Those
// must match the vectors already written to local_patent_embeddings — the model name
// is part of the lookup — so changing one at runtime would make every vector query
// match zero rows while search still appeared to work. They stay env-only.

export type SettingType = 'int' | 'float' | 'boolean'

export interface SettingDefinition {
  key: string
  label: string
  description: string
  category: SettingCategory
  type: SettingType
  default: number | boolean
  min?: number
  max?: number
  /** Shown in the UI so an admin knows what they are overriding. */
  envVar?: string
  /**
   * True when the value is only read at process start, so an override needs a
   * restart to take effect. The UI warns on these.
   */
  requiresRestart?: boolean
}

export type SettingCategory = 'retrieval' | 'rerank' | 'analysis' | 'claims'

export const SETTING_CATEGORIES: Array<{ id: SettingCategory; label: string; description: string }> = [
  {
    id: 'retrieval',
    label: 'Corpus retrieval',
    description: 'How many candidates the SQL layer pulls out of the corpus before ranking.',
  },
  {
    id: 'rerank',
    label: 'Reranking & cutoff',
    description: 'Voyage reranking and the score floor that decides what survives.',
  },
  {
    id: 'analysis',
    label: 'Deep analysis',
    description: 'How many candidates reach the LLM feature-mapping and report stages.',
  },
  {
    id: 'claims',
    label: 'Claims evidence',
    description: 'Claims hydration for the strongest candidates.',
  },
]

function envNumber(name: string, fallback: number) {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : fallback
}

function envBoolean(name: string, fallback: boolean) {
  const raw = String(process.env[name] || '').trim().toLowerCase()
  if (!raw) return fallback
  return !['0', 'false', 'off', 'no'].includes(raw)
}

export const SETTINGS: SettingDefinition[] = [
  // --- Corpus retrieval -----------------------------------------------------
  {
    key: 'retrieval.maxVectorQueries',
    label: 'Vector queries per search',
    description:
      'How many of the planned retrieval queries (one concept query plus per-feature queries) are executed as vector searches. Each is a separate ANN scan, so this trades recall against latency.',
    category: 'retrieval',
    type: 'int',
    default: envNumber('PATENT_SEARCH_MAX_VECTOR_QUERIES', 4),
    min: 1,
    max: 12,
    envVar: 'PATENT_SEARCH_MAX_VECTOR_QUERIES',
  },
  {
    key: 'retrieval.textCandidateCap',
    label: 'Full-text candidate cap',
    description: 'Upper bound on rows the full-text lane materialises before ranking.',
    category: 'retrieval',
    type: 'int',
    default: envNumber('PATENT_SEARCH_TEXT_CANDIDATE_CAP', 1600),
    min: 200,
    max: 10000,
    envVar: 'PATENT_SEARCH_TEXT_CANDIDATE_CAP',
  },
  {
    key: 'retrieval.trigramCandidateCap',
    label: 'Trigram candidate cap',
    description:
      'Upper bound for the fuzzy trigram lane. That lane only runs when the other lanes have not already filled the candidate pool.',
    category: 'retrieval',
    type: 'int',
    default: envNumber('PATENT_SEARCH_TRIGRAM_CANDIDATE_CAP', 900),
    min: 100,
    max: 5000,
    envVar: 'PATENT_SEARCH_TRIGRAM_CANDIDATE_CAP',
  },
  {
    key: 'retrieval.metadataCandidateCap',
    label: 'Metadata candidate cap',
    description: 'Upper bound for the classification/inventor/applicant matching lane.',
    category: 'retrieval',
    type: 'int',
    default: envNumber('PATENT_SEARCH_METADATA_CANDIDATE_CAP', 600),
    min: 100,
    max: 5000,
    envVar: 'PATENT_SEARCH_METADATA_CANDIDATE_CAP',
  },
  {
    key: 'retrieval.trigramThreshold',
    label: 'Trigram similarity threshold',
    description:
      'Minimum pg_trgm similarity for the fuzzy lane. Lower values catch more spelling variation but pull in noise.',
    category: 'retrieval',
    type: 'float',
    default: envNumber('PATENT_SEARCH_TRIGRAM_THRESHOLD', 0.18),
    min: 0.05,
    max: 0.5,
    envVar: 'PATENT_SEARCH_TRIGRAM_THRESHOLD',
  },
  {
    key: 'retrieval.statementTimeoutMs',
    label: 'Retrieval statement timeout (ms)',
    description:
      'Per-query Postgres statement timeout. A lane that exceeds it is skipped rather than failing the search, so raising this trades latency for recall on hard queries.',
    category: 'retrieval',
    type: 'int',
    default: envNumber('PATENT_SEARCH_STATEMENT_TIMEOUT_MS', 8000),
    min: 1000,
    max: 60000,
    envVar: 'PATENT_SEARCH_STATEMENT_TIMEOUT_MS',
  },

  // --- Reranking & cutoff ---------------------------------------------------
  {
    key: 'rerank.enabled',
    label: 'Voyage reranking enabled',
    description:
      'Second-stage reranking over the merged candidate pool. Without it, ordering falls back to the fused retrieval score, which is not comparable across corpora.',
    category: 'rerank',
    type: 'boolean',
    default: envBoolean('NOVELTY_RERANK_ENABLED', true),
    envVar: 'NOVELTY_RERANK_ENABLED',
  },
  {
    key: 'rerank.minScore',
    label: 'Minimum rerank score',
    description:
      'Absolute cutoff applied after reranking. Candidates scoring below this are dropped, so a search with no genuinely close prior art can return fewer results — or none. 0 disables the floor and keeps the old pure top-N behaviour. Calibrate this from a real score distribution rather than guessing.',
    category: 'rerank',
    type: 'float',
    default: envNumber('NOVELTY_MIN_RERANK_SCORE', 0),
    min: 0,
    max: 1,
    envVar: 'NOVELTY_MIN_RERANK_SCORE',
  },
  {
    key: 'rerank.maxDocsPerCall',
    label: 'Rerank documents per call',
    description: 'Candidate batch size per Voyage rerank request. Larger sets are chunked and merged by score.',
    category: 'rerank',
    type: 'int',
    default: envNumber('VOYAGE_RERANK_MAX_DOCS', 1000),
    min: 50,
    max: 1000,
    envVar: 'VOYAGE_RERANK_MAX_DOCS',
  },

  // --- Deep analysis --------------------------------------------------------
  {
    key: 'analysis.candidateLimit',
    label: 'Retrieval candidate pool',
    description:
      'How many merged candidates leave retrieval and enter the relevance gate. This is the widest point of the funnel after the SQL lanes.',
    category: 'analysis',
    type: 'int',
    default: 180,
    min: 20,
    max: 300,
  },
  {
    key: 'analysis.maxPatents',
    label: 'Visible prior-art limit',
    description: 'How many references are surfaced as the search result set.',
    category: 'analysis',
    type: 'int',
    default: 50,
    min: 10,
    max: 100,
  },
  {
    key: 'analysis.deepAnalysisCeiling',
    label: 'Deep analysis ceiling',
    description:
      'Maximum references sent to LLM feature mapping. This is the dominant cost driver of a novelty run — every increment is a batch of LLM calls.',
    category: 'analysis',
    type: 'int',
    default: 60,
    min: 5,
    max: 120,
  },
  {
    key: 'analysis.batchSize',
    label: 'Feature-mapping batch size',
    description: 'References per LLM call during feature mapping.',
    category: 'analysis',
    type: 'int',
    default: 8,
    min: 1,
    max: 12,
  },

  // --- Claims evidence ------------------------------------------------------
  {
    key: 'claims.topReferences',
    label: 'Claims hydration depth',
    description:
      'How many of the highest-ranked references get claims text attached from the corpus. Claims are stronger evidence than abstracts but lengthen the prompt, so this is a quality/token trade. Coverage is partial: US publications carry a first claim, Indian patents full claims.',
    category: 'claims',
    type: 'int',
    default: envNumber('NOVELTY_CLAIMS_TOP_REFS', 12),
    min: 0,
    max: 40,
    envVar: 'NOVELTY_CLAIMS_TOP_REFS',
  },
  {
    key: 'claims.maxChars',
    label: 'Claims excerpt length',
    description: 'Maximum characters of claims text attached per reference.',
    category: 'claims',
    type: 'int',
    default: envNumber('NOVELTY_CLAIMS_MAX_CHARS', 6000),
    min: 1000,
    max: 20000,
    envVar: 'NOVELTY_CLAIMS_MAX_CHARS',
  },
]

const BY_KEY = new Map(SETTINGS.map(setting => [setting.key, setting]))

export function getSettingDefinition(key: string) {
  return BY_KEY.get(key) || null
}

export function listSettingDefinitions() {
  return SETTINGS
}

export type SettingsSnapshot = Record<string, number | boolean>

/** Every setting at its registry default. */
export function defaultSettings(): SettingsSnapshot {
  return Object.fromEntries(SETTINGS.map(setting => [setting.key, setting.default]))
}

export interface CoercionResult {
  ok: boolean
  value?: number | boolean
  error?: string
}

/**
 * Validate and coerce a raw value against its registry definition. Rejects unknown
 * keys and out-of-range values so a bad admin edit cannot put the retrieval layer
 * into a state the code does not expect.
 */
export function coerceSettingValue(key: string, raw: unknown): CoercionResult {
  const definition = BY_KEY.get(key)
  if (!definition) return { ok: false, error: `Unknown setting "${key}".` }

  if (definition.type === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw }
    const text = String(raw).trim().toLowerCase()
    if (['true', '1', 'on', 'yes'].includes(text)) return { ok: true, value: true }
    if (['false', '0', 'off', 'no'].includes(text)) return { ok: true, value: false }
    return { ok: false, error: `${definition.label} must be true or false.` }
  }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) {
    return { ok: false, error: `${definition.label} must be a number.` }
  }
  if (definition.type === 'int' && !Number.isInteger(numeric)) {
    return { ok: false, error: `${definition.label} must be a whole number.` }
  }
  if (typeof definition.min === 'number' && numeric < definition.min) {
    return { ok: false, error: `${definition.label} must be at least ${definition.min}.` }
  }
  if (typeof definition.max === 'number' && numeric > definition.max) {
    return { ok: false, error: `${definition.label} must be at most ${definition.max}.` }
  }
  return { ok: true, value: numeric }
}
