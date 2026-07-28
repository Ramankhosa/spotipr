// Topic hub navigation. Real links to real indexable pages — not a client-side
// filter — so each hub can rank for its own head term and the crawler can walk
// the whole cluster from any article.

import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface CategoryLink {
  slug: string
  name: string
  postCount: number
}

export default function CategoryNav({
  categories,
  activeSlug,
  className,
}: {
  categories: CategoryLink[]
  activeSlug?: string
  className?: string
}) {
  if (!categories.length) return null

  const pill =
    'shrink-0 rounded-full border px-4 py-1.5 text-[0.8125rem] font-medium transition-colors'

  return (
    <nav aria-label="Article topics" className={cn('flex flex-wrap gap-2', className)}>
      <Link
        href="/blog"
        className={cn(
          pill,
          !activeSlug
            ? 'border-ai-graphite-900 bg-ai-graphite-900 text-white'
            : 'border-ai-graphite-900/15 bg-white text-ai-graphite-600 hover:border-ai-graphite-900/30 hover:text-ai-graphite-900'
        )}
      >
        All articles
      </Link>
      {categories.map((category) => (
        <Link
          key={category.slug}
          href={`/blog/category/${category.slug}`}
          className={cn(
            pill,
            activeSlug === category.slug
              ? 'border-ai-graphite-900 bg-ai-graphite-900 text-white'
              : 'border-ai-graphite-900/15 bg-white text-ai-graphite-600 hover:border-ai-graphite-900/30 hover:text-ai-graphite-900'
          )}
        >
          {category.name}
          <span
            className={cn(
              'ml-2 font-mono text-[10px]',
              activeSlug === category.slug ? 'text-paper-400' : 'text-ai-graphite-400'
            )}
          >
            {category.postCount}
          </span>
        </Link>
      ))}
    </nav>
  )
}
