// The launch set: ten articles covering the four pillars in
// docs/BLOG_SEO_STRATEGY.md. Order here is publication order (newest first).

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

export const POSTS: PostSeed[] = [
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
