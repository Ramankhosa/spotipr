import { PATENT_CORPUS_SOURCE_PQAI } from '@/lib/patent-corpus-service'
import { IndianCorpusProvider } from './indian-corpus-provider'

export class PqaiCorpusProvider extends IndianCorpusProvider {
  constructor() {
    super({
      id: 'pqai-corpus',
      label: 'Stored International Patent Corpus',
      jurisdictions: ['*'],
      corpusSource: PATENT_CORPUS_SOURCE_PQAI,
      defaultJurisdiction: '',
    })
  }
}
