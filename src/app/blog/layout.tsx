// Chrome for every editorial page: the marketing nav and colophon that the
// landing page uses, on the same paper ground. The blog is the top of the
// funnel, so a reader who arrives from a search result lands inside the product's
// world rather than on a detached content island.

import type { Metadata } from 'next'
import PatentNestNav from '@/components/patentnest/PatentNestNav'
import PaperFooter from '@/components/patentnest/PaperFooter'
import { BLOG_NAME, SITE_URL } from '@/lib/blog/site'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: BLOG_NAME, template: `%s · ${BLOG_NAME}` },
}

export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper-200 font-sans text-ai-graphite-900 antialiased">
      <PatentNestNav />
      <main>{children}</main>
      <PaperFooter />
    </div>
  )
}
