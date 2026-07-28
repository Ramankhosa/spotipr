'use client'

// Sticky contents rail with scroll-spy. Long patent explainers are reference
// material — readers arrive from a search result wanting one section, so the
// article has to show them where it is and let them jump.
//
// IntersectionObserver rather than a scroll handler: no work on the main thread
// between intersections, and the rootMargin makes a heading "active" once it
// reaches the top third of the viewport, which matches how people read.

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { HeadingNode } from '@/lib/blog/types'

export default function TableOfContents({ headings }: { headings: HeadingNode[] }) {
  const [activeId, setActiveId] = useState<string>('')
  const observed = useRef<HTMLElement[]>([])

  useEffect(() => {
    if (!headings.length) return

    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => Boolean(el))
    observed.current = elements

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          setActiveId(visible[0].target.id)
          return
        }
        // Nothing intersecting (scrolled past a long section): keep the last
        // heading above the fold marked instead of clearing the rail.
        const above = observed.current.filter((el) => el.getBoundingClientRect().top < 120)
        if (above.length) setActiveId(above[above.length - 1].id)
      },
      { rootMargin: '-80px 0px -66% 0px', threshold: 0 }
    )

    elements.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [headings])

  if (headings.length < 3) return null

  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
        On this page
      </p>
      <ul className="mt-4 space-y-1 border-l border-ai-graphite-900/10">
        {headings.map((heading) => (
          <li key={heading.id}>
            <a
              href={`#${heading.id}`}
              className={cn(
                '-ml-px block border-l py-1.5 pr-2 leading-snug transition-colors',
                heading.level === 3 ? 'pl-7 text-[0.8125rem]' : 'pl-4',
                activeId === heading.id
                  ? 'border-lamp-600 font-medium text-lamp-700'
                  : 'border-transparent text-ai-graphite-500 hover:border-ai-graphite-300 hover:text-ai-graphite-900'
              )}
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
