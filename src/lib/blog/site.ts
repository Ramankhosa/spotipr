// Canonical identity for everything the crawlers and answer engines read:
// absolute URLs, the publisher entity, and the JSON-LD builders.
//
// SITE_URL follows the same env convention as lib/mailer.ts (SITE_URL, then
// NEXTAUTH_URL, then localhost) so absolute links are consistent across email
// and web. Set SITE_URL in production — canonicals pointing at localhost is the
// classic way to make a blog invisible.

import type { FaqItem } from './types'

export const SITE_URL = (
  process.env.SITE_URL ||
  process.env.NEXTAUTH_URL ||
  'http://localhost:3000'
).replace(/\/$/, '')

export const SITE_NAME = 'PatentNest.ai'
export const BLOG_NAME = 'The PatentNest Journal'
export const BLOG_TAGLINE =
  'Practical patent guidance for founders, in-house teams and the attorneys who file for them.'

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

export const ORGANIZATION_ID = `${SITE_URL}/#organization`

/** The publisher entity every article's JSON-LD points back to. */
export function organizationSchema() {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description:
      'AI patent studio covering prior-art search, drafting, figures and office-action response across 12 patent offices.',
    logo: {
      '@type': 'ImageObject',
      url: absoluteUrl('/animations/logo-video.gif'),
    },
  }
}

export function breadcrumbSchema(trail: { name: string; url: string }[]) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  }
}

export function faqSchema(faqs: FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  }
}

export interface ArticleSchemaInput {
  title: string
  description: string
  slug: string
  publishedAt: Date | null
  updatedAt: Date
  wordCount: number
  keywords: string[]
  sections: string[]
  imageUrl?: string | null
  author: { name: string; slug: string; title?: string | null; url?: string | null }
  reviewer?: { name: string; slug: string } | null
}

export function articleSchema(input: ArticleSchemaInput) {
  const url = absoluteUrl(`/blog/${input.slug}`)
  return {
    '@type': 'BlogPosting',
    '@id': `${url}#article`,
    headline: input.title,
    description: input.description,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    datePublished: input.publishedAt?.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    wordCount: input.wordCount,
    keywords: input.keywords.join(', '),
    articleSection: input.sections,
    inLanguage: 'en',
    image: input.imageUrl ? [absoluteUrl(input.imageUrl)] : undefined,
    author: {
      '@type': 'Person',
      name: input.author.name,
      jobTitle: input.author.title || undefined,
      url: absoluteUrl(`/blog/authors/${input.author.slug}`),
      sameAs: input.author.url ? [input.author.url] : undefined,
    },
    reviewedBy: input.reviewer
      ? {
          '@type': 'Person',
          name: input.reviewer.name,
          url: absoluteUrl(`/blog/authors/${input.reviewer.slug}`),
        }
      : undefined,
    publisher: { '@id': ORGANIZATION_ID },
    isAccessibleForFree: true,
  }
}

/** Wrap graph nodes in a single @context envelope — one script tag per page. */
export function jsonLdGraph(nodes: unknown[]) {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) })
}
