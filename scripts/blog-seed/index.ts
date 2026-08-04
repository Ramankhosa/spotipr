// The launch set: ten articles covering the four pillars in
// docs/BLOG_SEO_STRATEGY.md, plus the authority set — ten India- and
// AI-focused articles targeting queries the competitor blogs don't cover.
// Order here is publication order (newest first).

import type { PostSeed } from './types'
import { post as patentCost } from './posts/patent-cost'
import { post as howLong } from './posts/how-long-does-a-patent-take'
import { post as provisional } from './posts/provisional-vs-complete-specification'
import { post as priorArtSearch } from './posts/how-to-do-a-prior-art-search'
import { post as searchTypes } from './posts/types-of-patent-search'
import { post as claims } from './posts/how-to-write-patent-claims'
import { post as eligibility } from './posts/software-patent-eligibility'
import { post as aiDrafting } from './posts/ai-patent-drafting'
import { post as pct } from './posts/pct-national-phase-deadlines'
import { post as officeAction } from './posts/how-to-respond-to-an-office-action'
import { post as grantedClaimsIndia } from './posts/granted-software-patent-claims-india'
import { post as section3k } from './posts/software-patents-in-india-section-3k'
import { post as costIndia } from './posts/patent-cost-in-india'
import { post as chatgptConfidentiality } from './posts/chatgpt-patent-drafting-confidentiality'
import { post as filingFormsIndia } from './posts/patent-filing-forms-india'
import { post as foreignFilingLicense } from './posts/foreign-filing-license-india'
import { post as drawingRequirements } from './posts/patent-drawing-requirements'
import { post as whitespace } from './posts/patent-whitespace-analysis'
import { post as reviewAiDraft } from './posts/review-ai-generated-patent-application'
import { post as disclosureToFiling } from './posts/invention-disclosure-to-filing'

export const POSTS: PostSeed[] = [
  grantedClaimsIndia,
  section3k,
  costIndia,
  chatgptConfidentiality,
  filingFormsIndia,
  foreignFilingLicense,
  drawingRequirements,
  whitespace,
  reviewAiDraft,
  disclosureToFiling,
  patentCost,
  howLong,
  provisional,
  priorArtSearch,
  searchTypes,
  claims,
  eligibility,
  aiDrafting,
  pct,
  officeAction,
]

export { CATEGORIES, EDITORIAL_AUTHOR } from './taxonomy'
export type { PostSeed } from './types'
