import { PATENT_CORPUS_SOURCE_EPO } from '@/lib/patent-corpus-service'
import { IndianCorpusProvider } from './indian-corpus-provider'

export class EpoOpsCorpusProvider extends IndianCorpusProvider {
  constructor() {
    super({
      id: 'epo-ops-corpus',
      label: 'Stored European Patent Corpus',
      jurisdictions: ['EP', 'WO', '*'],
      corpusSource: PATENT_CORPUS_SOURCE_EPO,
      defaultJurisdiction: 'EP',
      semanticSearchEnabled: false,
      metadataSearchEnabled: false,
      titleAbstractOnlySearch: true,
    })
  }
}
