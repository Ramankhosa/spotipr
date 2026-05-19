import type {
  PatentSearchCapabilities,
  PatentSearchProvider,
  PatentSearchProviderId,
} from './types'
import { IndianCorpusProvider } from './providers/indian-corpus-provider'
import { PqaiProvider } from './providers/pqai-provider'

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
  new PqaiProvider(),
  new PlaceholderProvider('epo-ops', 'EPO OPS', ['EP', 'WO', '*']),
  new PlaceholderProvider('uspto', 'USPTO', ['US']),
  new PlaceholderProvider('ip-australia', 'IP Australia', ['AU']),
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
  if (params.providerIds?.length) return params.providerIds

  if (params.sourceMode === 'INDIAN_ONLY') return ['indian-corpus']
  if (params.sourceMode === 'PQAI_ONLY') return ['pqai']
  if (params.sourceMode === 'PQAI_PLUS_INDIAN') return ['indian-corpus', 'pqai']

  const jurisdictions = (params.jurisdictions || []).map(value => value.toUpperCase())
  if (jurisdictions.length) {
    const ids: PatentSearchProviderId[] = []
    if (jurisdictions.includes('IN')) ids.push('indian-corpus')
    if (jurisdictions.some(value => value !== 'IN')) ids.push('pqai')
    return ids.length ? ids : ['pqai']
  }
  return ['pqai']
}
