'use client'

// Marketing-site nav, "Paper and Ink" treatment: warm vellum bar on a hairline
// rule, mono uppercase labels (the drafter's voice), squared corners, and a
// bordered rather than filled CTA so the hero's solid cobalt button stays the
// single loudest thing on the page. Dropdowns are CSS-only, no JS state.

import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import NestMark from './NestMark'

// Menu targets are limited to routes that exist and are reachable when signed
// out. Capabilities with a /features detail page link to it; the ones that don't
// have a page yet point at /pricing rather than /dashboard, which would bounce a
// signed-out visitor to the login screen.
const MENUS: { label: string; items: { label: string; href: string }[] }[] = [
  {
    label: 'Product',
    items: [
      { label: 'Novelty search and report', href: '/features/novelty-search-report' },
      { label: 'FER and office actions', href: '/features/fer-response' },
      { label: 'Whitespace studies', href: '/features/whitespace' },
      { label: 'Ideation', href: '/features/ideation' },
      { label: 'Drafting pipeline', href: '/features/drafting-pipeline' },
      { label: 'Writing personas', href: '/features/writing-personas' },
    ],
  },
  {
    label: 'Solutions',
    items: [
      { label: 'Patent firms', href: '/free-trial' },
      { label: 'Universities and TTOs', href: '/free-trial' },
      { label: 'R&D teams and startups', href: '/free-trial' },
      { label: 'Individual inventors', href: '/free-trial' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { label: 'Journal', href: '/blog' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Patent Intelligence API', href: '/features/patent-api' },
      { label: 'Contact us', href: '/contact' },
    ],
  },
]

export default function WorkspaceNav() {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-50 border-b border-vellum-400 bg-vellum-200/90 backdrop-blur-md">
      <nav className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="flex flex-none items-center gap-2 text-lamp-600">
          <NestMark />
          <span className="font-mono text-[14px] font-medium tracking-[0.1em] text-vellum-900">
            PATENTNEST
          </span>
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {MENUS.map((menu) => (
            <div key={menu.label} className="group relative">
              <button
                type="button"
                className="flex items-center gap-1 px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-vellum-600 transition-colors hover:text-vellum-900 group-focus-within:text-vellum-900"
              >
                {menu.label.toUpperCase()}
                <ChevronDown className="h-3 w-3 transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180" />
              </button>
              <div className="invisible absolute left-0 top-full w-[236px] translate-y-1 border border-vellum-900 bg-vellum-100 p-1 opacity-0 transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                {menu.items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="block px-3 py-2 text-[13.5px] text-vellum-700 transition-colors hover:bg-vellum-200 hover:text-lamp-600"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <Link
            href="/pricing"
            className="px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-vellum-600 transition-colors hover:text-vellum-900"
          >
            PRICING
          </Link>
          <Link
            href="/contact"
            className="px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-vellum-600 transition-colors hover:text-vellum-900"
          >
            ENTERPRISE
          </Link>
        </div>

        <div className="flex flex-none items-center gap-3 sm:gap-5">
          {user ? (
            <Link
              href="/dashboard"
              className="border border-vellum-900 px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-vellum-900 transition-colors duration-150 hover:bg-vellum-900 hover:text-vellum-100"
            >
              OPEN WORKSPACE
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden font-mono text-[10px] tracking-[0.12em] text-vellum-600 transition-colors hover:text-vellum-900 sm:block"
              >
                SIGN IN
              </Link>
              <Link
                href="/free-trial"
                className="border border-vellum-900 px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-vellum-900 transition-colors duration-150 hover:bg-vellum-900 hover:text-vellum-100"
              >
                REQUEST ACCESS
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
