// Quiet document colophon for the /patentnest landing page — light, minimal,
// matching the paper canvas (the dark MinimalFooter belongs to the / theme).

import Link from 'next/link'

export default function PaperFooter() {
  return (
    <footer className="border-t border-ai-graphite-900/10">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:flex-row sm:px-6 lg:px-8">
        <div className="flex items-baseline gap-0.5">
          <span className="font-serif text-lg font-semibold tracking-tight text-ai-graphite-900">
            PatentNest
          </span>
          <span className="font-mono text-[11px] text-brass-600">.ai</span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2 text-sm text-ai-graphite-500">
          <Link href="/pricing" className="transition-colors hover:text-ai-graphite-900">Pricing</Link>
          <Link href="/contact" className="transition-colors hover:text-ai-graphite-900">Contact</Link>
          <Link href="/terms" className="transition-colors hover:text-ai-graphite-900">Terms</Link>
          <Link href="/privacy" className="transition-colors hover:text-ai-graphite-900">Privacy</Link>
        </nav>

        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ai-graphite-400">
          © 2026 PatentNest.ai
        </p>
      </div>
    </footer>
  )
}
