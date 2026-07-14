import { PATENT_CORPUS_SOURCE_GOOGLE } from '@/lib/patent-corpus-service'
import { IndianCorpusProvider } from './indian-corpus-provider'

// Locally stored Google Patents corpus (bulk-imported from the Google Patents
// Public Data BigQuery dataset; see scripts/google-patents-import/README.md).
// Reuses the shared LocalPatent corpus search core: multi-query vector retrieval
// (concept + per-feature queries), trigram/text/metadata blending, and rank fusion.
export class GooglePatentsCorpusProvider extends IndianCorpusProvider {
  constructor() {
    super({
      id: 'google-patents-corpus',
      label: 'Stored Google Patents Corpus',
      jurisdictions: ['*'],
      corpusSource: PATENT_CORPUS_SOURCE_GOOGLE,
      defaultJurisdiction: '',
    })
  }
}
