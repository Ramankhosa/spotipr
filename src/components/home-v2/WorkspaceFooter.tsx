// Footer for /home-v2 — four link columns plus socials, matching the design comp.

import Link from 'next/link'
import { Linkedin, Youtube } from 'lucide-react'
import NestMark from './NestMark'

// Every href here is a route that exists AND is reachable signed out — a footer
// is mostly read by visitors who have no session, so /dashboard links would
// bounce to login. Product/solutions entries therefore lead to the trial request
// or pricing. The comp also showed "About us" and "Careers"; add them back once
// those pages land.
const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Novelty report', href: '/features/novelty-search-report' },
      { label: 'FER responses', href: '/features/fer-response' },
      { label: 'Whitespace studies', href: '/features/whitespace' },
      { label: 'Ideation', href: '/features/ideation' },
      { label: 'Drafting pipeline', href: '/features/drafting-pipeline' },
      { label: 'Writing personas', href: '/features/writing-personas' },
      { label: 'Pricing', href: '/pricing' },
    ],
  },
  {
    heading: 'Solutions',
    links: [
      { label: 'Patent firms', href: '/free-trial' },
      { label: 'Universities', href: '/free-trial' },
      { label: 'Startups', href: '/free-trial' },
      { label: 'R&D teams', href: '/free-trial' },
      { label: 'Inventors', href: '/free-trial' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Journal', href: '/blog' },
      { label: 'Request a trial', href: '/free-trial' },
      { label: 'Contact us', href: '/contact' },
    ],
  },
  // Policy links carried over from the legacy homepage footer (PaperFooter).
  {
    heading: 'Company',
    links: [
      { label: 'Contact us', href: '/contact' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Terms of service', href: '/terms' },
    ],
  },
]

// Mirrors the legacy PaperFooter's policy row so the same legal links stay one
// click away from the bottom of every page.
const LEGAL = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Contact', href: '/contact' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Journal', href: '/blog' },
]

export default function WorkspaceFooter() {
  return (
    <footer className="mt-24 border-t border-paper-300 bg-white lg:mt-28">
      <div className="mx-auto max-w-[1240px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2.4fr)_minmax(0,0.7fr)]">
          <div>
            <div className="flex items-center gap-2 text-lamp-600">
              <NestMark className="h-6 w-6" />
              <span className="text-[18px] font-semibold tracking-[-0.02em] text-ai-graphite-900">
                Patent<span className="text-lamp-600">Nest</span>
              </span>
            </div>
            <p className="mt-3 text-[12.5px] leading-[1.6] text-paper-500">
              © {new Date().getFullYear()} PatentNest.ai
              <br />
              All rights reserved.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
            {COLUMNS.map((col) => (
              <div key={col.heading}>
                <p className="mb-3 text-[10.5px] font-medium uppercase tracking-[0.14em] text-paper-500">
                  {col.heading}
                </p>
                <ul className="space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link
                        href={l.href}
                        className="text-[13px] text-ai-graphite-700 transition-colors hover:text-lamp-600"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-3 text-[10.5px] font-medium uppercase tracking-[0.14em] text-lamp-600">
              Stay connected
            </p>
            <div className="flex items-center gap-3">
              <a
                href="https://www.linkedin.com"
                aria-label="LinkedIn"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-paper-300 text-paper-600 transition-colors hover:border-lamp-300 hover:text-lamp-600"
              >
                <Linkedin className="h-4 w-4" />
              </a>
              <a
                href="https://www.youtube.com"
                aria-label="YouTube"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-paper-300 text-paper-600 transition-colors hover:border-lamp-300 hover:text-lamp-600"
              >
                <Youtube className="h-4 w-4" />
              </a>
              <a
                href="https://x.com"
                aria-label="X"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-paper-300 text-paper-600 transition-colors hover:border-lamp-300 hover:text-lamp-600"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                  <path d="M18.9 2H22l-7.1 8.1L23.4 22h-6.8l-5.3-6.9L5.2 22H2l7.4-8.4L1.3 2h7l4.9 6.5L18.9 2Zm-1.2 18h1.9L6.4 3.9H4.4L17.7 20Z" />
                </svg>
              </a>
            </div>
          </div>
        </div>

        {/* policy row, carried over from the legacy homepage footer */}
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-paper-300 pt-6 sm:flex-row sm:items-center">
          <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {LEGAL.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-[12.5px] text-paper-600 transition-colors hover:text-lamp-600"
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper-500">
            © {new Date().getFullYear()} PatentNest.ai
          </p>
        </div>
      </div>
    </footer>
  )
}
