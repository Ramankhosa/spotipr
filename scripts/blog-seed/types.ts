// Shape of a seeded article. Mirrors the composer's form so anything seeded
// here can be opened, edited and re-saved in /super-admin/blog without loss.

export interface FaqSeed {
  question: string
  answer: string
}

export interface PostSeed {
  slug: string
  title: string
  subtitle: string
  excerpt: string
  /** 40–80 words. The block answer engines quote. */
  answerSummary: string
  keyTakeaways: string[]
  faqs: FaqSeed[]
  focusKeyword: string
  secondaryKeywords: string[]
  tags: string[]
  jurisdictions: string[]
  seoTitle: string
  seoDescription: string
  categorySlug: string
  featured?: boolean
  relatedSlugs: string[]
  /** Days before the seed run this article is dated. Staggered = real cadence. */
  publishedDaysAgo: number
  /** Body HTML, as the composer would produce it. */
  content: string
}

export interface CategorySeed {
  slug: string
  name: string
  description: string
  seoTitle: string
  seoDescription: string
  sortOrder: number
}
