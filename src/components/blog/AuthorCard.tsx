// The byline, in two sizes.
//
// AuthorByline is the compact line under the H1; AuthorCard is the full block at
// the foot of the article. Both name the reviewer when there is one — on content
// that reads like legal guidance, "who checked this" is the signal readers and
// search quality raters actually look for.

import Link from 'next/link'
import { Linkedin, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPostDate } from '@/lib/blog/content'

interface AuthorLite {
  name: string
  slug: string
  title?: string | null
  avatarUrl?: string | null
}

function Avatar({ author, size = 40 }: { author: AuthorLite; size?: number }) {
  const initials = author.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  if (author.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- author avatars are
    // arbitrary remote/uploaded URLs; next/image would need per-host config.
    return (
      <img
        src={author.avatarUrl}
        alt=""
        width={size}
        height={size}
        className="rounded-full border border-ai-graphite-900/10 object-cover"
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full border border-ai-graphite-900/10 bg-paper-100 font-mono text-xs font-medium text-ai-graphite-500"
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  )
}

export function AuthorByline({
  author,
  reviewer,
  publishedAt,
  updatedAt,
  readingMinutes,
  className,
}: {
  author: AuthorLite
  reviewer?: AuthorLite | null
  publishedAt: Date | null
  updatedAt: Date
  readingMinutes: number
  className?: string
}) {
  // Only surface "updated" when it's a real revision, not the save that
  // published the post — a fake freshness badge fools nobody twice.
  const wasRevised =
    publishedAt && updatedAt.getTime() - publishedAt.getTime() > 24 * 60 * 60 * 1000

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-3', className)}>
      <div className="flex items-center gap-3">
        <Avatar author={author} />
        <div className="text-sm leading-tight">
          <Link
            href={`/blog/authors/${author.slug}`}
            className="font-medium text-ai-graphite-900 hover:text-lamp-700"
          >
            {author.name}
          </Link>
          {author.title && (
            <p className="mt-0.5 text-xs text-ai-graphite-500">{author.title}</p>
          )}
        </div>
      </div>

      <span className="hidden h-8 w-px bg-ai-graphite-900/10 sm:block" aria-hidden />

      <div className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.15em] text-ai-graphite-400">
        <p>
          {formatPostDate(publishedAt)} · {readingMinutes} min read
        </p>
        {reviewer && (
          <p className="mt-0.5">
            Reviewed by{' '}
            <Link href={`/blog/authors/${reviewer.slug}`} className="text-ai-graphite-600 hover:text-lamp-700">
              {reviewer.name}
            </Link>
          </p>
        )}
        {wasRevised && <p className="mt-0.5">Updated {formatPostDate(updatedAt)}</p>}
      </div>
    </div>
  )
}

export function AuthorCard({
  author,
}: {
  author: AuthorLite & {
    bio?: string | null
    credentials?: string[]
    linkedinUrl?: string | null
    websiteUrl?: string | null
  }
}) {
  return (
    <section className="mt-16 rounded-xl border border-ai-graphite-900/10 bg-white p-6 sm:p-7">
      <div className="flex items-start gap-4">
        <Avatar author={author} size={56} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
            Written by
          </p>
          <Link
            href={`/blog/authors/${author.slug}`}
            className="mt-1 block text-base font-semibold text-ai-graphite-900 hover:text-lamp-700"
          >
            {author.name}
          </Link>
          {author.title && <p className="text-sm text-ai-graphite-500">{author.title}</p>}

          {author.bio && (
            <p className="mt-3 text-sm leading-relaxed text-ai-graphite-600">{author.bio}</p>
          )}

          {!!author.credentials?.length && (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {author.credentials.map((credential) => (
                <li
                  key={credential}
                  className="rounded border border-ai-graphite-900/10 bg-paper-100 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ai-graphite-500"
                >
                  {credential}
                </li>
              ))}
            </ul>
          )}

          {(author.linkedinUrl || author.websiteUrl) && (
            <div className="mt-4 flex items-center gap-3">
              {author.linkedinUrl && (
                <a
                  href={author.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ai-graphite-400 transition-colors hover:text-lamp-600"
                  aria-label={`${author.name} on LinkedIn`}
                >
                  <Linkedin className="h-4 w-4" />
                </a>
              )}
              {author.websiteUrl && (
                <a
                  href={author.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ai-graphite-400 transition-colors hover:text-lamp-600"
                  aria-label={`${author.name}'s website`}
                >
                  <Globe className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
