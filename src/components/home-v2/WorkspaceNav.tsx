'use client'

// Marketing-site nav for the /home-v2 exploration: white bar, hairline rule,
// hover/focus dropdowns (CSS-only, no JS state), cobalt "Start free" CTA.

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
      { label: 'Contact us', href: '/contact' },
    ],
  },
]

export default function WorkspaceNav() {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-50 border-b border-paper-300/70 bg-white/85 backdrop-blur-md">
      <nav className="mx-auto flex h-[68px] max-w-[1240px] items-center justify-between gap-6 px-5 sm:px-8">
        <Link href="/" className="flex flex-none items-center gap-2 text-lamp-600">
          <NestMark />
          <span className="text-[21px] font-semibold tracking-[-0.02em] text-ai-graphite-900">
            Patent<span className="text-lamp-600">Nest</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 lg:flex">
          {MENUS.map((menu) => (
            <div key={menu.label} className="group relative">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-3 py-2 text-[14.5px] text-ai-graphite-700 transition-colors hover:text-ai-graphite-900 group-focus-within:text-ai-graphite-900"
              >
                {menu.label}
                <ChevronDown className="h-3.5 w-3.5 text-paper-500 transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180" />
              </button>
              <div className="invisible absolute left-0 top-full w-[236px] translate-y-1 rounded-xl border border-paper-300 bg-white p-1.5 opacity-0 shadow-[0_16px_40px_-16px_rgba(16,24,40,0.22)] transition-all duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100">
                {menu.items.map((item) => (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="block rounded-lg px-3 py-2 text-[13.5px] text-ai-graphite-700 transition-colors hover:bg-[#f6f8fd] hover:text-lamp-600"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <Link
            href="/pricing"
            className="rounded-md px-3 py-2 text-[14.5px] text-ai-graphite-700 transition-colors hover:text-ai-graphite-900"
          >
            Pricing
          </Link>
          <Link
            href="/contact"
            className="rounded-md px-3 py-2 text-[14.5px] text-ai-graphite-700 transition-colors hover:text-ai-graphite-900"
          >
            Enterprise
          </Link>
        </div>

        <div className="flex flex-none items-center gap-3 sm:gap-5">
          {user ? (
            <Link
              href="/dashboard"
              className="rounded-lg bg-lamp-600 px-5 py-2.5 text-[14px] font-medium text-white transition-all duration-150 hover:bg-lamp-700 hover:shadow-[0_8px_20px_-10px_rgba(29,78,216,0.65)] active:scale-[0.98]"
            >
              Open workspace
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-[14.5px] text-ai-graphite-700 transition-colors hover:text-ai-graphite-900 sm:block"
              >
                Sign in
              </Link>
              <Link
                href="/free-trial"
                className="rounded-lg bg-lamp-600 px-5 py-2.5 text-[14px] font-medium text-white transition-all duration-150 hover:bg-lamp-700 hover:shadow-[0_8px_20px_-10px_rgba(29,78,216,0.65)] active:scale-[0.98]"
              >
                Request free trial
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
