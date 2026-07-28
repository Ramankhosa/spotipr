// Article card for every listing surface (/blog, category hubs, related rail).
//
// The whole card is one link — competitors that put the link only on a "Read
// more" button lose the biggest tap target on the page. Metadata is the minimum
// a reader uses to decide: which office it applies to, how long it takes to read,
// and who wrote it.

import Link from 'next/link'
import { ArrowUpRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPostDate } from '@/lib/blog/content'
import { JURISDICTION_LABELS } from '@/lib/blog/types'
import type { PostCardData } from '@/lib/blog/queries'

export function JurisdictionChips({ codes, className }: { codes: string[]; className?: string }) {
  if (!codes.length) return null
  return (
    <span className={cn('flex flex-wrap items-center gap-1', className)}>
      {codes.slice(0, 4).map((code) => (
        <span
          key={code}
          className="rounded border border-ai-graphite-900/10 bg-paper-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ai-graphite-500"
        >
          {JURISDICTION_LABELS[code] ?? code}
        </span>
      ))}
    </span>
  )
}

export default function PostCard({ post, className }: { post: PostCardData; className?: string }) {
  return (
    <article className={cn('group relative flex h-full flex-col', className)}>
      <Link
        href={`/blog/${post.slug}`}
        className="flex h-full flex-col rounded-xl border border-ai-graphite-900/10 bg-white p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-ai-graphite-900/20 hover:shadow-[0_8px_24px_-12px_rgba(16,24,40,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-lamp-600 focus-visible:ring-offset-2"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-lamp-700">
            {post.category.name}
          </span>
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
            <Clock className="h-3 w-3" aria-hidden />
            {post.readingMinutes} min
          </span>
        </div>

        <h3 className="mt-4 text-lg font-semibold leading-snug tracking-tight text-ai-graphite-900 transition-colors group-hover:text-lamp-700">
          {post.title}
        </h3>

        <p className="mt-3 line-clamp-3 flex-1 text-sm leading-relaxed text-ai-graphite-600">
          {post.excerpt}
        </p>

        <div className="mt-5 flex items-end justify-between gap-3 border-t border-ai-graphite-900/[0.07] pt-4">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ai-graphite-700">{post.author.name}</p>
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-ai-graphite-400">
              {formatPostDate(post.publishedAt)}
            </p>
          </div>
          <ArrowUpRight
            className="h-4 w-4 shrink-0 text-ai-graphite-300 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-lamp-600"
            aria-hidden
          />
        </div>
      </Link>
    </article>
  )
}
