import type {
  PatentSearchCapabilities,
  PatentSearchProvider,
  PatentSearchProviderId,
} from './types'
import { EpoOpsCorpusProvider } from './providers/epo-ops-corpus-provider'
import { EpoOpsProvider, hasEpoOpsCredentials } from './providers/epo-ops-provider'
import { IndianCorpusProvider } from './providers/indian-corpus-provider'
import { IpAustraliaProvider, hasIpAustraliaCredentials } from './providers/ip-australia-provider'
import { GooglePatentsProvider, hasGooglePatentsCredentials } from './providers/google-patents-provider'
import { GooglePatentsBigQueryProvider, hasGooglePatentsBigQueryCredentials } from './providers/google-patents-bigquery-provider'
import { GooglePatentsCorpusProvider } from './providers/google-patents-corpus-provider'
import { PqaiCorpusProvider } from './providers/pqai-corpus-provider'
import { PqaiProvider } from './providers/pqai-provider'
import { PatentsViewProvider } from './providers/patentsview-provider'

class PlaceholderProvider implements PatentSearchProvider {
  enabled = false
  capabilities: PatentSearchCapabilities = {
    semantic: false,
    fullText: true,
    classification: true,
    dateFilters: true,
    numberLookup: true,
    applicantFilter: true,
    inventorFilter: true,
  }

  constructor(
    public id: PatentSearchProviderId,
    public label: string,
    public jurisdictions: string[]
  ) {}

  async search(): Promise<never[]> {
    throw new Error(`${this.label} provider is not configured yet.`)
  }
}

const providers: PatentSearchProvider[] = [
  new IndianCorpusProvider(),
  new GooglePatentsCorpusProvider(),
  new PqaiCorpusProvider(),
  new PqaiProvider(),
  new GooglePatentsProvider(),
  new GooglePatentsBigQueryProvider(),
  new PatentsViewProvider(),
  new EpoOpsCorpusProvider(),
  new EpoOpsProvider(),
  new IpAustraliaProvider(),
  new PlaceholderProvider('wipo', 'WIPO PATENTSCOPE', ['WO']),
]

export function listPatentSearchProviders() {
  return providers.map(provider => ({
    id: provider.id,
    label: provider.label,
    jurisdictions: provider.jurisdictions,
    enabled: provider.enabled,
    capabilities: provider.capabilities,
  }))
}

export function getPatentSearchProvider(id: PatentSearchProviderId) {
  return providers.find(provider => provider.id === id)
}

// The stored corpus is the primary lane: ~45M Google Patents records plus the IPIndia
// corpus, searched locally with Voyage embeddings + rerank. Live provider APIs are a
// fallback only (see resolveFallbackProviderIds), and PQAI is disabled entirely.
export const LOCAL_CORPUS_PROVIDER_IDS: PatentSearchProviderId[] = [
  'google-patents-corpus',
  'indian-corpus',
]

// Never dispatched, and stripped from any caller-supplied or legacy source-mode
// selection so a stale saved search config cannot reintroduce them.
const DISABLED_PROVIDER_IDS = new Set<PatentSearchProviderId>(['pqai', 'pqai-corpus'])

function withoutDisabledProviders(ids: PatentSearchProviderId[]) {
  return ids.filter(id => !DISABLED_PROVIDER_IDS.has(id))
}

export function resolveProviderIds(params: {
  providerIds?: PatentSearchProviderId[]
  sourceMode?: string
  jurisdictions?: string[]
  disableLinkedProviderExpansion?: boolean
  /**
   * Providers a super admin has switched off. Passed in rather than read here so
   * this function stays synchronous and unit-testable; the orchestrator resolves
   * the gates once per search.
   */
  adminDisabled?: Set<PatentSearchProviderId>
}) {
  const gateOut = (ids: PatentSearchProviderId[]) =>
    params.adminDisabled?.size ? ids.filter(id => !params.adminDisabled!.has(id)) : ids

  if (params.providerIds?.length) {
    const requested = gateOut(withoutDisabledProviders(params.providerIds))
    // A selection consisting only of PQAI (or other retired ids) still needs to search
    // something — but the corpus substitute is gated too, so an admin-disabled provider
    // can never re-enter the lane through this path.
    if (!requested.length) return gateOut([...LOCAL_CORPUS_PROVIDER_IDS])
    if (params.disableLinkedProviderExpansion) return requested
    const hasEuropeanSelection = requested.some(id => id === 'epo-ops' || id === 'epo-ops-corpus')
    if (!hasEuropeanSelection) return requested

    const linkedEpoProviders: PatentSearchProviderId[] = hasEpoOpsCredentials()
      ? ['epo-ops', 'epo-ops-corpus']
      : ['epo-ops-corpus']
    const resolved: PatentSearchProviderId[] = []
    let epoProvidersAdded = false
    for (const providerId of requested) {
      if (providerId === 'epo-ops' || providerId === 'epo-ops-corpus') {
        if (!epoProvidersAdded) resolved.push(...linkedEpoProviders)
        epoProvidersAdded = true
      } else if (!resolved.includes(providerId)) {
        resolved.push(providerId)
      }
    }
    return gateOut(resolved)
  }

  // Legacy source modes are still honoured for saved configs, but each now resolves
  // to the equivalent local corpus lane rather than fanning out to live APIs.
  if (params.sourceMode === 'INDIAN_ONLY') return gateOut(['indian-corpus'])
  if (params.sourceMode === 'EPO_ONLY') {
    return gateOut(withoutDisabledProviders(
      hasEpoOpsCredentials() ? ['epo-ops', 'epo-ops-corpus'] : ['epo-ops-corpus']
    ))
  }
  if (params.sourceMode === 'AUSTRALIA_ONLY' && hasIpAustraliaCredentials()) {
    return gateOut(['ip-australia'])
  }

  return gateOut([...LOCAL_CORPUS_PROVIDER_IDS])
}

/**
 * Live provider APIs to try when the local corpus returns nothing for a search.
 * Only providers with configured credentials are returned, ordered cheapest-first,
 * and scoped to the requested jurisdictions where a provider is jurisdiction-specific.
 */
export function resolveFallbackProviderIds(params: {
  jurisdictions?: string[]
  alreadySearched?: PatentSearchProviderId[]
  /**
   * Providers barred from the automatic fallback lane. Separate from a full
   * disable: an admin may want a provider available for explicit selection while
   * keeping it out of the metered path that fires on an empty corpus result.
   */
  fallbackBlocked?: Set<PatentSearchProviderId>
} = {}) {
  const jurisdictions = (params.jurisdictions || []).map(value => value.toUpperCase())
  const searched = new Set(params.alreadySearched || [])
  const blocked = params.fallbackBlocked
  const wantsJurisdiction = (codes: string[]) =>
    !jurisdictions.length || codes.some(code => jurisdictions.includes(code))

  const ids: PatentSearchProviderId[] = []
  if (hasGooglePatentsCredentials()) ids.push('google-patents')
  if (wantsJurisdiction(['EP', 'WO']) && hasEpoOpsCredentials()) ids.push('epo-ops')
  if (wantsJurisdiction(['AU']) && hasIpAustraliaCredentials()) ids.push('ip-australia')
  if (wantsJurisdiction(['US'])) ids.push('patentsview')
  if (hasGooglePatentsBigQueryCredentials()) ids.push('google-patents-bigquery')

  return withoutDisabledProviders(ids)
    .filter(id => !searched.has(id))
    .filter(id => !blocked?.has(id))
}
