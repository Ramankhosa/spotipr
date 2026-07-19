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
      // The metadata tsvector lane ('simple' over classifications/inventors/
      // applicants) has partial indexes for indian-corpus/pqai only. On the
      // ~45M Google rows it is an unindexed sequential scan (EXPLAIN cost ~25M)
      // that always dies at the statement timeout — disable it here, like
      // EpoOpsCorpusProvider does. The indian provider keeps the lane.
      metadataSearchEnabled: false,
    })
  }
}
