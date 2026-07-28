// Shared shapes for the editorial surfaces. Kept free of Prisma imports so the
// client-side composer can use them without pulling the engine into the bundle.

export type BlogPostStatusValue = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED'

/** One entry of the `faqs` JSON column — rendered as an accordion and as FAQPage JSON-LD. */
export interface FaqItem {
  question: string
  answer: string
}

export interface HeadingNode {
  id: string
  text: string
  level: 2 | 3
}

export const BLOG_STATUS_LABELS: Record<BlogPostStatusValue, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
}

export const BLOG_STATUS_STYLES: Record<BlogPostStatusValue, string> = {
  DRAFT: 'bg-paper-100 text-paper-700 ring-paper-300',
  SCHEDULED: 'bg-amber-50 text-amber-700 ring-amber-200',
  PUBLISHED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ARCHIVED: 'bg-paper-100 text-paper-500 ring-paper-300',
}

/** Patent offices an article can be scoped to. Order = how chips render. */
export const JURISDICTION_LABELS: Record<string, string> = {
  US: 'USPTO',
  EP: 'EPO',
  IN: 'India',
  PCT: 'PCT',
  CN: 'China',
  JP: 'Japan',
  KR: 'Korea',
  DE: 'Germany',
  UK: 'UK',
  AU: 'Australia',
  CA: 'Canada',
  BR: 'Brazil',
}

/** `parse`, but forgiving: the column is JSON and hand-seeded rows happen. */
export function parseFaqs(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((f): f is FaqItem =>
      !!f && typeof f === 'object' &&
      typeof (f as FaqItem).question === 'string' &&
      typeof (f as FaqItem).answer === 'string'
    )
    .map((f) => ({ question: f.question.trim(), answer: f.answer.trim() }))
    .filter((f) => f.question && f.answer)
}
