// Renders stored article HTML.
//
// Three transforms happen here rather than in the database, so the stored
// document stays exactly what the composer produced:
//   1. h2/h3 get anchor ids (shared with the TOC via lib/blog/content).
//   2. tables get a scroll wrapper — a 5-column fee table must not make the
//      whole page scroll sideways on a phone.
//   3. outbound links get rel="noopener noreferrer" and open in a new tab, so
//      a reader checking the USPTO fee schedule doesn't lose the article.
//
// The HTML is trusted: the only writers are the super-admin composer and the
// seed script. If the blog ever accepts contributor HTML this needs a sanitizer.

import { withHeadingAnchors } from '@/lib/blog/content'

function prepare(html: string): string {
  return withHeadingAnchors(html)
    .replace(/<table\b/gi, '<div class="table-wrap"><table')
    .replace(/<\/table>/gi, '</table></div>')
    .replace(/<a\s+href="(https?:\/\/[^"]+)"/gi, '<a href="$1" target="_blank" rel="noopener noreferrer"')
}

export default function ArticleBody({ html }: { html: string }) {
  return (
    <div
      className="article-prose mt-10 max-w-[68ch]"
      dangerouslySetInnerHTML={{ __html: prepare(html) }}
    />
  )
}
