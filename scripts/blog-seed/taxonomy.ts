// The four pillars from docs/BLOG_SEO_STRATEGY.md, plus the byline.
//
// AUTHORS: seeded with a single editorial byline on purpose. E-E-A-T is built
// on real, verifiable people — inventing an attorney with a registration number
// would be a fabricated credential, which is worse than no byline at all.
// Replace this record (and set a reviewer on each post) with the real
// practitioners who sign off the content before the blog goes public. The SEO
// audit will flag every post's byline as incomplete until you do, which is the
// correct and honest state.

import type { CategorySeed } from './types'

export const CATEGORIES: CategorySeed[] = [
  {
    slug: 'patent-basics',
    name: 'Patent basics',
    description:
      'What a patent costs, how long it takes, and which application to file first — the questions every inventor asks before anything else, answered for the USPTO, the EPO, India and the PCT.',
    seoTitle: 'Patent basics — cost, timelines and first filings explained',
    seoDescription:
      'Plain-English guides to what a patent costs, how long the process takes, and whether to start with a provisional or a complete application. Written for founders, reviewed by practitioners.',
    sortOrder: 1,
  },
  {
    slug: 'prior-art-search',
    name: 'Prior art & searching',
    description:
      'How to find out what already exists before you spend money on drafting: search technique, the difference between patentability, freedom-to-operate and invalidity searches, and how to read what you find.',
    seoTitle: 'Prior art search guides — technique, tools and search types',
    seoDescription:
      'How to run a patent prior art search, which type of search you actually need, and how to interpret the results before you file.',
    sortOrder: 2,
  },
  {
    slug: 'drafting-and-claims',
    name: 'Drafting & claims',
    description:
      'The craft: writing claims that survive examination, drafting software and AI inventions that clear eligibility, and knowing what AI drafting tools do well and where they still need a professional.',
    seoTitle: 'Patent drafting and claim writing guides',
    seoDescription:
      'How to write patent claims, draft software and AI inventions for eligibility, and use AI drafting tools without losing scope.',
    sortOrder: 3,
  },
  {
    slug: 'filing-and-prosecution',
    name: 'Filing & prosecution',
    description:
      'After the application is written: international filing routes and their deadlines, and what to do when the examiner writes back.',
    seoTitle: 'Patent filing and prosecution — deadlines and office actions',
    seoDescription:
      'PCT national phase deadlines by country and how to respond to an office action or First Examination Report, step by step.',
    sortOrder: 4,
  },
]

export const EDITORIAL_AUTHOR = {
  slug: 'patentnest-editorial',
  name: 'PatentNest Editorial',
  title: 'Editorial desk',
  bio:
    'The PatentNest editorial desk writes practical guidance on patent practice across the offices the studio supports — the USPTO, the EPO, the Indian Patent Office and the PCT. Articles are researched against primary sources and checked against current official fee schedules and rules before publication.',
  credentials: ['Sources: USPTO · WIPO · EPO · IPO India'],
  email: null as string | null,
  linkedinUrl: null as string | null,
  websiteUrl: 'https://patentnest.ai',
}
