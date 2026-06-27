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
  new PqaiCorpusProvider(),
  new PqaiProvider(),
  new GooglePatentsProvider(),
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

export function resolveProviderIds(params: {
  providerIds?: PatentSearchProviderId[]
  sourceMode?: string
  jurisdictions?: string[]
}) {
  if (params.providerIds?.length) {
    const hasEuropeanSelection = params.providerIds.some(id => id === 'epo-ops' || id === 'epo-ops-corpus')
    if (!hasEuropeanSelection) return params.providerIds

    const linkedEpoProviders: PatentSearchProviderId[] = hasEpoOpsCredentials()
      ? ['epo-ops', 'epo-ops-corpus']
      : ['epo-ops-corpus']
    const resolved: PatentSearchProviderId[] = []
    let epoProvidersAdded = false
    for (const providerId of params.providerIds) {
      if (providerId === 'epo-ops' || providerId === 'epo-ops-corpus') {
        if (!epoProvidersAdded) resolved.push(...linkedEpoProviders)
        epoProvidersAdded = true
      } else if (!resolved.includes(providerId)) {
        resolved.push(providerId)
      }
    }
    return resolved
  }

  const jurisdictions = (params.jurisdictions || []).map(value => value.toUpperCase())
  const googleProviderIds: PatentSearchProviderId[] = hasGooglePatentsCredentials() ? ['google-patents'] : []
  const officialProviderIds: PatentSearchProviderId[] = []
  if (jurisdictions.includes('AU') && hasIpAustraliaCredentials()) officialProviderIds.push('ip-australia')
  const epoProviderIds: PatentSearchProviderId[] = hasEpoOpsCredentials()
    ? ['epo-ops', 'epo-ops-corpus']
    : ['epo-ops-corpus']
  if (jurisdictions.some(value => value === 'EP' || value === 'WO')) {
    officialProviderIds.push(...epoProviderIds)
  }

  if (params.sourceMode === 'INDIAN_ONLY') return ['indian-corpus', ...googleProviderIds]
  if (params.sourceMode === 'AUSTRALIA_ONLY') return ['ip-australia', ...googleProviderIds]
  if (params.sourceMode === 'EPO_ONLY') return [...epoProviderIds, ...googleProviderIds]
  if (params.sourceMode === 'PQAI_ONLY') return [...officialProviderIds, 'pqai-corpus', 'pqai', ...googleProviderIds]
  if (params.sourceMode === 'PQAI_PLUS_INDIAN') return ['indian-corpus', ...officialProviderIds, 'pqai-corpus', 'pqai', ...googleProviderIds]
  if (params.sourceMode === 'PQAI_PLUS_AUSTRALIA') return [...officialProviderIds, 'pqai-corpus', 'pqai', ...googleProviderIds]
  if (params.sourceMode === 'PQAI_PLUS_EPO') return [...epoProviderIds, 'pqai-corpus', 'pqai', ...googleProviderIds]
  if (params.sourceMode === 'PQAI_PLUS_INDIAN_EPO') return ['indian-corpus', ...epoProviderIds, 'pqai-corpus', 'pqai', ...googleProviderIds]

  if (jurisdictions.length) {
    const ids: PatentSearchProviderId[] = []
    if (jurisdictions.includes('IN')) ids.push('indian-corpus')
    ids.push(...officialProviderIds)
    if (jurisdictions.some(value => value !== 'IN')) ids.push('pqai-corpus', 'pqai')
    ids.push(...googleProviderIds)
    return ids.length ? ids : ['pqai-corpus', 'pqai', ...googleProviderIds]
  }
  return ['pqai-corpus', 'pqai', ...googleProviderIds]
}
